import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { deliverLifecycleEmail, lifecycleStateRef } from "./email-lifecycle";
import { deliveryTime, hasUsableReceipt, HOUR, isReminderHour, millis, REMINDER_EXPIRY } from "./email-lifecycle-policy";
import { appendUnsubscribeText, buildUnsubscribeUrls, isEmailSuppressed, normalizeEmailAddress, unsubscribeTokenSecret } from "./email-suppression";
import { appendAppDownloadText } from "./email-app-links";
import { buildFirstReceiptReminder, getOnboardingEmailAttachments } from "./onboarding-email-content";
import { sendSendgridMail } from "./sendgrid";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const appBaseUrl = defineSecret("APP_BASE_URL");

// Persist activation separately from current receipt count: deleting a receipt
// must not enroll an experienced user back into first-receipt reminders.
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
      transaction.set(ref, { userId, activatedAt: admin.firestore.Timestamp.now(), reminderDueAt: null, reminderStatus: "activated" }, { merge: true });
    });
  },
);

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
    const due = await db.collection("emailLifecycleState").where("reminderDueAt", "<=", admin.firestore.Timestamp.fromMillis(at)).limit(100).get();
    for (const item of due.docs) {
      const userId = item.id;
      const state = item.data();
      const update = async (fields: admin.firestore.UpdateData<admin.firestore.DocumentData>) => {
        try { await item.ref.update(fields); } catch (error) { if ((error as { code?: number }).code !== 5) throw error; }
      };
      const stop = (reason: string) => update({ reminderDueAt: null, reminderStatus: reason });
      const defer = (nextAt: number) => update({ reminderDueAt: admin.firestore.Timestamp.fromMillis(nextAt) });
      try {
        // Only a successful welcome in this version enrolls a user. Old profiles
        // are deliberately never backfilled into this campaign.
        const enrolledAt = millis(state.enrolledAt);
        if (!enrolledAt || state.activatedAt || at >= enrolledAt + REMINDER_EXPIRY) { await stop("finished"); continue; }
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
        const content = buildFirstReceiptReminder(appBaseUrl.value(), String(profile.firstName ?? ""), urls.pageUrl);
        const result = await deliverLifecycleEmail({
          userId, recipient, key: "first-receipt-v1", kind: "first-receipt", now,
          guard: async (transaction, freshState) => {
            if (freshState.activatedAt) return false;
            const [processed, processing] = await Promise.all([transaction.get(usable), transaction.get(inFlight)]);
            return !processed.docs.some(doc => hasUsableReceipt(doc.data())) && processing.empty;
          },
          send: () => sendSendgridMail(sendgridApiKey.value(), {
            to: recipient, from: { email: "info@receipt-nest.com", name: "ReceiptNest" }, replyTo: { email: "info@receipt-nest.com", name: "ReceiptNest" },
            subject: content.subject, html: content.html, text: appendUnsubscribeText(appendAppDownloadText(content.text), urls.pageUrl),
            attachments: getOnboardingEmailAttachments(),
            headers: { "List-Unsubscribe": `<${urls.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          }),
        });
        if (result.nextAt) await defer(result.nextAt);
        else if (result.reason === "no-longer-eligible") await defer(at + 6 * HOUR);
        else if (!result.sent) await stop(result.reason);
      } catch (error) {
        // Back off operational failures; already-claimed keys are never resent.
        await defer(at + 6 * HOUR);
        logger.error("Onboarding email failed", { userId, error });
      }
    }
  },
);
