import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { VertexAI } from "@google-cloud/vertexai";
import * as crypto from "crypto";
import type { Request } from "express";

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

const PART_SEPARATOR = Buffer.from("\r\n\r\n");

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
      const recipients = extractRecipientAddresses(parsedEmail.fields);
      logger.info("Parsed inbound email", {
        recipients,
        attachmentCount: parsedEmail.attachments.length,
        attachments: parsedEmail.attachments.map((attachment) => ({
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

        const validAttachments = parsedEmail.attachments
          .filter((attachment) => isAllowedAttachment(attachment))
          .slice(0, MAX_ATTACHMENTS_PER_EMAIL);

        logger.info("Resolved inbound attachments for user", {
          userId,
          recipientLocals,
          validAttachmentCount: validAttachments.length,
        });

        if (validAttachments.length > 0) {
          for (const attachment of validAttachments) {
            await saveAttachmentReceipt(userId, attachment, parsedEmail.fields);
            createdReceipts += 1;
          }
          continue;
        }

        const createdTextReceipt = await saveTextOnlyReceipt(userId, parsedEmail.fields);
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

    const headerEndIndex = rawBody.indexOf(PART_SEPARATOR, partStart);
    if (headerEndIndex < 0) {
      break;
    }

    const headerLines = rawBody.slice(partStart, headerEndIndex).toString("utf8").split("\r\n");
    const headers: Record<string, string> = {};
    for (const line of headerLines) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex > 0) {
        const key = line.slice(0, separatorIndex).trim().toLowerCase();
        const value = line.slice(separatorIndex + 1).trim();
        headers[key] = value;
      }
    }

    const dataStart = headerEndIndex + PART_SEPARATOR.length;
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
    const fieldNameMatch = contentDisposition.match(/name="([^"]+)"/i);
    if (!fieldNameMatch) {
      continue;
    }

    const fieldName = fieldNameMatch[1];
    const fileNameMatch = contentDisposition.match(/filename="([^"]*)"/i);
    if (!fileNameMatch) {
      fields[fieldName] = partData.toString("utf8");
      continue;
    }

    if (partData.length === 0 || partData.length > MAX_ATTACHMENT_SIZE_BYTES) {
      continue;
    }

    const fileName = sanitizeFileName(fileNameMatch[1] || `${fieldName}.bin`);
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
  const match = contentType.match(/boundary="?([^=";]+)"?/i);
  return match ? match[1] : null;
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
  const text = normalizeEmailText(fields.text || stripHtml(fields.html || ""));
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
  const storagePath = `users/${userId}/receipts/${timestamp}_email_body.txt`;

  const bucket = admin.storage().bucket();
  await bucket.file(storagePath).save(Buffer.from(textPayload, "utf8"), {
    metadata: { contentType: "text/plain; charset=utf-8" },
  });

  const updateData: Record<string, unknown> = {
    userId,
    status,
    skipProcessing: true,
    source: "email",
    file: {
      storagePath,
      originalName: `${subject || "forwarded-email"}.txt`,
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(textPayload, "utf8"),
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
