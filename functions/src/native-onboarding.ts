import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { hasUsableReceipt } from './email-lifecycle-policy';
import { NATIVE_GUIDE_VERSION, NativeGuideProgress, nextNativeGuideProgress, validateNativeGuideChange, recordNativeReceiptMilestone } from './native-onboarding-policy';

function owner(request: { auth?: { uid: string; token: Record<string, any> }; data?: any }): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  if (!request.auth.token.email_verified) throw new HttpsError('failed-precondition', 'Verify your email first.');
  // Prevent queued work for a previous session from affecting the next account.
  if (request.data?.expectedUserId !== request.auth.uid) throw new HttpsError('permission-denied', 'The account changed.');
  return request.auth.uid;
}

export const getNativeOnboardingState = onCall({ region: 'us-central1' }, async request => {
  const uid = owner(request);
  const db = admin.firestore();
  const ref = db.doc(`users/${uid}`);
  const count = (await ref.collection('receipts').count().get()).data().count;
  const progress = await db.runTransaction(async transaction => {
    const profile = await transaction.get(ref);
    if (!profile.exists) throw new HttpsError('failed-precondition', 'Account is not ready yet.');
    const current = profile.get('nativeOnboarding') as NativeGuideProgress | undefined;
    if (current?.version === NATIVE_GUIDE_VERSION) return current;
    const now = Date.now();
    const createdAt = profile.get('createdAt')?.toMillis?.();
    const cohort = !Number.isFinite(createdAt) ? 'unknown_account' : now - createdAt <= 86400000 ? 'new_account' : 'existing_account';
    const initial: NativeGuideProgress = { version: NATIVE_GUIDE_VERSION, status: 'new', firstOpenedAt: now,
      baselineReceiptCount: count, cohort, updatedAt: now };
    transaction.update(ref, { nativeOnboarding: initial });
    return initial;
  });
  return { receiptCount: count, progress };
});

export const saveNativeOnboardingProgress = onCall({ region: 'us-central1' }, async request => {
  const uid = owner(request);
  const { action, receiptId } = request.data ?? {};
  try { validateNativeGuideChange(action, receiptId); }
  catch { throw new HttpsError('invalid-argument', 'Invalid onboarding action or receipt.'); }
  const db = admin.firestore();
  const ref = db.doc(`users/${uid}`);
  const progress = await db.runTransaction(async transaction => {
    const profile = await transaction.get(ref);
    if (!profile.exists) throw new HttpsError('failed-precondition', 'Account is not ready yet.');
    const current = profile.get('nativeOnboarding') as NativeGuideProgress | undefined;
    if (current?.version !== NATIVE_GUIDE_VERSION) throw new HttpsError('failed-precondition', 'Open the guide first.');
    const receipt = ['upload', 'view', 'observe', 'complete'].includes(action)
      ? (await transaction.get(ref.collection('receipts').doc(receiptId))).data() : undefined;
    let next: NativeGuideProgress;
    try { next = nextNativeGuideProgress(current, action, Date.now(), receiptId, receipt); }
    catch { throw new HttpsError('failed-precondition', 'View and confirm this receipt before finishing.'); }
    transaction.update(ref, { nativeOnboarding: next });
    return next;
  });
  return { progress };
});

// A bounded, permanent milestone record makes the 14-day outcome independent
// of app reopening, duplicate trigger delivery, and later receipt deletion.
export const recordNativeReceiptActivation = onDocumentWritten(
  { region: 'us-central1', document: 'users/{userId}/receipts/{receiptId}' },
  async event => {
    if (!hasUsableReceipt(event.data?.after?.data()) || hasUsableReceipt(event.data?.before?.data())) return;
    const db = admin.firestore();
    const profileRef = db.doc(`users/${event.params.userId}`);
    const receiptRef = profileRef.collection('receipts').doc(event.params.receiptId);
    await db.runTransaction(async transaction => {
      const [profile, receipt] = await Promise.all([transaction.get(profileRef), transaction.get(receiptRef)]);
      const progress = profile.get('nativeOnboarding') as NativeGuideProgress | undefined;
      if (!profile.exists || progress?.version !== NATIVE_GUIDE_VERSION || !receipt.exists) return;
      const activatedAt = Date.parse(event.time);
      if (!Number.isFinite(activatedAt)) return;
      const next = recordNativeReceiptMilestone(progress, receipt.id, receipt.data()!, activatedAt);
      if (next !== progress) transaction.update(profileRef, { nativeOnboarding: next });
    });
  },
);
