import { hasUsableReceipt } from './email-lifecycle-policy';

export const NATIVE_GUIDE_VERSION = 2;
export const NATIVE_GUIDE_ACTIONS = ['introduce', 'pause', 'restart', 'upload', 'view', 'observe', 'complete'] as const;
export type NativeGuideAction = typeof NATIVE_GUIDE_ACTIONS[number];
export interface NativeGuideProgress {
  version: 2;
  status: 'new' | 'in_progress' | 'paused' | 'completed';
  firstOpenedAt: number;
  baselineReceiptCount: number;
  cohort?: 'new_account' | 'existing_account' | 'unknown_account';
  updatedAt: number;
  receiptId?: string | null;
  viewedAt?: number | null;
  completedAt?: number;
  firstUsableReceiptViewedAt?: number;
  firstUsableReceiptId?: string;
  receiptMilestones?: { id: string; at: number }[];
  firstReceiptSavedAt?: number;
  thirdReceiptSavedAt?: number;
}

export function validateNativeGuideChange(action: unknown, receiptId: unknown): asserts action is NativeGuideAction {
  if (!NATIVE_GUIDE_ACTIONS.includes(action as NativeGuideAction)) throw new Error('Invalid action.');
  if (['upload', 'view', 'observe', 'complete'].includes(action as string) &&
    (typeof receiptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(receiptId))) throw new Error('A valid receipt is required.');
}

export function nextNativeGuideProgress(current: NativeGuideProgress, action: NativeGuideAction,
  now: number, receiptId?: string, receipt?: Record<string, any>): NativeGuideProgress {
  validateNativeGuideChange(action, receiptId);
  if (['upload', 'view', 'observe', 'complete'].includes(action) && !receipt) throw new Error('Receipt not found.');
  if (['view', 'observe', 'complete'].includes(action) && !hasUsableReceipt(receipt)) throw new Error('Receipt is not ready.');
  if (action === 'complete' && (receipt?.status !== 'final' || current.receiptId !== receiptId || !current.viewedAt)) {
    throw new Error('View and confirm the receipt first.');
  }
  const next = { ...current };
  if (['view', 'observe'].includes(action) && !next.firstUsableReceiptViewedAt) {
    next.firstUsableReceiptViewedAt = now;
    next.firstUsableReceiptId = receiptId;
  }
  // Observing a receipt for measurement never reopens or moves a paused guide.
  if (action === 'observe') return { ...next, updatedAt: now };
  // Replays and stale writes cannot regress completed onboarding across devices.
  if (current.status === 'completed') return next;
  next.updatedAt = now;
  switch (action) {
    case 'introduce': next.status = 'in_progress'; break;
    case 'pause': next.status = 'paused'; break;
    case 'restart': next.status = 'in_progress'; next.receiptId = null; next.viewedAt = null; break;
    case 'upload':
      next.status = 'in_progress';
      if (next.receiptId !== receiptId) next.viewedAt = null;
      next.receiptId = receiptId;
      break;
    case 'view':
      if (next.receiptId !== receiptId) next.viewedAt = null;
      next.status = 'in_progress'; next.receiptId = receiptId; next.viewedAt ??= now;
      break;
    case 'complete': next.status = 'completed'; next.completedAt ??= now; break;
  }
  return next;
}

const DAY = 86400000;
export function recordNativeReceiptMilestone(current: NativeGuideProgress, receiptId: string,
  receipt: Record<string, any>, activatedAt: number): NativeGuideProgress {
  const createdAt = receipt.createdAt?.toMillis?.() ?? receipt.createdAt;
  if (!hasUsableReceipt(receipt) || !Number.isFinite(createdAt) || createdAt < current.firstOpenedAt ||
    activatedAt < current.firstOpenedAt || activatedAt > current.firstOpenedAt + 14 * DAY) return current;
  const milestones = current.receiptMilestones ?? [];
  if (milestones.length >= 3 || milestones.some(item => item.id === receiptId)) return current;
  const nextMilestones = [...milestones, { id: receiptId, at: activatedAt }].sort((a, b) => a.at - b.at);
  return { ...current, receiptMilestones: nextMilestones,
    firstReceiptSavedAt: Math.min(current.firstReceiptSavedAt ?? activatedAt, activatedAt),
    ...(nextMilestones.length === 3 ? { thirdReceiptSavedAt: nextMilestones[2].at } : {}) };
}
