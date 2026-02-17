import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { VertexAI } from "@google-cloud/vertexai";
import * as crypto from "crypto";
import type { Request } from "express";
import sharp from "sharp";

const receiptInboundDomain = defineSecret("RECEIPT_INBOUND_DOMAIN");
const emailIngestWebhookKey = defineSecret("EMAIL_INGEST_WEBHOOK_KEY");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "receipt-nest";
const VERTEX_LOCATION = "us-central1";

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_EMAIL = 6;
const FREE_PLAN_RECEIPT_LIMIT = 200;
const MAX_EMAIL_TEXT_LENGTH = 12000;
const MAX_ALIAS_LOCAL_PART_LENGTH = 64;

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

const CATEGORIES = [
  { id: "groceries", name: "Groceries", keywords: ["grocery", "supermarket", "food", "whole foods", "trader joe", "kroger"] },
  { id: "restaurants", name: "Restaurants", keywords: ["restaurant", "cafe", "coffee", "starbucks", "mcdonalds", "uber eats"] },
  { id: "shopping", name: "Shopping", keywords: ["amazon", "target", "walmart", "costco", "best buy", "retail"] },
  { id: "transportation", name: "Transportation", keywords: ["gas", "fuel", "uber", "lyft", "parking", "transit"] },
  { id: "entertainment", name: "Entertainment", keywords: ["movie", "netflix", "spotify", "gaming", "concert"] },
  { id: "subscriptions", name: "Subscriptions", keywords: ["subscription", "monthly", "recurring", "membership"] },
  { id: "utilities", name: "Utilities", keywords: ["electric", "water", "internet", "phone", "utility"] },
  { id: "healthcare", name: "Healthcare", keywords: ["pharmacy", "doctor", "hospital", "cvs", "walgreens"] },
  { id: "travel", name: "Travel", keywords: ["hotel", "flight", "airline", "airbnb", "booking"] },
  { id: "other", name: "Other", keywords: [] },
];

interface ParsedAttachment {
  fieldName: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}

interface ParsedInboundEmail {
  fields: Record<string, string>;
  attachments: ParsedAttachment[];
}

interface InboundEmailPayload {
  fields: Record<string, string>;
  attachments: ParsedAttachment[];
}

interface ExtractedField<T> {
  value: T;
  confidence: number;
  rawText?: string;
}

interface EmailExtractionResult {
  source: "gemini" | "manual";
  processedAt: admin.firestore.FieldValue;
  totalAmount?: ExtractedField<number>;
  currency?: ExtractedField<string>;
  date?: ExtractedField<string>;
  supplierName?: ExtractedField<string>;
  overallConfidence: number;
}

interface ReceiptMerchant {
  canonicalId?: string;
  canonicalName: string;
  rawName: string;
  matchConfidence: number;
  matchedBy: "exact" | "fuzzy" | "alias" | "ai" | "manual";
}

interface ReceiptCategory {
  id: string;
  name: string;
  confidence: number;
  assignedBy: "ai" | "user" | "rule" | "default";
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

const PART_SEPARATOR_CRLF = Buffer.from("\r\n\r\n");
const PART_SEPARATOR_LF = Buffer.from("\n\n");

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

    try {
      const parsedEmail = parseInboundEmail(req);
      const payload = enrichInboundPayload(parsedEmail);
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

        const validAttachments = payload.attachments
          .filter((attachment) => isAllowedAttachment(attachment))
          .slice(0, MAX_ATTACHMENTS_PER_EMAIL);

        logger.info("Resolved inbound attachments for user", {
          userId,
          recipientLocals,
          parsedAttachmentCount: parsedEmail.attachments.length,
          enrichedAttachmentCount: payload.attachments.length,
          validAttachmentCount: validAttachments.length,
          rejectedAttachmentCount: Math.max(payload.attachments.length - validAttachments.length, 0),
        });

        if (validAttachments.length > 0) {
          for (const attachment of validAttachments) {
            await saveAttachmentReceipt(userId, attachment, payload.fields);
            createdReceipts += 1;
          }
          continue;
        }

        const createdTextReceipt = await saveTextOnlyReceipt(userId, payload.fields);
        if (createdTextReceipt) {
          createdReceipts += 1;
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

function parseInboundEmail(req: Request): ParsedInboundEmail {
  const fields: Record<string, string> = {};
  const attachments: ParsedAttachment[] = [];
  const contentType = String(req.headers["content-type"] || "");
  const isMultipart = contentType.toLowerCase().includes("multipart/form-data");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!isMultipart || !rawBody || rawBody.length === 0) {
    const body = req.body as Record<string, unknown> | undefined;
    if (body) {
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "string") {
          fields[key] = value;
        } else if (typeof value === "number" || typeof value === "boolean") {
          fields[key] = String(value);
        } else if (Array.isArray(value)) {
          fields[key] = value.map((item) => String(item)).join(", ");
        } else if (value && typeof value === "object") {
          fields[key] = JSON.stringify(value);
        }
      }
    }
    return { fields, attachments };
  }

  const boundary = extractMultipartBoundary(contentType);
  if (!boundary) {
    logger.warn("Multipart request missing boundary.");
    return { fields, attachments };
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const closingDelimiter = Buffer.from(`--${boundary}--`);
  let cursor = 0;

  while (cursor < rawBody.length) {
    const startIndex = rawBody.indexOf(delimiter, cursor);
    if (startIndex < 0) {
      break;
    }

    if (rawBody.indexOf(closingDelimiter, startIndex) === startIndex) {
      break;
    }

    let partStart = startIndex + delimiter.length;
    if (rawBody[partStart] === 13 && rawBody[partStart + 1] === 10) {
      partStart += 2;
    }

    let headerEndIndex = rawBody.indexOf(PART_SEPARATOR_CRLF, partStart);
    let separatorLength = PART_SEPARATOR_CRLF.length;
    if (headerEndIndex < 0) {
      headerEndIndex = rawBody.indexOf(PART_SEPARATOR_LF, partStart);
      separatorLength = PART_SEPARATOR_LF.length;
    }
    if (headerEndIndex < 0) {
      break;
    }

    const headerLines = rawBody.slice(partStart, headerEndIndex).toString("utf8").split(/\r?\n/);
    const headers: Record<string, string> = {};
    let activeHeaderKey: string | null = null;
    for (const line of headerLines) {
      if (/^\s/.test(line) && activeHeaderKey) {
        headers[activeHeaderKey] = `${headers[activeHeaderKey]} ${line.trim()}`;
        continue;
      }
      const separatorIndex = line.indexOf(":");
      if (separatorIndex > 0) {
        const key = line.slice(0, separatorIndex).trim().toLowerCase();
        const value = line.slice(separatorIndex + 1).trim();
        headers[key] = value;
        activeHeaderKey = key;
      }
    }

    const dataStart = headerEndIndex + separatorLength;
    const nextDelimiterIndex = rawBody.indexOf(delimiter, dataStart);
    if (nextDelimiterIndex < 0) {
      break;
    }

    let partData = rawBody.slice(dataStart, nextDelimiterIndex);
    while (
      partData.length > 0 &&
      (partData[partData.length - 1] === 10 || partData[partData.length - 1] === 13)
    ) {
      partData = partData.slice(0, partData.length - 1);
    }
    cursor = nextDelimiterIndex;

    const contentDisposition = headers["content-disposition"] || "";
    const fieldName = extractContentDispositionParam(contentDisposition, "name");
    if (!fieldName) {
      continue;
    }

    const fileNameRaw = extractContentDispositionParam(contentDisposition, "filename");
    if (!fileNameRaw) {
      fields[fieldName] = partData.toString("utf8");
      continue;
    }

    if (partData.length === 0 || partData.length > MAX_ATTACHMENT_SIZE_BYTES) {
      continue;
    }

    const fileName = sanitizeFileName(decodeRfc2231Value(fileNameRaw) || `${fieldName}.bin`);
    const mimeType = headers["content-type"] || "application/octet-stream";
    attachments.push({
      fieldName,
      fileName,
      mimeType,
      data: partData,
    });
  }

  return { fields, attachments };
}

function extractMultipartBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    return null;
  }
  const value = (match[1] || match[2] || "").trim();
  if (!value) {
    return null;
  }
  return value;
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

  const aliasLookups = await Promise.all(Array.from(aliasCandidates).map(async (alias) => {
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
  fields: Record<string, string>
): Promise<void> {
  const resolvedMimeType = normalizeAttachmentMimeType(attachment) || "application/octet-stream";
  const timestamp = Date.now();
  const storagePath = `users/${userId}/receipts/${timestamp}_${sanitizeFileName(attachment.fileName)}`;
  const bucket = admin.storage().bucket();
  await bucket.file(storagePath).save(attachment.data, {
    metadata: { contentType: resolvedMimeType },
  });

  const db = admin.firestore();
  const receiptRef = await db.collection(`users/${userId}/receipts`).add({
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
      ingestMode: "attachment",
      ingestedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await receiptRef.update({ id: receiptRef.id });
}

async function saveTextOnlyReceipt(
  userId: string,
  fields: Record<string, string>
): Promise<boolean> {
  const subject = fields.subject || "";
  const sender = fields.from || "";
  const textSource =
    fields.text ||
    fields["stripped-text"] ||
    stripHtml(fields.html || fields["stripped-html"] || "") ||
    extractReadableTextFromRawEmail(fields.email || "");
  const text = normalizeEmailText(textSource);
  if (!subject && !text) {
    return false;
  }

  const extraction = await extractFromEmailContent(subject, sender, text);
  const merchantName = extraction.supplierName?.value || inferMerchantFromSender(sender) || "Email Receipt";
  const merchant = await normalizeMerchant(userId, merchantName, extraction.supplierName?.confidence || 0.5);
  const category = classifyCategory(merchant.canonicalName);
  const hasTotal = extraction.totalAmount?.value !== undefined && extraction.totalAmount.value > 0;
  const status = hasTotal ? "final" : "needs_review";

  const timestamp = Date.now();
  const textPayload = [
    `Subject: ${subject || "(none)"}`,
    `From: ${sender || "(unknown)"}`,
    "",
    text || "(empty body)",
  ].join("\n");
  const textStoragePath = `users/${userId}/receipts/${timestamp}_email_body.txt`;
  const previewStoragePath = `users/${userId}/receipts/${timestamp}_email_preview.png`;

  const bucket = admin.storage().bucket();
  await bucket.file(textStoragePath).save(Buffer.from(textPayload, "utf8"), {
    metadata: { contentType: "text/plain; charset=utf-8" },
  });

  let receiptFileStoragePath = textStoragePath;
  let receiptFileOriginalName = `${sanitizeFileName(subject || "forwarded-email")}.txt`;
  let receiptFileMimeType = "text/plain";
  let receiptFileSizeBytes = Buffer.byteLength(textPayload, "utf8");
  let previewGenerated = false;

  try {
    const previewBuffer = await generateEmailPreviewImage({
      subject,
      sender,
      merchantName: merchant.canonicalName || merchantName,
      totalAmount: extraction.totalAmount?.value,
      currency: extraction.currency?.value,
      transactionDate: extraction.date?.value,
      bodyText: text,
      status,
    });

    await bucket.file(previewStoragePath).save(previewBuffer, {
      metadata: { contentType: "image/png" },
    });

    receiptFileStoragePath = previewStoragePath;
    receiptFileOriginalName = `${sanitizeFileName(subject || "forwarded-email")}_preview.png`;
    receiptFileMimeType = "image/png";
    receiptFileSizeBytes = previewBuffer.length;
    previewGenerated = true;
  } catch (error) {
    logger.warn("Failed to generate text-email preview image. Falling back to text file.", {
      userId,
      messageId: extractMessageId(fields),
      error,
    });
  }

  const updateData: Record<string, unknown> = {
    userId,
    status,
    skipProcessing: true,
    source: "email",
    file: {
      storagePath: receiptFileStoragePath,
      originalName: receiptFileOriginalName,
      mimeType: receiptFileMimeType,
      sizeBytes: receiptFileSizeBytes,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    extraction,
    merchant,
    category,
    email: {
      from: sender,
      to: fields.to || "",
      subject,
      messageId: extractMessageId(fields),
      ingestMode: "text_fallback",
      textStoragePath,
      previewStoragePath: previewGenerated ? previewStoragePath : null,
      previewGenerated,
      ingestedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    notes: `Imported from forwarded email${subject ? `: ${subject}` : ""}.`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (hasTotal) {
    updateData.totalAmount = extraction.totalAmount?.value;
  }
  if (extraction.currency?.value) {
    updateData.currency = extraction.currency.value;
  }
  if (extraction.date?.value) {
    updateData.date = extraction.date.value;
  }

  const db = admin.firestore();
  const receiptRef = await db.collection(`users/${userId}/receipts`).add(updateData);
  await receiptRef.update({ id: receiptRef.id });
  return true;
}

async function extractFromEmailContent(
  subject: string,
  sender: string,
  textBody: string
): Promise<EmailExtractionResult> {
  const bodyExcerpt = textBody.length > MAX_EMAIL_TEXT_LENGTH
    ? textBody.slice(0, MAX_EMAIL_TEXT_LENGTH)
    : textBody;

  const fallbackMerchant = inferMerchantFromSender(sender);

  try {
    const vertexAI = new VertexAI({
      project: PROJECT_ID,
      location: VERTEX_LOCATION,
    });

    const model = vertexAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    });

    const prompt = `You are extracting purchase details from a forwarded receipt email.
Return ONLY JSON with this structure:
{
  "total": 12.34,
  "merchant": "Store Name",
  "date": "2025-01-30",
  "currency": "USD"
}

Rules:
- Use the final amount paid (not subtotal/tax).
- If a value is not available, set it to null.
- date must be YYYY-MM-DD when present.

Sender: ${sender || "(unknown)"}
Subject: ${subject || "(none)"}
Email body:
${bodyExcerpt}`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = parseJsonPayload(responseText);

    const total = parsePositiveNumber(
      parsed.total ?? parsed.totalAmount ?? parsed.total_amount ?? parsed.amount
    );

    const merchantRaw = parsed.merchant ?? parsed.vendor ?? parsed.store ?? parsed.businessName ?? parsed.business_name;
    const merchantValue = merchantRaw
      ? String(merchantRaw).trim().replace(/\s+/g, " ")
      : fallbackMerchant;

    const dateRaw = parsed.date ?? parsed.transactionDate ?? parsed.transaction_date ?? parsed.purchaseDate ?? parsed.purchase_date;
    const dateValue = dateRaw ? parseDate(String(dateRaw)) || undefined : undefined;

    const currencyRaw = parsed.currency ?? parsed.currencyCode ?? parsed.currency_code;
    const currencyValue = currencyRaw ? String(currencyRaw).toUpperCase() : "USD";

    let confidence = 0.8;
    if (!total) confidence = 0.55;
    if (!merchantValue) confidence = 0.45;

    const extraction: EmailExtractionResult = {
      source: "gemini",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      overallConfidence: confidence,
      currency: {
        value: currencyValue,
        confidence: 0.8,
      },
    };

    if (total !== undefined && total > 0) {
      extraction.totalAmount = {
        value: total,
        confidence,
        rawText: String(total),
      };
    }
    if (merchantValue) {
      extraction.supplierName = {
        value: merchantValue,
        confidence,
        rawText: merchantValue,
      };
    }
    if (dateValue) {
      extraction.date = {
        value: dateValue,
        confidence,
      };
    }

    return extraction;
  } catch (error) {
    logger.warn("Gemini email extraction failed. Falling back to manual extraction.", error);
    const extraction: EmailExtractionResult = {
      source: "manual",
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      overallConfidence: fallbackMerchant ? 0.5 : 0.35,
      currency: {
        value: "USD",
        confidence: 0.5,
      },
    };

    if (fallbackMerchant) {
      extraction.supplierName = {
        value: fallbackMerchant,
        confidence: 0.5,
      };
    }

    return extraction;
  }
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
  const excerptLines = wrapTextForPreview(input.bodyText, 58, 10);
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

function classifyCategory(merchantName: string): ReceiptCategory {
  const lowerMerchant = merchantName.toLowerCase();
  for (const category of CATEGORIES) {
    if (category.keywords.some((keyword) => lowerMerchant.includes(keyword))) {
      return {
        id: category.id,
        name: category.name,
        confidence: 0.9,
        assignedBy: "rule",
      };
    }
  }

  return {
    id: "other",
    name: "Other",
    confidence: 0.5,
    assignedBy: "default",
  };
}

function parseJsonPayload(rawResponse: string): Record<string, unknown> {
  if (!rawResponse) {
    return {};
  }

  try {
    return JSON.parse(rawResponse) as Record<string, unknown>;
  } catch {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {};
    }
    try {
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "number" && isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value
      .replace(/[$,\s]/g, "")
      .replace(/[^\d.-]/g, "");
    const parsed = parseFloat(normalized);
    if (!isNaN(parsed) && isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function parseDate(value: string): string | null {
  const cleaned = value.trim();
  const direct = new Date(cleaned);
  if (!isNaN(direct.getTime())) {
    return direct.toISOString().split("T")[0];
  }

  const patterns = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    /(\d{1,2})-(\d{1,2})-(\d{4})/,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
    /(\d{4})-(\d{1,2})-(\d{1,2})/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;

    const parts = match.slice(1).map(Number);
    let year: number;
    let month: number;
    let day: number;

    if (parts[0] > 1000) {
      [year, month, day] = parts;
    } else if (parts[2] > 1000) {
      [month, day, year] = parts;
    } else {
      continue;
    }

    const candidate = new Date(year, month - 1, day);
    if (!isNaN(candidate.getTime())) {
      return candidate.toISOString().split("T")[0];
    }
  }

  return null;
}

function stripHtml(html: string): string {
  if (!html) return "";
  return decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function normalizeEmailText(value: string): string {
  if (!value) {
    return "";
  }
  const compact = value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  return compact.length > MAX_EMAIL_TEXT_LENGTH ? compact.slice(0, MAX_EMAIL_TEXT_LENGTH) : compact;
}

function inferMerchantFromSender(senderField: string): string | null {
  if (!senderField) return null;
  const emailMatch = senderField.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (!emailMatch) return null;

  const domain = emailMatch[1].toLowerCase();
  const pieces = domain.split(".");
  if (pieces.length < 2) return null;

  const blockedNames = new Set(["mail", "email", "notifications", "notification", "no-reply", "noreply"]);
  let label = pieces[0];
  if (blockedNames.has(label) && pieces.length > 2) {
    label = pieces[1];
  }

  if (!label) return null;
  return label
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function enrichInboundPayload(parsed: ParsedInboundEmail): InboundEmailPayload {
  const fields: Record<string, string> = { ...parsed.fields };
  const attachments = [...parsed.attachments];

  if (!fields.text && fields["stripped-text"]) {
    fields.text = fields["stripped-text"];
  }
  if (!fields.html && fields["stripped-html"]) {
    fields.html = fields["stripped-html"];
  }

  if (attachments.length === 0 && fields.email) {
    const rawMimeAttachments = extractAttachmentsFromRawEmail(fields.email);
    if (rawMimeAttachments.length > 0) {
      attachments.push(...rawMimeAttachments);
    }
  }
  if (attachments.length === 0 && fields["attachment-info"]) {
    const infoAttachments = extractAttachmentsFromAttachmentInfo(fields);
    if (infoAttachments.length > 0) {
      attachments.push(...infoAttachments);
    }
  }

  const deduped = dedupeAttachments(attachments);
  return { fields, attachments: deduped };
}

function dedupeAttachments(attachments: ParsedAttachment[]): ParsedAttachment[] {
  const seen = new Set<string>();
  const deduped: ParsedAttachment[] = [];
  for (const attachment of attachments) {
    const signature = `${attachment.fileName.toLowerCase()}::${attachment.data.length}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push(attachment);
  }
  return deduped;
}

function extractAttachmentsFromRawEmail(rawEmail: string): ParsedAttachment[] {
  const normalized = rawEmail.replace(/\r\n/g, "\n");
  const lower = normalized.toLowerCase();
  const attachments: ParsedAttachment[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const dispositionIndex = lower.indexOf("content-disposition:", cursor);
    if (dispositionIndex < 0) {
      break;
    }

    const headerStart = Math.max(
      normalized.lastIndexOf("\n--", dispositionIndex),
      normalized.lastIndexOf("\ncontent-type:", dispositionIndex)
    );
    const headerBlockStart = headerStart >= 0 ? headerStart + 1 : dispositionIndex;
    const headerEnd = normalized.indexOf("\n\n", dispositionIndex);
    if (headerEnd < 0) {
      break;
    }

    const headerBlock = normalized.slice(headerBlockStart, headerEnd);
    const bodyStart = headerEnd + 2;
    const nextBoundary = normalized.indexOf("\n--", bodyStart);
    const bodyEnd = nextBoundary >= 0 ? nextBoundary : normalized.length;
    const encodedBody = normalized.slice(bodyStart, bodyEnd).trim();
    cursor = bodyEnd;

    const fileNameRaw = extractHeaderValue(headerBlock, "content-disposition", "filename");
    if (!fileNameRaw) {
      continue;
    }
    const dispositionType = (extractPrimaryHeaderValue(headerBlock, "content-disposition") || "").toLowerCase();
    if (dispositionType !== "attachment" && dispositionType !== "inline") {
      continue;
    }
    const decodedFileName = decodeRfc2231Value(fileNameRaw || "");
    const fileName = sanitizeFileName(decodedFileName || `attachment_${attachments.length + 1}.bin`);
    const mimeType = (extractPrimaryHeaderValue(headerBlock, "content-type") || "application/octet-stream").toLowerCase();
    const transferEncoding = (extractPrimaryHeaderValue(headerBlock, "content-transfer-encoding") || "7bit").toLowerCase();

    const data = decodeMimeBodyToBuffer(encodedBody, transferEncoding);
    if (!data || data.length === 0 || data.length > MAX_ATTACHMENT_SIZE_BYTES) {
      continue;
    }

    attachments.push({
      fieldName: `raw_attachment_${attachments.length + 1}`,
      fileName,
      mimeType,
      data,
    });
  }

  return attachments;
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

function extractReadableTextFromRawEmail(rawEmail: string): string {
  if (!rawEmail) {
    return "";
  }

  const normalized = rawEmail.replace(/\r\n/g, "\n");
  const chunks: string[] = [];

  const collectFromType = (contentType: "text/plain" | "text/html") => {
    let cursor = 0;
    const needle = `content-type: ${contentType}`;
    const lower = normalized.toLowerCase();

    while (cursor < normalized.length) {
      const contentTypeIndex = lower.indexOf(needle, cursor);
      if (contentTypeIndex < 0) {
        break;
      }

      const headerStart = Math.max(
        normalized.lastIndexOf("\n--", contentTypeIndex),
        normalized.lastIndexOf("\ncontent-type:", contentTypeIndex)
      );
      const headerBlockStart = headerStart >= 0 ? headerStart + 1 : contentTypeIndex;
      const headerEnd = normalized.indexOf("\n\n", contentTypeIndex);
      if (headerEnd < 0) {
        break;
      }

      const headerBlock = normalized.slice(headerBlockStart, headerEnd);
      const headerBlockLower = headerBlock.toLowerCase();
      if (headerBlockLower.includes("content-disposition: attachment")) {
        cursor = headerEnd + 2;
        continue;
      }

      const bodyStart = headerEnd + 2;
      const nextBoundary = normalized.indexOf("\n--", bodyStart);
      const bodyEnd = nextBoundary >= 0 ? nextBoundary : normalized.length;
      const encodedBody = normalized.slice(bodyStart, bodyEnd).trim();
      cursor = bodyEnd;

      const transferEncoding = (extractPrimaryHeaderValue(headerBlock, "content-transfer-encoding") || "7bit").toLowerCase();
      const decodedText = decodeMimeBodyToText(encodedBody, transferEncoding);
      if (!decodedText) {
        continue;
      }

      const cleaned = contentType === "text/html" ? stripHtml(decodedText) : decodedText;
      const compact = normalizeEmailText(cleaned);
      if (compact) {
        chunks.push(compact);
      }
    }
  };

  collectFromType("text/plain");
  collectFromType("text/html");

  if (chunks.length > 0) {
    return chunks.join("\n");
  }

  // Last resort: strip obvious MIME/base64 noise and return compact text.
  const fallback = normalized
    .replace(/^Content-[^\n]*$/gim, " ")
    .replace(/^[A-Za-z0-9+/]{80,}={0,2}$/gm, " ")
    .replace(/--[A-Za-z0-9'()+_,./:=?-]+--?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return fallback;
}

function extractHeaderValue(headerBlock: string, headerName: string, paramName: string): string | null {
  const normalizedHeaderBlock = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  const headerRegex = new RegExp(`${headerName}:\\s*([^\\n]+)`, "i");
  const headerMatch = normalizedHeaderBlock.match(headerRegex);
  if (!headerMatch) {
    return null;
  }

  const paramRegex = new RegExp(`${paramName}\\*?=(\"[^\"]+\"|[^;\\n]+)`, "i");
  const paramMatch = headerMatch[1].match(paramRegex);
  if (!paramMatch) {
    return null;
  }

  return paramMatch[1].replace(/^"|"$/g, "").trim();
}

function extractContentDispositionParam(contentDisposition: string, paramName: string): string | null {
  if (!contentDisposition) {
    return null;
  }

  const starRegex = new RegExp(`${paramName}\\*=([^;\\n]+)`, "i");
  const starMatch = contentDisposition.match(starRegex);
  if (starMatch?.[1]) {
    return starMatch[1].replace(/^"|"$/g, "").trim();
  }

  const regularRegex = new RegExp(`${paramName}=((\"[^\"]*\")|[^;\\n]+)`, "i");
  const regularMatch = contentDisposition.match(regularRegex);
  if (!regularMatch?.[1]) {
    return null;
  }

  return regularMatch[1].replace(/^"|"$/g, "").trim();
}

function extractPrimaryHeaderValue(headerBlock: string, headerName: string): string | null {
  const normalizedHeaderBlock = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  const headerRegex = new RegExp(`${headerName}:\\s*([^\\n]+)`, "i");
  const match = normalizedHeaderBlock.match(headerRegex);
  if (!match) {
    return null;
  }
  return match[1].split(";")[0].trim();
}

function decodeRfc2231Value(value: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  const parts = trimmed.split("''");
  if (parts.length === 2) {
    try {
      return decodeURIComponent(parts[1]);
    } catch {
      return parts[1];
    }
  }
  return trimmed;
}

function decodeMimeBodyToText(body: string, transferEncoding: string): string {
  if (!body) return "";
  if (transferEncoding.includes("base64")) {
    try {
      const bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
      return bytes.toString("utf8");
    } catch {
      return "";
    }
  }
  if (transferEncoding.includes("quoted-printable")) {
    return decodeQuotedPrintable(body);
  }
  return body;
}

function decodeMimeBodyToBuffer(body: string, transferEncoding: string): Buffer | null {
  if (!body) return null;
  if (transferEncoding.includes("base64")) {
    try {
      const bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
      return bytes.length > 0 ? bytes : null;
    } catch {
      return null;
    }
  }
  if (transferEncoding.includes("quoted-printable")) {
    return Buffer.from(decodeQuotedPrintable(body), "utf8");
  }
  return Buffer.from(body, "utf8");
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

function decodeQuotedPrintable(value: string): string {
  const softBreakRemoved = value.replace(/=\r?\n/g, "");
  return softBreakRemoved.replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
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
  if (isValidAliasLocalPart(existingAlias) && !looksLikeLegacyTokenAlias(existingAlias)) {
    return existingAlias;
  }

  const baseAlias = buildAliasBase(userData, userId);
  return allocateUniqueAlias(userId, baseAlias);
}

async function allocateUniqueAlias(userId: string, baseAlias: string): Promise<string> {
  const db = admin.firestore();
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

    const snapshot = await db
      .collection("users")
      .where("receiptEmailAlias", "==", candidate)
      .limit(1)
      .get();

    if (snapshot.empty || snapshot.docs[0].id === userId) {
      return candidate;
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
  const plan = userSnap.get("subscriptionPlan");
  if (plan === "pro") {
    return true;
  }

  try {
    const countSnap = await db.collection(`users/${userId}/receipts`).count().get();
    const count = countSnap.data().count;
    return count < FREE_PLAN_RECEIPT_LIMIT;
  } catch (error) {
    logger.warn("Failed to enforce free plan cap for inbound email. Allowing upload.", { userId, error });
    return true;
  }
}
