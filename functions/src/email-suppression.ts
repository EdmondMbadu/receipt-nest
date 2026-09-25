import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";

export const unsubscribeTokenSecret = defineSecret("UNSUBSCRIBE_TOKEN_SECRET");
export const unsubscribeAppBaseUrl = defineSecret("APP_BASE_URL");

export const EMAIL_SUPPRESSIONS_COLLECTION = "emailSuppressions";
export const MAX_UNSUBSCRIBE_REASON_LENGTH = 500;
const EMAIL_LINK_REQUEST_COOLDOWN_MS = 15 * 60 * 1_000;
const IP_LINK_REQUEST_WINDOW_MS = 60 * 60 * 1_000;
const MAX_LINK_REQUESTS_PER_IP_WINDOW = 10;

export type EmailSuppressionSource = "unsubscribe_page" | "one_click" | "admin";

type UnsubscribeTokenPayload = {
  v: 1;
  email: string;
};

const emailPattern = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export const normalizeEmailAddress = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isValidEmailAddress = (value: string): boolean => emailPattern.test(value);

export const emailSuppressionDocumentId = (email: string): string =>
  createHash("sha256").update(normalizeEmailAddress(email)).digest("hex");

const encodeBase64Url = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

const signTokenPayload = (encodedPayload: string, secret: string): string =>
  createHmac("sha256", secret).update(encodedPayload).digest("base64url");

export const buildUnsubscribeToken = (email: string, secret: string): string => {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!isValidEmailAddress(normalizedEmail)) {
    throw new Error("A valid email address is required to create an unsubscribe token.");
  }
  if (!secret.trim()) {
    throw new Error("Unsubscribe token signing is not configured.");
  }

  const payload: UnsubscribeTokenPayload = { v: 1, email: normalizedEmail };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signTokenPayload(encodedPayload, secret)}`;
};

export const verifyUnsubscribeToken = (token: unknown, secret: string): string | null => {
  if (typeof token !== "string" || token.length < 20 || token.length > 2_000 || !secret.trim()) {
    return null;
  }

  const [encodedPayload, suppliedSignature, ...extraParts] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extraParts.length > 0) {
    return null;
  }

  const expectedSignature = signTokenPayload(encodedPayload, secret);
  const suppliedBuffer = Buffer.from(suppliedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<UnsubscribeTokenPayload>;
    const email = normalizeEmailAddress(payload.email);
    return payload.v === 1 && isValidEmailAddress(email) ? email : null;
  } catch {
    return null;
  }
};

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, "");

export const buildUnsubscribeUrls = (
  email: string,
  appBaseUrl: string,
  secret: string
): { pageUrl: string; oneClickUrl: string } => {
  const baseUrl = normalizeBaseUrl(appBaseUrl);
  if (!baseUrl) {
    throw new Error("The application base URL is not configured.");
  }

  const token = buildUnsubscribeToken(email, secret);
  const encodedToken = encodeURIComponent(token);
  return {
    pageUrl: `${baseUrl}/unsubscribe?token=${encodedToken}`,
    oneClickUrl: `${baseUrl}/api/email/unsubscribe?token=${encodedToken}`,
  };
};

const escapeHtmlAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const appendUnsubscribeHtml = (html: string, unsubscribeUrl: string): string => {
  const safeUrl = escapeHtmlAttribute(unsubscribeUrl);
  const footer = `
<!-- receiptnest-unsubscribe-footer -->
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:24px;border-top:1px solid #e2e8f0;">
  <tr>
    <td align="center" style="padding:18px 12px 4px;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#64748b;">
      You can stop receiving non-essential ReceiptNest emails at any time.<br />
      <a href="${safeUrl}" style="color:#047857;text-decoration:underline;">Unsubscribe</a>
    </td>
  </tr>
</table>`;

  const bodyCloseIndex = html.toLowerCase().lastIndexOf("</body>");
  if (bodyCloseIndex < 0) {
    return `${html}${footer}`;
  }

  return `${html.slice(0, bodyCloseIndex)}${footer}\n${html.slice(bodyCloseIndex)}`;
};

export const appendUnsubscribeText = (text: string, unsubscribeUrl: string): string =>
  `${text.trim()}\n\nUnsubscribe from non-essential ReceiptNest emails: ${unsubscribeUrl}`;

export const normalizeUnsubscribeReason = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const reason = value.trim().replace(/\s+/g, " ");
  return reason ? reason.slice(0, MAX_UNSUBSCRIBE_REASON_LENGTH) : null;
};

export const getEmailSuppressionReference = (
  db: admin.firestore.Firestore,
  email: string
): admin.firestore.DocumentReference =>
  db.collection(EMAIL_SUPPRESSIONS_COLLECTION).doc(emailSuppressionDocumentId(email));

export const isEmailSuppressed = async (
  db: admin.firestore.Firestore,
  email: string
): Promise<boolean> => {
  const snapshot = await getEmailSuppressionReference(db, email).get();
  return snapshot.exists && snapshot.data()?.status === "unsubscribed";
};

export const getSuppressedEmailSet = async (
  db: admin.firestore.Firestore,
  emails: string[]
): Promise<Set<string>> => {
  const normalizedEmails = Array.from(new Set(emails.map(normalizeEmailAddress).filter(isValidEmailAddress)));
  const suppressed = new Set<string>();
  const chunkSize = 100;

  for (let index = 0; index < normalizedEmails.length; index += chunkSize) {
    const chunk = normalizedEmails.slice(index, index + chunkSize);
    const snapshots = await db.getAll(...chunk.map((email) => getEmailSuppressionReference(db, email)));
    snapshots.forEach((snapshot, snapshotIndex) => {
      if (snapshot.exists && snapshot.data()?.status === "unsubscribed") {
        suppressed.add(chunk[snapshotIndex]);
      }
    });
  }

  return suppressed;
};

export const unsubscribeEmailAddress = async (
  db: admin.firestore.Firestore,
  email: string,
  reason: string | null,
  source: EmailSuppressionSource
): Promise<{ alreadyUnsubscribed: boolean }> => {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!isValidEmailAddress(normalizedEmail)) {
    throw new Error("A valid email address is required.");
  }

  const reference = getEmailSuppressionReference(db, normalizedEmail);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const alreadyUnsubscribed = snapshot.exists && snapshot.data()?.status === "unsubscribed";
    const now = admin.firestore.FieldValue.serverTimestamp();
    const update: admin.firestore.DocumentData = {
      email: normalizedEmail,
      emailNormalized: normalizedEmail,
      status: "unsubscribed",
      updatedAt: now,
      resubscribedAt: null,
      resubscribedBy: null,
    };

    if (!snapshot.exists) {
      update.createdAt = now;
    }
    if (!alreadyUnsubscribed) {
      update.unsubscribedAt = now;
      update.reason = reason;
      update.source = source;
    } else if (reason && !snapshot.data()?.reason) {
      update.reason = reason;
    }

    transaction.set(reference, update, { merge: true });
    return { alreadyUnsubscribed };
  });
};

export const restoreEmailAddress = async (
  db: admin.firestore.Firestore,
  email: string,
  adminUserId: string
): Promise<void> => {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!isValidEmailAddress(normalizedEmail)) {
    throw new Error("A valid email address is required.");
  }
  const reference = getEmailSuppressionReference(db, normalizedEmail);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.status !== "unsubscribed") {
    throw new Error("That email address is not currently unsubscribed.");
  }

  await reference.set(
    {
      status: "resubscribed",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      resubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
      resubscribedBy: adminUserId,
    },
    { merge: true }
  );
};

const rateLimitDocumentId = (value: string, secret: string): string =>
  createHmac("sha256", secret).update(value).digest("hex");

const timestampMillis = (value: unknown): number =>
  value instanceof admin.firestore.Timestamp ? value.toMillis() : 0;

export const reserveUnsubscribeLinkRequest = async (
  db: admin.firestore.Firestore,
  email: string,
  ipAddress: string,
  secret: string
): Promise<boolean> => {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!isValidEmailAddress(normalizedEmail)) {
    return false;
  }

  const now = admin.firestore.Timestamp.now();
  const nowMillis = now.toMillis();
  const emailReference = db
    .collection("emailUnsubscribeLinkRequests")
    .doc(emailSuppressionDocumentId(normalizedEmail));
  const ipReference = db
    .collection("emailUnsubscribeRateLimits")
    .doc(rateLimitDocumentId(ipAddress || "unknown", secret));

  return db.runTransaction(async (transaction) => {
    const [emailSnapshot, ipSnapshot] = await Promise.all([
      transaction.get(emailReference),
      transaction.get(ipReference),
    ]);

    const lastRequestedAtMillis = timestampMillis(emailSnapshot.data()?.lastRequestedAt);
    if (lastRequestedAtMillis > nowMillis - EMAIL_LINK_REQUEST_COOLDOWN_MS) {
      return false;
    }

    const storedWindowStartedAtMillis = timestampMillis(ipSnapshot.data()?.windowStartedAt);
    const isCurrentWindow = storedWindowStartedAtMillis > nowMillis - IP_LINK_REQUEST_WINDOW_MS;
    const currentRequestCount = isCurrentWindow ? Number(ipSnapshot.data()?.requestCount ?? 0) : 0;
    if (currentRequestCount >= MAX_LINK_REQUESTS_PER_IP_WINDOW) {
      return false;
    }

    transaction.set(
      emailReference,
      {
        emailHash: emailSuppressionDocumentId(normalizedEmail),
        lastRequestedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    transaction.set(
      ipReference,
      {
        windowStartedAt: isCurrentWindow
          ? admin.firestore.Timestamp.fromMillis(storedWindowStartedAtMillis)
          : now,
        requestCount: currentRequestCount + 1,
        updatedAt: now,
      },
      { merge: true }
    );
    return true;
  });
};
