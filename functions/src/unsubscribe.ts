import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { assertAdmin } from "./authz";
import {
  isEmailSuppressed,
  normalizeEmailAddress,
  normalizeUnsubscribeReason,
  restoreEmailAddress,
  unsubscribeEmailAddress,
  unsubscribeTokenSecret,
  verifyUnsubscribeToken,
} from "./email-suppression";

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
