import { onDocumentWritten, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomBytes, randomUUID } from "node:crypto";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { buildEmailHtml, EMAIL_PIPELINE_VERSION, MAX_EMAIL_SOURCE_BYTES, type EmailDocumentSource } from "./email-content";
import { freezeEmailAssets, renderEmailPdf } from "./email-renderer";

export function ownedEmailPath(userId: string, path: unknown): path is string {
  const prefix = `users/${userId}/receipts/`;
  return typeof path === "string" && path.startsWith(prefix) && !!path.slice(prefix.length) && !path.slice(prefix.length).includes("/");
}

export async function processStoredEmailPdf(
  ref: admin.firestore.DocumentReference, requestId: string,
  dependencies = { bucket: admin.storage().bucket(), freeze: freezeEmailAssets, render: renderEmailPdf }
): Promise<void> {
  const db = admin.firestore();
  const userId = ref.parent.parent!.id;
  const token = admin.firestore.Timestamp.now().toMillis().toString() + Math.random().toString(16).slice(2);
  const source = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const email = snap.get("email");
    if (!snap.exists || email?.pipelineVersion !== EMAIL_PIPELINE_VERSION || email.renderRequestId !== requestId
      || !["queued", "rendering"].includes(email.renderStatus) || !ownedEmailPath(userId, email.documentStoragePath)) return null;
    if (email.renderStatus === "rendering" && email.renderLeaseUntil?.toMillis() > Date.now()) throw new Error("Email rendering lease is active");
    if ((email.renderAttempts || 0) >= 3) {
      tx.update(ref, { "email.renderStatus": "failed", "email.renderError": "PDF could not be generated. The saved email remains available." });
      return null;
    }
    tx.update(ref, { "email.renderStatus": "rendering", "email.renderToken": token,
      "email.renderAttempts": (email.renderAttempts || 0) + 1,
      "email.renderLeaseUntil": admin.firestore.Timestamp.fromMillis(Date.now() + 150000) });
    return { path: email.documentStoragePath as string, subject: email.subject as string };
  });
  if (!source) return;
  const started = Date.now();
  const base = `users/${userId}/receipts/${ref.id}_${requestId}`;
  const pdfPath = `${base}_email.pdf`;
  const htmlPath = `${base}_email.html`;
  try {
    const file = dependencies.bucket.file(source.path);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > MAX_EMAIL_SOURCE_BYTES) throw new Error("Email source is too large");
    const [bytes] = await file.download();
    const document = JSON.parse(bytes.toString("utf8")) as EmailDocumentSource;
    const frozen = await dependencies.freeze(buildEmailHtml(document));
    const pdf = await dependencies.render(frozen.html);
    await Promise.all([
      dependencies.bucket.file(pdfPath).save(pdf, { metadata: { contentType: "application/pdf", cacheControl: "private, max-age=3600", metadata: { firebaseStorageDownloadTokens: randomUUID() } } }),
      dependencies.bucket.file(htmlPath).save(Buffer.from(frozen.html), { metadata: { contentType: "text/html; charset=utf-8", cacheControl: "private, max-age=3600", metadata: { firebaseStorageDownloadTokens: randomUUID() } } }),
    ]);
    const saved = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("email.renderToken") !== token || snap.get("email.renderRequestId") !== requestId) return false;
      // Only update document presentation. Amount/category/date and in-flight user edits are untouched.
      tx.update(ref, {
        ...(snap.get("email.ingestMode") === "attachment" ? {} : {
          file: { storagePath: pdfPath, originalName: `${(source.subject || "Forwarded email").replace(/[^a-zA-Z0-9 ._-]/g, "_").slice(0, 100)}.pdf`,
            mimeType: "application/pdf", sizeBytes: pdf.length, uploadedAt: admin.firestore.FieldValue.serverTimestamp() },
        }),
        "email.pdfStoragePath": pdfPath, "email.htmlStoragePath": htmlPath, "email.pdfGenerated": true,
        "email.renderStatus": "ready", "email.renderError": admin.firestore.FieldValue.delete(),
        "email.missingAssets": frozen.missingAssets, "email.renderDurationMs": Date.now() - started,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!saved) await Promise.all([pdfPath, htmlPath].map(path => dependencies.bucket.file(path).delete({ ignoreNotFound: true })));
    logger.info("Full email PDF rendered", { receiptId: ref.id, durationMs: Date.now() - started, missingAssets: frozen.missingAssets });
  } catch (error) {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get("email.renderToken") === token && snap.get("email.renderRequestId") === requestId) tx.update(ref, {
        "email.renderStatus": (snap.get("email.renderAttempts") || 0) >= 3 ? "failed" : "queued",
        "email.renderError": "PDF could not be generated. The saved email remains available.",
      });
    });
    logger.error("Full email PDF rendering failed", { receiptId: ref.id, errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export const renderForwardedEmailPdf = onDocumentWritten({
  document: "users/{userId}/receipts/{receiptId}", region: "us-central1", memory: "1GiB", cpu: 1,
  timeoutSeconds: 120, concurrency: 1, maxInstances: 3, retry: true,
}, async event => {
  const after = event.data?.after;
  // Rendering-state updates must not compete with the worker that owns the lease.
  if (!after?.exists || after.get("email.renderStatus") !== "queued") return;
  const requestId = after.get("email.renderRequestId");
  if (typeof requestId !== "string" || !/^[a-f0-9]{16}$/.test(requestId)) return;
  await processStoredEmailPdf(after.ref, requestId);
});

export const cleanupForwardedEmailFiles = onDocumentDeleted({
  document: "users/{userId}/receipts/{receiptId}", region: "us-central1", retry: true,
}, async event => {
  const data = event.data?.data();
  if (data?.email?.pipelineVersion !== EMAIL_PIPELINE_VERSION) return;
  const { userId } = event.params;
  const email = data.email;
  if (!ownedEmailPath(userId, email.sourceStoragePath)) return;
  const remaining = await admin.firestore().collection(`users/${userId}/receipts`).where("email.sourceStoragePath", "==", email.sourceStoragePath).limit(1).get();
  const paths = [data.file?.storagePath, email.pdfStoragePath, email.previewStoragePath];
  if (!remaining.empty) {
    // Each attachment owns its rendered PDF/HTML, but all share one archived message.
    if (email.htmlStoragePath !== email.initialHtmlStoragePath) paths.push(email.htmlStoragePath);
  } else paths.push(email.htmlStoragePath, email.initialHtmlStoragePath, email.sourceStoragePath, email.rawStoragePath, email.documentStoragePath, email.textStoragePath);
  await Promise.all([...new Set(paths)].filter(path => ownedEmailPath(userId, path)).map(path => admin.storage().bucket().file(path).delete({ ignoreNotFound: true })));
});

export const retryForwardedEmailPdf = onCall({ region: "us-central1" }, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to retry your email PDF.");
  const receiptId = request.data?.receiptId;
  if (typeof receiptId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(receiptId)) throw new HttpsError("invalid-argument", "Invalid receipt.");
  const ref = admin.firestore().doc(`users/${request.auth.uid}/receipts/${receiptId}`);
  await admin.firestore().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Receipt not found.");
    if (snap.get("email.renderStatus") !== "failed" || !ownedEmailPath(request.auth!.uid, snap.get("email.documentStoragePath"))) {
      throw new HttpsError("failed-precondition", "This email PDF does not need a retry.");
    }
    tx.update(ref, { "email.renderStatus": "queued", "email.renderRequestId": randomBytes(8).toString("hex"),
      "email.renderAttempts": 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { queued: true };
});
