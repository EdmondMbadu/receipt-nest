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
    const safeSubject = subject.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeMessage = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\\n/g, "<br />");
    const preheader = "ReceiptNest test email confirmation.";
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f8fafc;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      ${preheader}
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
                      <p style="margin:0; font-size:12px; letter-spacing:0.28em; text-transform:uppercase; font-weight:600; color:#a7f3d0;">ReceiptNest</p>
                      <h1 style="margin:10px 0 0; font-size:24px; font-weight:600; font-family:Arial, sans-serif;">${safeSubject}</h1>
                      <p style="margin:8px 0 0; font-size:14px; color:#d1fae5; font-family:Arial, sans-serif;">A quick confirmation that your mail setup is working.</p>
                    </td>
                    <td align="right" style="vertical-align:top;">
                      <div style="width:46px; height:46px; border-radius:14px; background:rgba(167, 243, 208, 0.18); display:inline-block; text-align:center; line-height:46px; font-size:20px;">
                        &#x1F4E7;
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px; font-family:Arial, sans-serif; color:#0f172a;">
                <p style="margin:0 0 12px; font-size:15px; line-height:1.6;">Hello,</p>
                <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">${safeMessage}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:22px 0 14px;">
                  <tr>
                    <td style="padding:14px 16px; background:#ecfdf5; border-radius:12px; border:1px solid #d1fae5; font-size:13px; color:#065f46;">
                      Test sent from the ReceiptNest Admin Console.
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 18px; font-size:14px; line-height:1.6; color:#475569;">If you did not request this message, you can safely ignore it.</p>
                <div style="margin-top:18px; padding:14px 16px; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0; font-size:13px; color:#475569;">
                  Need help? Reply to this email or visit our support page.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 30px; font-family:Arial, sans-serif; font-size:12px; color:#64748b;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p style="margin:0 0 6px;">ReceiptNest • info@receipt-nest.com</p>
                      <p style="margin:0;">You are receiving this email because an admin initiated a test send.</p>
                    </td>
                    <td align="right">
                      <span style="display:inline-block; padding:6px 10px; border-radius:999px; background:#0f172a; color:#e2e8f0; font-size:11px;">Admin test</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0; font-size:11px; color:#94a3b8;">© ${new Date().getFullYear()} ReceiptNest. All rights reserved.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    sgMail.setApiKey(sendgridApiKey.value());

    try {
      await sgMail.send({
        to,
        from: { email: fromEmail, name: "ReceiptNest" },
        replyTo: { email: fromEmail, name: "ReceiptNest" },
        subject,
        text: message,
        html
      });
    } catch (error) {
      logger.error("SendGrid test email failed", error);
      throw new HttpsError("internal", "Failed to send email.");
    }

    return { ok: true };
  }
);
