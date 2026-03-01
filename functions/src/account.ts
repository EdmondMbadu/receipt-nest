import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import sgMail from "@sendgrid/mail";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const fromEmail = "info@receipt-nest.com";

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

const sendAccountDeletionEmail = async (email: string): Promise<void> => {
  const recipient = email.trim();
  if (!recipient) {
    return;
  }

  const apiKey = sendgridApiKey.value();
  if (!apiKey) {
    logger.warn("Skipping account deletion email because SENDGRID_API_KEY is missing", { recipient });
    return;
  }

  const subject = "Your ReceiptNest AI account has been fully deleted";
  const text =
    "Hi,\n\n" +
    "This confirms that your ReceiptNest AI account and all associated data were fully deleted.\n\n" +
    "Thank you for using us. We hope you come back.\n\n" +
    "If you did not request this, please contact support immediately at info@receipt-nest.com.";
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:24px 12px;background:#f8fafc;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:linear-gradient(135deg,#0f172a 0%, #0b2f24 45%, #065f46 100%);color:#ffffff;">
                <p style="margin:0;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#a7f3d0;">ReceiptNest AI</p>
                <h1 style="margin:10px 0 0;font-size:22px;line-height:1.35;">Account deletion confirmed</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px;">
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Hi,</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">This confirms that your ReceiptNest AI account and all associated data were fully deleted.</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Thank you for using us once upon a time. We hope you come back.</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">If you did not request this, contact us immediately at <a href="mailto:info@receipt-nest.com" style="color:#065f46;text-decoration:none;">info@receipt-nest.com</a>.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  try {
    sgMail.setApiKey(apiKey);
    await sgMail.send({
      to: recipient,
      from: { email: fromEmail, name: "ReceiptNest AI" },
      replyTo: { email: fromEmail, name: "ReceiptNest AI" },
      subject,
      text,
      html
    });
  } catch (error) {
    logger.error("Failed sending account deletion confirmation email", { recipient, error });
  }
};

export const deleteUserAccount = onCall(
  { region: "us-central1", secrets: [stripeSecretKey, sendgridApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    const userId = request.auth.uid;
    const db = admin.firestore();
    const userRef = db.doc(`users/${userId}`);
    const userSnapshot = await userRef.get();
    const userData = userSnapshot.exists ? (userSnapshot.data() as Record<string, unknown>) : undefined;
    const emailFromToken = typeof request.auth.token.email === "string" ? request.auth.token.email.trim() : "";
    const emailFromProfile = typeof userData?.email === "string" ? userData.email.trim() : "";
    const deletionConfirmationEmail = emailFromToken || emailFromProfile;

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

    await sendAccountDeletionEmail(deletionConfirmationEmail);

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
