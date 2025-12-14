import { Timestamp, serverTimestamp } from 'firebase/firestore';

/**
 * Canonical merchant record
 * Collection: users/{userId}/merchants/{merchantId}
 * 
 * This stores normalized merchant information and aliases
 * to improve matching over time as users correct merchant names.
 */
export interface Merchant {
  id: string;
  userId: string;

  // Canonical display name (e.g., "Walmart", "Amazon")
  canonicalName: string;

  // All known variations/aliases for this merchant
  // e.g., ["WAL-MART", "Walmart Supercenter #1234", "WM *STORE 1234"]
  aliases: string[];

  // Default category for this merchant (user preference)
  defaultCategoryId?: string;

  // Usage stats
  receiptCount: number;
  totalSpend: number;

  // Timestamps
  createdAt: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt: Timestamp | ReturnType<typeof serverTimestamp>;
}

/**
 * Create a new merchant document
 */
export function createMerchantDocument(
  userId: string,
  merchantId: string,
  canonicalName: string,
  rawName: string
): Merchant {
  return {
    id: merchantId,
    userId,
    canonicalName,
    aliases: [rawName],
    receiptCount: 0,
    totalSpend: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

