export type GuideAction = 'seen' | 'progress' | 'complete' | 'dismiss';
export interface GuideProgress {
  version: 1;
  status: 'seen' | 'in_progress' | 'completed' | 'dismissed';
  step: number;
  seenAt: number;
  updatedAt: number;
}

export function nextGuideProgress(current: GuideProgress | undefined, action: GuideAction, step: number, now: number): GuideProgress {
  if (!['seen', 'progress', 'complete', 'dismiss'].includes(action) || !Number.isInteger(step) || step < 0 || step > 4) {
    throw new Error('Invalid guide progress');
  }
  // A late tab or in-flight step must not undo a completion or dismissal.
  if (current && (current.status === 'completed' || current.status === 'dismissed') && action !== 'complete') return current;
  if (current && action === 'seen') return current;
  return {
    version: 1,
    status: action === 'complete' ? 'completed' : action === 'dismiss' ? 'dismissed' : action === 'progress' ? 'in_progress' : 'seen',
    step: action === 'complete' ? 4 : step,
    seenAt: current?.seenAt ?? now,
    updatedAt: now,
  };
}
