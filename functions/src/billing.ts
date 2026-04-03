import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";

const STRIPE_API_VERSION = "2024-06-20";
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripePriceIdMonthly = defineSecret("STRIPE_PRICE_ID_MONTHLY");
const stripePriceIdAnnual = defineSecret("STRIPE_PRICE_ID_ANNUAL");
const appBaseUrl = defineSecret("APP_BASE_URL");

const getStripe = () => {
  const secret = stripeSecretKey.value();
  if (!secret) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }
  return new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
  });
};

const VALID_INTERVALS = new Set(["monthly", "annual"]);
const portalRedirectStatusSet = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);
const pendingCheckoutStatusSet = new Set(["incomplete"]);

const getPriceIdForInterval = (interval: string) => {
  if (interval === "annual") {
    return stripePriceIdAnnual.value();
  }
  return stripePriceIdMonthly.value();
};

const resolvePlanFromPrice = (priceId: string | null | undefined) => {
  if (priceId === stripePriceIdMonthly.value() || priceId === stripePriceIdAnnual.value()) {
    return "pro";
  }
  return "free";
};

const resolveIntervalFromPrice = (priceId: string | null | undefined) => {
  if (priceId === stripePriceIdAnnual.value()) {
    return "annual";
  }
  if (priceId === stripePriceIdMonthly.value()) {
    return "monthly";
  }
  return "monthly";
};

const activeStatusSet = new Set(["active", "trialing", "past_due", "unpaid"]);

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
  storedCustomerId,
  email,
}: {
  stripe: Stripe;
  userRef: admin.firestore.DocumentReference;
  uid: string;
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

  await userRef.set({ stripeCustomerId: customer.id }, { merge: true });
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
      stripePriceIdMonthly,
      stripePriceIdAnnual,
      appBaseUrl,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated to start checkout.");
    }

    if (
      !stripeSecretKey.value() ||
      !stripePriceIdMonthly.value() ||
      !stripePriceIdAnnual.value() ||
      !appBaseUrl.value()
    ) {
      throw new HttpsError("failed-precondition", "Stripe configuration is incomplete.");
    }

    const interval = String(request.data?.interval || "monthly");
    if (!VALID_INTERVALS.has(interval)) {
      throw new HttpsError("invalid-argument", "Interval must be monthly or annual.");
    }

    const priceId = getPriceIdForInterval(interval);
    if (!priceId) {
      throw new HttpsError("failed-precondition", "Stripe price ID missing for selected interval.");
    }

    const stripe = getStripe();
    const uid = request.auth.uid;
    const userRef = admin.firestore().doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};

    const customerId = await ensureCheckoutCustomerId({
      stripe,
      userRef,
      uid,
      storedCustomerId: userData.stripeCustomerId as string | undefined,
      email: getCustomerEmail(userData, request.auth.token.email),
    });

    const blockingSubscription = await findBlockingSubscription(stripe, customerId);
    if (blockingSubscription) {
      if (portalRedirectStatusSet.has(blockingSubscription.status)) {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${appBaseUrl.value()}/app/pricing`,
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
      success_url: `${appBaseUrl.value()}/app/pricing?checkout=success`,
      cancel_url: `${appBaseUrl.value()}/app/pricing?checkout=cancel`,
      metadata: {
        firebaseUID: uid,
        planInterval: interval,
      },
      subscription_data: {
        metadata: {
          firebaseUID: uid,
          planInterval: interval,
        },
      },
    });

    return { url: session.url };
  }
);

export const createPortalSession = onCall(
  { region: "us-central1", secrets: [stripeSecretKey, appBaseUrl] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated to access the billing portal.");
    }

    if (!stripeSecretKey.value() || !appBaseUrl.value()) {
      throw new HttpsError("failed-precondition", "Stripe configuration is incomplete.");
    }

    const uid = request.auth.uid;
    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    const userData = userSnap.data() || {};

    const stripe = getStripe();
    const customerId = await requirePortalCustomerId({
      stripe,
      uid,
      storedCustomerId: userData.stripeCustomerId as string | undefined,
    });
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl.value()}/app/pricing`,
    });

    return { url: portalSession.url };
  }
);

export const stripeWebhook = onRequest(
  { region: "us-central1", secrets: [stripeSecretKey, stripeWebhookSecret, stripePriceIdMonthly, stripePriceIdAnnual] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    if (!stripeSecretKey.value() || !stripeWebhookSecret.value()) {
      logger.error("Stripe webhook configuration missing.");
      res.status(500).send("Webhook configuration missing.");
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || Array.isArray(signature)) {
      res.status(400).send("Missing Stripe signature.");
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.rawBody, signature, stripeWebhookSecret.value());
    } catch (error) {
      logger.error("Stripe webhook signature verification failed.", error);
      res.status(400).send("Webhook signature verification failed.");
      return;
    }

    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          await syncSubscription(subscription);
          break;
        }
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.subscription) {
            const stripe = getStripe();
            const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
            await syncSubscription(subscription);
          }
          break;
        }
        case "invoice.payment_succeeded":
        case "invoice.paid":
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          if (invoice.subscription) {
            const stripe = getStripe();
            const subscription = await stripe.subscriptions.retrieve(String(invoice.subscription));
            await syncSubscription(subscription);
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

const syncSubscription = async (subscription: Stripe.Subscription) => {
  const customerId = subscription.customer as string | null;
  if (!customerId) {
    logger.warn("Subscription missing customer id.");
    return;
  }

  const db = admin.firestore();
  const userSnapshot = await db
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  if (userSnapshot.empty) {
    logger.warn(`No user found for Stripe customer ${customerId}`);
    return;
  }

  const userRef = userSnapshot.docs[0].ref;
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = resolvePlanFromPrice(priceId);
  const interval = resolveIntervalFromPrice(priceId);
  const isActive = activeStatusSet.has(subscription.status);

  await userRef.set(
    {
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
    },
    { merge: true }
  );
};
