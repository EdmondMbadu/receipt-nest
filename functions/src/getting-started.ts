import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { GuideAction, GuideProgress, nextGuideProgress } from './getting-started-policy';

export const getGettingStartedState = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  if (!request.auth.token.email_verified) throw new HttpsError('failed-precondition', 'Verify your email first.');
  const ref = admin.firestore().doc(`users/${request.auth.uid}`);
  // Count the whole account on the server, including legacy profiles without a count.
  const [profile, count] = await Promise.all([ref.get(), ref.collection('receipts').count().get()]);
  return { receiptCount: count.data().count, progress: profile.get('gettingStarted') ?? null };
});

export const saveGettingStartedProgress = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  if (!request.auth.token.email_verified) throw new HttpsError('failed-precondition', 'Verify your email first.');
  const action = request.data?.action as GuideAction;
  const step = request.data?.step;
  try { nextGuideProgress(undefined, action, step, Date.now()); }
  catch { throw new HttpsError('invalid-argument', 'Invalid guide progress.'); }
  const ref = admin.firestore().doc(`users/${request.auth.uid}`);
  return admin.firestore().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError('failed-precondition', 'Account is not ready.');
    const current = snapshot.get('gettingStarted') as GuideProgress | undefined;
    const progress = nextGuideProgress(current, action, step, Date.now());
    transaction.update(ref, { gettingStarted: progress });
    return { progress };
  });
});
