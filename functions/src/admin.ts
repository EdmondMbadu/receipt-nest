import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const fromEmail = "info@receipt-nest.com";

const assertAdmin = async (uid: string, token: Record<string, unknown>) => {
  if (token?.admin === true || token?.role === "admin") {
    return;
  }

  const userSnap = await admin.firestore().doc(`users/${uid}`).get();
  const role = userSnap.get("role");
  if (role === "admin") {
    return;
  }

  throw new HttpsError("permission-denied", "Admin access required.");
};

export const sendTestEmail = onCall(
  { region: "us-central1", secrets: [sendgridApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    if (!sendgridApiKey.value()) {
      throw new HttpsError("failed-precondition", "SendGrid configuration is missing.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const to = String(request.data?.to || "").trim();
    if (!to) {
      throw new HttpsError("invalid-argument", "Recipient email is required.");
    }

    const subject = String(request.data?.subject || "Test Email").trim() || "Test Email";
    const message = String(request.data?.message || "").trim() || "This is a test email from ReceiptNest.";

    sgMail.setApiKey(sendgridApiKey.value());

    try {
      await sgMail.send({
        to,
        from: { email: fromEmail, name: "ReceiptNest" },
        subject,
        text: message
      });
    } catch (error) {
      logger.error("SendGrid test email failed", error);
      throw new HttpsError("internal", "Failed to send email.");
    }

    return { ok: true };
  }
);
