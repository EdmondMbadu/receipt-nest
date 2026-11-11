import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { diagnoseReceipt, emailRetrySource, mergeRetryValues, missingReceiptFields, RECEIPT_MODEL_ID, RECEIPT_PIPELINE_VERSION, RECEIPT_STUCK_MS, receiptValues } from "./receipt-issue-policy";
import { EMAIL_EXTRACTION_PIPELINE_VERSION } from "./email-intelligence";

export function issueRefFor(userId: string, receiptId: string) {
  return admin.firestore().collection("receiptIssues").doc(createHash("sha256").update(`${userId}/${receiptId}`).digest("hex"));
}

export async function claimReceiptAttempt(ref: admin.firestore.DocumentReference, attemptId: string, retry: boolean) {
  return admin.firestore().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data()!;
    const emailSource = retry && emailRetrySource(data, ref.parent.parent!.id);
    if (data.skipProcessing === true && !emailSource) return null;
    // A creation event must never restart an already attempted receipt.
    if (!retry && data.processingAttempt) return null;
    if (retry && (data.processingAttempt?.id !== attemptId || data.processingAttempt?.state !== "queued")) return null;
    tx.update(ref, {
      status: "processing", updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      processingAttempt: {
        ...data.processingAttempt, id: attemptId, state: "running", stage: "file",
        startedAt: admin.firestore.Timestamp.now(), leaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + RECEIPT_STUCK_MS),
        model: RECEIPT_MODEL_ID, pipelineVersion: emailSource ? EMAIL_EXTRACTION_PIPELINE_VERSION : RECEIPT_PIPELINE_VERSION,
      },
    });
    return data;
  });
}

export async function finishReceiptAttempt(
  ref: admin.firestore.DocumentReference, attemptId: string, initial: any, retry: boolean,
  proposed: Record<string, any>, failure?: { reason: string; cause: string; code: string; stage: string }
) {
  const userId = ref.parent.parent!.id;
  const issueRef = issueRefFor(userId, ref.id);
  const eventRef = ref.collection("processingHistory").doc(attemptId);
  await admin.firestore().runTransaction(async tx => {
    const [snap, issueSnap] = await Promise.all([tx.get(ref), tx.get(issueRef)]);
    if (!snap.exists || snap.get("processingAttempt.id") !== attemptId || snap.get("processingAttempt.state") !== "running") return;
    const current = snap.data()!;
    const values = mergeRetryValues(initial, current, proposed);
    const effective = { ...current, ...values };
    const missing = missingReceiptFields(effective);
    const reviewReasons = proposed.extraction?.reviewReasons as string[] | undefined;
    const reviewReason = reviewReasons?.join(". ") || (missing.length ? `Missing ${missing.join(", ")}` : "");
    const state = failure ? "failed" : reviewReason ? "incomplete" : "succeeded";
    const attempt = {
      ...current.processingAttempt, state, stage: failure?.stage || "complete",
      finishedAt: admin.firestore.Timestamp.now(), reason: failure?.reason || reviewReason || "Receipt validated",
      cause: failure?.cause || (reviewReason ? "unknown" : issueSnap.get("cause") || "unknown"), code: failure?.code || null,
    };
    const status = state === "succeeded" ? "final" : "needs_review";
    const update: Record<string, any> = {
      ...values, status, processingAttempt: attempt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), processedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (proposed.extraction) update.extraction = proposed.extraction;
    const after = { ...effective, ...update };
    const diagnosis = diagnoseReceipt(after);
    tx.update(ref, update);
    if (diagnosis || issueSnap.exists) {
      tx.set(issueRef, {
        userId, receiptId: ref.id, receiptPath: ref.path,
        state: diagnosis ? "open" : "resolved", kind: diagnosis?.kind || issueSnap.get("kind") || "incomplete",
        reason: diagnosis?.reason || issueSnap.get("reason") || "Receipt validated after retry",
        cause: diagnosis?.cause === "unknown" ? issueSnap.get("cause") || "unknown" : diagnosis?.cause || attempt.cause,
        recommendation: diagnosis?.recommendation || "",
        openedAt: issueSnap.get("openedAt") || admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedAt: diagnosis ? null : admin.firestore.FieldValue.serverTimestamp(),
        resolution: diagnosis ? null : "retry", resolvedBy: diagnosis ? null : current.processingAttempt.requestedBy || "system", model: attempt.model, pipelineVersion: attempt.pipelineVersion,
      }, { merge: true });
    }
    tx.set(eventRef, {
      action: retry ? "retry" : "processing", outcome: state, actor: current.processingAttempt.requestedBy || "system",
      at: admin.firestore.FieldValue.serverTimestamp(), reason: attempt.reason, cause: attempt.cause,
      code: attempt.code, stage: attempt.stage, model: attempt.model, pipelineVersion: attempt.pipelineVersion,
      before: receiptValues(initial), after: receiptValues(after),
      previousExtraction: initial.extraction || null,
      extracted: proposed.extraction ? {
        totalAmount: proposed.extraction.totalAmount?.value ?? null,
        currency: proposed.extraction.currency?.value ?? null,
        date: proposed.extraction.date?.value ?? null,
        merchant: proposed.extraction.supplierName?.value ?? null,
      } : null,
    });
  });
}
