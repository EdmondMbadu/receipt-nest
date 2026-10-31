import * as admin from "firebase-admin";
import { randomUUID } from "node:crypto";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAdmin } from "./authz";
import { diagnoseReceipt, ISSUE_CAUSES, missingReceiptFields, RECEIPT_STUCK_MS, receiptValues } from "./receipt-issue-policy";
import { issueRefFor } from "./receipt-processing-state";
import { loadReceiptPreview, loadReceiptSourceBundlePreview } from "./receipt-preview";

const options = { region: "us-central1", timeoutSeconds: 60, memory: "512MiB" as const };
async function authorize(request: any) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  await assertAdmin(request.auth.uid, request.auth.token);
}
function target(data: any) {
  for (const key of ["userId", "receiptId"]) {
    if (typeof data?.[key] !== "string" || !data[key].length || data[key].length > 1500 || data[key].includes("/") || [".", ".."].includes(data[key])) {
      throw new HttpsError("invalid-argument", "Choose a valid user and receipt.");
    }
  }
  return admin.firestore().doc(`users/${data.userId}/receipts/${data.receiptId}`);
}
function json(value: any): any {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(json);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
}
function row(snap: admin.firestore.DocumentSnapshot, issue?: any, email?: string) {
  const data = snap.data()!;
  const diagnosis = diagnoseReceipt(data);
  const userId = snap.ref.parent.parent!.id;
  if (!diagnosis && !issue) return null;
  return json({
    userId, receiptId: snap.id, email: email || userId,
    fileName: data.file?.originalName || "Receipt", merchant: data.merchant?.canonicalName || "Unknown merchant",
    kind: diagnosis?.kind || issue?.kind || "incomplete",
    state: issue?.state || "open", reason: issue?.reason || diagnosis?.reason,
    recommendation: diagnosis?.recommendation || issue?.recommendation || "Compare the receipt with the original and verify its values.",
    cause: issue?.cause || diagnosis?.cause || "unknown", notes: issue?.notes || "",
    uploadedAt: data.createdAt || null,
    openedAt: issue?.openedAt || data.processingAttempt?.startedAt || data.createdAt || data.updatedAt,
    updatedAt: issue?.updatedAt || data.updatedAt, resolvedAt: issue?.resolvedAt || null,
    attempts: data.processingAttempt ? 1 : 0,
    active: ["uploaded", "processing"].includes(data.status) && !diagnosis,
    model: data.processingAttempt?.model || "Not recorded", pipelineVersion: data.processingAttempt?.pipelineVersion || "Not recorded",
  });
}

export const getAdminReceiptIssues = onCall(options, async request => {
  await authorize(request);
  const db = admin.firestore();
  const [candidates, recorded, users] = await Promise.all([
    db.collectionGroup("receipts").where("status", "in", ["uploaded", "processing", "needs_review", "extracted"]).get(),
    db.collection("receiptIssues").get(),
    db.collection("users").select("email").get(),
  ]);
  const emails = new Map(users.docs.map(doc => [doc.id, doc.get("email")]));
  const receipts = new Map(candidates.docs.filter(doc => /^users\/[^/]+\/receipts\/[^/]+$/.test(doc.ref.path)).map(doc => [doc.ref.path, doc as admin.firestore.DocumentSnapshot]));
  const records = new Map(recorded.docs.map(doc => [doc.get("receiptPath"), doc.data()]));
  const missing = [...records.keys()].filter(path => typeof path === "string" && /^users\/[^/]+\/receipts\/[^/]+$/.test(path) && !receipts.has(path));
  for (let index = 0; index < missing.length; index += 100) {
    const batch = await db.getAll(...missing.slice(index, index + 100).map(path => db.doc(path)));
    batch.filter(doc => doc.exists).forEach(doc => receipts.set(doc.ref.path, doc));
  }
  const rows = [...receipts.values()].map(doc => row(doc, records.get(doc.ref.path), emails.get(doc.ref.parent.parent!.id))).filter(Boolean);
  return { rows, fetchedAt: new Date().toISOString(), stuckAfterMinutes: RECEIPT_STUCK_MS / 60000 };
});

export const getAdminReceiptIssue = onCall(options, async request => {
  await authorize(request);
  const ref = target(request.data);
  const issueRef = issueRefFor(ref.parent.parent!.id, ref.id);
  const [snap, issue, events, user] = await Promise.all([
    ref.get(), issueRef.get(), ref.collection("processingHistory").orderBy("at", "desc").limit(100).get(), ref.parent.parent!.get(),
  ]);
  if (!snap.exists) throw new HttpsError("not-found", "This receipt no longer exists.");
  const data = snap.data()!;
  return {
    row: row(snap, issue.data(), user.get("email")), revision: snap.updateTime!.toMillis(),
    receipt: json({ id: ref.id, userId: ref.parent.parent!.id, status: data.status, file: data.file, email: data.email,
      ...receiptValues(data), extraction: data.extraction, processingAttempt: data.processingAttempt,
      createdAt: data.createdAt, updatedAt: data.updatedAt, processedAt: data.processedAt, sourceBundle: data.sourceBundle }),
    issue: json(issue.data()), events: events.docs.map(doc => json({ id: doc.id, ...doc.data() })),
    historyLimited: events.size === 100,
  };
});

export const getAdminReceiptPreview = onCall({ ...options, memory: "1GiB" }, async request => {
  await authorize(request);
  const ref = target(request.data);
  const receipt = await ref.get();
  if (!receipt.exists) throw new HttpsError("not-found", "This receipt no longer exists.");
  // File paths come from the selected receipt, never from a client-supplied storage path.
  if (request.data.sourceBundle === true) return loadReceiptSourceBundlePreview(receipt.data(), ref.parent.parent!.id, admin.storage().bucket());
  return loadReceiptPreview(receipt.data(), ref.parent.parent!.id, admin.storage().bucket());
});

export const actOnAdminReceiptIssue = onCall(options, async request => {
  await authorize(request);
  const data = request.data;
  const ref = target(data);
  const issueRef = issueRefFor(data.userId, data.receiptId);
  const actions = ["retry", "correct", "resolve", "awaiting_user", "reopen", "flag"];
  if (!actions.includes(data.action)) throw new HttpsError("invalid-argument", "Choose a supported action.");
  if (!ISSUE_CAUSES.includes(data.cause)) throw new HttpsError("invalid-argument", "Choose a cause, or select Unknown.");
  const notes = typeof data.notes === "string" ? data.notes.trim() : "";
  if (notes.length > 2000) throw new HttpsError("invalid-argument", "Keep the note under 2,000 characters.");
  if (["awaiting_user", "flag"].includes(data.action) && !notes) throw new HttpsError("invalid-argument", "Add a note explaining what is needed.");
  const eventId = randomUUID();
  await admin.firestore().runTransaction(async tx => {
    const [snap, issue] = await Promise.all([tx.get(ref), tx.get(issueRef)]);
    if (!snap.exists) throw new HttpsError("not-found", "This receipt no longer exists.");
    if (snap.updateTime!.toMillis() !== data.revision) throw new HttpsError("aborted", "This receipt changed. Refresh it before taking action.");
    const current = snap.data()!;
    const diagnosis = diagnoseReceipt(current);
    const active = ["uploaded", "processing"].includes(current.status) && diagnosis?.kind !== "stuck";
    if (active) throw new HttpsError("failed-precondition", "This receipt is still processing. Wait for it to finish.");
    if (data.action === "retry" && current.skipProcessing === true) throw new HttpsError("failed-precondition", "Automatic processing is disabled for this receipt.");
    const update: Record<string, any> = {};
    if (data.action === "correct") {
      const values = data.values;
      if (!values || typeof values.merchant !== "string" || !values.merchant.trim() || values.merchant.length > 200 ||
        typeof values.totalAmount !== "number" || !Number.isFinite(values.totalAmount) || values.totalAmount <= 0 || values.totalAmount > 1e10 ||
        typeof values.currency !== "string" || !/^[A-Z]{3}$/.test(values.currency) ||
        typeof values.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) || (!Number.isFinite(Date.parse(values.date)) || new Date(values.date).toISOString().slice(0, 10) !== values.date) ||
        typeof values.category !== "string" || !values.category.trim() || values.category.length > 100) {
        throw new HttpsError("invalid-argument", "Enter a valid merchant, positive total, currency, date, and category.");
      }
      Object.assign(update, {
        totalAmount: values.totalAmount, currency: values.currency, date: values.date, status: "final",
        merchant: { ...current.merchant, canonicalName: values.merchant.trim(), rawName: current.merchant?.rawName || values.merchant.trim(), matchedBy: "manual", matchConfidence: 1 },
        category: { ...current.category, id: values.categoryId || current.category?.id || "other", name: values.category.trim(), assignedBy: "user", confidence: 1 },
      });
    }
    if (data.action === "resolve" && missingReceiptFields(current).length) throw new HttpsError("failed-precondition", "Correct the missing receipt fields before resolving this issue.");
    const resolved = ["correct", "resolve"].includes(data.action);
    if (resolved) {
      update.status = "final";
      // Acknowledging a failed attempt keeps its audit event, without leaving a false failure on the receipt.
      if (current.processingAttempt) update.processingAttempt = { ...current.processingAttempt, state: "verified" };
    }
    if (data.action === "retry") {
      update.status = "processing";
      update.processingAttempt = { id: eventId, state: "queued", stage: "queued", requestedBy: request.auth!.uid,
        startedAt: admin.firestore.Timestamp.now(), leaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + RECEIPT_STUCK_MS) };
      tx.create(admin.firestore().collection("receiptProcessingJobs").doc(eventId), { userId: data.userId, receiptId: data.receiptId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    // Touch the receipt on every action so concurrent admins cannot overwrite issue state with an old revision.
    tx.update(ref, { ...update, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(issueRef, {
      userId: data.userId, receiptId: data.receiptId, receiptPath: ref.path,
      state: resolved ? "resolved" : data.action === "awaiting_user" ? "awaiting_user" : "open",
      kind: diagnosis?.kind || issue.get("kind") || "incomplete",
      reason: data.action === "flag" ? notes : issue.get("reason") || diagnosis?.reason || "Admin requested review",
      cause: data.cause, notes, recommendation: diagnosis?.recommendation || issue.get("recommendation") || "Verify the receipt against the original.",
      openedAt: issue.get("openedAt") || current.createdAt || admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), resolvedAt: resolved ? admin.firestore.FieldValue.serverTimestamp() : null,
      resolution: resolved ? data.action : null, resolvedBy: resolved ? request.auth!.uid : null,
    }, { merge: true });
    tx.create(ref.collection("processingHistory").doc(data.action === "retry" ? `${eventId}-requested` : eventId), {
      at: admin.firestore.FieldValue.serverTimestamp(), action: data.action === "retry" ? "retry_requested" : data.action,
      actor: request.auth!.uid, cause: data.cause, notes, outcome: resolved ? "resolved" : "open",
      before: receiptValues(current), after: receiptValues({ ...current, ...update }),
    });
  });
  return { success: true, attemptId: data.action === "retry" ? eventId : null };
});

// Firestore does not remove subcollections when a receipt document is deleted.
export const cleanupReceiptIssue = onDocumentDeleted(
  { document: "users/{userId}/receipts/{receiptId}", region: "us-central1", retry: true },
  async event => {
    const ref = admin.firestore().doc(`users/${event.params.userId}/receipts/${event.params.receiptId}`);
    await admin.firestore().recursiveDelete(ref.collection("processingHistory"));
    await issueRefFor(event.params.userId, event.params.receiptId).delete();
  }
);
