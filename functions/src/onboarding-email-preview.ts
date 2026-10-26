import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { assertAdmin } from "./authz";
import { isValidEmailAddress, normalizeEmailAddress } from "./email-suppression";
import { buildOnboardingEmailMessage, OnboardingEmailTemplate } from "./onboarding-email-message";
import { sendSendgridMail } from "./sendgrid";
import { isOnboardingReminder } from "./email-lifecycle-policy";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const appBaseUrl = defineSecret("APP_BASE_URL");

export const sendOnboardingTestEmail = onCall(
  { region: "us-central1", secrets: [sendgridApiKey, appBaseUrl] },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to send a test email.");
    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const to = normalizeEmailAddress(request.data?.to);
    const userId = typeof request.data?.userId === "string" ? request.data.userId.trim() : "";
    const template = request.data?.template as OnboardingEmailTemplate;
    if (!isValidEmailAddress(to) || /[,;]/.test(to)) throw new HttpsError("invalid-argument", "Enter one valid test inbox email address.");
    if (!userId || userId.includes("/")) throw new HttpsError("invalid-argument", "Choose a source user for the test email.");
    if (template !== "welcome" && !isOnboardingReminder(template)) throw new HttpsError("invalid-argument", "Choose a welcome, Day 3, Day 10, or Day 21 email.");
    if (!sendgridApiKey.value() || !appBaseUrl.value()?.trim()) throw new HttpsError("failed-precondition", "Email configuration is missing.");

    const profile = await admin.firestore().doc(`users/${userId}`).get();
    if (!profile.exists) throw new HttpsError("not-found", "The selected source user no longer exists.");
    const content = buildOnboardingEmailMessage(template, appBaseUrl.value(), String(profile.data()?.firstName ?? ""));
    const subject = `[Test] ${content.subject}`;
    try {
      // An explicit admin test sends only to `to`, even when the source user's
      // reminder is ineligible or already sent. Never call lifecycle delivery,
      // enroll/mark the source user, or generate unsubscribe tokens for them.
      // Public unsubscribe/preferences links remain available in the preview.
      await sendSendgridMail(sendgridApiKey.value(), {
        ...content, subject, to,
        from: { email: "info@receipt-nest.com", name: "ReceiptNest" },
        replyTo: { email: "info@receipt-nest.com", name: "ReceiptNest" },
      });
    } catch (error) {
      logger.error("Failed to send onboarding test email", { template, userId, error });
      throw new HttpsError("internal", "Unable to send the test email right now. Please try again.");
    }
    return { ok: true, to, template, subject };
  },
);
