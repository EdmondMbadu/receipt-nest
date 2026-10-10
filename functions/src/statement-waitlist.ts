/**
 * Statement Decoder early-access waitlist (a "fake door" to measure demand before building the feature).
 * joinStatementWaitlist: POST /api/statement-waitlist from the Guess the Charge page. Saves first name + email,
 *   sends one confirmation email, and counts the signup in the game stats.
 * getStatementWaitlist: admin-only callable for the admin dashboard.
 */
import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { assertAdmin } from "./authz";
import {
  appendUnsubscribeHtml,
  appendUnsubscribeText,
  buildUnsubscribeUrls,
  isEmailSuppressed,
  unsubscribeAppBaseUrl,
  unsubscribeTokenSecret,
} from "./email-suppression";
import { addEmailDarkMode } from "./email-theme";
import { isAllowedSource } from "./game-stats-core";
import { incrementGameCounters } from "./game-stats";
import { sendSendgridMail } from "./sendgrid";
import { WAITLIST_MAX_BODY_BYTES, buildWaitlistEmail, parseWaitlistRequest, statsPageForSource } from "./statement-waitlist-core";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const COLLECTION = "statementWaitlist";
const FROM = { email: "info@receipt-nest.com", name: "ReceiptNest" };

// Light per-instance throttle: at most 6 attempts per IP per 10 minutes.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;
const attempts = new Map<string, number[]>();
const rateLimited = (ip: string, now = Date.now()): boolean => {
  const recent = (attempts.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 5000) attempts.clear();
  return recent.length > RATE_MAX;
};

const docIdFor = (email: string) => createHash("sha256").update(email).digest("hex");

const sendConfirmation = async (name: string, email: string): Promise<void> => {
  const message = buildWaitlistEmail(name);
  const urls = buildUnsubscribeUrls(email, unsubscribeAppBaseUrl.value(), unsubscribeTokenSecret.value());
  await sendSendgridMail(sendgridApiKey.value(), {
    to: email,
    from: FROM,
    replyTo: FROM,
    subject: message.subject,
    text: appendUnsubscribeText(message.text, urls.pageUrl),
    html: addEmailDarkMode(appendUnsubscribeHtml(message.html, urls.pageUrl)),
    headers: {
      "List-Unsubscribe": `<${urls.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    categories: ["statement_decoder_waitlist"],
  });
};

export const joinStatementWaitlist = onRequest(
  {
    region: "us-central1",
    maxInstances: 3,
    memory: "256MiB",
    secrets: [sendgridApiKey, unsubscribeAppBaseUrl, unsubscribeTokenSecret],
  },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).json({ ok: false, message: "Method not allowed." });
      return;
    }
    if (!isAllowedSource(request.get("origin"), request.get("referer"))) {
      response.status(403).json({ ok: false, message: "Not allowed." });
      return;
    }
    const ip = String(request.get("x-forwarded-for") || request.ip || "unknown").split(",")[0].trim();
    if (rateLimited(ip)) {
      response.status(429).json({ ok: false, message: "Too many tries. Please wait a few minutes." });
      return;
    }
    const raw =
      request.rawBody && request.rawBody.length <= WAITLIST_MAX_BODY_BYTES
        ? request.rawBody.toString("utf8")
        : typeof request.body === "string"
          ? request.body
          : request.body && typeof request.body === "object"
            ? JSON.stringify(request.body).slice(0, WAITLIST_MAX_BODY_BYTES + 1)
            : "";
    const parsed = parseWaitlistRequest(raw);
    if (!parsed.ok) {
      response.status(400).json({ ok: false, field: parsed.field, message: parsed.message });
      return;
    }
    const { name, email, source, bot } = parsed.value;
    if (bot) {
      response.status(200).json({ ok: true });
      return;
    }

    const db = admin.firestore();
    const ref = db.collection(COLLECTION).doc(docIdFor(email));
    let isNew = false;
    let needsEmail = false;
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = admin.firestore.FieldValue.serverTimestamp();
        if (!snap.exists) {
          isNew = true;
          needsEmail = true;
          tx.set(ref, {
            name,
            email,
            source,
            sources: [source],
            consent: "notify_when_statement_decoder_launches",
            createdAt: now,
            updatedAt: now,
            emailStatus: "pending",
          });
        } else {
          needsEmail = snap.get("emailStatus") !== "sent";
          tx.update(ref, {
            name,
            sources: admin.firestore.FieldValue.arrayUnion(source),
            updatedAt: now,
            rejoinCount: admin.firestore.FieldValue.increment(1),
          });
        }
      });
    } catch (error) {
      logger.error("Statement waitlist write failed", { error });
      response.status(500).json({ ok: false, message: "We couldn't save that. Please try again." });
      return;
    }

    if (isNew) {
      try {
        await incrementGameCounters(statsPageForSource(source), ["waitlist_join", `waitlist_${source}`]);
      } catch (error) {
        logger.warn("Statement waitlist counter failed", { error });
      }
    }

    let emailStatus: "sent" | "suppressed" | "failed" | "skipped" = "skipped";
    if (needsEmail) {
      try {
        if (await isEmailSuppressed(db, email)) {
          emailStatus = "suppressed";
        } else {
          await sendConfirmation(name, email);
          emailStatus = "sent";
        }
      } catch (error) {
        emailStatus = "failed";
        logger.error("Statement waitlist confirmation email failed", { error, source });
      }
      try {
        await ref.update({
          emailStatus,
          ...(emailStatus === "sent" ? { emailSentAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
        });
      } catch (error) {
        logger.warn("Statement waitlist email status update failed", { error });
      }
    }

    response.status(200).json({ ok: true, already: !isNew });
  }
);

export const getStatementWaitlist = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }
  await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

  const db = admin.firestore();
  const [countSnap, listSnap] = await Promise.all([
    db.collection(COLLECTION).count().get(),
    db.collection(COLLECTION).orderBy("createdAt", "desc").limit(500).get(),
  ]);
  const entries = listSnap.docs.map((doc) => {
    const d = doc.data();
    const created = d.createdAt as admin.firestore.Timestamp | undefined;
    return {
      name: typeof d.name === "string" ? d.name : "",
      email: typeof d.email === "string" ? d.email : "",
      source: typeof d.source === "string" ? d.source : "",
      emailStatus: typeof d.emailStatus === "string" ? d.emailStatus : "",
      createdAt: created ? created.toMillis() : null,
    };
  });
  return { total: countSnap.data().count, entries };
});
