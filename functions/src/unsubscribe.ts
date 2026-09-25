import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { assertAdmin } from "./authz";
import { sendSendgridMail } from "./sendgrid";
import { addEmailDarkMode } from "./email-theme";
import {
  buildUnsubscribeUrls,
  isEmailSuppressed,
  isValidEmailAddress,
  normalizeEmailAddress,
  normalizeUnsubscribeReason,
  reserveUnsubscribeLinkRequest,
  restoreEmailAddress,
  unsubscribeEmailAddress,
  unsubscribeAppBaseUrl,
  unsubscribeTokenSecret,
  verifyUnsubscribeToken,
} from "./email-suppression";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const fromEmail = "info@receipt-nest.com";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const requireTokenEmail = (token: unknown): string => {
  const email = verifyUnsubscribeToken(token, unsubscribeTokenSecret.value());
  if (!email) {
    throw new HttpsError("invalid-argument", "This unsubscribe link is invalid.");
  }
  return email;
};

export const getEmailUnsubscribeContext = onCall(
  { region: "us-central1", secrets: [unsubscribeTokenSecret] },
  async (request) => {
    const email = requireTokenEmail(request.data?.token);
    const unsubscribed = await isEmailSuppressed(admin.firestore(), email);
    return { ok: true, email, unsubscribed };
  }
);

export const submitEmailUnsubscribe = onCall(
  { region: "us-central1", secrets: [unsubscribeTokenSecret] },
  async (request) => {
    const email = requireTokenEmail(request.data?.token);
    const reason = normalizeUnsubscribeReason(request.data?.reason);
    const result = await unsubscribeEmailAddress(
      admin.firestore(),
      email,
      reason,
      "unsubscribe_page"
    );

    logger.info("Email unsubscribe recorded", {
      emailSuppressionStatus: result.alreadyUnsubscribed ? "already_unsubscribed" : "created",
      source: "unsubscribe_page",
    });
    return { ok: true, email, alreadyUnsubscribed: result.alreadyUnsubscribed };
  }
);

export const requestEmailUnsubscribeLink = onCall(
  {
    region: "us-central1",
    secrets: [sendgridApiKey, unsubscribeAppBaseUrl, unsubscribeTokenSecret],
  },
  async (request) => {
    const email = normalizeEmailAddress(request.data?.email);
    if (!isValidEmailAddress(email)) {
      throw new HttpsError("invalid-argument", "Enter a valid email address.");
    }

    if (!sendgridApiKey.value() || !unsubscribeAppBaseUrl.value() || !unsubscribeTokenSecret.value()) {
      throw new HttpsError("failed-precondition", "Email unsubscribe configuration is missing.");
    }

    const ipAddress = request.rawRequest.ip || request.rawRequest.socket.remoteAddress || "unknown";
    const shouldSend = await reserveUnsubscribeLinkRequest(
      admin.firestore(),
      email,
      ipAddress,
      unsubscribeTokenSecret.value()
    );

    if (shouldSend) {
      const { pageUrl } = buildUnsubscribeUrls(
        email,
        unsubscribeAppBaseUrl.value(),
        unsubscribeTokenSecret.value()
      );
      const safeEmail = escapeHtml(email);
      const safePageUrl = escapeHtml(pageUrl);
      const subject = "Confirm your ReceiptNest unsubscribe request";
      const text = `We received a request to unsubscribe ${email} from non-essential ReceiptNest emails.\n\nConfirm your request: ${pageUrl}\n\nIf you did not request this, you can ignore this email.`;
      const html = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:24px 12px;background:#f8fafc;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:26px 30px;background:linear-gradient(135deg,#0f172a 0%,#065f46 100%);color:#ffffff;">
            <p style="margin:0;font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#a7f3d0;">ReceiptNest</p>
            <h1 style="margin:10px 0 0;font-size:22px;line-height:1.35;">Confirm your unsubscribe request</h1>
          </td></tr>
          <tr><td style="padding:28px 30px;">
            <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">We received a request to stop non-essential emails to <strong>${safeEmail}</strong>.</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Use the button below to confirm. You can optionally tell us why on the next page.</p>
            <a href="${safePageUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#059669;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Continue to unsubscribe</a>
            <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#64748b;">If you did not request this, ignore this email. Nothing will change.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

      try {
        await sendSendgridMail(sendgridApiKey.value(), {
          to: email,
          from: { email: fromEmail, name: "ReceiptNest" },
          replyTo: { email: fromEmail, name: "ReceiptNest" },
          subject,
          text,
          html: addEmailDarkMode(html),
        });
      } catch (error) {
        logger.error("Failed to send unsubscribe confirmation link", { error });
      }
    }

    return { ok: true };
  }
);

export const oneClickEmailUnsubscribe = onRequest(
  { region: "us-central1", secrets: [unsubscribeTokenSecret] },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).send("Method not allowed.");
      return;
    }

    const token = typeof request.query.token === "string" ? request.query.token : "";
    const email = verifyUnsubscribeToken(token, unsubscribeTokenSecret.value());
    if (!email) {
      response.status(400).send("Invalid unsubscribe link.");
      return;
    }

    try {
      const result = await unsubscribeEmailAddress(admin.firestore(), email, null, "one_click");
      logger.info("One-click email unsubscribe recorded", {
        emailSuppressionStatus: result.alreadyUnsubscribed ? "already_unsubscribed" : "created",
      });
      response.status(200).send("Unsubscribed.");
    } catch (error) {
      logger.error("One-click email unsubscribe failed", { error });
      response.status(500).send("Unable to unsubscribe right now.");
    }
  }
);

export const restoreSuppressedEmail = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }
    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const email = normalizeEmailAddress(request.data?.email);
    try {
      await restoreEmailAddress(admin.firestore(), email, request.auth.uid);
    } catch (error) {
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error ? error.message : "Unable to restore that email address."
      );
    }

    logger.info("Admin restored suppressed email", {
      requestedBy: request.auth.uid,
    });
    return { ok: true, email };
  }
);
