/**
 * Receipt Processor Cloud Function
 *
 * Triggered when a new receipt is uploaded.
 * Uses Document AI for primary extraction and Gemini 2.5 as fallback.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
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
  source: "document_ai" | "gemini" | "manual";
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

// Configuration - UPDATE THESE WITH YOUR VALUES
const PROJECT_ID = process.env.GCLOUD_PROJECT || "receipt-nest";
const LOCATION = "us"; // Document AI processor location
const PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || ""; // Set via environment
const VERTEX_LOCATION = "us-central1"; // Vertex AI location

// Confidence thresholds
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const PDF_HIGH_CONFIDENCE_THRESHOLD = 0.65; // Lower threshold for PDFs since they're typically cleaner
const LOW_CONFIDENCE_THRESHOLD = 0.5;

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

      // Step 1: Try Document AI extraction (skip for HEIC if conversion failed)
      let extraction: ExtractionResult | null = null;

      // Only try Document AI if we have a supported format (not unconverted HEIC)
      const canUseDocumentAI = PROCESSOR_ID && processMimeType !== "image/heic" && processMimeType !== "image/heif";

      if (canUseDocumentAI) {
        try {
          extraction = await extractWithDocumentAI(processBuffer, processMimeType);
          logger.info("Document AI extraction complete", { confidence: extraction.overallConfidence });
        } catch (error) {
          logger.warn("Document AI extraction failed, falling back to Gemini", error);
        }
      } else if (PROCESSOR_ID) {
        logger.info("Skipping Document AI for HEIC file, using Gemini directly");
      } else {
        logger.info("Document AI processor not configured, using Gemini directly");
      }

      // Step 2: If Document AI failed or low confidence, use Gemini
      if (!extraction || extraction.overallConfidence < LOW_CONFIDENCE_THRESHOLD) {
        try {
          // Gemini can handle various formats including HEIC
          const geminiExtraction = await extractWithGemini(processBuffer, processMimeType);
          if (!extraction || geminiExtraction.overallConfidence > extraction.overallConfidence) {
            extraction = geminiExtraction;
            logger.info("Using Gemini extraction", { confidence: extraction.overallConfidence });
          }
        } catch (error) {
          logger.error("Gemini extraction failed", error);
        }
      }

      // Step 2.5: If we still don't have a merchant name, try focused merchant extraction
      if (extraction && (!extraction.supplierName || !extraction.supplierName.value)) {
        logger.warn("No merchant name found in initial extraction, attempting focused merchant-only extraction");
        try {
          const merchantName = await extractMerchantNameOnly(processBuffer, processMimeType);
          if (merchantName) {
            logger.info("Focused merchant extraction successful", { merchantName });
            extraction.supplierName = {
              value: merchantName,
              confidence: 0.75,
              rawText: merchantName
            };
          }
        } catch (error) {
          logger.error("Focused merchant extraction failed", error);
        }
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
      // Use lower threshold for PDFs since they're typically cleaner and more machine-readable
      const isPdf = mimeType === "application/pdf";
      const confidenceThreshold = isPdf ? PDF_HIGH_CONFIDENCE_THRESHOLD : HIGH_CONFIDENCE_THRESHOLD;
      const status = extraction.overallConfidence >= confidenceThreshold
        ? "final"
        : "needs_review";

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
 * Focused extraction to get just the merchant name using Gemini
 * Used as a fallback when the main extraction doesn't find a merchant
 */
async function extractMerchantNameOnly(
  fileBuffer: Buffer,
  mimeType: string
): Promise<string | null> {
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: VERTEX_LOCATION,
  });

  const model = vertexAI.getGenerativeModel({
    model: "gemini-2.5-flash-preview-05-20",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
      responseMimeType: "application/json",
    },
  });

  // Gemini only supports these image mimeTypes
  const supportedMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  let geminiMimeType = mimeType;
  if (!supportedMimeTypes.includes(mimeType)) {
    geminiMimeType = "image/jpeg";
  }

  const prompt = `You are analyzing a receipt image. Your ONLY task is to identify the merchant/store/business name.

Look for:
- The largest text at the TOP of the receipt
- Company logos or branding
- Store name in the header
- Business name before the itemized list

Common examples: "WALMART", "TARGET", "STARBUCKS", "CVS PHARMACY", "WHOLE FOODS MARKET", "MCDONALD'S", etc.

Return ONLY a JSON object with this format:
{
  "merchant": "Store Name Here"
}

Make your best effort. Even a partial name is better than nothing. Only return null if the image is completely illegible.`;

  const base64Image = fileBuffer.toString("base64");

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: geminiMimeType,
              data: base64Image,
            },
          },
          { text: prompt },
        ],
      },
    ],
  });

  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";

  try {
    const parsed = JSON.parse(text);
    const merchantName = parsed.merchant;

    if (merchantName && typeof merchantName === 'string') {
      const trimmed = merchantName.trim();
      if (trimmed.length > 0 && !["null", "unknown", "n/a", "none"].includes(trimmed.toLowerCase())) {
        return trimmed;
      }
    }
  } catch (error) {
    logger.warn("Failed to parse merchant-only extraction", { error, text });
  }

  return null;
}

/**
 * Extract receipt data using Google Document AI
 */
async function extractWithDocumentAI(
  fileBuffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  const client = new DocumentProcessorServiceClient();

  const name = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

  const request = {
    name,
    rawDocument: {
      content: fileBuffer.toString("base64"),
      mimeType,
    },
  };

  const [result] = await client.processDocument(request);
  const document = result.document;

  if (!document) {
    throw new Error("No document returned from Document AI");
  }

  // Extract entities from the document
  const entities = document.entities || [];
  let totalAmount: ExtractedField<number> | undefined;
  let currency: ExtractedField<string> | undefined;
  let date: ExtractedField<string> | undefined;
  let supplierName: ExtractedField<string> | undefined;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const entity of entities) {
    const type = entity.type?.toLowerCase() || "";
    const value = entity.mentionText || "";
    const confidence = entity.confidence || 0;

    confidenceSum += confidence;
    confidenceCount++;

    if (type.includes("total") || type.includes("amount")) {
      const numericValue = parseFloat(value.replace(/[^0-9.-]/g, ""));
      if (!isNaN(numericValue)) {
        totalAmount = { value: numericValue, confidence, rawText: value };
      }
    }

    if (type.includes("currency")) {
      currency = { value: value.toUpperCase(), confidence, rawText: value };
    }

    if (type.includes("date") || type.includes("receipt_date")) {
      const parsedDate = parseDate(value);
      if (parsedDate) {
        date = { value: parsedDate, confidence, rawText: value };
      }
    }

    if (type.includes("supplier") || type.includes("vendor") || type.includes("merchant")) {
      supplierName = { value: value.trim(), confidence, rawText: value };
    }
  }

  // Default currency to USD if not found
  if (!currency && totalAmount) {
    currency = { value: "USD", confidence: 0.5 };
  }

  const overallConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;

  return {
    source: "document_ai",
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    totalAmount,
    currency,
    date,
    supplierName,
    overallConfidence,
  };
}

/**
 * Extract receipt data using Gemini 2.5
 */
async function extractWithGemini(
  fileBuffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: VERTEX_LOCATION,
  });

  const model = vertexAI.getGenerativeModel({
    model: "gemini-2.5-flash-preview-05-20", // Gemini 2.5 Flash - better accuracy for receipts
    generationConfig: {
      temperature: 0.1, // Low temperature for more consistent extraction
      maxOutputTokens: 1024,
      responseMimeType: "application/json", // Force JSON output
    },
  });

  // Gemini only supports these image mimeTypes: jpeg, png, gif, webp
  // Map unsupported types to jpeg (the data will still be what it is, but Gemini might handle it)
  const supportedMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  let geminiMimeType = mimeType;
  if (!supportedMimeTypes.includes(mimeType)) {
    logger.info(`Unsupported mimeType ${mimeType} for Gemini, using image/jpeg`);
    geminiMimeType = "image/jpeg";
  }

  const prompt = `You are an expert receipt parser. Analyze this receipt image carefully and extract the key information.

CRITICAL INSTRUCTIONS:
1. MERCHANT NAME: This is the MOST IMPORTANT field. Look very carefully for:
   - The business/store name printed at the TOP of the receipt (usually largest text)
   - Company logos or branding
   - Header text before the itemized list
   - Store location or branch name
   - Common patterns: "WALMART", "TARGET", "STARBUCKS", "CVS", "WHOLE FOODS", etc.
   - DO NOT return null for merchant unless the receipt is completely illegible
   - If unsure, provide your best guess based on any visible text or logos

2. TOTAL AMOUNT: Look for the FINAL TOTAL - usually labeled as "Total", "Grand Total", "Amount Due", or similar. Do NOT use subtotals or individual item prices.

Return a JSON object with these exact fields:
{
  "merchant": "The store or business name",
  "total": 0.00,
  "currency": "USD",
  "date": "YYYY-MM-DD",
  "confidence": 0.95
}

Field requirements:
- "merchant": The business name. REQUIRED - make your best effort to extract this. Look at logos, headers, and any text at the top of the receipt. Even partial names are better than null.
- "total": A NUMBER representing the final total paid. Parse from text like "$45.67" → 45.67
- "currency": The currency code (default to "USD" for US receipts)
- "date": The transaction date in YYYY-MM-DD format
- "confidence": Your confidence in the extraction (0.0 to 1.0)

If you cannot find the merchant name with high confidence, still provide your best guess based on visible text. Only set merchant to null if the image is completely unreadable.

Return ONLY the JSON object.`;

  const base64Image = fileBuffer.toString("base64");

  logger.info("Calling Gemini 2.5 Flash for receipt extraction", {
    originalMimeType: mimeType,
    geminiMimeType,
    bufferSize: fileBuffer.length,
  });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: geminiMimeType,
              data: base64Image,
            },
          },
          { text: prompt },
        ],
      },
    ],
  });

  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";

  logger.info("Gemini raw response", { text: text.substring(0, 500) });

  // Parse JSON from response - with responseMimeType set, the response should be clean JSON
  let parsed: Record<string, unknown>;
  try {
    // First try direct parse (should work with responseMimeType: "application/json")
    parsed = JSON.parse(text);
  } catch {
    // Fallback: extract JSON from markdown code blocks or text
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error("Could not parse JSON from Gemini response", { text });
      throw new Error("Could not parse JSON from Gemini response");
    }
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    parsed = JSON.parse(jsonStr);
  }

  logger.info("Gemini parsed response", {
    merchant: parsed.merchant,
    total: parsed.total,
    totalType: typeof parsed.total,
    date: parsed.date,
    confidence: parsed.confidence,
  });

  let confidence = (typeof parsed.confidence === 'number' ? parsed.confidence : 0.7);

  // Parse total amount - handle both number and string values
  let totalAmountValue: number | undefined;
  if (parsed.total != null) {
    const rawTotal = parsed.total;
    const numValue = typeof rawTotal === 'string'
      ? parseFloat(String(rawTotal).replace(/[^0-9.-]/g, ''))
      : Number(rawTotal);
    if (!isNaN(numValue) && numValue > 0) {
      totalAmountValue = numValue;
      logger.info("Parsed total amount", { raw: rawTotal, parsed: numValue });
    } else {
      logger.warn("Failed to parse total amount", { raw: rawTotal, parsed: numValue });
    }
  } else {
    logger.warn("No total found in Gemini response");
  }

  // Parse merchant name - be more robust in handling empty/null values
  let merchantValue: string | undefined;
  if (parsed.merchant != null) {
    const trimmed = String(parsed.merchant).trim();
    // Only accept non-empty strings that aren't just "null", "unknown", etc.
    if (trimmed.length > 0 &&
        !["null", "unknown", "n/a", "none", ""].includes(trimmed.toLowerCase())) {
      merchantValue = trimmed;
    }
  }

  // Log merchant extraction for debugging
  logger.info("Merchant extraction from Gemini", {
    raw: parsed.merchant,
    parsed: merchantValue,
    wasNull: parsed.merchant == null,
    wasEmpty: !merchantValue
  });

  // Boost confidence for PDFs when all critical fields are successfully extracted
  const isPdf = mimeType === "application/pdf";
  const hasAllCriticalFields = totalAmountValue !== undefined && merchantValue && parsed.date;
  if (isPdf && hasAllCriticalFields && confidence < 0.85) {
    // PDFs are cleaner and more machine-readable, so boost confidence when extraction is complete
    confidence = Math.max(confidence, 0.85);
    logger.info("Boosted confidence for complete PDF extraction", { originalConfidence: parsed.confidence, boostedConfidence: confidence });
  }

  return {
    source: "gemini",
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    totalAmount: totalAmountValue !== undefined
      ? { value: totalAmountValue, confidence, rawText: String(parsed.total) }
      : undefined,
    currency: parsed.currency
      ? { value: String(parsed.currency), confidence }
      : { value: "USD", confidence: 0.5 },
    date: parsed.date
      ? { value: String(parsed.date), confidence }
      : undefined,
    supplierName: merchantValue
      ? { value: merchantValue, confidence, rawText: merchantValue }
      : undefined,
    overallConfidence: confidence,
  };
}

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
