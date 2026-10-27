import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { deliverLifecycleEmail, lifecycleStateRef } from "./email-lifecycle";
import { deliveryTime, hasUsableReceipt, HOUR, isReminderHour, millis, nextOnboardingReminder, onboardingDeliveryKey, ONBOARDING_SEQUENCE_VERSION, REMINDER_EXPIRY, sameOnboardingEnrollment } from "./email-lifecycle-policy";
import { buildUnsubscribeUrls, isEmailSuppressed, normalizeEmailAddress, unsubscribeTokenSecret } from "./email-suppression";
import { buildOnboardingEmailMessage } from "./onboarding-email-message";
import { sendSendgridMail } from "./sendgrid";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const appBaseUrl = defineSecret("APP_BASE_URL");

// Persist activation separately from current receipt count: deleting a receipt
// must not automatically enroll an experienced user back into reminders.
export const recordReceiptEmailActivation = onDocumentWritten(
  { region: "us-central1", document: "users/{userId}/receipts/{receiptId}" },
  async event => {
    if (!hasUsableReceipt(event.data?.after?.data()) || hasUsableReceipt(event.data?.before?.data())) return;
    const userId = event.params.userId;
    const db = admin.firestore();
    const ref = lifecycleStateRef(userId);
    await db.runTransaction(async transaction => {
      const [profile, state] = await Promise.all([transaction.get(db.doc(`users/${userId}`)), transaction.get(ref)]);
      if (!profile.exists || state.data()?.activatedAt) return;
      if (state.data()?.onboardingRunId) {
        // A delayed event for a receipt deleted before the explicit restart
        // must not cancel the fresh sequence. Check the current document.
        const receipt = await transaction.get(db.doc(`users/${userId}/receipts/${event.params.receiptId}`));
        if (!hasUsableReceipt(receipt.data())) return;
      }
      transaction.set(ref, { userId, activatedAt: admin.firestore.Timestamp.now(), reminderDueAt: null, reminderStatus: "activated" }, { merge: true });
    });
  },
);

// Upgrade only users who were already enrolled by a successful welcome. This
// bounded, one-time rollout does not enroll legacy users or replay Day 3.
const upgradeEnrolledSequence = async (now: Date) => {
  const db = admin.firestore();
  const marker = db.doc("emailLifecycleRollouts/onboarding-v2");
  if ((await marker.get()).data()?.completedAt) return;
  const recent = await db.collection("emailLifecycleState")
    .where("enrolledAt", ">=", admin.firestore.Timestamp.fromMillis(now.getTime() - REMINDER_EXPIRY)).get();
  for (const item of recent.docs) {
    if (item.data().onboardingSequenceVersion === ONBOARDING_SEQUENCE_VERSION) continue;
    await db.runTransaction(async transaction => {
      const [snapshot, owner] = await Promise.all([transaction.get(item.ref), transaction.get(db.doc(`users/${item.id}`))]);
      const state = snapshot.data() ?? {};
      if (!snapshot.exists || !owner.exists || state.onboardingSequenceVersion === ONBOARDING_SEQUENCE_VERSION) return;
      const handled = { ...state.onboardingHandled };
      if (state.reminderStatus === "sent") handled["first-receipt"] = "sent";
      const canceled = state.activatedAt || ["activated", "unsubscribed", "preference", "preference-or-deleted", "account-not-eligible", "account-missing", "address-changed"].includes(state.reminderStatus);
      const next = canceled ? null : nextOnboardingReminder(millis(state.enrolledAt), handled, now.getTime());
      transaction.set(item.ref, {
        userId: item.id, onboardingSequenceVersion: ONBOARDING_SEQUENCE_VERSION, onboardingHandled: handled,
        reminderDueAt: next ? admin.firestore.Timestamp.fromMillis(Math.max(now.getTime(), next.dueAt)) : null,
      }, { merge: true });
    });
  }
  await marker.set({ completedAt: admin.firestore.Timestamp.now(), version: ONBOARDING_SEQUENCE_VERSION });
};

export const dispatchOnboardingEmails = onSchedule(
  { region: "us-central1", schedule: "every 60 minutes", timeoutSeconds: 300, secrets: [sendgridApiKey, appBaseUrl, unsubscribeTokenSecret] },
  async event => {
    if (!sendgridApiKey.value() || !appBaseUrl.value() || !unsubscribeTokenSecret.value()) {
      logger.error("Onboarding emails skipped: email configuration is missing");
      return;
    }
    const now = deliveryTime(event.scheduleTime ? new Date(event.scheduleTime) : new Date());
    const at = now.getTime();
    const db = admin.firestore();
    await upgradeEnrolledSequence(now);
    const due = await db.collection("emailLifecycleState").where("reminderDueAt", "<=", admin.firestore.Timestamp.fromMillis(at)).limit(100).get();
    for (const item of due.docs) {
      const userId = item.id;
      const state = item.data();
      const update = async (fields: admin.firestore.UpdateData<admin.firestore.DocumentData>) => {
        await db.runTransaction(async transaction => {
          const fresh = await transaction.get(item.ref);
          if (fresh.exists && sameOnboardingEnrollment(state, fresh.data() ?? {})) transaction.update(item.ref, fields);
        });
      };
      const stop = (reason: string) => update({ reminderDueAt: null, reminderStatus: reason });
      const defer = (nextAt: number) => update({ reminderDueAt: admin.firestore.Timestamp.fromMillis(nextAt) });
      try {
        // Enrollment comes from an accepted welcome or an explicit, audited
        // zero-receipt restart. Profile age alone never enrolls anyone.
        const enrolledAt = millis(state.enrolledAt);
        if (!enrolledAt || state.activatedAt || at >= enrolledAt + REMINDER_EXPIRY) { await stop("finished"); continue; }
        const step = nextOnboardingReminder(enrolledAt, state.onboardingHandled, at);
        if (!step) { await stop("completed"); continue; }
        if (step.dueAt > at) { await defer(step.dueAt); continue; }
        const userRef = db.doc(`users/${userId}`);
        const profileSnap = await userRef.get();
        const profile = profileSnap.data() ?? {};
        if (!profileSnap.exists || profile.notificationSettings?.onboardingEmails === false) { await stop("preference-or-deleted"); continue; }
        if (!isReminderHour(profile, now)) { await defer(at + HOUR); continue; }
        let authUser;
        try { authUser = await admin.auth().getUser(userId); }
        catch (error) {
          if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
          await stop("account-missing"); continue;
        }
        const recipient = normalizeEmailAddress(authUser.email);
        if (!recipient || !authUser.emailVerified || authUser.disabled || recipient !== normalizeEmailAddress(profile.email)) { await stop("account-not-eligible"); continue; }
        if (await isEmailSuppressed(db, recipient)) { await stop("unsubscribed"); continue; }
        const receipts = userRef.collection("receipts");
        const usable = receipts.where("status", "in", ["final", "needs_review"]);
        const inFlight = receipts.where("status", "in", ["uploaded", "processing", "extracted"]).limit(1);
        const [processedSnap, processingSnap] = await Promise.all([usable.get(), inFlight.get()]);
        if (processedSnap.docs.some(doc => hasUsableReceipt(doc.data()))) { await stop("activated"); continue; }
        if (!processingSnap.empty) { await defer(at + 6 * HOUR); continue; }
        const urls = buildUnsubscribeUrls(recipient, appBaseUrl.value(), unsubscribeTokenSecret.value());
        const content = buildOnboardingEmailMessage(step.template, appBaseUrl.value(), String(profile.firstName ?? ""), urls.pageUrl);
        const result = await deliverLifecycleEmail({
          userId, recipient, key: onboardingDeliveryKey(state, step.key), kind: step.template, now,
          onboardingRunId: state.onboardingRunId,
          guard: async (transaction, freshState) => {
            const freshStep = nextOnboardingReminder(millis(freshState.enrolledAt), freshState.onboardingHandled, at);
            if (!sameOnboardingEnrollment(state, freshState) || freshState.activatedAt || !freshStep || freshStep.template !== step.template || millis(freshState.reminderDueAt) > at) return false;
            const [processed, processing] = await Promise.all([transaction.get(usable), transaction.get(inFlight)]);
            return !processed.docs.some(doc => hasUsableReceipt(doc.data())) && processing.empty;
          },
          send: () => sendSendgridMail(sendgridApiKey.value(), {
            to: recipient, from: { email: "info@receipt-nest.com", name: "ReceiptNest" }, replyTo: { email: "info@receipt-nest.com", name: "ReceiptNest" },
            ...content,
            headers: { "List-Unsubscribe": `<${urls.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          }),
        });
        if (result.nextAt) await defer(result.nextAt);
        else if (result.reason === "no-longer-eligible") await defer(at + 6 * HOUR);
        else if (result.reason === "already-claimed") {
          // An ambiguous or concurrent provider acceptance must not be resent.
          // Advance this stage while retaining the delivery claim for inspection.
          await db.runTransaction(async transaction => {
            const [fresh, owner] = await Promise.all([transaction.get(item.ref), transaction.get(userRef)]);
            if (!fresh.exists || !owner.exists) return;
            const latest = fresh.data() ?? {};
            if (!sameOnboardingEnrollment(state, latest)) return;
            const handled = { ...latest.onboardingHandled, [step.template]: latest.onboardingHandled?.[step.template] || "claimed" };
            const next = latest.activatedAt ? null : nextOnboardingReminder(enrolledAt, handled, at);
            transaction.set(item.ref, {
              userId, onboardingHandled: handled,
              reminderDueAt: next ? admin.firestore.Timestamp.fromMillis(next.dueAt) : null,
              reminderStatus: next ? "in-progress" : "completed",
            }, { merge: true });
          });
        }
        else if (!result.sent) await stop(result.reason);
      } catch (error) {
        // Back off operational failures; already-claimed keys are never resent.
        await defer(at + 6 * HOUR);
        logger.error("Onboarding email failed", { userId, error });
      }
    }
  },
);
