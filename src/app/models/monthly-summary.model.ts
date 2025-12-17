import { Timestamp, serverTimestamp } from 'firebase/firestore';

/**
 * Category breakdown for monthly summary
 */
export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  total: number;
  count: number;
}

/**
 * Merchant breakdown for monthly summary
 */
export interface MerchantBreakdown {
  merchantId: string;
  merchantName: string;
  total: number;
  count: number;
}

/**
 * Monthly spending summary
 * Collection: users/{userId}/monthlySummaries/{YYYY-MM}
 * 
 * This document is updated incrementally as receipts are added/modified.
 */
export interface MonthlySummary {
  id: string; // Format: "YYYY-MM" e.g., "2025-01"
  userId: string;

  // Totals
  totalSpend: number;
  receiptCount: number;

  // Breakdowns
  byCategory: Record<string, CategoryBreakdown>;
  byMerchant: Record<string, MerchantBreakdown>;

  // Daily totals for charting (day of month -> amount)
  dailyTotals: Record<number, number>;

  // Timestamps
  updatedAt: Timestamp | ReturnType<typeof serverTimestamp>;
}

/**
 * Generate monthly summary ID from date
 */
export function getMonthlySummaryId(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Create an empty monthly summary document
 */
export function createMonthlySummaryDocument(
  userId: string,
  monthId: string
): MonthlySummary {
  return {
    id: monthId,
    userId,
    totalSpend: 0,
    receiptCount: 0,
    byCategory: {},
    byMerchant: {},
    dailyTotals: {},
    updatedAt: serverTimestamp()
  };
}


