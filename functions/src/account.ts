import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");

const deleteByUserIdField = async (collectionName: string, userId: string): Promise<number> => {
  const db = admin.firestore();
  let deletedCount = 0;

  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .where("userId", "==", userId)
      .limit(250)
      .get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();

    deletedCount += snapshot.size;
    if (snapshot.size < 250) {
      break;
    }
  }

  return deletedCount;
};

const deleteByFieldValue = async (
  collectionName: string,
  fieldName: "userId" | "uid",
  value: string
): Promise<number> => {
  const db = admin.firestore();
  let deletedCount = 0;

  while (true) {
    const snapshot = await db
      .collection(collectionName)
      .where(fieldName, "==", value)
      .limit(250)
      .get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();
    deletedCount += snapshot.size;

    if (snapshot.size < 250) {
      break;
    }
  }

  return deletedCount;
};

const deleteTopLevelUserLinkedDocuments = async (userId: string): Promise<Record<string, number>> => {
  const db = admin.firestore();
  const rootCollections = await db.listCollections();
  const deletedByCollection: Record<string, number> = {};

  for (const collectionRef of rootCollections) {
    const name = collectionRef.id;
    if (name === "users") {
      continue;
    }

    const [byUserId, byUid] = await Promise.all([
      deleteByFieldValue(name, "userId", userId),
      deleteByFieldValue(name, "uid", userId)
    ]);

    const totalDeleted = byUserId + byUid;
    if (totalDeleted > 0) {
      deletedByCollection[name] = totalDeleted;
    }
  }

  return deletedByCollection;
};

const deleteStoragePrefix = async (userId: string): Promise<void> => {
  try {
    await admin.storage().bucket().deleteFiles({
      prefix: `users/${userId}/`,
      force: true
    });
  } catch (error) {
    logger.error("Failed deleting storage files for user", { userId, error });
    throw new HttpsError("internal", "Failed to remove account files.");
  }
};

const deleteStripeCustomerData = async (
  userId: string,
  userData: Record<string, unknown> | undefined
): Promise<void> => {
  const customerIdRaw = userData?.stripeCustomerId;
  const customerId = typeof customerIdRaw === "string" ? customerIdRaw.trim() : "";
  if (!customerId) {
    return;
  }

  const secret = stripeSecretKey.value();
  if (!secret) {
    logger.warn("Skipping Stripe cleanup because STRIPE_SECRET_KEY is missing", { userId, customerId });
    return;
  }

  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });

  let startingAfter: string | undefined;
  while (true) {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    if (page.data.length === 0) {
      break;
    }

    for (const subscription of page.data) {
      if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
        continue;
      }

      await stripe.subscriptions.cancel(subscription.id);
    }

    if (!page.has_more) {
      break;
    }

    startingAfter = page.data[page.data.length - 1].id;
  }

  await stripe.customers.del(customerId);
};

export const deleteUserAccount = onCall(
  { region: "us-central1", secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    const userId = request.auth.uid;
    const db = admin.firestore();
    const userRef = db.doc(`users/${userId}`);
    const userSnapshot = await userRef.get();
    const userData = userSnapshot.exists ? (userSnapshot.data() as Record<string, unknown>) : undefined;

    try {
      await deleteStripeCustomerData(userId, userData);
    } catch (error) {
      logger.error("Failed cleaning Stripe resources before account deletion", { userId, error });
      throw new HttpsError(
        "internal",
        "Unable to remove billing resources right now. Please try again shortly."
      );
    }

    const deletedTopLevel = await deleteTopLevelUserLinkedDocuments(userId);

    // Keep explicit cleanup for known share/link collections as a safety net.
    const [deletedGraphShares, deletedChatShares, deletedTelegramLinks] = await Promise.all([
      deleteByUserIdField("graphShares", userId),
      deleteByUserIdField("chatShares", userId),
      deleteByUserIdField("telegramLinks", userId)
    ]);

    await deleteStoragePrefix(userId);

    try {
      await db.recursiveDelete(userRef);
    } catch (error) {
      logger.error("Failed deleting user document tree", { userId, error });
      throw new HttpsError("internal", "Failed to remove account records.");
    }

    try {
      await admin.auth().deleteUser(userId);
    } catch (error) {
      logger.error("Failed deleting Firebase Auth user", { userId, error });
      throw new HttpsError("internal", "Account data was removed but auth deletion failed.");
    }

    return {
      ok: true,
      deleted: {
        topLevelByField: deletedTopLevel,
        graphShares: deletedGraphShares,
        chatShares: deletedChatShares,
        telegramLinks: deletedTelegramLinks
      }
    };
  }
);
