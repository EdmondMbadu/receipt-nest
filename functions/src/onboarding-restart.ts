import * as admin from "firebase-admin";
import { ONBOARDING_SEQUENCE_VERSION, REMINDER_DELAY } from "./email-lifecycle-policy";
import { emailSuppressionDocumentId, isValidEmailAddress, normalizeEmailAddress } from "./email-suppression";

type RestartOptions = { userId: string; runId: string; startedAt: Date; dryRun?: boolean };

// Explicit operator enrollment only. Ordinary receipt deletion never calls this.
// Each run has a durable per-account audit record, making interrupted runs safe
// to resume without restarting clocks or replaying stages already completed.
export const restartZeroReceiptOnboarding = async ({ userId, runId, startedAt, dryRun = true }: RestartOptions): Promise<string> => {
  if (!userId || userId.includes("/") || !/^[a-z0-9-]{1,100}$/.test(runId) || !Number.isFinite(startedAt.getTime())) {
    throw new Error("A valid account, run ID and start time are required");
  }
  let authUser: admin.auth.UserRecord;
  try { authUser = await admin.auth().getUser(userId); }
  catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") return "account-missing";
    throw error;
  }
  const email = normalizeEmailAddress(authUser.email);
  if (!isValidEmailAddress(email) || !authUser.emailVerified || authUser.disabled) return "account-not-eligible";
  const db = admin.firestore();
  const userRef = db.doc(`users/${userId}`);
  const stateRef = db.doc(`emailLifecycleState/${userId}`);
  const auditRef = db.doc(`emailLifecycleRestarts/${userId}_${runId}`);
  return db.runTransaction(async transaction => {
    const [owner, stateSnap, audit, receipts, suppression] = await Promise.all([
      transaction.get(userRef), transaction.get(stateRef), transaction.get(auditRef),
      transaction.get(userRef.collection("receipts").limit(1)),
      transaction.get(db.doc(`emailSuppressions/${emailSuppressionDocumentId(email)}`)),
    ]);
    if (!owner.exists) return "account-missing";
    if (audit.exists) return "already-enrolled";
    if (!receipts.empty) return "has-receipts";
    const profile = owner.data() ?? {};
    if (normalizeEmailAddress(profile.email) !== email) return "address-changed";
    if (profile.notificationSettings?.onboardingEmails === false) return "preference";
    if (suppression.data()?.status === "unsubscribed") return "unsubscribed";
    if (dryRun) return "eligible";
    const state = stateSnap.data() ?? {};
    const at = admin.firestore.Timestamp.fromDate(startedAt);
    transaction.set(auditRef, {
      userId, runId, startedAt: at, recordedAt: admin.firestore.Timestamp.now(),
      previous: {
        enrolledAt: state.enrolledAt ?? null, activatedAt: state.activatedAt ?? null,
        onboardingRunId: state.onboardingRunId ?? null, onboardingHandled: state.onboardingHandled ?? {},
        reminderDueAt: state.reminderDueAt ?? null, reminderStatus: state.reminderStatus ?? null,
      },
    });
    // Replace the handled map atomically while preserving cadence, tips and all
    // other history. A merge-set would retain handled stages from the old run.
    transaction.set(stateRef, {
      ...state, userId, enrolledAt: at, onboardingRunId: runId,
      enrollmentSource: "zero-receipt-restart", onboardingSequenceVersion: ONBOARDING_SEQUENCE_VERSION,
      activatedAt: null, onboardingHandled: {}, reminderStatus: "enrolled",
      reminderDueAt: admin.firestore.Timestamp.fromMillis(startedAt.getTime() + REMINDER_DELAY),
    });
    return "enrolled";
  });
};
