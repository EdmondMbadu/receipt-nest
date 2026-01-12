import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const stripePriceIdMonthly = process.env.STRIPE_PRICE_ID_MONTHLY || "";
const stripePriceIdAnnual = process.env.STRIPE_PRICE_ID_ANNUAL || "";
const appBaseUrl = process.env.APP_BASE_URL || "";

if (!stripeSecretKey) {
  logger.warn("Missing STRIPE_SECRET_KEY env var. Stripe billing functions will fail.");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-06-20",
});

const VALID_INTERVALS = new Set(["monthly", "annual"]);

const getPriceIdForInterval = (interval: string) => {
  if (interval === "annual") {
    return stripePriceIdAnnual;
  }
  return stripePriceIdMonthly;
};

const resolvePlanFromPrice = (priceId: string | null | undefined) => {
  if (priceId === stripePriceIdMonthly || priceId === stripePriceIdAnnual) {
    return "pro";
  }
  return "free";
};

const resolveIntervalFromPrice = (priceId: string | null | undefined) => {
  if (priceId === stripePriceIdAnnual) {
    return "annual";
  }
  if (priceId === stripePriceIdMonthly) {
    return "monthly";
  }
  return "monthly";
};

const activeStatusSet = new Set(["active", "trialing", "past_due", "unpaid"]);

export const createCheckoutSession = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated to start checkout.");
    }

    if (!stripeSecretKey || !stripePriceIdMonthly || !stripePriceIdAnnual || !appBaseUrl) {
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

    const uid = request.auth.uid;
    const userRef = admin.firestore().doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};

    let customerId = userData.stripeCustomerId as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.email || request.auth.token.email || undefined,
        metadata: { firebaseUID: uid },
      });
      customerId = customer.id;
      await userRef.set({ stripeCustomerId: customerId }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${appBaseUrl}/app/pricing?checkout=success`,
      cancel_url: `${appBaseUrl}/app/pricing?checkout=cancel`,
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

export const stripeWebhook = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    if (!stripeSecretKey || !stripeWebhookSecret) {
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
      event = stripe.webhooks.constructEvent(req.rawBody, signature, stripeWebhookSecret);
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
            const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
            await syncSubscription(subscription);
          }
          break;
        }
        case "invoice.payment_succeeded":
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          if (invoice.subscription) {
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
