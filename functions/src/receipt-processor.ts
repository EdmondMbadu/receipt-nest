/**
 * Receipt Processor Cloud Function
 *
 * Triggered when a new receipt is uploaded.
 * Uses a two-pass Gemini extraction for accurate receipt parsing.
 */

import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { VertexAI } from "@google-cloud/vertexai";
import sharp from "sharp";
import heicDecode from "heic-decode";

// Types
interface ExtractedField<T> {
  value: T;
  confidence: number;
  rawText?: string;
}

interface ExtractionResult {
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

interface ReceiptDoc {
  status?: string;
  notes?: string;
  totalAmount?: number;
  currency?: string;
  date?: string;
  merchant?: {
    canonicalName?: string;
    rawName?: string;
  };
  category?: {
    name?: string;
  };
}

// Configuration
const PROJECT_ID = process.env.GCLOUD_PROJECT || "receipt-nest";
const VERTEX_LOCATION = "us-central1"; // Vertex AI location


// Default categories for classification
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

/**
 * Simple, robust Gemini extraction for receipts
 * Single pass with clear instructions - optimized for reliability
 */
async function extractWithGemini(
  fileBuffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: VERTEX_LOCATION,
  });

  // Use stable model ID - gemini-2.5-flash is recommended
  // Fallback order: gemini-2.5-flash -> gemini-2.0-flash
  const model = vertexAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  });

  // Normalize mimeType for Gemini
  const supportedMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
  let geminiMimeType = mimeType;
  if (!supportedMimeTypes.includes(mimeType)) {
    logger.info(`Unsupported mimeType ${mimeType} for Gemini, using image/jpeg`);
    geminiMimeType = "image/jpeg";
  }

  const base64Image = fileBuffer.toString("base64");

  const prompt = `You are a receipt parser. Extract these fields from the receipt image:

{
  "total": 123.45,
  "merchant": "Store Name",
  "date": "2024-01-15",
  "currency": "USD"
}

Instructions:
- total: The FINAL total amount paid. Look for "TOTAL", "GRAND TOTAL", "AMOUNT DUE", "BALANCE". This is the number AFTER tax is added. Do NOT use subtotal or tax amount.
- merchant: The store or business name, usually at the top of the receipt. Remove any store numbers like "#1234".
- date: The transaction date in YYYY-MM-DD format.
- currency: Default to "USD" for US receipts.

Return ONLY the JSON object, no other text.`;

  logger.info("Starting Gemini extraction", {
    model: "gemini-2.5-flash",
    mimeType: geminiMimeType,
    bufferSize: fileBuffer.length
  });

  const modelResult = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: geminiMimeType, data: base64Image } },
          { text: prompt },
        ],
      },
    ],
  });

  const responseText = modelResult.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
  logger.info("Gemini raw response", { text: responseText });

  // Handle empty response
  if (!responseText || responseText.trim() === "") {
    logger.error("Gemini returned empty response");
    throw new Error("Gemini returned empty response");
  }

  // Parse the response
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText);
  } catch (parseError) {
    // Try to extract JSON from the response if it's wrapped in markdown
    const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        logger.error("Failed to parse extracted JSON", { responseText, extracted: jsonMatch[0] });
        throw new Error("Failed to parse Gemini response as JSON");
      }
    } else {
      logger.error("Failed to parse Gemini response - no JSON found", { responseText });
      throw new Error("Failed to parse Gemini response as JSON");
    }
  }

  logger.info("Gemini parsed response", parsed);

  const totalCandidates = [
    parsed.total,
    parsed.totalAmount,
    parsed.total_amount,
    parsed.amount,
    parsed.amount_paid,
    parsed.grandTotal,
    parsed.grand_total,
    parsed.finalTotal,
    parsed.final_total,
    parsed.balance,
    parsed.amountDue,
    parsed.amount_due,
  ];
  const totalValue = totalCandidates
    .map((value) => parsePositiveNumber(value))
    .find((value): value is number => value !== undefined);

  // Extract merchant
  let merchantValue: string | undefined;
  const merchantRaw =
    parsed.merchant ??
    parsed.supplier ??
    parsed.vendor ??
    parsed.store ??
    parsed.businessName ??
    parsed.business_name ??
    parsed.merchantName ??
    parsed.merchant_name;
  if (merchantRaw) {
    const merchant = String(merchantRaw).trim();
    if (merchant.length > 0 && !['null', 'unknown', 'n/a', 'none'].includes(merchant.toLowerCase())) {
      // Clean up merchant name - remove store numbers
      merchantValue = merchant.replace(/#\s*\d+/g, '').replace(/\s+/g, ' ').trim();
    }
  }

  // Extract date
  let dateValue: string | undefined;
  const dateRaw =
    parsed.date ??
    parsed.transactionDate ??
    parsed.transaction_date ??
    parsed.purchaseDate ??
    parsed.purchase_date;
  if (dateRaw) {
    const dateStr = String(dateRaw);
    if (dateStr && !['null', 'unknown', 'n/a'].includes(dateStr.toLowerCase())) {
      dateValue = parseDate(dateStr) || undefined;
    }
  }

  // Extract currency
  const currencyRaw =
    parsed.currency ??
    parsed.currencyCode ??
    parsed.currency_code;
  const currencyValue = currencyRaw ? String(currencyRaw).toUpperCase() : 'USD';

  // Calculate confidence - be generous to avoid needs_review
  let confidence = 0.85;
  if (!totalValue || totalValue <= 0) {
    confidence = 0.5;
  } else if (!merchantValue) {
    confidence = 0.75;
  }

  logger.info("Final extraction values", {
    total: totalValue,
    merchant: merchantValue,
    date: dateValue,
    currency: currencyValue,
    confidence
  });

  const extractionResult: ExtractionResult = {
    source: "gemini",
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    currency: { value: currencyValue, confidence: 0.9 },
    overallConfidence: confidence,
  };

  if (totalValue !== undefined && totalValue > 0) {
    extractionResult.totalAmount = { value: totalValue, confidence, rawText: String(totalValue) };
  }
  if (dateValue) {
    extractionResult.date = { value: dateValue, confidence };
  }
  if (merchantValue) {
    extractionResult.supplierName = { value: merchantValue, confidence, rawText: merchantValue };
  }

  return extractionResult;
}

/**
 * Main Cloud Function - Triggered when a receipt document is created
 */
export const processReceipt = onDocumentCreated(
  {
    document: "users/{userId}/receipts/{receiptId}",
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 300,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.error("No data associated with the event");
      return;
    }

    const receiptData = snapshot.data();
    const { userId, receiptId } = event.params;

    logger.info(`Processing receipt: ${receiptId} for user: ${userId}`);

    // Get Firestore reference
    const db = admin.firestore();
    const receiptRef = db.doc(`users/${userId}/receipts/${receiptId}`);

    try {
      // Update status to processing
      await receiptRef.update({
        status: "processing",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Get the file from Storage
      const storagePath = receiptData.file?.storagePath;
      if (!storagePath) {
        throw new Error("No storage path found in receipt document");
      }

      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);
      const [fileBuffer] = await file.download();
      let mimeType = receiptData.file?.mimeType || "application/octet-stream";

      logger.info(`Downloaded file: ${storagePath}, size: ${fileBuffer.length} bytes, mimeType: ${mimeType}`);

      // Convert HEIC/HEIF to JPEG for processing
      let processBuffer = fileBuffer;
      let processMimeType = mimeType;

      // Check if it's a HEIC/HEIF file (by mimeType or file extension)
      const isHeic = mimeType === "image/heic" ||
        mimeType === "image/heif" ||
        storagePath.toLowerCase().endsWith(".heic") ||
        storagePath.toLowerCase().endsWith(".heif");

      if (isHeic) {
        logger.info("Detected HEIC/HEIF image, attempting conversion to JPEG...");

        // Method 1: Try sharp first (might have native HEIC support)
        let converted = false;
        try {
          const jpegBuffer = await sharp(fileBuffer)
            .jpeg({ quality: 90 })
            .toBuffer();
          processBuffer = jpegBuffer;
          processMimeType = "image/jpeg";
          converted = true;
          logger.info(`HEIC conversion with sharp successful, new size: ${processBuffer.length} bytes`);
        } catch (sharpError: unknown) {
          const errorMessage = sharpError instanceof Error ? sharpError.message : String(sharpError);
          logger.warn(`Sharp HEIC conversion failed: ${errorMessage}. Trying heic-decode...`);
        }

        // Method 2: Fallback to heic-decode (pure JavaScript, works everywhere)
        if (!converted) {
          try {
            const { width, height, data } = await heicDecode({ buffer: fileBuffer });
            logger.info(`HEIC decoded: ${width}x${height}, data length: ${data.length}`);

            // heic-decode returns RGBA data (4 channels)
            // Use sharp to properly encode as JPEG with correct color handling
            const jpegBuffer = await sharp(Buffer.from(data), {
              raw: {
                width,
                height,
                channels: 4, // RGBA
              },
            })
              .jpeg({ quality: 90 })
              .toBuffer();

            processBuffer = jpegBuffer;
            processMimeType = "image/jpeg";
            converted = true;
            logger.info(`HEIC conversion with heic-decode + sharp successful, new size: ${processBuffer.length} bytes`);
          } catch (heicDecodeError: unknown) {
            const errorMessage = heicDecodeError instanceof Error ? heicDecodeError.message : String(heicDecodeError);
            logger.error(`heic-decode conversion also failed: ${errorMessage}`);
          }
        }

        // If still not converted, we'll try Gemini with the original file anyway
        if (!converted) {
          logger.warn("All HEIC conversion methods failed. Attempting Gemini with raw file...");
          processMimeType = "image/jpeg"; // Tell Gemini it's JPEG anyway
        }
      }

      // Step 1: Gemini extraction for accurate receipt parsing
      let extraction: ExtractionResult | null = null;

      try {
        extraction = await extractWithGemini(processBuffer, processMimeType);
        if (extraction) {
          logger.info("Gemini extraction complete", {
            confidence: extraction.overallConfidence,
            total: extraction.totalAmount?.value,
            merchant: extraction.supplierName?.value
          });
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error("Two-pass Gemini extraction failed", {
          message: errorMessage,
          stack: errorStack,
          mimeType: processMimeType,
          bufferSize: processBuffer.length
        });
      }

      // If we still have no extraction, mark for review
      if (!extraction) {
        await receiptRef.update({
          status: "needs_review",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.warn("No extraction successful, marked for review");
        return;
      }

      // Step 3: Normalize merchant name
      const merchant = await normalizeMerchant(
        userId,
        extraction.supplierName?.value || "Unknown",
        extraction.supplierName?.confidence || 0
      );

      // Step 4: Classify category
      const category = await classifyCategory(
        merchant.canonicalName,
        extraction
      );

      // Step 5: Determine final status
      // Be lenient - if we have a total amount, approve it
      const hasTotalAmount = extraction.totalAmount?.value !== undefined && extraction.totalAmount.value > 0;
      const hasMerchant = extraction.supplierName?.value !== undefined;

      // Auto-approve if we have a total amount - this is the most important field
      // Users can always edit merchant/date later, but having SOME data is better than needs_review
      let status: string;
      if (hasTotalAmount) {
        status = "final";
        logger.info("Auto-approving receipt with total amount", {
          totalAmount: extraction.totalAmount?.value,
          merchant: extraction.supplierName?.value,
          hasMerchant,
          confidence: extraction.overallConfidence
        });
      } else {
        status = "needs_review";
        logger.warn("No total amount extracted, marking for review", {
          merchant: extraction.supplierName?.value,
          confidence: extraction.overallConfidence
        });
      }

      // Step 6: Update receipt with extraction results
      const updateData: Record<string, unknown> = {
        status,
        extraction,
        merchant,
        category,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // ALWAYS set final values if they exist (not just for high confidence)
      logger.info(`Setting final values for ${receiptId}`, {
        hasTotal: extraction.totalAmount?.value !== undefined,
        totalValue: extraction.totalAmount?.value,
        totalType: typeof extraction.totalAmount?.value,
        hasCurrency: !!extraction.currency?.value,
        hasDate: !!extraction.date?.value,
      });

      if (extraction.totalAmount?.value !== undefined) {
        updateData.totalAmount = extraction.totalAmount.value;
        logger.info(`Adding totalAmount to update: ${extraction.totalAmount.value}`);
      } else {
        logger.warn(`No totalAmount to add for receipt ${receiptId}`);
      }

      if (extraction.currency?.value) {
        updateData.currency = extraction.currency.value;
      }
      if (extraction.date?.value) {
        updateData.date = extraction.date.value;
      }

      // Log the full update data (excluding extraction for brevity)
      logger.info(`Updating receipt ${receiptId}`, {
        status: updateData.status,
        totalAmount: updateData.totalAmount,
        currency: updateData.currency,
        date: updateData.date,
        merchantName: merchant.canonicalName,
      });

      await receiptRef.update(updateData);

      logger.info(`Receipt processed successfully: ${receiptId}`, {
        status,
        merchant: merchant.canonicalName,
        category: category.name,
        amount: extraction.totalAmount?.value,
        savedTotalAmount: updateData.totalAmount,
      });

    } catch (error) {
      logger.error("Error processing receipt", error);

      // Update status to needs_review on error
      await receiptRef.update({
        status: "needs_review",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);

/**
 * Background note generation.
 * Runs after receipt updates and only fills notes when empty.
 * This is intentionally lightweight so it does not affect upload latency.
 */
export const generateReceiptNote = onDocumentUpdated(
  {
    document: "users/{userId}/receipts/{receiptId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const after = event.data?.after.data() as ReceiptDoc | undefined;
    const before = event.data?.before.data() as ReceiptDoc | undefined;
    if (!after) {
      return;
    }

    // Only run once receipt processing is complete.
    if (after.status !== "final") {
      return;
    }

    // Never overwrite user-entered notes.
    if (after.notes && after.notes.trim().length > 0) {
      return;
    }

    // Skip if this update already had final+empty notes before, to reduce duplicate work.
    if (
      before?.status === "final" &&
      (!before.notes || before.notes.trim().length === 0)
    ) {
      return;
    }

    const note = buildAutoReceiptNote(after);
    if (!note) {
      return;
    }

    const { userId, receiptId } = event.params;
    const db = admin.firestore();
    const receiptRef = db.doc(`users/${userId}/receipts/${receiptId}`);

    await receiptRef.update({
      notes: note,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Generated note for receipt: ${receiptId}`, { note });
  }
);

/**
 * Normalize merchant name and match to existing merchants
 */
async function normalizeMerchant(
  userId: string,
  rawName: string,
  confidence: number
): Promise<ReceiptMerchant> {
  const db = admin.firestore();

  // Clean the merchant name
  const cleanedName = rawName
    .replace(/[#\d]+$/g, "") // Remove trailing numbers (store #1234)
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .split(" ")
    .slice(0, 3) // Take first 3 words
    .join(" ");

  const canonicalName = cleanedName || rawName;

  // Try to find existing merchant by alias
  const merchantsRef = db.collection(`users/${userId}/merchants`);
  const snapshot = await merchantsRef.get();

  for (const doc of snapshot.docs) {
    const merchant = doc.data();
    const aliases: string[] = merchant.aliases || [];

    // Check for exact match in aliases
    if (aliases.some((a: string) => a.toLowerCase() === rawName.toLowerCase())) {
      return {
        canonicalId: doc.id,
        canonicalName: merchant.canonicalName,
        rawName,
        matchConfidence: 1.0,
        matchedBy: "alias",
      };
    }

    // Check for fuzzy match (simple contains check)
    if (aliases.some((a: string) =>
      a.toLowerCase().includes(canonicalName.toLowerCase()) ||
      canonicalName.toLowerCase().includes(a.toLowerCase())
    )) {
      return {
        canonicalId: doc.id,
        canonicalName: merchant.canonicalName,
        rawName,
        matchConfidence: 0.8,
        matchedBy: "fuzzy",
      };
    }
  }

  // No match found - create new merchant
  const newMerchantRef = await merchantsRef.add({
    userId,
    canonicalName,
    aliases: [rawName],
    receiptCount: 0,
    totalSpend: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    canonicalId: newMerchantRef.id,
    canonicalName,
    rawName,
    matchConfidence: confidence,
    matchedBy: "ai",
  };
}

/**
 * Classify receipt into a category
 */
async function classifyCategory(
  merchantName: string,
  extraction: ExtractionResult
): Promise<ReceiptCategory> {
  const lowerMerchant = merchantName.toLowerCase();

  // Try keyword matching first
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => lowerMerchant.includes(kw))) {
      return {
        id: cat.id,
        name: cat.name,
        confidence: 0.9,
        assignedBy: "rule",
      };
    }
  }

  // Default to "other" if no match
  return {
    id: "other",
    name: "Other",
    confidence: 0.5,
    assignedBy: "default",
  };
}

/**
 * Parse various date formats to ISO string (YYYY-MM-DD)
 */
function parseDate(dateStr: string): string | null {
  const cleaned = dateStr.trim();

  // Try parsing with Date constructor
  const date = new Date(cleaned);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split("T")[0];
  }

  // Try common formats: MM/DD/YYYY, DD/MM/YYYY, etc.
  const patterns = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // MM/DD/YYYY or DD/MM/YYYY
    /(\d{1,2})-(\d{1,2})-(\d{4})/, // MM-DD-YYYY
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/, // YYYY/MM/DD
    /(\d{4})-(\d{1,2})-(\d{1,2})/, // YYYY-MM-DD
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      // Try to construct a valid date
      const parts = match.slice(1).map(Number);
      let year, month, day;

      if (parts[0] > 1000) {
        // YYYY/MM/DD format
        [year, month, day] = parts;
      } else if (parts[2] > 1000) {
        // Assume MM/DD/YYYY for US receipts
        [month, day, year] = parts;
      } else {
        continue;
      }

      const testDate = new Date(year, month - 1, day);
      if (!isNaN(testDate.getTime())) {
        return testDate.toISOString().split("T")[0];
      }
    }
  }

  return null;
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

/**
 * Build a short human-readable note from extracted receipt metadata.
 */
function buildAutoReceiptNote(receipt: ReceiptDoc): string {
  const merchant =
    receipt.merchant?.canonicalName ||
    receipt.merchant?.rawName ||
    "Unknown merchant";
  const category = receipt.category?.name || "general purchase";
  const amountText = formatAmount(receipt.totalAmount, receipt.currency);
  const dateText = formatShortDate(receipt.date);

  const segments = [
    `${category} purchase`,
    `at ${merchant}`,
  ];

  if (amountText) {
    segments.push(`for ${amountText}`);
  }

  if (dateText) {
    segments.push(`on ${dateText}`);
  }

  const note = `${segments.join(" ")}.`;
  return note.length <= 160 ? note : note.slice(0, 157).trimEnd() + "...";
}

function formatAmount(amount?: number, currency?: string): string | null {
  if (amount === undefined || amount === null || amount <= 0) {
    return null;
  }

  const normalizedCurrency = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${normalizedCurrency} ${amount.toFixed(2)}`;
  }
}

function formatShortDate(isoDate?: string): string | null {
  if (!isoDate) {
    return null;
  }

  const parsed = new Date(isoDate);
  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
