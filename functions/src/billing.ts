import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { BillingMode, getEffectiveBillingModeForUserData } from "./app-config";
import {
  BillingSnapshot,
  buildGenericBillingOverlay,
  buildModeBillingFields,
  emptyBillingSnapshot,
  getModeBillingFieldName,
  getStoredCustomerIdForMode,
} from "./billing-state";
import { appendAppDownloadText, getEmailAppIconAttachments, renderAppDownloadHtmlCard } from "./email-app-links";
import { sendSendgridMail } from "./sendgrid";

const STRIPE_API_VERSION = "2024-06-20";
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripePriceIdMonthly = defineSecret("STRIPE_PRICE_ID_MONTHLY");
const stripePriceIdAnnual = defineSecret("STRIPE_PRICE_ID_ANNUAL");
const stripeSecretKeyTest = defineSecret("STRIPE_SECRET_KEY_TEST");
const stripeWebhookSecretTest = defineSecret("STRIPE_WEBHOOK_SECRET_TEST");
const stripePriceIdMonthlyTest = defineSecret("STRIPE_PRICE_ID_MONTHLY_TEST");
const stripePriceIdAnnualTest = defineSecret("STRIPE_PRICE_ID_ANNUAL_TEST");
const appBaseUrl = defineSecret("APP_BASE_URL");
const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const fromEmail = "info@receipt-nest.com";

const getStripeSecretKeyForMode = (mode: BillingMode) =>
  mode === "test" ? stripeSecretKeyTest.value() : stripeSecretKey.value();

const getStripeWebhookSecretForMode = (mode: BillingMode) =>
  mode === "test" ? stripeWebhookSecretTest.value() : stripeWebhookSecret.value();

const getStripePriceIdForModeAndInterval = (mode: BillingMode, interval: string) => {
  if (mode === "test") {
    return interval === "annual" ? stripePriceIdAnnualTest.value() : stripePriceIdMonthlyTest.value();
  }

  return interval === "annual" ? stripePriceIdAnnual.value() : stripePriceIdMonthly.value();
};

const hasCheckoutConfigForMode = (mode: BillingMode) => {
  const secretKey = getStripeSecretKeyForMode(mode);
  const monthlyPriceId = getStripePriceIdForModeAndInterval(mode, "monthly");
  const annualPriceId = getStripePriceIdForModeAndInterval(mode, "annual");
  return Boolean(secretKey && monthlyPriceId && annualPriceId && appBaseUrl.value());
};

const hasPortalConfigForMode = (mode: BillingMode) =>
  Boolean(getStripeSecretKeyForMode(mode) && appBaseUrl.value());

const hasWebhookConfigForMode = (mode: BillingMode) =>
  Boolean(
    getStripeSecretKeyForMode(mode) &&
      getStripeWebhookSecretForMode(mode) &&
      getStripePriceIdForModeAndInterval(mode, "monthly") &&
      getStripePriceIdForModeAndInterval(mode, "annual")
  );

const getStripe = (mode: BillingMode) => {
  const secret = getStripeSecretKeyForMode(mode);
  if (!secret) {
    throw new Error(`Missing Stripe secret key for ${mode} mode.`);
  }
  return new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
  });
};

const VALID_INTERVALS = new Set(["monthly", "annual"]);
type BillingPlatform = "web" | "mobile";
const VALID_PLATFORMS = new Set<BillingPlatform>(["web", "mobile"]);
const portalRedirectStatusSet = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);
const pendingCheckoutStatusSet = new Set(["incomplete"]);

const getPriceIdForInterval = (mode: BillingMode, interval: string) => {
  return getStripePriceIdForModeAndInterval(mode, interval);
};

const resolvePlanFromPrice = (mode: BillingMode, priceId: string | null | undefined) => {
  if (
    priceId === getStripePriceIdForModeAndInterval(mode, "monthly") ||
    priceId === getStripePriceIdForModeAndInterval(mode, "annual")
  ) {
    return "pro";
  }
  return "free";
};

const resolveIntervalFromPrice = (mode: BillingMode, priceId: string | null | undefined) => {
  if (priceId === getStripePriceIdForModeAndInterval(mode, "annual")) {
    return "annual";
  }
  if (priceId === getStripePriceIdForModeAndInterval(mode, "monthly")) {
    return "monthly";
  }
  return "monthly";
};

const activeStatusSet = new Set(["active", "trialing", "past_due", "unpaid"]);
const PRO_FEATURE_HIGHLIGHTS = [
  "Unlimited receipts",
  "Advanced search and filters",
  "Export to CSV and PDF",
  "Spending insights and trends",
  "Priority support",
];

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const formatDateLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);

const formatCurrency = (amountMinor: number, currency: string | null | undefined) => {
  const normalizedCurrency = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${normalizedCurrency}`;
  }
};

const buildBillingUrls = (platform: BillingPlatform) => {
  const baseUrl = normalizeBaseUrl(appBaseUrl.value());
  if (platform === "mobile") {
    return {
      checkoutSuccessUrl: `${baseUrl}/mobile-return/checkout?status=success`,
      checkoutCancelUrl: `${baseUrl}/mobile-return/checkout?status=cancel`,
      portalReturnUrl: `${baseUrl}/mobile-return/portal`,
    };
  }

  return {
    checkoutSuccessUrl: `${baseUrl}/app/pricing?checkout=success`,
    checkoutCancelUrl: `${baseUrl}/app/pricing?checkout=cancel`,
    portalReturnUrl: `${baseUrl}/app/pricing`,
  };
};

const isStripeResourceMissingError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: string; statusCode?: number };
  return candidate.code === "resource_missing" || candidate.statusCode === 404;
};

const getCustomerEmail = (
  userData: Record<string, unknown>,
  requestEmail: string | null | undefined
) => {
  const storedEmail = typeof userData.email === "string" ? userData.email.trim() : "";
  const authEmail = typeof requestEmail === "string" ? requestEmail.trim() : "";
  return storedEmail || authEmail || undefined;
};

const maybeUpdateCustomerEmail = async ({
  stripe,
  customerId,
  existingEmail,
  nextEmail,
}: {
  stripe: Stripe;
  customerId: string;
  existingEmail: string | null | undefined;
  nextEmail: string | undefined;
}) => {
  const normalizedNextEmail = nextEmail?.trim();
  const normalizedExistingEmail = existingEmail?.trim();

  if (!normalizedNextEmail || normalizedExistingEmail === normalizedNextEmail) {
    return;
  }

  await stripe.customers.update(customerId, { email: normalizedNextEmail });
};

const ensureCheckoutCustomerId = async ({
  stripe,
  userRef,
  uid,
  mode,
  storedCustomerId,
  email,
}: {
  stripe: Stripe;
  userRef: admin.firestore.DocumentReference;
  uid: string;
  mode: BillingMode;
  storedCustomerId: string | undefined;
  email: string | undefined;
}) => {
  const normalizedCustomerId = storedCustomerId?.trim();
  if (normalizedCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(normalizedCustomerId);
      if (!("deleted" in customer) || !customer.deleted) {
        await maybeUpdateCustomerEmail({
          stripe,
          customerId: normalizedCustomerId,
          existingEmail: customer.email,
          nextEmail: email,
        });
        return normalizedCustomerId;
      }

      logger.warn("Stored Stripe customer was deleted. Creating a replacement customer.", {
        uid,
        customerId: normalizedCustomerId,
      });
    } catch (error) {
      if (!isStripeResourceMissingError(error)) {
        throw error;
      }

      logger.warn("Stored Stripe customer was missing. Creating a replacement customer.", {
        uid,
        customerId: normalizedCustomerId,
      });
    }
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { firebaseUID: uid },
  });

  await userRef.set(
    {
      [getModeBillingFieldName(mode, "stripeCustomerId")]: customer.id,
      stripeCustomerId: customer.id,
    },
    { merge: true }
  );
  return customer.id;
};

const findUserSnapshotByCustomerId = async (mode: BillingMode, customerId: string) => {
  const db = admin.firestore();
  let userSnapshot = await db
    .collection("users")
    .where(getModeBillingFieldName(mode, "stripeCustomerId"), "==", customerId)
    .limit(1)
    .get();

  if (userSnapshot.empty && mode === "live") {
    userSnapshot = await db
      .collection("users")
      .where("stripeCustomerId", "==", customerId)
      .limit(1)
      .get();
  }

  if (userSnapshot.empty) {
    return null;
  }

  return userSnapshot.docs[0];
};

const markInvoiceEmailAsSent = async (mode: BillingMode, invoiceId: string) => {
  const recordRef = admin.firestore().collection("stripeInvoiceEmailReceipts").doc(`${mode}_${invoiceId}`);

  try {
    await recordRef.create({
      mode,
      invoiceId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error: any) {
    if (error?.code !== 6 && error?.code !== "already-exists") {
      throw error;
    }

    logger.info("Skipping duplicate billing confirmation email.", {
      mode,
      invoiceId,
    });
    return false;
  }
};

const sendSubscriptionReceiptEmail = async ({
  invoice,
  subscription,
  mode,
}: {
  invoice: Stripe.Invoice;
  subscription: Stripe.Subscription;
  mode: BillingMode;
}) => {
  if (!sendgridApiKey.value()) {
    logger.warn("Skipping billing confirmation email because SENDGRID_API_KEY is missing.", {
      invoiceId: invoice.id,
      mode,
    });
    return;
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) {
    return;
  }

  const userDoc = await findUserSnapshotByCustomerId(mode, customerId);
  if (!userDoc) {
    logger.warn("No user found for billing confirmation email.", {
      invoiceId: invoice.id,
      customerId,
      mode,
    });
    return;
  }

  const userData = userDoc.data() || {};
  const recipient = getCustomerEmail(userData, invoice.customer_email ?? undefined);
  if (!recipient) {
    logger.warn("Skipping billing confirmation email because no customer email was found.", {
      invoiceId: invoice.id,
      customerId,
      mode,
    });
    return;
  }

  const shouldSend = await markInvoiceEmailAsSent(mode, invoice.id);
  if (!shouldSend) {
    return;
  }

  const isInitialPurchase = invoice.billing_reason === "subscription_create";
  const amountLabel = formatCurrency(invoice.amount_paid ?? 0, invoice.currency);
  const renewalDate =
    subscription.current_period_end != null
      ? formatDateLabel(new Date(subscription.current_period_end * 1000))
      : null;
  const manageBillingUrl = `${normalizeBaseUrl(appBaseUrl.value())}/app/pricing`;
  const featureListHtml = PRO_FEATURE_HIGHLIGHTS.map(
    (feature) =>
      `<li style="margin:0 0 10px; color:#0f172a; font-size:14px; line-height:1.6;">${escapeHtml(feature)}</li>`
  ).join("");

  const subject = isInitialPurchase
    ? "Your ReceiptNest AI Pro receipt and activation details"
    : "Your ReceiptNest AI Pro renewal receipt";
  const text = appendAppDownloadText([
    isInitialPurchase
      ? "Congratulations. Your ReceiptNest AI Pro plan is now active."
      : "Your ReceiptNest AI Pro renewal was successful.",
    "",
    `Amount paid: ${amountLabel}`,
    renewalDate ? `Next renewal: ${renewalDate}` : null,
    "",
    "Pro includes:",
    ...PRO_FEATURE_HIGHLIGHTS.map((feature) => `- ${feature}`),
    "",
    `Manage billing: ${manageBillingUrl}`,
    invoice.hosted_invoice_url ? `Invoice: ${invoice.hosted_invoice_url}` : null,
    invoice.invoice_pdf ? `PDF receipt: ${invoice.invoice_pdf}` : null,
  ]
    .filter(Boolean)
    .join("\n"));

  const bodyHtml = `
    <p style="margin:0 0 12px; font-size:15px; line-height:1.6;">${isInitialPurchase ? "Congratulations," : "Hello,"}</p>
    <p style="margin:0 0 16px; font-size:15px; line-height:1.6;">
      ${isInitialPurchase
        ? "Your ReceiptNest AI Pro plan is now active and your payment was processed successfully."
        : "Your ReceiptNest AI Pro subscription renewed successfully."}
    </p>
    <div style="margin:0 0 18px; padding:16px; background:#ecfdf5; border:1px solid #d1fae5; border-radius:14px;">
      <p style="margin:0 0 8px; font-size:13px; font-weight:700; color:#065f46; text-transform:uppercase; letter-spacing:0.08em;">Payment summary</p>
      <p style="margin:0; font-size:18px; font-weight:700; color:#0f172a;">${escapeHtml(amountLabel)}</p>
      ${renewalDate ? `<p style="margin:8px 0 0; font-size:14px; color:#475569;">Next renewal: ${escapeHtml(renewalDate)}</p>` : ""}
    </div>
    <p style="margin:0 0 10px; font-size:15px; line-height:1.6;">Your Pro features include:</p>
    <ul style="margin:0 0 18px 18px; padding:0;">
      ${featureListHtml}
    </ul>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;">
      <tr>
        <td align="center" bgcolor="#10b981" style="border-radius:999px;">
          <a href="${manageBillingUrl}" style="display:inline-block; padding:12px 22px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif;">Manage billing</a>
        </td>
      </tr>
    </table>
    ${
      invoice.hosted_invoice_url || invoice.invoice_pdf
        ? `<div style="margin-top:18px; padding:14px 16px; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0; font-size:13px; color:#475569;">
            ${invoice.hosted_invoice_url ? `<p style="margin:0 0 8px;">Invoice: <a href="${invoice.hosted_invoice_url}" style="color:#065f46; text-decoration:none;">View hosted invoice</a></p>` : ""}
            ${invoice.invoice_pdf ? `<p style="margin:0;">PDF receipt: <a href="${invoice.invoice_pdf}" style="color:#065f46; text-decoration:none;">Download receipt PDF</a></p>` : ""}
          </div>`
        : ""
    }
  `;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f8fafc;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f8fafc;">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px; background:#ffffff; border-radius:20px; border:1px solid #e2e8f0; overflow:hidden; box-shadow:0 20px 40px rgba(15, 23, 42, 0.08);">
            <tr>
              <td style="padding:28px 32px; background:linear-gradient(135deg,#0f172a 0%, #0b2f24 45%, #065f46 100%); color:#ffffff;">
                <p style="margin:0; font-size:12px; letter-spacing:0.28em; text-transform:uppercase; font-weight:600; color:#a7f3d0;">ReceiptNest AI</p>
                <h1 style="margin:10px 0 0; font-size:24px; font-weight:600; font-family:Arial, sans-serif;">${escapeHtml(subject)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px; font-family:Arial, sans-serif; color:#0f172a;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 30px; font-family:Arial, sans-serif; font-size:12px; color:#64748b;">
                ${renderAppDownloadHtmlCard()}
                <p style="margin:0 0 6px;">ReceiptNest AI • ${escapeHtml(fromEmail)}</p>
                <p style="margin:0;">You are receiving this email because a subscription payment succeeded on your ReceiptNest AI account.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  await sendSendgridMail(sendgridApiKey.value(), {
    to: recipient,
    from: { email: fromEmail, name: "ReceiptNest AI" },
    replyTo: { email: fromEmail, name: "ReceiptNest AI" },
    subject,
    text,
    html,
    attachments: getEmailAppIconAttachments(),
  });
};

const requirePortalCustomerId = async ({
  stripe,
  uid,
  storedCustomerId,
}: {
  stripe: Stripe;
  uid: string;
  storedCustomerId: string | undefined;
}) => {
  const normalizedCustomerId = storedCustomerId?.trim();
  if (!normalizedCustomerId) {
    throw new HttpsError("failed-precondition", "No Stripe customer found for this account.");
  }

  try {
    const customer = await stripe.customers.retrieve(normalizedCustomerId);
    if ("deleted" in customer && customer.deleted) {
      throw new HttpsError("failed-precondition", "No active Stripe billing profile was found for this account.");
    }

    return normalizedCustomerId;
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    if (isStripeResourceMissingError(error)) {
      logger.warn("Billing portal requested for a missing Stripe customer.", {
        uid,
        customerId: normalizedCustomerId,
      });
      throw new HttpsError("failed-precondition", "No active Stripe billing profile was found for this account.");
    }

    throw error;
  }
};

const findBlockingSubscription = async (stripe: Stripe, customerId: string) => {
  let startingAfter: string | undefined;

  while (true) {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const blockingSubscription = page.data.find(
      (subscription) =>
        portalRedirectStatusSet.has(subscription.status) || pendingCheckoutStatusSet.has(subscription.status)
    );
    if (blockingSubscription) {
      return blockingSubscription;
    }

    if (!page.has_more || page.data.length === 0) {
      return null;
    }

    startingAfter = page.data[page.data.length - 1].id;
  }
};

export const createCheckoutSession = onCall(
  {
    region: "us-central1",
    secrets: [
      stripeSecretKey,
      stripeSecretKeyTest,
      stripePriceIdMonthly,
      stripePriceIdAnnual,
      stripePriceIdMonthlyTest,
      stripePriceIdAnnualTest,
      appBaseUrl,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated to start checkout.");
    }

    const interval = String(request.data?.interval || "monthly");
    if (!VALID_INTERVALS.has(interval)) {
      throw new HttpsError("invalid-argument", "Interval must be monthly or annual.");
    }

    const platform = String(request.data?.platform || "web") as BillingPlatform;
    if (!VALID_PLATFORMS.has(platform)) {
      throw new HttpsError("invalid-argument", "Platform must be web or mobile.");
    }

    const uid = request.auth.uid;
    const userRef = admin.firestore().doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    const billingMode = getEffectiveBillingModeForUserData(userData);

    if (!hasCheckoutConfigForMode(billingMode)) {
      throw new HttpsError("failed-precondition", `Stripe ${billingMode} configuration is incomplete.`);
    }

    const priceId = getPriceIdForInterval(billingMode, interval);
    if (!priceId) {
      throw new HttpsError("failed-precondition", "Stripe price ID missing for selected interval.");
    }

    const billingUrls = buildBillingUrls(platform);
    const stripe = getStripe(billingMode);

    const customerId = await ensureCheckoutCustomerId({
      stripe,
      userRef,
      uid,
      mode: billingMode,
      storedCustomerId: getStoredCustomerIdForMode(userData, billingMode) ?? undefined,
      email: getCustomerEmail(userData, request.auth.token.email),
    });

    const blockingSubscription = await findBlockingSubscription(stripe, customerId);
    if (blockingSubscription) {
      if (portalRedirectStatusSet.has(blockingSubscription.status)) {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: billingUrls.portalReturnUrl,
        });

        return { url: portalSession.url };
      }

      throw new HttpsError(
        "failed-precondition",
        "A previous billing attempt is still pending. Please finish that checkout before starting a new one."
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: uid,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: billingUrls.checkoutSuccessUrl,
      cancel_url: billingUrls.checkoutCancelUrl,
      metadata: {
        firebaseUID: uid,
        planInterval: interval,
        platform,
        billingMode,
      },
      subscription_data: {
        metadata: {
          firebaseUID: uid,
          planInterval: interval,
          platform,
          billingMode,
        },
      },
    });

    return { url: session.url };
  }
);

export const createPortalSession = onCall(
  { region: "us-central1", secrets: [stripeSecretKey, stripeSecretKeyTest, appBaseUrl] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated to access the billing portal.");
    }

    const platform = String(request.data?.platform || "web") as BillingPlatform;
    if (!VALID_PLATFORMS.has(platform)) {
      throw new HttpsError("invalid-argument", "Platform must be web or mobile.");
    }

    const uid = request.auth.uid;
    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    const userData = userSnap.data() || {};
    const billingMode = getEffectiveBillingModeForUserData(userData);

    if (!hasPortalConfigForMode(billingMode)) {
      throw new HttpsError("failed-precondition", `Stripe ${billingMode} configuration is incomplete.`);
    }

    const billingUrls = buildBillingUrls(platform);
    const stripe = getStripe(billingMode);
    const customerId = await requirePortalCustomerId({
      stripe,
      uid,
      storedCustomerId: getStoredCustomerIdForMode(userData, billingMode) ?? undefined,
    });
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: billingUrls.portalReturnUrl,
    });

    return { url: portalSession.url };
  }
);

export const stripeWebhook = onRequest(
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
      appBaseUrl,
      sendgridApiKey,
    ],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    if (!hasWebhookConfigForMode("live") && !hasWebhookConfigForMode("test")) {
      logger.error("Stripe webhook configuration missing.");
      res.status(500).send("Webhook configuration missing.");
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || Array.isArray(signature)) {
      res.status(400).send("Missing Stripe signature.");
      return;
    }

    let event: Stripe.Event | null = null;
    let billingMode: BillingMode | null = null;
    try {
      const candidateModes: BillingMode[] = ["live", "test"];
      let lastError: unknown = null;

      for (const candidateMode of candidateModes) {
        if (!hasWebhookConfigForMode(candidateMode)) {
          continue;
        }

        try {
          const stripe = getStripe(candidateMode);
          event = stripe.webhooks.constructEvent(
            req.rawBody,
            signature,
            getStripeWebhookSecretForMode(candidateMode)
          );
          billingMode = candidateMode;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!event || !billingMode) {
        throw lastError ?? new Error("No matching Stripe webhook secret was configured.");
      }
    } catch (error) {
      logger.error("Stripe webhook signature verification failed.", error);
      res.status(400).send("Webhook signature verification failed.");
      return;
    }

    const stripe = getStripe(billingMode);

    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          await syncSubscription(subscription, billingMode);
          break;
        }
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.subscription) {
            const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
            await syncSubscription(subscription, billingMode);
          }
          break;
        }
        case "invoice.payment_succeeded":
        case "invoice.paid":
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          if (invoice.subscription) {
            const subscription = await stripe.subscriptions.retrieve(String(invoice.subscription));
            await syncSubscription(subscription, billingMode);
            if (event.type === "invoice.paid") {
              await sendSubscriptionReceiptEmail({
                invoice,
                subscription,
                mode: billingMode,
              });
            }
          }
          break;
        }
        default:
          logger.info(`Unhandled Stripe event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      logger.error("Stripe webhook handler failed.", error);
      res.status(500).send("Webhook handler failed.");
    }
  }
);

const syncSubscription = async (subscription: Stripe.Subscription, mode: BillingMode) => {
  const customerId = subscription.customer as string | null;
  if (!customerId) {
    logger.warn("Subscription missing customer id.");
    return;
  }

  const db = admin.firestore();
  let userSnapshot = await db
    .collection("users")
    .where(getModeBillingFieldName(mode, "stripeCustomerId"), "==", customerId)
    .limit(1)
    .get();

  if (userSnapshot.empty && mode === "live") {
    userSnapshot = await db
      .collection("users")
      .where("stripeCustomerId", "==", customerId)
      .limit(1)
      .get();
  }

  if (userSnapshot.empty) {
    logger.warn(`No user found for Stripe customer ${customerId}`, { billingMode: mode });
    return;
  }

  const userRef = userSnapshot.docs[0].ref;
  const userData = userSnapshot.docs[0].data() || {};
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = resolvePlanFromPrice(mode, priceId);
  const interval = resolveIntervalFromPrice(mode, priceId);
  const isActive = activeStatusSet.has(subscription.status);
  const snapshot: BillingSnapshot = {
    ...emptyBillingSnapshot(),
    subscriptionPlan: isActive && plan === "pro" ? "pro" : "free",
    subscriptionStatus: subscription.status,
    subscriptionInterval: interval,
    subscriptionPriceId: priceId || null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    subscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end || false,
    subscriptionCurrentPeriodEnd: subscription.current_period_end
      ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000)
      : null,
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const nextFields: Record<string, unknown> = {
    ...buildModeBillingFields(mode, snapshot),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (getEffectiveBillingModeForUserData(userData) === mode) {
    Object.assign(nextFields, buildGenericBillingOverlay(snapshot));
  }

  await userRef.set(
    nextFields,
    { merge: true }
  );
};
