export const DEFAULT_FREE_PLAN_RECEIPT_LIMIT = 50;
export const PUBLIC_BILLING_CONFIG_COLLECTION = 'publicConfig';
export const PUBLIC_BILLING_CONFIG_DOC_ID = 'billing';

export function normalizeFreePlanReceiptLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_FREE_PLAN_RECEIPT_LIMIT;
  }

  return Math.floor(parsed);
}
