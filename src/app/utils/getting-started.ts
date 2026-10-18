export interface GuideProgress {
  version: 1;
  status: 'seen' | 'in_progress' | 'completed' | 'dismissed';
  step: number;
  seenAt: number;
  updatedAt: number;
}
export type GuideAction = 'seen' | 'progress' | 'complete' | 'dismiss';
export interface GuideChange { action: GuideAction; step: number; }
export function shouldIntroduceGuide(count: number | null, progress: GuideProgress | null): boolean {
  return count !== null && Number.isInteger(count) && count >= 0 && count < 5 && !progress;
}
export function canResumeGuide(count: number | null, progress: GuideProgress | null): boolean {
  return count !== null && count >= 0 && count < 5 && !!progress && ['seen', 'in_progress'].includes(progress.status);
}
export function trackGettingStarted(event: string, source: string): void {
  if (typeof window === 'undefined') return;
  try {
    (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.('event', event, { source, guide_version: 1 });
  } catch { /* Analytics never interrupts getting started. */ }
}

export function trackReceiptDownload(userId: string | undefined, kind: 'original' | 'csv' | 'pdf'): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = 'rn_first_download:' + userId;
    if (localStorage.getItem(key)) return;
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    if (!gtag) return;
    gtag('event', 'first_receipt_download', { format: kind, activation_scope: 'same_browser', outcome: 'download_requested' });
    localStorage.setItem(key, '1');
  } catch { /* Downloading works even when analytics or storage is unavailable. */ }
}
