import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { emailSuppressionDocumentId, normalizeEmailAddress } from "./email-suppression";
import { LifecycleKind, HOUR, REMINDER_DELAY, ONBOARDING_SEQUENCE_VERSION, isOnboardingReminder, millis, nextEmailTime, nextOnboardingReminder, recentSendEvents, wantsLifecycleEmail } from "./email-lifecycle-policy";

export const lifecycleStateRef = (userId: string) => admin.firestore().doc(`emailLifecycleState/${userId}`);
const deliveryRef = (userId: string, key: string) => admin.firestore().doc(`emailLifecycleDeliveries/${userId}_${key}`);

export type LifecycleDeliveryResult = { sent: boolean; reason: string; nextAt?: number };
type DeliveryOptions = {
  userId: string;
  recipient: string;
  key: string;
  kind: LifecycleKind;
  now: Date;
  send: () => Promise<unknown>;
  guard?: (transaction: admin.firestore.Transaction, state: admin.firestore.DocumentData) => Promise<boolean>;
  tipId?: string;
  onboardingRunId?: string;
};

// A claim is written BEFORE contacting the provider. Every scheduler and welcome
// call uses this same transaction, so concurrent jobs share one cadence budget.
export const deliverLifecycleEmail = async (options: DeliveryOptions): Promise<LifecycleDeliveryResult> => {
  const { userId, key, kind, recipient, now } = options;
  const db = admin.firestore();
  const stateRef = lifecycleStateRef(userId);
  const messageRef = deliveryRef(userId, key);
  const profileRef = db.doc(`users/${userId}`);
  const suppressionRef = db.doc(`emailSuppressions/${emailSuppressionDocumentId(recipient)}`);
  const at = now.getTime();
  const reserved = await db.runTransaction(async transaction => {
    const [profileSnap, stateSnap, messageSnap, suppressionSnap] = await Promise.all([
      transaction.get(profileRef), transaction.get(stateRef), transaction.get(messageRef), transaction.get(suppressionRef),
    ]);
    const profile = profileSnap.data() ?? {};
    const state = stateSnap.data() ?? {};
    const message = messageSnap.data();
    if (!profileSnap.exists) return { sent: false, reason: "account-missing" };
    if (normalizeEmailAddress(profile.email) !== normalizeEmailAddress(recipient)) return { sent: false, reason: "address-changed" };
    if (kind === "welcome" && profile.welcomeEmailSent) return { sent: false, reason: "already-sent" };
    if (!wantsLifecycleEmail(profile, kind)) return { sent: false, reason: "preference" };
    if (kind !== "welcome" && suppressionSnap.data()?.status === "unsubscribed") return { sent: false, reason: "unsubscribed" };
    if (message && message.status !== "rejected") return { sent: false, reason: "already-claimed" };
    if (message?.retryAt && millis(message.retryAt) > at) return { sent: false, reason: "retry-later", nextAt: millis(message.retryAt) };
    if (options.guard && !await options.guard(transaction, state)) return { sent: false, reason: "no-longer-eligible" };
    const events = recentSendEvents(state.events, at, millis(profile.welcomeEmailSentAt));
    const nextAt = nextEmailTime(events, at);
    if (kind !== "welcome" && nextAt > at) return { sent: false, reason: "cadence", nextAt };
    transaction.set(messageRef, { userId, key, kind, status: "sending", claimedAt: admin.firestore.Timestamp.fromMillis(at) });
    transaction.set(stateRef, { userId, events: [...events.filter(event => event.key !== key), { key, at }] }, { merge: true });
    return { sent: true, reason: "reserved" };
  });
  if (!reserved.sent) return reserved;

  let accepted = false;
  try {
    await options.send();
    accepted = true;
    await db.runTransaction(async transaction => {
      const stateSnap = await transaction.get(stateRef);
      const profileSnap = await transaction.get(profileRef);
      // Account deletion must never be undone by an email finishing in flight.
      if (!profileSnap.exists) return;
      transaction.set(messageRef, { userId, key, kind, status: "sent", acceptedAt: admin.firestore.Timestamp.now() }, { merge: true });
      if (kind === "welcome") {
        transaction.set(profileRef, { welcomeEmailSent: true, welcomeEmailSentAt: admin.firestore.Timestamp.fromMillis(at) }, { merge: true });
        // A delayed first welcome must not move an explicitly restarted clock.
        if (!stateSnap.data()?.onboardingRunId) transaction.set(stateRef, {
          userId, enrolledAt: admin.firestore.Timestamp.fromMillis(at),
          onboardingSequenceVersion: ONBOARDING_SEQUENCE_VERSION,
          reminderDueAt: stateSnap.data()?.activatedAt ? null : admin.firestore.Timestamp.fromMillis(at + REMINDER_DELAY),
        }, { merge: true });
      }
      if (isOnboardingReminder(kind) && (stateSnap.data()?.onboardingRunId ?? null) === (options.onboardingRunId ?? null)) {
        const state = stateSnap.data() ?? {};
        const handled = { ...state.onboardingHandled, [kind]: "sent" };
        const next = state.activatedAt ? null : nextOnboardingReminder(millis(state.enrolledAt), handled, at);
        transaction.set(stateRef, {
          userId, onboardingSequenceVersion: ONBOARDING_SEQUENCE_VERSION, onboardingHandled: handled,
          reminderDueAt: next ? admin.firestore.Timestamp.fromMillis(next.dueAt) : null,
          reminderStatus: next ? "in-progress" : "completed",
        }, { merge: true });
      }
      if (options.tipId) transaction.set(stateRef, { userId, tips: { ...stateSnap.data()?.tips, [options.tipId]: true } }, { merge: true });
    });
    return { sent: true, reason: "sent" };
  } catch (error) {
    const status = (error as { code?: number; response?: { statusCode?: number } }).response?.statusCode ??
      (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 0);
    // A definite provider rejection is retryable. A timeout, process crash, or
    // failed acknowledgement write may follow acceptance: never resend that key
    // automatically. Its reserved cadence slot remains counted conservatively.
    if (!accepted && status >= 400 && status <= 599) {
      await db.runTransaction(async transaction => {
        const stateSnap = await transaction.get(stateRef);
        const profileSnap = await transaction.get(profileRef);
        if (!profileSnap.exists) return;
        transaction.set(messageRef, { userId, key, kind, status: "rejected", retryAt: admin.firestore.Timestamp.fromMillis(at + 6 * HOUR) }, { merge: true });
        transaction.set(stateRef, { userId, events: recentSendEvents(stateSnap.data()?.events, at).filter(event => event.key !== key) }, { merge: true });
      });
    }
    logger.error("Lifecycle email delivery needs attention", { userId, key, accepted, definiteRejection: status >= 400 && status <= 599, error });
    throw error;
  }
};
