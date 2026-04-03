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

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

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
