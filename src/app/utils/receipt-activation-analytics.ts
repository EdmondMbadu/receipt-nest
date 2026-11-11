import { ACQUISITION_MAX_AGE_MS, AcquisitionParams, cleanAcquisition } from './search-acquisition';

/**
 * Activation for new web signups observed in this browser. This intentionally
 * does not claim complete cross-device, mobile, or historical activation.
 * The account ID stays in localStorage and is never sent to analytics.
 */
const KEY_PREFIX = 'rn_receipt_activation:';

type ProcessedReceipt = {
  status: string;
  extraction?: { totalAmount?: { value: number } };
};

export function armReceiptActivation(userId: string, now = Date.now(), attribution?: AcquisitionParams): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = KEY_PREFIX + userId;
    // Preserve the original signup time and its attribution on repeated callbacks.
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, JSON.stringify({ startedAt: now, attribution }));
  } catch { /* storage must never break signup */ }
}

export function trackFirstReceiptProcessed(userId: string, receipts: readonly ProcessedReceipt[], now = Date.now()): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = KEY_PREFIX + userId;
    const raw = localStorage.getItem(key);
    if (raw === null || raw === 'complete') return;
    const stored = JSON.parse(raw) as number | { startedAt?: number; attribution?: unknown } | null;
    const startedAt = typeof stored === 'number' ? stored : stored?.startedAt;
    const age = typeof startedAt === 'number' ? now - startedAt : NaN;
    if (!Number.isFinite(age) || age < 0 || age > ACQUISITION_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return;
    }
    // Failed extraction can also end in needs_review. Require a parsed amount,
    // rather than counting an upload or a failed processing attempt as success.
    const ready = receipts.some(receipt =>
      (receipt.status === 'needs_review' || receipt.status === 'final') &&
      Number.isFinite(receipt.extraction?.totalAmount?.value)
    );
    if (!ready) return;
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof gtag !== 'function') return;
    gtag('event', 'first_receipt_processed', {
      activation_scope: 'new_web_signup_same_browser',
      ...cleanAcquisition(typeof stored === 'object' ? stored?.attribution : undefined)
    });
    localStorage.setItem(key, 'complete');
  } catch { /* analytics must never break receipt loading */ }
}
