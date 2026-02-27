import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const appBaseUrl = defineSecret("APP_BASE_URL");
const fromEmail = "info@receipt-nest.com";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

const buildEmailShell = (title: string, bodyHtml: string, preheader: string) => {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f8fafc;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f8fafc;">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px; background:#ffffff; border-radius:20px; border:1px solid #e2e8f0; overflow:hidden; box-shadow:0 20px 40px rgba(15, 23, 42, 0.08);">
            <tr>
              <td style="padding:28px 32px; background:linear-gradient(135deg,#0f172a 0%, #0b2f24 45%, #065f46 100%); color:#ffffff;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p style="margin:0; font-size:12px; letter-spacing:0.28em; text-transform:uppercase; font-weight:600; color:#a7f3d0;">ReceiptNest AI</p>
                      <h1 style="margin:10px 0 0; font-size:24px; font-weight:600; font-family:Arial, sans-serif;">${safeTitle}</h1>
                    </td>
                    <td align="right" style="vertical-align:top;">
                      <div style="width:46px; height:46px; border-radius:14px; background:rgba(167, 243, 208, 0.18); display:inline-block; text-align:center; line-height:46px; font-size:20px;">
                        &#x1F9FE;
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px; font-family:Arial, sans-serif; color:#0f172a;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 30px; font-family:Arial, sans-serif; font-size:12px; color:#64748b;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p style="margin:0 0 6px;">ReceiptNest AI • info@receipt-nest.com</p>
                      <p style="margin:0;">You are receiving this email because you created a ReceiptNest AI account.</p>
                    </td>
                    <td align="right">
                      <span style="display:inline-block; padding:6px 10px; border-radius:999px; background:#0f172a; color:#e2e8f0; font-size:11px;">ReceiptNest AI</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0; font-size:11px; color:#94a3b8;">© ${new Date().getFullYear()} ReceiptNest AI. All rights reserved.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const sendEmail = async (to: string, subject: string, text: string, html: string) => {
  if (!sendgridApiKey.value()) {
    throw new HttpsError("failed-precondition", "SendGrid configuration is missing.");
  }
  sgMail.setApiKey(sendgridApiKey.value());
  await sgMail.send({
    to,
    from: { email: fromEmail, name: "ReceiptNest AI" },
    replyTo: { email: fromEmail, name: "ReceiptNest AI" },
    subject,
    text,
    html
  });
};

export const sendVerificationEmail = onCall(
  { region: "us-central1", secrets: [sendgridApiKey, appBaseUrl] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    if (!appBaseUrl.value()) {
      throw new HttpsError("failed-precondition", "App base URL is missing.");
    }

    const email = request.auth.token.email as string | undefined;
    if (!email) {
      throw new HttpsError("failed-precondition", "Missing authenticated email.");
    }

    const link = await admin.auth().generateEmailVerificationLink(email, {
      url: `${appBaseUrl.value()}/login?verified=1`,
      handleCodeInApp: false
    });

    const subject = "Verify your ReceiptNest AI email";
    const text = `Welcome to ReceiptNest AI!\n\nPlease verify your email to finish setting up your account: ${link}\n\nOnce verified, you can head to your dashboard and start organizing receipts.`;
    const bodyHtml = `
      <p style="margin:0 0 12px; font-size:15px; line-height:1.6;">Hello,</p>
      <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Thanks for signing up for ReceiptNest AI. Please verify your email to finish setting up your account.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;">
        <tr>
          <td align="center" bgcolor="#10b981" style="border-radius:999px;">
            <a href="${link}" style="display:inline-block; padding:12px 22px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif;">Verify email</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px; font-size:14px; line-height:1.6; color:#475569;">If the button does not work, copy and paste this link into your browser:</p>
      <p style="margin:0 0 18px; font-size:13px; line-height:1.6; word-break:break-all; color:#0f172a;">${escapeHtml(link)}</p>
      <div style="margin-top:18px; padding:14px 16px; background:#ecfdf5; border-radius:12px; border:1px solid #d1fae5; font-size:13px; color:#065f46;">
        After verifying, head to your dashboard to start organizing receipts.
      </div>
    `;
    const html = buildEmailShell(subject, bodyHtml, "Verify your email to unlock your dashboard.");

    await sendEmail(email, subject, text, html);

    return { ok: true };
  }
);

export const sendWelcomeEmail = onCall(
  { region: "us-central1", secrets: [sendgridApiKey, appBaseUrl] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    const email = request.auth.token.email as string | undefined;
    if (!email) {
      throw new HttpsError("failed-precondition", "Missing authenticated email.");
    }

    if (!request.auth.token.email_verified) {
      throw new HttpsError("failed-precondition", "Email not verified.");
    }

    const userRef = admin.firestore().doc(`users/${request.auth.uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    if (userData.welcomeEmailSent) {
      return { ok: true };
    }

    const subject = "Welcome to ReceiptNest AI";
    const text = `Welcome to ReceiptNest AI!\n\nCapture receipts, stay organized, and keep every expense in one place.\n\nGo to your dashboard: ${appBaseUrl.value()}/app`;
    const bodyHtml = `
      <p style="margin:0 0 12px; font-size:15px; line-height:1.6;">Welcome to ReceiptNest AI,</p>
      <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">Your receipts are about to get a lot calmer. Upload anything, keep it tidy, and track your spend without the chaos.</p>
      <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">When you are ready, jump into your dashboard and start building your receipt library.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;">
        <tr>
          <td align="center" bgcolor="#10b981" style="border-radius:999px;">
            <a href="${appBaseUrl.value()}/app" style="display:inline-block; padding:12px 22px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif;">Go to the dashboard</a>
          </td>
        </tr>
      </table>
      <div style="margin-top:18px; padding:14px 16px; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0; font-size:13px; color:#475569;">
        Need a quick start? Upload your first receipt and let ReceiptNest AI do the organizing.
      </div>
    `;
    const html = buildEmailShell(subject, bodyHtml, "Welcome to ReceiptNest AI. Your receipts just got organized.");

    try {
      await sendEmail(email, subject, text, html);
      await userRef.set(
        { welcomeEmailSent: true, welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (error) {
      logger.error("Failed to send welcome email", error);
      throw new HttpsError("internal", "Failed to send welcome email.");
    }

    return { ok: true };
  }
);
