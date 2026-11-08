import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { VertexAI } from "@google-cloud/vertexai";
import { simpleParser } from "mailparser";
import Busboy from "busboy";
import { buildEmailHtml, emailExtractionText, EMAIL_PIPELINE_VERSION, MAX_EMAIL_SOURCE_BYTES, type EmailDocumentSource } from "./email-content";
import { emailExtractionPrompt, validateEmailValues, type EmailValues } from "./email-intelligence";
import * as crypto from "crypto";
import type { Request } from "express";
import sharp from "sharp";
import { getFreePlanReceiptLimit } from "./app-config";
import { getEffectiveSubscriptionPlan } from "./subscription";

const receiptInboundDomain = defineSecret("RECEIPT_INBOUND_DOMAIN");
const emailIngestWebhookKey = defineSecret("EMAIL_INGEST_WEBHOOK_KEY");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "receipt-nest";
const VERTEX_LOCATION = "us-central1";

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_EMAIL = 6;
const MAX_ALIAS_LOCAL_PART_LENGTH = 64;
const RECEIPT_FORWARDING_ALIAS_COLLECTION = "receiptForwardingAliases";

const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "pdf",
]);

interface ParsedAttachment {
  fieldName: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  contentId?: string;
  disposition?: string;
}

interface ParsedInboundEmail {
  fields: Record<string, string>;
  attachments: ParsedAttachment[];
}

interface InboundEmailPayload {
  fields: Record<string, string>;
  attachments: ParsedAttachment[];
}

interface EmailExtractionResult extends EmailValues {
  source: "gemini" | "manual" | "email_rules";
  processedAt: admin.firestore.FieldValue;
}

interface ReceiptMerchant {
  canonicalId?: string;
  canonicalName: string;
  rawName: string;
  matchConfidence: number;
  matchedBy: "exact" | "fuzzy" | "alias" | "ai" | "manual";
}

interface EmailPreviewImageInput {
  subject: string;
  sender: string;
  merchantName: string;
  totalAmount?: number;
  currency?: string;
  transactionDate?: string;
  bodyText: string;
  status: "final" | "needs_review";
}


export const generateReceiptForwardingAddress = onCall(
  { region: "us-central1", secrets: [receiptInboundDomain] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be authenticated.");
    }

    const inboundDomain = receiptInboundDomain.value()?.trim().toLowerCase();
    if (!inboundDomain) {
      throw new HttpsError("failed-precondition", "Inbound email domain is not configured.");
    }

    const userId = request.auth.uid;
    const db = admin.firestore();
    const userRef = db.doc(`users/${userId}`);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    const existingToken = userSnap.get("receiptEmailToken");

    const token = typeof existingToken === "string" && existingToken.length >= 12
      ? existingToken
      : await generateUniqueReceiptToken();

    const alias = await resolvePrimaryAliasForUser(userId, userData);
    const primaryAddress = buildLocalForwardingAddress(alias, inboundDomain);
    const fallbackAddress = buildTokenForwardingAddress(token, inboundDomain);

    await userRef.set(
      {
        receiptEmailToken: token,
        receiptEmailAlias: alias,
        receiptForwardingAddress: primaryAddress,
        receiptForwardingFallbackAddresses: [fallbackAddress],
        receiptForwardingEnabled: true,
        receiptForwardingUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      emailAddress: primaryAddress,
      fallbackAddresses: [fallbackAddress],
    };
  }
);

export const inboundEmailWebhook = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    invoker: "public",
    secrets: [receiptInboundDomain, emailIngestWebhookKey],
  },
  async (req, res) => {
    if (req.method === "GET") {
      res.status(200).send("ReceiptNest inbound email webhook is live.");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const configuredWebhookKey = emailIngestWebhookKey.value();
    if (configuredWebhookKey) {
      const providedKey = typeof req.query.key === "string" ? req.query.key : "";
      if (providedKey !== configuredWebhookKey) {
        res.status(401).send("Unauthorized");
        return;
      }
    }

    const inboundDomain = receiptInboundDomain.value()?.trim().toLowerCase();
    if (!inboundDomain) {
      logger.error("Inbound email domain secret is missing.");
      res.status(500).send("Inbound domain is not configured.");
      return;
    }

    if (((req as Request & { rawBody?: Buffer }).rawBody?.length || 0) > MAX_EMAIL_SOURCE_BYTES) {
      res.status(413).send("Email exceeds the 28 MB ingestion limit.");
      return;
    }

    try {
      const parsedEmail = await parseInboundEmail(req);
      const parsedSize = Object.values(parsedEmail.fields).reduce((size, value) => size + Buffer.byteLength(value), 0)
        + parsedEmail.attachments.reduce((size, file) => size + file.data.length, 0);
      if (parsedSize > MAX_EMAIL_SOURCE_BYTES) { res.status(413).send("Email exceeds the 28 MB ingestion limit."); return; }
      const payload = await enrichInboundPayload(parsedEmail);
      const recipients = extractRecipientAddresses(payload.fields);
      logger.info("Parsed inbound email", {
        contentType: String(req.headers["content-type"] || ""),
        fieldKeys: Object.keys(payload.fields).slice(0, 40),
        hasAttachmentInfoField: !!payload.fields["attachment-info"],
        hasRawEmailField: !!payload.fields.email,
        recipients,
        attachmentCount: payload.attachments.length,
        attachments: payload.attachments.map((attachment) => ({
          fieldName: attachment.fieldName,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.data.length,
          allowed: isAllowedAttachment(attachment),
          resolvedMimeType: normalizeAttachmentMimeType(attachment),
        })),
      });

      if (recipients.length === 0) {
        logger.warn("Inbound email missing recipient addresses.");
        res.status(202).json({ ok: true, createdReceipts: 0, skipped: "missing_recipients" });
        return;
      }

      const recipientLocals = recipients
        .map((address) => extractRecipientLocalPart(address, inboundDomain))
        .filter((value): value is string => !!value);

      if (recipientLocals.length === 0) {
        logger.warn("Inbound email had no valid forwarding aliases.", { recipients });
        res.status(202).json({ ok: true, createdReceipts: 0, skipped: "no_matching_alias" });
        return;
      }

      const userIds = await findUsersByRecipientLocals(recipientLocals);

      if (userIds.size === 0) {
        logger.warn("No users found for forwarding aliases.", { recipientLocals });
        res.status(202).json({ ok: true, createdReceipts: 0, skipped: "unknown_alias" });
        return;
      }

      let createdReceipts = 0;
      const skippedUsers: string[] = [];

      for (const userId of userIds) {
        const canAcceptMore = await canUserAcceptNewReceipt(userId);
        if (!canAcceptMore) {
          skippedUsers.push(userId);
          continue;
        }

        const deliveryId = emailDeliveryId(payload);
        const ingestionRef = admin.firestore().doc(`users/${userId}/emailIngestions/${deliveryId}`);
        const claimed = await admin.firestore().runTransaction(async tx => {
          const snap = await tx.get(ingestionRef);
          if (snap.get("state") === "complete") return false;
          if (snap.get("leaseUntil")?.toMillis() > Date.now()) throw new Error("Email delivery is already being processed");
          tx.set(ingestionRef, { state: "processing", leaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 150000) });
          return true;
        });
        if (!claimed) continue;
        try {
          const archive = await saveEmailArchive(userId, deliveryId, payload);
          const validAttachments = payload.attachments
            .filter(attachment => isAllowedAttachment(attachment) && !isInlineEmailAsset(attachment, payload.fields))
            .slice(0, MAX_ATTACHMENTS_PER_EMAIL);
          if (validAttachments.length) {
            for (const [index, attachment] of validAttachments.entries()) {
              if (!await canUserAcceptNewReceipt(userId)) break;
              await saveAttachmentReceipt(userId, attachment, payload.fields, `${deliveryId}_${index}`, archive);
              createdReceipts++;
            }
          } else if (await saveTextOnlyReceipt(userId, payload.fields, deliveryId, archive)) createdReceipts++;
          await ingestionRef.set({ state: "complete", completedAt: admin.firestore.FieldValue.serverTimestamp() });
        } catch (error) {
          await ingestionRef.delete();
          throw error;
        }
      }

      res.status(200).json({
        ok: true,
        createdReceipts,
        processedUsers: Array.from(userIds),
        skippedUsers,
      });
    } catch (error) {
      logger.error("Inbound email ingestion failed.", error);
      res.status(500).json({ ok: false });
    }
  }
);

export async function parseInboundEmail(req: Request): Promise<ParsedInboundEmail> {
  const fields: Record<string, string> = {};
  const attachments: ParsedAttachment[] = [];
  const contentType = String(req.headers["content-type"] || "");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!contentType.toLowerCase().includes("multipart/form-data") || !rawBody?.length) {
    for (const [key, value] of Object.entries((req.body || {}) as Record<string, unknown>)) {
      if (typeof value === "string") fields[key] = value;
      else if (value !== undefined && value !== null) fields[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    return { fields, attachments };
  }
  await new Promise<void>((resolve, reject) => {
    const parser = Busboy({ headers: { "content-type": contentType }, limits: {
      fileSize: MAX_EMAIL_SOURCE_BYTES, fieldSize: MAX_EMAIL_SOURCE_BYTES, fields: 100, files: 100, parts: 200,
    } });
    parser.on("field", (name, value, info) => {
      if (info.valueTruncated || info.nameTruncated) reject(new Error("Email field exceeds limit"));
      fields[name] = value;
    });
    parser.on("file", (fieldName, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("limit", () => reject(new Error("Email attachment exceeds limit")));
      stream.on("end", () => attachments.push({ fieldName, fileName: sanitizeFileName(info.filename || `${fieldName}.bin`),
        mimeType: info.mimeType, data: Buffer.concat(chunks) }));
    });
    for (const event of ["partsLimit", "filesLimit", "fieldsLimit"] as const) parser.on(event, () => reject(new Error("Email has too many MIME parts")));
    parser.on("error", reject);
    parser.on("close", resolve);
    parser.end(rawBody);
  });
  return { fields, attachments };
}

function extractRecipientAddresses(fields: Record<string, string>): string[] {
  const candidates = new Set<string>();
  const addressRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  const parseFromText = (value?: string) => {
    if (!value) return;
    for (const match of value.match(addressRegex) || []) {
      candidates.add(match.toLowerCase());
    }
  };

  parseFromText(fields.to);
  parseFromText(fields.cc);
  parseFromText(fields.envelope);

  if (fields.envelope) {
    try {
      const envelope = JSON.parse(fields.envelope) as { to?: string[] };
      if (Array.isArray(envelope.to)) {
        for (const address of envelope.to) {
          parseFromText(address);
        }
      }
    } catch {
      // Ignore malformed envelope payload
    }
  }

  return Array.from(candidates);
}

function extractRecipientLocalPart(address: string, inboundDomain: string): string | null {
  const [localRaw, domainRaw] = address.toLowerCase().split("@");
  if (!localRaw || !domainRaw) {
    return null;
  }

  if (domainRaw !== inboundDomain) {
    return null;
  }

  const localPart = localRaw.split("+")[0].trim();
  if (!isValidAliasLocalPart(localPart)) {
    return null;
  }

  return localPart;
}

async function findUsersByRecipientLocals(recipientLocals: string[]): Promise<Set<string>> {
  const uniqueLocals = Array.from(new Set(recipientLocals));
  const tokenCandidates = new Set<string>();
  const aliasCandidates = new Set<string>();

  for (const local of uniqueLocals) {
    aliasCandidates.add(local);
    const tokenCandidate = extractTokenFromLocalPart(local);
    if (tokenCandidate) {
      tokenCandidates.add(tokenCandidate);
    }
  }

  const db = admin.firestore();
  const matchedUserIds = new Set<string>();

  const tokenLookups = await Promise.all(Array.from(tokenCandidates).map(async (token) => {
    const snapshot = await db
      .collection("users")
      .where("receiptEmailToken", "==", token)
      .limit(1)
      .get();
    if (snapshot.empty) {
      return null;
    }
    return snapshot.docs[0].id;
  }));

  for (const userId of tokenLookups) {
    if (userId) {
      matchedUserIds.add(userId);
    }
  }

  const aliasReservationLookups = await Promise.all(Array.from(aliasCandidates).map(async (alias) => {
    const snapshot = await db.doc(`${RECEIPT_FORWARDING_ALIAS_COLLECTION}/${alias}`).get();
    const reservedUserId = snapshot.get("userId");
    return typeof reservedUserId === "string" && reservedUserId ? reservedUserId : null;
  }));

  for (const userId of aliasReservationLookups) {
    if (userId) {
      matchedUserIds.add(userId);
    }
  }

  const unresolvedAliases = Array.from(aliasCandidates).filter((_, index) => !aliasReservationLookups[index]);
  const aliasLookups = await Promise.all(unresolvedAliases.map(async (alias) => {
    const snapshot = await db
      .collection("users")
      .where("receiptEmailAlias", "==", alias)
      .limit(1)
      .get();
    if (snapshot.empty) {
      return null;
    }
    return snapshot.docs[0].id;
  }));

  for (const userId of aliasLookups) {
    if (userId) {
      matchedUserIds.add(userId);
    }
  }

  return matchedUserIds;
}

async function saveAttachmentReceipt(
  userId: string,
  attachment: ParsedAttachment,
  fields: Record<string, string>,
  deliveryId: string,
  archive: EmailArchive
): Promise<void> {
  const receiptRef = admin.firestore().doc(`users/${userId}/receipts/email_${deliveryId}`);
  if ((await receiptRef.get()).exists) return;
  const resolvedMimeType = normalizeAttachmentMimeType(attachment) || "application/octet-stream";
  const storagePath = `users/${userId}/receipts/email_${deliveryId}_${sanitizeFileName(attachment.fileName)}`;
  const bucket = admin.storage().bucket();
  await bucket.file(storagePath).save(attachment.data, {
    metadata: { metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() }, contentType: resolvedMimeType },
  });

  await receiptRef.create({
    id: receiptRef.id,
    userId,
    status: "uploaded",
    file: {
      storagePath,
      originalName: attachment.fileName,
      mimeType: resolvedMimeType,
      sizeBytes: attachment.data.length,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    source: "email",
    email: {
      from: fields.from || "",
      to: fields.to || "",
      subject: fields.subject || "",
      messageId: extractMessageId(fields),
      ...archive.metadata,
      ingestMode: "attachment",
      renderStatus: "queued",
      renderRequestId: crypto.randomBytes(8).toString("hex"),
      renderAttempts: 0,
      ingestedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

}

interface EmailArchive {
  document: EmailDocumentSource;
  metadata: Record<string, unknown>;
}

export function emailDeliveryId(payload: InboundEmailPayload): string {
  const hash = crypto.createHash("sha256");
  hash.update(extractMessageId(payload.fields) || payload.fields.headers || "");
  hash.update(payload.fields.subject || ""); hash.update(payload.fields.text || ""); hash.update(payload.fields.html || "");
  for (const attachment of payload.attachments) hash.update(attachment.data);
  return hash.digest("hex").slice(0, 32);
}

export function isInlineEmailAsset(attachment: ParsedAttachment, fields: Record<string, string>): boolean {
  if (attachment.disposition === "inline") return true;
  return !!attachment.contentId && (fields.html || "").includes(`cid:${attachment.contentId.replace(/^<|>$/g, "")}`);
}

async function saveEmailArchive(userId: string, deliveryId: string, payload: InboundEmailPayload): Promise<EmailArchive> {
  const base = `users/${userId}/receipts/email_${deliveryId}`;
  const document: EmailDocumentSource = {
    subject: payload.fields.subject || "", sender: payload.fields.from || "", recipient: payload.fields.to || "",
    sentAt: payload.fields.date || payload.fields.headers?.match(/^date:\s*(.+)$/im)?.[1] || "", html: extractHtmlFromEmailFields(payload.fields),
    text: payload.fields.text || payload.fields["stripped-text"] || "", inlineImages: {},
  };
  for (const attachment of payload.attachments) {
    if (attachment.contentId && /^image\/(?:png|jpe?g|gif|webp|avif)$/i.test(attachment.mimeType)) {
      document.inlineImages![attachment.contentId.replace(/^<|>$/g, "")] = `data:${attachment.mimeType};base64,${attachment.data.toString("base64")}`;
    }
  }
  const bucket = admin.storage().bucket();
  const sourceStoragePath = `${base}_source.json`;
  const rawStoragePath = payload.fields.email ? `${base}_original.eml` : null;
  const documentStoragePath = `${base}_document.json`;
  const textStoragePath = `${base}_body.txt`;
  const htmlStoragePath = `${base}_preview.html`;
  const source = JSON.stringify({ version: EMAIL_PIPELINE_VERSION, fields: payload.fields,
    attachments: payload.attachments.map(a => ({ ...a, data: a.data.toString("base64") })) });
  if (Buffer.byteLength(source) > MAX_EMAIL_SOURCE_BYTES * 2) throw new Error("Email archive too large");
  const writes = [
    bucket.file(sourceStoragePath).save(Buffer.from(source), { metadata: { metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() }, contentType: "application/json", cacheControl: "private, no-store" } }),
    bucket.file(documentStoragePath).save(Buffer.from(JSON.stringify(document)), { metadata: { metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() }, contentType: "application/json", cacheControl: "private, no-store" } }),
    bucket.file(textStoragePath).save(Buffer.from(document.text || emailExtractionText(document.html, "")), { metadata: { metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() }, contentType: "text/plain; charset=utf-8" } }),
    bucket.file(htmlStoragePath).save(Buffer.from(buildEmailHtml(document)), { metadata: { metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() }, contentType: "text/html; charset=utf-8", cacheControl: "private, no-store" } }),
  ];
  if (rawStoragePath) writes.push(bucket.file(rawStoragePath).save(Buffer.from(payload.fields.email), { metadata: { metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() }, contentType: "message/rfc822", cacheControl: "private, no-store" } }));
  await Promise.all(writes);
  return { document, metadata: { sourceStoragePath, rawStoragePath, documentStoragePath, textStoragePath, htmlStoragePath, initialHtmlStoragePath: htmlStoragePath,
    pipelineVersion: EMAIL_PIPELINE_VERSION, originalFormat: rawStoragePath ? "rfc822" : "provider_payload" } };
}

async function saveTextOnlyReceipt(
  userId: string, fields: Record<string, string>, deliveryId: string, archive: EmailArchive
): Promise<boolean> {
  const { subject, sender, recipient, html, text } = archive.document;
  const body = emailExtractionText(html, text);
  if (!subject && !body) return false;
  const receiptRef = admin.firestore().doc(`users/${userId}/receipts/email_${deliveryId}_body`);
  if ((await receiptRef.get()).exists) return true;
  const extraction = await extractFromEmailContent(subject, sender, body);
  const merchantName = extraction.supplierName?.value || "Email Receipt";
  const merchant = await normalizeMerchant(userId, merchantName, extraction.supplierName?.confidence || 0.5);
  const status = extraction.reviewReasons.length ? "needs_review" : "final";
  const previewStoragePath = `users/${userId}/receipts/email_${deliveryId}_preview.png`;
  let file = {
    storagePath: archive.metadata.htmlStoragePath as string,
    originalName: `${sanitizeFileName(subject || "email")}.html`, mimeType: "text/html",
    sizeBytes: Buffer.byteLength(buildEmailHtml(archive.document)), uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  let previewGenerated = false;
  try {
    const preview = await generateEmailPreviewImage({ subject, sender, merchantName,
      totalAmount: extraction.totalAmount?.value, currency: extraction.currency?.value,
      transactionDate: extraction.date?.value, bodyText: body, status });
    await admin.storage().bucket().file(previewStoragePath).save(preview, {
      metadata: { metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() }, contentType: "image/png" },
    });
    file = { storagePath: previewStoragePath, originalName: `${sanitizeFileName(subject || "email")}_preview.png`,
      mimeType: "image/png", sizeBytes: preview.length, uploadedAt: admin.firestore.FieldValue.serverTimestamp() };
    previewGenerated = true;
  } catch (error) { logger.warn("Temporary email thumbnail unavailable; keeping full HTML preview", { error }); }
  await receiptRef.create({
    id: receiptRef.id, userId, source: "email", status, skipProcessing: true,
    file,
    extraction, merchant, category: extraction.category,
    ...(extraction.totalAmount ? { totalAmount: extraction.totalAmount.value } : {}),
    ...(extraction.currency ? { currency: extraction.currency.value } : {}),
    ...(extraction.date ? { date: extraction.date.value } : {}),
    email: { ...archive.metadata, from: sender, to: recipient, subject, messageId: extractMessageId(fields),
      ingestMode: "text_fallback", previewStoragePath: previewGenerated ? previewStoragePath : null, previewGenerated, pdfGenerated: false,
      renderStatus: "queued", renderRequestId: crypto.randomBytes(8).toString("hex"), renderAttempts: 0,
      ingestedAt: admin.firestore.FieldValue.serverTimestamp() },
    notes: `Imported from forwarded email${subject ? `: ${subject}` : ""}.`,
    processedAt: admin.firestore.FieldValue.serverTimestamp(), createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return true;
}

async function extractFromEmailContent(subject: string, sender: string, text: string): Promise<EmailExtractionResult> {
  const labeled = validateEmailValues({}, text, sender);
  if (labeled.transactionType === "money_transfer" && !labeled.reviewReasons.length) {
    return { ...labeled, source: "email_rules", processedAt: admin.firestore.FieldValue.serverTimestamp() };
  }
  let parsed: Record<string, unknown> = {};
  let source: "gemini" | "manual" = "manual";
  try {
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: VERTEX_LOCATION });
    const model = vertexAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: {
      temperature: 0, maxOutputTokens: 1600, responseMimeType: "application/json",
    } });
    const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: emailExtractionPrompt(subject, sender, text) }] }] });
    parsed = parseJsonPayload(result.response.candidates?.[0]?.content?.parts?.[0]?.text || "");
    source = "gemini";
  } catch (error) { logger.warn("Email AI extraction unavailable; validating labeled source fields", { error }); }
  return { ...validateEmailValues(parsed, text, sender), source, processedAt: admin.firestore.FieldValue.serverTimestamp() };
}

async function generateEmailPreviewImage(input: EmailPreviewImageInput): Promise<Buffer> {
  const width = 1200;
  const height = 1600;
  const statusColor = input.status === "final" ? "#0f766e" : "#b45309";
  const statusBg = input.status === "final" ? "#ccfbf1" : "#fef3c7";
  const statusLabel = input.status === "final" ? "Auto-classified" : "Review required";
  const merchant = input.merchantName || "Email Receipt";
  const amount = formatEmailPreviewAmount(input.totalAmount, input.currency);
  const dateLabel = formatEmailPreviewDate(input.transactionDate);
  const sender = input.sender || "(unknown sender)";
  const subject = input.subject || "(no subject)";

  const subjectLines = wrapTextForPreview(subject, 42, 2);
  const cleanExcerpt = buildCleanPreviewExcerpt(input.bodyText);
  const excerptLines = wrapTextForPreview(
    cleanExcerpt || "No readable email body content was detected.",
    58,
    10
  );
  const generatedAt = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const subjectNodes = subjectLines
    .map((line, index) =>
      `<text x="120" y="${310 + index * 44}" class="subject">${escapeSvgText(line)}</text>`
    )
    .join("");

  const excerptNodes = excerptLines
    .map((line, index) =>
      `<text x="120" y="${880 + index * 34}" class="excerpt">${escapeSvgText(line)}</text>`
    )
    .join("");

  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eef2ff"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#0f172a" flood-opacity="0.18"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="70" y="70" width="1060" height="1460" rx="40" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="70" y="70" width="1060" height="120" rx="40" fill="#0f172a"/>
  <rect x="70" y="150" width="1060" height="40" fill="#0f172a"/>
  <text x="120" y="145" class="title">ReceiptNest Email Receipt</text>

  <rect x="880" y="250" width="190" height="44" rx="22" fill="${statusBg}"/>
  <text x="975" y="278" text-anchor="middle" class="status" fill="${statusColor}">${escapeSvgText(statusLabel)}</text>

  <text x="120" y="245" class="label">Subject</text>
  ${subjectNodes}

  <text x="120" y="420" class="label">From</text>
  <text x="120" y="465" class="value">${escapeSvgText(sender)}</text>

  <line x1="120" y1="530" x2="1080" y2="530" stroke="#e2e8f0" stroke-width="2"/>

  <text x="120" y="590" class="label">Merchant</text>
  <text x="120" y="642" class="merchant">${escapeSvgText(merchant)}</text>

  <text x="120" y="730" class="label">Detected Total</text>
  <text x="120" y="790" class="amount">${escapeSvgText(amount)}</text>

  <text x="680" y="730" class="label">Date</text>
  <text x="680" y="790" class="value">${escapeSvgText(dateLabel)}</text>

  <line x1="120" y1="835" x2="1080" y2="835" stroke="#e2e8f0" stroke-width="2"/>

  <text x="120" y="850" class="label">Email body excerpt</text>
  ${excerptNodes}

  <line x1="120" y1="1320" x2="1080" y2="1320" stroke="#e2e8f0" stroke-width="2"/>
  <text x="120" y="1370" class="foot">Generated ${escapeSvgText(generatedAt)}</text>
  <text x="120" y="1410" class="foot">No attachment found. Preview created from extracted email content.</text>

  <style>
    .title { font-family: Arial, sans-serif; font-size: 42px; font-weight: 700; fill: #f8fafc; }
    .label { font-family: Arial, sans-serif; font-size: 28px; font-weight: 600; fill: #475569; }
    .subject { font-family: Arial, sans-serif; font-size: 40px; font-weight: 700; fill: #0f172a; }
    .value { font-family: Arial, sans-serif; font-size: 34px; font-weight: 500; fill: #0f172a; }
    .merchant { font-family: Arial, sans-serif; font-size: 52px; font-weight: 800; fill: #0f172a; }
    .amount { font-family: Arial, sans-serif; font-size: 64px; font-weight: 800; fill: #065f46; }
    .excerpt { font-family: Arial, sans-serif; font-size: 30px; font-weight: 400; fill: #1e293b; }
    .status { font-family: Arial, sans-serif; font-size: 18px; font-weight: 700; }
    .foot { font-family: Arial, sans-serif; font-size: 26px; font-weight: 400; fill: #64748b; }
  </style>
</svg>
`;

  return sharp(Buffer.from(svg, "utf8"))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function wrapTextForPreview(value: string, maxCharsPerLine: number, maxLines: number): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  let consumedWords = 0;

  for (const word of words) {
    consumedWords += 1;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      if (lines.length >= maxLines) {
        break;
      }
    }

    if (word.length > maxCharsPerLine) {
      current = `${word.slice(0, Math.max(maxCharsPerLine - 3, 1))}...`;
    } else {
      current = word;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length === 0) {
    return [normalized.slice(0, maxCharsPerLine)];
  }

  if (consumedWords < words.length || lines.join(" ").length < normalized.length) {
    const lastIndex = Math.min(lines.length - 1, maxLines - 1);
    const lastLine = lines[lastIndex];
    if (lastLine && !lastLine.endsWith("...")) {
      lines[lastIndex] = `${lastLine.slice(0, Math.max(maxCharsPerLine - 3, 1))}...`;
    }
  }

  return lines.slice(0, maxLines);
}

function buildCleanPreviewExcerpt(value: string): string {
  if (!value) {
    return "";
  }

  const normalized = value
    .replace(/\u0000/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }

  const candidates = normalized
    .split(/(?<=[.!?])\s+|(?:\s{2,})|(?:\s*[|•]\s*)/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);

  const cleanParts: string[] = [];
  for (const rawPart of candidates) {
    let part = rawPart
      .replace(/=[A-Fa-f0-9]{2}/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!part || isPreviewNoiseSegment(part)) {
      continue;
    }

    if (part.length > 180) {
      part = `${part.slice(0, 177)}...`;
    }
    cleanParts.push(part);

    if (cleanParts.join(" ").length > 700 || cleanParts.length >= 12) {
      break;
    }
  }

  if (cleanParts.length === 0) {
    return "";
  }

  const joined = cleanParts.join(" ");
  return joined.length > 700 ? `${joined.slice(0, 697)}...` : joined;
}

function isPreviewNoiseSegment(value: string): boolean {
  const lower = value.toLowerCase();

  if (
    lower.includes("content-type:") ||
    lower.includes("content-transfer-encoding") ||
    lower.includes("mime-version:") ||
    lower.includes("boundary=") ||
    lower.includes("dkim-signature:") ||
    lower.includes("authentication-results:") ||
    lower.includes("unsubscribe") ||
    lower.includes("list-unsubscribe") ||
    lower.includes("received:") ||
    lower.includes("return-path:")
  ) {
    return true;
  }

  if (/[A-Za-z0-9+/=]{40,}/.test(value)) {
    return true;
  }

  const alphaCount = (value.match(/[A-Za-z]/g) || []).length;
  const symbolCount = (value.match(/[^A-Za-z0-9\s]/g) || []).length;
  if (alphaCount < 3) {
    return true;
  }
  if (symbolCount > alphaCount * 0.8 && value.length > 20) {
    return true;
  }

  const maxTokenLength = value.split(/\s+/).reduce((max, token) => Math.max(max, token.length), 0);
  if (maxTokenLength > 45) {
    return true;
  }

  return false;
}

function formatEmailPreviewAmount(totalAmount: number | undefined, currency: string | undefined): string {
  if (typeof totalAmount !== "number" || !isFinite(totalAmount) || totalAmount <= 0) {
    return "Amount not detected";
  }

  const normalizedCurrency = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(totalAmount);
  } catch {
    return `${totalAmount.toFixed(2)} ${normalizedCurrency}`;
  }
}

function formatEmailPreviewDate(transactionDate: string | undefined): string {
  if (!transactionDate) {
    return "Date not detected";
  }

  const parsed = new Date(transactionDate);
  if (isNaN(parsed.getTime())) {
    return transactionDate;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function normalizeMerchant(
  userId: string,
  rawName: string,
  confidence: number
): Promise<ReceiptMerchant> {
  const db = admin.firestore();

  const cleanedName = rawName
    .replace(/[#\d]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");

  const canonicalName = cleanedName || rawName;
  const merchantsRef = db.collection(`users/${userId}/merchants`);
  const snapshot = await merchantsRef.get();

  for (const doc of snapshot.docs) {
    const merchant = doc.data();
    const aliases: string[] = merchant.aliases || [];
    if (aliases.some((a) => a.toLowerCase() === rawName.toLowerCase())) {
      return {
        canonicalId: doc.id,
        canonicalName: merchant.canonicalName,
        rawName,
        matchConfidence: 1,
        matchedBy: "alias",
      };
    }

    if (
      aliases.some((a) =>
        a.toLowerCase().includes(canonicalName.toLowerCase()) ||
        canonicalName.toLowerCase().includes(a.toLowerCase())
      )
    ) {
      return {
        canonicalId: doc.id,
        canonicalName: merchant.canonicalName,
        rawName,
        matchConfidence: 0.8,
        matchedBy: "fuzzy",
      };
    }
  }

  const merchantRef = await merchantsRef.add({
    userId,
    canonicalName,
    aliases: [rawName],
    receiptCount: 0,
    totalSpend: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    canonicalId: merchantRef.id,
    canonicalName,
    rawName,
    matchConfidence: confidence,
    matchedBy: "ai",
  };
}

function parseJsonPayload(rawResponse: string): Record<string, unknown> {
  if (!rawResponse) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawResponse);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {};
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

function extractHtmlFromEmailFields(fields: Record<string, string>): string {
  const directHtml = normalizeEmailHtml(fields.html || fields["stripped-html"] || "");
  if (directHtml) {
    return directHtml;
  }

  return "";
}

function normalizeEmailHtml(value: string): string {
  if (!value) {
    return "";
  }

  const compact = value.replace(/\u0000/g, "").trim();
  if (!compact) {
    return "";
  }

  return compact;
}

function extractMessageId(fields: Record<string, string>): string | null {
  const direct = fields["message-id"] || fields["Message-Id"] || fields["Message-ID"];
  if (direct) {
    return direct.trim();
  }

  const headers = fields.headers || "";
  const match = headers.match(/message-id:\s*([^\r\n]+)/i);
  return match ? match[1].trim() : null;
}

function isAllowedAttachment(attachment: ParsedAttachment): boolean {
  const mimeType = normalizeAttachmentMimeType(attachment);
  if (!mimeType) {
    return false;
  }
  return attachment.data.length > 0 && attachment.data.length <= MAX_ATTACHMENT_SIZE_BYTES;
}

export async function enrichInboundPayload(parsed: ParsedInboundEmail): Promise<InboundEmailPayload> {
  const fields: Record<string, string> = { ...parsed.fields };
  const attachments = [...parsed.attachments];
  if (fields.email) {
    const message = await simpleParser(fields.email, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
    fields.html ||= typeof message.html === "string" ? message.html : "";
    fields.text ||= message.text || "";
    fields.subject ||= message.subject || "";
    fields.from ||= message.from?.text || "";
    fields.to ||= Array.isArray(message.to) ? message.to.map(a => a.text).join(", ") : message.to?.text || "";
    fields.date ||= message.date?.toISOString() || "";
    fields["message-id"] ||= message.messageId || "";
    for (const attachment of message.attachments) {
      if (attachment.contentType === "message/rfc822") {
        const inner = await simpleParser(attachment.content, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
        if (inner.html || inner.text) { fields.html = typeof inner.html === "string" ? inner.html : ""; fields.text = inner.text || ""; }
        for (const a of inner.attachments) attachments.push({ fieldName: `mime_${attachments.length}`, fileName: a.filename || "attachment", mimeType: a.contentType, data: a.content, contentId: a.contentId, disposition: a.contentDisposition });
      } else attachments.push({ fieldName: `mime_${attachments.length}`, fileName: attachment.filename || "attachment", mimeType: attachment.contentType,
        data: attachment.content, contentId: attachment.contentId, disposition: attachment.contentDisposition });
    }
  }
  let info: Record<string, { "content-id"?: string; disposition?: string }> = {};
  try { info = JSON.parse(fields["attachment-info"] || "{}"); } catch { /* optional provider metadata */ }
  let contentIds: Record<string, string> = {};
  try { contentIds = JSON.parse(fields["content-ids"] || "{}"); } catch { /* optional provider metadata */ }
  for (const attachment of attachments) {
    attachment.contentId ||= info[attachment.fieldName]?.["content-id"] || Object.keys(contentIds).find(id => contentIds[id] === attachment.fieldName);
    attachment.disposition ||= info[attachment.fieldName]?.disposition;
  }


  if (!fields.text && fields["stripped-text"]) {
    fields.text = fields["stripped-text"];
  }
  if (!fields.html && fields["stripped-html"]) {
    fields.html = fields["stripped-html"];
  }

  if (attachments.length === 0 && fields["attachment-info"]) {
    const infoAttachments = extractAttachmentsFromAttachmentInfo(fields);
    if (infoAttachments.length > 0) {
      attachments.push(...infoAttachments);
    }
  }

  // SendGrid can deliver a forward-as-attachment as a parsed file instead of a raw message.
  if (!fields.email) {
    for (const attachment of attachments.filter(a => a.mimeType === "message/rfc822" || /\.eml$/i.test(a.fileName))) {
      const inner = await simpleParser(attachment.data, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
      if (inner.html || inner.text) { fields.html = typeof inner.html === "string" ? inner.html : ""; fields.text = inner.text || ""; }
      for (const a of inner.attachments) attachments.push({ fieldName: `mime_${attachments.length}`, fileName: a.filename || "attachment", mimeType: a.contentType, data: a.content, contentId: a.contentId, disposition: a.contentDisposition });
    }
  }
  for (const attachment of attachments) attachment.contentId ||= info[attachment.fieldName]?.["content-id"] || Object.keys(contentIds).find(id => contentIds[id] === attachment.fieldName);
  const deduped = dedupeAttachments(attachments);
  return { fields, attachments: deduped };
}

function dedupeAttachments(attachments: ParsedAttachment[]): ParsedAttachment[] {
  const seen = new Set<string>();
  const deduped: ParsedAttachment[] = [];
  for (const attachment of attachments) {
    const signature = `${attachment.fileName.toLowerCase()}::${crypto.createHash("sha256").update(attachment.data).digest("hex")}`;
    if (seen.has(signature)) {
      const previous = deduped.find(a => `${a.fileName.toLowerCase()}::${crypto.createHash("sha256").update(a.data).digest("hex")}` === signature);
      if (previous) { previous.contentId ||= attachment.contentId; previous.disposition ||= attachment.disposition; }
      continue;
    }
    seen.add(signature);
    deduped.push(attachment);
  }
  return deduped;
}

function extractAttachmentsFromAttachmentInfo(fields: Record<string, string>): ParsedAttachment[] {
  const infoRaw = fields["attachment-info"];
  if (!infoRaw) {
    return [];
  }

  let parsedInfo: Record<string, { filename?: string; type?: string }>;
  try {
    parsedInfo = JSON.parse(infoRaw) as Record<string, { filename?: string; type?: string }>;
  } catch {
    return [];
  }

  const attachments: ParsedAttachment[] = [];
  for (const [fieldName, metadata] of Object.entries(parsedInfo || {})) {
    const rawPayload = fields[fieldName];
    if (!rawPayload) {
      continue;
    }

    const data = decodePotentialBase64(rawPayload);
    if (!data || data.length === 0 || data.length > MAX_ATTACHMENT_SIZE_BYTES) {
      continue;
    }

    const fileName = sanitizeFileName(metadata?.filename || `${fieldName}.bin`);
    const mimeType = (metadata?.type || "application/octet-stream").toLowerCase();
    attachments.push({
      fieldName,
      fileName,
      mimeType,
      data,
    });
  }

  return attachments;
}

function decodePotentialBase64(value: string): Buffer | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.includes("\"type\":\"Buffer\"")) {
    try {
      const parsed = JSON.parse(trimmed) as { type?: string; data?: number[] };
      if (parsed.type === "Buffer" && Array.isArray(parsed.data)) {
        const fromArray = Buffer.from(parsed.data);
        return fromArray.length > 0 ? fromArray : null;
      }
    } catch {
      // Ignore malformed JSON and continue with base64 decode path.
    }
  }

  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length < 16 || compact.length % 4 !== 0) {
    return null;
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) {
    return null;
  }

  try {
    const data = Buffer.from(compact, "base64");
    if (data.length === 0) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function normalizeAttachmentMimeType(attachment: ParsedAttachment): string | null {
  const rawMimeType = String(attachment.mimeType || "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_ATTACHMENT_TYPES.has(rawMimeType)) {
    return rawMimeType;
  }

  const extension = getFileExtension(attachment.fileName);
  if (!extension || !ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    return null;
  }

  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "pdf":
      return "application/pdf";
    default:
      return null;
  }
}

function getFileExtension(fileName: string): string | null {
  const cleaned = fileName.trim().toLowerCase();
  const dotIndex = cleaned.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === cleaned.length - 1) {
    return null;
  }

  return cleaned.slice(dotIndex + 1);
}

function sanitizeFileName(name: string): string {
  const safe = name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe.slice(0, 120) || "receipt";
}

function buildTokenForwardingAddress(token: string, inboundDomain: string): string {
  return `r-${token}@${inboundDomain}`;
}

function buildLocalForwardingAddress(localPart: string, inboundDomain: string): string {
  return `${localPart}@${inboundDomain}`;
}

function isValidAliasLocalPart(localPart: string): boolean {
  return /^[a-z0-9._-]{3,64}$/.test(localPart);
}

function sanitizeAliasSegment(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function buildAliasBase(
  userData: admin.firestore.DocumentData,
  userId: string
): string {
  const first = sanitizeAliasSegment(String(userData.firstName || ""));
  const last = sanitizeAliasSegment(String(userData.lastName || ""));

  if (first && last) {
    return `${first}.${last}`.slice(0, MAX_ALIAS_LOCAL_PART_LENGTH);
  }

  if (first) {
    return first.slice(0, MAX_ALIAS_LOCAL_PART_LENGTH);
  }

  const email = String(userData.email || "").toLowerCase();
  const emailLocal = sanitizeAliasSegment(email.split("@")[0] || "");
  if (emailLocal.length >= 3) {
    return emailLocal.slice(0, MAX_ALIAS_LOCAL_PART_LENGTH);
  }

  return `user.${userId.slice(0, 8)}`.toLowerCase();
}

function hasReadableNameAliasPreference(userData: admin.firestore.DocumentData): boolean {
  const first = sanitizeAliasSegment(String(userData.firstName || ""));
  const last = sanitizeAliasSegment(String(userData.lastName || ""));
  return Boolean(first && last);
}

function looksLikeGeneratedFallbackAlias(alias: string, userId: string): boolean {
  const normalized = alias.toLowerCase();
  return normalized === `user.${userId.slice(0, 8).toLowerCase()}`;
}

function extractTokenFromLocalPart(localPart: string): string | null {
  let candidate = localPart.toLowerCase();
  if (candidate.startsWith("r-")) {
    candidate = candidate.slice(2);
  }

  if (!/^[a-z0-9]{12,64}$/.test(candidate)) {
    return null;
  }

  return candidate;
}

async function resolvePrimaryAliasForUser(
  userId: string,
  userData: admin.firestore.DocumentData
): Promise<string> {
  const existingAlias = String(userData.receiptEmailAlias || "").toLowerCase();
  const shouldUpgradeExistingAlias =
    hasReadableNameAliasPreference(userData) && looksLikeGeneratedFallbackAlias(existingAlias, userId);
  if (
    isValidAliasLocalPart(existingAlias) &&
    !looksLikeLegacyTokenAlias(existingAlias) &&
    !shouldUpgradeExistingAlias
  ) {
    const claimedExistingAlias = await tryClaimAlias(userId, existingAlias);
    if (claimedExistingAlias) {
      return claimedExistingAlias;
    }
  }

  const baseAlias = buildAliasBase(userData, userId);
  return allocateUniqueAlias(userId, baseAlias);
}

async function tryClaimAlias(userId: string, alias: string): Promise<string | null> {
  const normalizedAlias = alias.toLowerCase();
  if (!isValidAliasLocalPart(normalizedAlias)) {
    return null;
  }

  const db = admin.firestore();
  const aliasRef = db.doc(`${RECEIPT_FORWARDING_ALIAS_COLLECTION}/${normalizedAlias}`);

  return db.runTransaction(async (transaction) => {
    const aliasSnap = await transaction.get(aliasRef);
    if (aliasSnap.exists) {
      return aliasSnap.get("userId") === userId ? normalizedAlias : null;
    }

    transaction.set(aliasRef, {
      alias: normalizedAlias,
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return normalizedAlias;
  });
}

async function allocateUniqueAlias(userId: string, baseAlias: string): Promise<string> {
  const normalizedBase = baseAlias
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, MAX_ALIAS_LOCAL_PART_LENGTH);

  const fallbackBase = normalizedBase.length >= 3
    ? normalizedBase
    : `user.${userId.slice(0, 8)}`;

  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? "" : `${attempt + 1}`;
    const maxBaseLength = MAX_ALIAS_LOCAL_PART_LENGTH - suffix.length;
    const candidate = `${fallbackBase.slice(0, maxBaseLength)}${suffix}`;
    if (!isValidAliasLocalPart(candidate)) {
      continue;
    }

    const claimedAlias = await tryClaimAlias(userId, candidate);
    if (claimedAlias) {
      return claimedAlias;
    }
  }

  throw new HttpsError("resource-exhausted", "Unable to allocate a readable forwarding alias right now.");
}

function looksLikeLegacyTokenAlias(alias: string): boolean {
  const normalized = alias.toLowerCase();
  return /^r-[a-f0-9]{20}$/.test(normalized) || /^[a-f0-9]{20}$/.test(normalized);
}

async function generateUniqueReceiptToken(): Promise<string> {
  const db = admin.firestore();
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = crypto.randomBytes(10).toString("hex");
    const snapshot = await db
      .collection("users")
      .where("receiptEmailToken", "==", candidate)
      .limit(1)
      .get();
    if (snapshot.empty) {
      return candidate;
    }
  }
  throw new HttpsError("resource-exhausted", "Unable to allocate a forwarding alias right now.");
}

async function canUserAcceptNewReceipt(userId: string): Promise<boolean> {
  const db = admin.firestore();
  const userSnap = await db.doc(`users/${userId}`).get();
  const plan = getEffectiveSubscriptionPlan(userSnap.data());
  if (plan === "pro") {
    return true;
  }

  try {
    const freePlanReceiptLimit = await getFreePlanReceiptLimit();
    const countSnap = await db.collection(`users/${userId}/receipts`).count().get();
    const count = countSnap.data().count;
    return count < freePlanReceiptLimit;
  } catch (error) {
    logger.warn("Failed to enforce free plan cap for inbound email. Allowing upload.", { userId, error });
    return true;
  }
}
