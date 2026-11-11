export const FIRST_RECEIPT_SIGNUP = { start: 'receipt' } as const;
export const FIRST_RECEIPT_PATH = '/app?addReceipt=1';
const KEY_PREFIX = 'rn_first_receipt_entry:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Email verification can open a new tab. Keep the explicit upload intent
// scoped to the newly created account until it reaches the authenticated app.
export function rememberFirstReceiptEntry(userId: string, now = Date.now()): void {
  if (typeof window === 'undefined' || !userId) return;
  try { localStorage.setItem(KEY_PREFIX + userId, String(now)); } catch { /* Optional continuity. */ }
}

export function takeFirstReceiptEntry(userId?: string, now = Date.now()): boolean {
  if (typeof window === 'undefined' || !userId) return false;
  try {
    const key = KEY_PREFIX + userId;
    const raw = localStorage.getItem(key);
    if (raw === null) return false;
    localStorage.removeItem(key);
    const age = now - Number(raw);
    return age >= 0 && age <= MAX_AGE_MS;
  } catch { return false; }
}
