import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { assertAdmin } from "./authz";
import {
  BillingMode,
  DEFAULT_BILLING_MODE,
  getEffectiveBillingModeForUserData,
} from "./app-config";
import {
  buildGenericBillingOverlay,
  buildModeBillingFields,
  getGenericBillingSnapshot,
  getModeBillingSnapshot,
} from "./billing-state";
import { appendAppDownloadText, getEmailAppIconAttachments, renderAppDownloadHtmlCard } from "./email-app-links";
import { sendSendgridMail } from "./sendgrid";
import { getEffectiveSubscriptionPlan } from "./subscription";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripePriceIdMonthly = defineSecret("STRIPE_PRICE_ID_MONTHLY");
const stripePriceIdAnnual = defineSecret("STRIPE_PRICE_ID_ANNUAL");
const stripeSecretKeyTest = defineSecret("STRIPE_SECRET_KEY_TEST");
const stripeWebhookSecretTest = defineSecret("STRIPE_WEBHOOK_SECRET_TEST");
const stripePriceIdMonthlyTest = defineSecret("STRIPE_PRICE_ID_MONTHLY_TEST");
const stripePriceIdAnnualTest = defineSecret("STRIPE_PRICE_ID_ANNUAL_TEST");
const fromEmail = "info@receipt-nest.com";

const MAX_RECEIPT_COUNT_BACKFILL_USERS = 50;
const MAX_CUSTOM_EMAIL_RECIPIENTS = 200;
const MAX_CUSTOM_EMAIL_TEMPLATE_CHARS = 120_000;

type UserProAccessMode = "grant" | "revoke";
type CustomEmailRecipient = {
  email: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  userId?: string;
  role?: string;
  plan?: "free" | "pro";
  planSource?: string;
  billingMode?: BillingMode;
  receiptCount?: number;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripHtmlToText = (value: string) =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitFullName = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
};

const getPlanSource = (userData: admin.firestore.DocumentData) => {
  if (userData.adminSubscriptionPlanOverride === "pro") {
    return "admin";
  }

  return userData.subscriptionPlan === "pro" ? "billing" : "free";
};

const normalizeCustomEmailRecipient = async (
  db: admin.firestore.Firestore,
  recipient: unknown
): Promise<CustomEmailRecipient | null> => {
  if (!recipient || typeof recipient !== "object") {
    return null;
  }

  const value = recipient as Record<string, unknown>;
  const userId = typeof value.userId === "string" ? value.userId.trim() : "";

  if (userId) {
    const userSnap = await db.doc(`users/${userId}`).get();
    if (userSnap.exists) {
      const userData = userSnap.data() || {};
      const email = String(userData.email || "").trim().toLowerCase();
      if (!emailPattern.test(email)) {
        return null;
      }

      const firstName = String(userData.firstName || "").trim();
      const lastName = String(userData.lastName || "").trim();
      const fullName = `${firstName} ${lastName}`.trim() || email;

      return {
        email,
        firstName,
        lastName,
        fullName,
        userId,
        role: String(userData.role || "user"),
        plan: getEffectiveSubscriptionPlan(userData),
        planSource: getPlanSource(userData),
        billingMode: getEffectiveBillingModeForUserData(userData),
        receiptCount: Number.isFinite(userData.receiptCount) ? Number(userData.receiptCount) : 0,
      };
    }
  }

  const email = String(value.email || "").trim().toLowerCase();
  if (!emailPattern.test(email)) {
    return null;
  }

  const fullName = String(value.fullName || "").trim();
  const splitName = splitFullName(fullName);
  const firstName = String(value.firstName || splitName.firstName || "").trim();
  const lastName = String(value.lastName || splitName.lastName || "").trim();

  return {
    email,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim() || fullName || email,
    role: typeof value.role === "string" ? value.role : "csv",
    plan: value.plan === "pro" ? "pro" : "free",
    planSource: typeof value.planSource === "string" ? value.planSource : "csv",
    billingMode: value.billingMode === "test" ? "test" : "live",
    receiptCount: Number.isFinite(value.receiptCount) ? Number(value.receiptCount) : 0,
  };
};

const buildTemplateValues = (recipient: CustomEmailRecipient, preheader: string) => {
  const firstName = recipient.firstName || splitFullName(recipient.fullName || "").firstName || "there";
  const lastName = recipient.lastName || "";
  const fullName = recipient.fullName || `${firstName} ${lastName}`.trim() || recipient.email;
  const values: Record<string, string> = {
    firstname: firstName,
    first_name: firstName,
    first: firstName,
    lastname: lastName,
    last_name: lastName,
    last: lastName,
    fullname: fullName,
    full_name: fullName,
    name: fullName,
    email: recipient.email,
    userid: recipient.userId || "",
    user_id: recipient.userId || "",
    plan: recipient.plan || "",
    role: recipient.role || "",
    plansource: recipient.planSource || "",
    plan_source: recipient.planSource || "",
    billingmode: recipient.billingMode || "",
    billing_mode: recipient.billingMode || "",
    receiptcount: String(recipient.receiptCount ?? 0),
    receipt_count: String(recipient.receiptCount ?? 0),
    preheader,
  };

  return values;
};

const renderTemplate = (
  template: string,
  values: Record<string, string>,
  escapeValue: (value: string) => string
) =>
  template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => {
    const value = values[key.toLowerCase()] ?? "";
    return escapeValue(value);
  });

const hasUnsafeEmailHtml = (html: string) =>
  /<\s*script\b/i.test(html) || /javascript\s*:/i.test(html) || /\son[a-z]+\s*=/i.test(html);

const parseBillingMode = (value: unknown): BillingMode => {
  if (value === "live" || value === "test") {
    return value;
  }

  throw new HttpsError("invalid-argument", "Billing mode must be live or test.");
};

const hasBillingModeConfig = (mode: BillingMode) => {
  if (mode === "test") {
    return Boolean(
      stripeSecretKeyTest.value() &&
        stripeWebhookSecretTest.value() &&
        stripePriceIdMonthlyTest.value() &&
        stripePriceIdAnnualTest.value()
    );
  }

  return Boolean(
    stripeSecretKey.value() &&
      stripeWebhookSecret.value() &&
      stripePriceIdMonthly.value() &&
      stripePriceIdAnnual.value()
  );
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
    const message = String(request.data?.message || "").trim() || "This is a test email from ReceiptNest AI.";
    const safeSubject = subject.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeMessage = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br />");
    const preheader = "ReceiptNest AI test email confirmation.";
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
                      <p style="margin:0; font-size:12px; letter-spacing:0.28em; text-transform:uppercase; font-weight:600; color:#a7f3d0;">ReceiptNest AI</p>
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
                      Test sent from the ReceiptNest AI Admin Console.
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
                ${renderAppDownloadHtmlCard()}
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p style="margin:0 0 6px;">ReceiptNest AI • info@receipt-nest.com</p>
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
          <p style="margin:16px 0 0; font-size:11px; color:#94a3b8;">© ${new Date().getFullYear()} ReceiptNest AI. All rights reserved.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    try {
      await sendSendgridMail(sendgridApiKey.value(), {
        to,
        from: { email: fromEmail, name: "ReceiptNest AI" },
        replyTo: { email: fromEmail, name: "ReceiptNest AI" },
        subject,
        text: appendAppDownloadText(message),
        html,
        attachments: getEmailAppIconAttachments(),
      });
    } catch (error) {
      logger.error("SendGrid test email failed", error);
      throw new HttpsError("internal", "Failed to send email.");
    }

    return { ok: true };
  }
);

export const sendCustomAdminEmail = onCall(
  { region: "us-central1", secrets: [sendgridApiKey], timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    if (!sendgridApiKey.value()) {
      throw new HttpsError("failed-precondition", "SendGrid configuration is missing.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const subject = String(request.data?.subject || "").trim();
    const preheader = String(request.data?.preheader || "").trim();
    const htmlTemplate = String(request.data?.html || "").trim();
    const textTemplate = String(request.data?.text || "").trim();
    const rawRecipients: unknown[] = Array.isArray(request.data?.recipients) ? request.data.recipients : [];

    if (!subject) {
      throw new HttpsError("invalid-argument", "Email subject is required.");
    }

    if (!htmlTemplate) {
      throw new HttpsError("invalid-argument", "HTML template is required.");
    }

    if (htmlTemplate.length > MAX_CUSTOM_EMAIL_TEMPLATE_CHARS || textTemplate.length > MAX_CUSTOM_EMAIL_TEMPLATE_CHARS) {
      throw new HttpsError("invalid-argument", "Email template is too large.");
    }

    if (hasUnsafeEmailHtml(htmlTemplate)) {
      throw new HttpsError(
        "invalid-argument",
        "HTML template cannot include script tags, javascript: URLs, or inline event handlers."
      );
    }

    if (rawRecipients.length === 0) {
      throw new HttpsError("invalid-argument", "At least one recipient is required.");
    }

    if (rawRecipients.length > MAX_CUSTOM_EMAIL_RECIPIENTS) {
      throw new HttpsError(
        "invalid-argument",
        `Send at most ${MAX_CUSTOM_EMAIL_RECIPIENTS} recipients at a time.`
      );
    }

    const db = admin.firestore();
    const normalizedRecipients = await Promise.all(
      rawRecipients.map((recipient) => normalizeCustomEmailRecipient(db, recipient))
    );
    const recipientsByEmail = new Map<string, CustomEmailRecipient>();
    normalizedRecipients.forEach((recipient) => {
      if (recipient) {
        recipientsByEmail.set(recipient.email.toLowerCase(), recipient);
      }
    });
    const recipients = [...recipientsByEmail.values()];

    if (recipients.length === 0) {
      throw new HttpsError("invalid-argument", "No valid recipient email addresses were provided.");
    }

    const actingUserEmail =
      typeof request.auth.token?.email === "string" ? request.auth.token.email : null;
    const failedRecipients: Array<{ email: string; reason: string }> = [];
    let sentCount = 0;

    for (const recipient of recipients) {
      const values = buildTemplateValues(recipient, preheader);
      const renderedSubject = renderTemplate(subject, values, (value) =>
        value.replace(/[\r\n]+/g, " ").trim()
      );
      const renderedHtml = renderTemplate(htmlTemplate, values, escapeHtml);
      const renderedText = renderTemplate(textTemplate || stripHtmlToText(htmlTemplate), values, (value) => value);

      try {
        await sendSendgridMail(sendgridApiKey.value(), {
          to: recipient.email,
          from: { email: fromEmail, name: "ReceiptNest AI" },
          replyTo: { email: fromEmail, name: "ReceiptNest AI" },
          subject: renderedSubject,
          text: renderedText,
          html: renderedHtml,
        });
        sentCount += 1;
      } catch (error) {
        logger.error("Custom admin email recipient failed", {
          requestedBy: request.auth.uid,
          requestedByEmail: actingUserEmail,
          recipientEmail: recipient.email,
          error,
        });
        failedRecipients.push({
          email: recipient.email,
          reason: "SendGrid rejected the message for this recipient.",
        });
      }
    }

    logger.info("Admin sent custom email", {
      requestedBy: request.auth.uid,
      requestedByEmail: actingUserEmail,
      subject,
      requestedRecipientCount: rawRecipients.length,
      dedupedRecipientCount: recipients.length,
      sentCount,
      failedCount: failedRecipients.length,
    });

    if (sentCount === 0) {
      throw new HttpsError("internal", "No emails were sent. Check the template and recipient list.");
    }

    return {
      ok: true,
      sentCount,
      failedCount: failedRecipients.length,
      failedRecipients: failedRecipients.slice(0, 10),
    };
  }
);

export const backfillUserReceiptCounts = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const requestedUserIds = Array.isArray(request.data?.userIds)
      ? request.data.userIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const userIds = Array.from(
      new Set(
        requestedUserIds
          .map((value: string) => value.trim())
          .filter((value: string) => value.length > 0)
      )
    ).slice(0, MAX_RECEIPT_COUNT_BACKFILL_USERS);

    if (userIds.length === 0) {
      throw new HttpsError("invalid-argument", "At least one userId is required.");
    }

    const db = admin.firestore();
    const updatedUsers = await Promise.all(
      userIds.map(async (userId) => {
        const userRef = db.doc(`users/${userId}`);
        const countSnap = await db.collection(`users/${userId}/receipts`).count().get();
        const receiptCount = countSnap.data().count;

        await userRef.set(
          {
            receiptCount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return userId;
      })
    );

    logger.info("Backfilled user receipt counts", {
      requestedBy: request.auth.uid,
      updatedCount: updatedUsers.length,
      userIds,
    });

    return { ok: true, updatedCount: updatedUsers.length };
  }
);

export const setUserProAccess = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const userId = String(request.data?.userId || "").trim();
    const mode = String(request.data?.mode || "").trim() as UserProAccessMode;

    if (!userId) {
      throw new HttpsError("invalid-argument", "A target userId is required.");
    }

    if (mode !== "grant" && mode !== "revoke") {
      throw new HttpsError("invalid-argument", "Mode must be grant or revoke.");
    }

    const db = admin.firestore();
    const userRef = db.doc(`users/${userId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }

    const actingUserEmail =
      typeof request.auth.token?.email === "string" ? request.auth.token.email : null;
    const previousData = userSnap.data() || {};

    await userRef.set(
      {
        adminSubscriptionPlanOverride: mode === "grant" ? "pro" : null,
        adminSubscriptionOverrideUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        adminSubscriptionOverrideUpdatedBy: request.auth.uid,
        adminSubscriptionOverrideUpdatedByEmail: actingUserEmail,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const nextData = {
      ...previousData,
      adminSubscriptionPlanOverride: mode === "grant" ? "pro" : null,
    };
    const effectivePlan = getEffectiveSubscriptionPlan(nextData);
    const manualOverrideActive = mode === "grant";

    logger.info("Admin updated user Pro access", {
      requestedBy: request.auth.uid,
      requestedByEmail: actingUserEmail,
      targetUserId: userId,
      mode,
      previousEffectivePlan: getEffectiveSubscriptionPlan(previousData),
      effectivePlan,
      manualOverrideActive,
    });

    return {
      ok: true,
      userId,
      effectivePlan,
      manualOverrideActive,
    };
  }
);

export const getBillingModeStatus = onCall(
  {
    region: "us-central1",
    secrets: [
      stripeSecretKey,
      stripeWebhookSecret,
      stripePriceIdMonthly,
      stripePriceIdAnnual,
      stripeSecretKeyTest,
      stripeWebhookSecretTest,
      stripePriceIdMonthlyTest,
      stripePriceIdAnnualTest,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    return {
      ok: true,
      defaultBillingMode: DEFAULT_BILLING_MODE,
      hasLiveConfig: hasBillingModeConfig("live"),
      hasTestConfig: hasBillingModeConfig("test"),
    };
  }
);

export const setUserBillingMode = onCall(
  {
    region: "us-central1",
    secrets: [
      stripeSecretKey,
      stripeWebhookSecret,
      stripePriceIdMonthly,
      stripePriceIdAnnual,
      stripeSecretKeyTest,
      stripeWebhookSecretTest,
      stripePriceIdMonthlyTest,
      stripePriceIdAnnualTest,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const userId = String(request.data?.userId || "").trim();
    const targetMode = parseBillingMode(request.data?.mode);

    if (!userId) {
      throw new HttpsError("invalid-argument", "A target userId is required.");
    }

    if (!hasBillingModeConfig(targetMode)) {
      throw new HttpsError(
        "failed-precondition",
        `Stripe ${targetMode} configuration is incomplete. Add the required Stripe secrets and price IDs first.`
      );
    }

    const db = admin.firestore();
    const userRef = db.doc(`users/${userId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }

    const userData = userSnap.data() || {};
    const currentMode = getEffectiveBillingModeForUserData(userData);
    if (currentMode === targetMode) {
      return { ok: true, userId, billingMode: targetMode };
    }

    const currentSnapshot = getGenericBillingSnapshot(userData);
    const targetSnapshot = getModeBillingSnapshot(userData, targetMode);

    const actingUserEmail =
      typeof request.auth.token?.email === "string" ? request.auth.token.email : null;

    await userRef.set(
      {
        ...buildModeBillingFields(currentMode, currentSnapshot),
        ...buildGenericBillingOverlay(targetSnapshot),
        billingModeOverride: targetMode === "test" ? "test" : null,
        billingModeOverrideUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        billingModeOverrideUpdatedBy: request.auth.uid,
        billingModeOverrideUpdatedByEmail: actingUserEmail,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info("Admin updated user billing mode", {
      requestedBy: request.auth.uid,
      requestedByEmail: actingUserEmail,
      targetUserId: userId,
      previousBillingMode: currentMode,
      billingMode: targetMode,
    });

    return {
      ok: true,
      userId,
      billingMode: targetMode,
    };
  }
);
