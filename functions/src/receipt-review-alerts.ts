import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { missingReceiptFields } from "./receipt-issue-policy";
import { sendSendgridMail } from "./sendgrid";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");

export const notifyAdminReceiptNeedsReview = onDocumentWritten({
  document: "users/{userId}/receipts/{receiptId}",
  region: "us-central1", timeoutSeconds: 60, retry: true, secrets: [sendgridApiKey],
}, async event => {
  const after = event.data?.after;
  if (after?.get("status") !== "needs_review" || event.data?.before.get("status") === "needs_review") return;

  // Firestore can deliver the same transition more than once, including concurrently.
  const alertId = createHash("sha256").update(event.id).digest("hex");
  const db = admin.firestore();
  const ref = db.collection("receiptReviewAlerts").doc(alertId);
  const claimed = await db.runTransaction(async tx => {
    const alert = await tx.get(ref);
    if (alert.get("sentAt")) return false;
    if (alert.get("leaseUntil")?.toMillis() > Date.now()) throw new Error("Review alert delivery is already in progress");
    tx.set(ref, { leaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 120_000) });
    return true;
  });
  if (!claimed) return;

  const { userId, receiptId } = event.params;
  const url = `https://receipt-nest.com/app/admin/receipt-issues/${encodeURIComponent(userId)}/${encodeURIComponent(receiptId)}`;
  const missing = missingReceiptFields(after.data());
  const message = missing.length
    ? `Check the missing receipt fields (${missing.join(", ")}).`
    : "Check the processing details and verify the extracted values.";
  try {
    await sendSendgridMail(sendgridApiKey.value(), {
      to: "gervais@receipt-nest.com",
      from: { email: "info@receipt-nest.com", name: "ReceiptNest" },
      subject: "Receipt needs review",
      text: `A ReceiptNest receipt needs review. ${message}\n\nOpen the admin receipt page\n${url}`,
    });
  } catch (error) {
    await ref.delete();
    throw error;
  }
  await ref.set({ sentAt: admin.firestore.FieldValue.serverTimestamp() });
});
