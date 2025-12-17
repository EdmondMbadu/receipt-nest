import { Timestamp, serverTimestamp } from 'firebase/firestore';

/**
 * Receipt processing status workflow:
 * uploaded → processing → extracted → needs_review → final
 */
export type ReceiptStatus = 'uploaded' | 'processing' | 'extracted' | 'needs_review' | 'final';

/**
 * Source of extraction data
 */
export type ExtractionSource = 'document_ai' | 'gemini' | 'manual';

/**
 * How the merchant was matched
 */
export type MerchantMatchType = 'exact' | 'fuzzy' | 'alias' | 'ai' | 'manual';

/**
 * How the category was assigned
 */
export type CategoryAssignmentType = 'ai' | 'user' | 'rule' | 'default';

/**
 * Extracted field with confidence score
 */
export interface ExtractedField<T> {
  value: T;
  confidence: number;
  rawText?: string;
}

/**
 * Line item from receipt (optional, for detailed receipts)
 */
export interface LineItem {
  description: string;
  amount: number;
  quantity?: number;
}

/**
 * File metadata stored in Firebase Storage
 */
export interface ReceiptFile {
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Timestamp | ReturnType<typeof serverTimestamp>;
}

/**
 * Extraction results from Document AI or Gemini
 */
export interface ExtractionResult {
  source: ExtractionSource;
  processedAt?: Timestamp | ReturnType<typeof serverTimestamp>;

  totalAmount?: ExtractedField<number>;
  currency?: ExtractedField<string>;
  date?: ExtractedField<string>; // ISO date string YYYY-MM-DD
  supplierName?: ExtractedField<string>;
  lineItems?: LineItem[];

  overallConfidence: number;
  rawResponse?: string; // For debugging, optional
}

/**
 * Normalized merchant information
 */
export interface ReceiptMerchant {
  canonicalId?: string;
  canonicalName: string;
  rawName: string;
  matchConfidence: number;
  matchedBy: MerchantMatchType;
}

/**
 * Category classification
 */
export interface ReceiptCategory {
  id: string;
  name: string;
  confidence: number;
  assignedBy: CategoryAssignmentType;
}

/**
 * Main Receipt document stored in Firestore
 * Collection: users/{userId}/receipts/{receiptId}
 */
export interface Receipt {
  id: string;
  userId: string;

  // Status & workflow
  status: ReceiptStatus;

  // File storage
  file: ReceiptFile;

  // Extraction results (populated after processing)
  extraction?: ExtractionResult;

  // Normalized merchant (populated after extraction)
  merchant?: ReceiptMerchant;

  // Category classification (populated after extraction)
  category?: ReceiptCategory;

  // Final values (user-confirmed or high-confidence extracted)
  totalAmount?: number;
  currency?: string;
  date?: string; // ISO date string YYYY-MM-DD

  // User-editable fields
  notes?: string;
  tags?: string[];

  // Timestamps
  createdAt: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt: Timestamp | ReturnType<typeof serverTimestamp>;
}

/**
 * Create a new receipt document (before upload processing)
 */
export function createReceiptDocument(
  userId: string,
  receiptId: string,
  file: ReceiptFile
): Receipt {
  return {
    id: receiptId,
    userId,
    status: 'uploaded',
    file,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}


