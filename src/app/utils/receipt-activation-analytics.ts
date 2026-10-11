/**
 * Activation for new web signups observed in this browser. This intentionally
 * does not claim complete cross-device, mobile, or historical activation.
 * The account ID stays in localStorage and is never sent to analytics.
 */
const KEY_PREFIX = 'rn_receipt_activation:';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type ProcessedReceipt = {
  status: string;
  extraction?: { totalAmount?: { value: number } };
};

export function armReceiptActivation(userId: string, now = Date.now()): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = KEY_PREFIX + userId;
    // Never rearm a completed activation on repeated auth callbacks.
    if (localStorage.getItem(key) === 'complete') return;
    localStorage.setItem(key, String(now));
  } catch { /* storage must never break signup */ }
}

export function trackFirstReceiptProcessed(userId: string, receipts: readonly ProcessedReceipt[], now = Date.now()): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = KEY_PREFIX + userId;
    const raw = localStorage.getItem(key);
    if (raw === null || raw === 'complete') return;
    const age = now - Number(raw);
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) {
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
    localStorage.setItem(key, 'complete');
    gtag('event', 'first_receipt_processed', { activation_scope: 'new_web_signup_same_browser' });
  } catch { /* analytics must never break receipt loading */ }
}
