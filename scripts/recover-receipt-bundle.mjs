#!/usr/bin/env node
// Deliberately requires an externally reviewed manifest; no model extraction or email delivery.
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { commitRecovery, recoveryPlan, sha256, timestampKey } from './lib/receipt-bundle-recovery.mjs';

const args = process.argv.slice(2);
assert(args.length === 3 && ['--dry-run', '--apply', '--verify'].includes(args[0]) && args[1] === '--manifest', 'Usage: node scripts/recover-receipt-bundle.mjs --dry-run|--apply|--verify --manifest /absolute/path/manifest.json');
const mode = args[0];
const manifestPath = resolve(args[2]);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const plan = recoveryPlan(manifest);
const projectRoot = resolve(import.meta.dirname, '..');
const require = createRequire(join(projectRoot, 'functions/package.json'));
const admin = require('firebase-admin');
const { PDFDocument } = require('pdf-lib');
const { GoogleAuth, OAuth2Client } = require('google-auth-library');
const { Storage } = require('@google-cloud/storage');

// Reuse the active Firebase CLI account without exposing credentials to logs or files.
const firebaseExecutable = await realpath(execFileSync('which', ['firebase'], { encoding: 'utf8' }).trim());
const auth = require(join(dirname(firebaseExecutable), '..', 'auth.js'));
const account = auth.getProjectDefaultAccount(projectRoot);
assert(account?.tokens?.refresh_token, 'An authenticated Firebase CLI account is required');
const actor = account.user.email;
auth.setActiveAccount({}, account);
const oauth = new OAuth2Client();
oauth.refreshHandler = async () => {
    const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase']);
    return { access_token: token.access_token, expiry_date: token.expires_at || Date.now() + 3000000 };
};
assert.equal(manifest.projectId, 'receipt-nest', 'Unexpected project');
assert.equal(manifest.bucket, 'receipt-nest.firebasestorage.app', 'Unexpected bucket');
const db = new admin.firestore.Firestore({ projectId: manifest.projectId, auth: new GoogleAuth({ projectId: manifest.projectId, authClient: oauth }) });
const bucket = new Storage({ projectId: manifest.projectId, authClient: oauth }).bucket(manifest.bucket);
const sourceRef = db.doc(`users/${manifest.userId}/receipts/${manifest.sourceReceiptId}`);
const auditRef = db.doc(`receiptBundleRecoveries/${plan.recoveryId}`);
const issueRef = db.doc(`receiptIssues/${sha256(`${manifest.userId}/${manifest.sourceReceiptId}`)}`);
const files = new Map();

try {
  const localOriginal = await readFile(join(dirname(manifestPath), 'original.pdf'));
  assert.equal(sha256(localOriginal), manifest.sourceSha256, 'Local source PDF changed');
  const originalPdf = await PDFDocument.load(localOriginal);
  assert.equal(originalPdf.getPageCount(), manifest.pageCount, 'Source page count mismatch');
  for (const entry of plan.entries) {
    const bytes = await readFile(join(dirname(manifestPath), 'pdf', `receipt-${String(entry.page).padStart(2, '0')}.pdf`));
    assert.equal(sha256(bytes), entry.fileSha256, `Reviewed page ${entry.page} changed`);
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1, 'Split file must contain exactly one page');
    files.set(entry.page, { bytes, sha256: sha256(bytes) });
  }
  const [source, audit, allReceipts, originalMetadata] = await Promise.all([
    sourceRef.get(), auditRef.get(), sourceRef.parent.get(), bucket.file(manifest.sourceStoragePath).getMetadata(),
  ]);
  assert(source.exists, 'Source receipt missing');
  const remoteOriginal = (await bucket.file(manifest.sourceStoragePath).download())[0];
  assert.equal(sha256(remoteOriginal), manifest.sourceSha256, 'Stored original changed');
  const tokens = originalMetadata[0].metadata?.firebaseStorageDownloadTokens;
  assert(tokens, 'Original must remain accessible to its owner');
  if (audit.exists) {
    assert.equal(audit.data().manifestSha256, plan.manifestSha256, 'Existing recovery has a different manifest');
    assert.equal(audit.data().state, 'complete', 'Existing recovery is incomplete');
  } else {
    assert(mode !== '--verify', 'No completed recovery to verify');
    assert.equal(timestampKey(source.updateTime), manifest.expectedSourceUpdateTime, 'Source changed; review it again');
    assert.equal(source.data().file.storagePath, manifest.sourceStoragePath, 'Source path changed');
    assert.equal(allReceipts.size, manifest.expectedAccountReceiptCount, 'Account changed; review it again');
    for (const entry of plan.entries.slice(1)) assert(!allReceipts.docs.some(doc => doc.id === entry.id), 'Target receipt exists');
  }
  const summary = { recoveryId: plan.recoveryId, mode, actor, receiptCount: plan.entries.length, currency: manifest.receipts[0].currency, total: manifest.expectedTotalCents / 100, originalSha256: manifest.sourceSha256 };
  if (!audit.exists) await writeFile(join(dirname(manifestPath), 'preflight.json'), JSON.stringify({ ...summary, source: source.data(), sourceUpdateTime: timestampKey(source.updateTime), sourceGeneration: originalMetadata[0].generation, manifestSha256: plan.manifestSha256 }, null, 2));
  if (mode === '--dry-run' && !audit.exists) {
    console.log(JSON.stringify({ ...summary, writes: false, preflight: 'passed' }, null, 2));
  } else {
    if (mode === '--apply' && !audit.exists) {
      for (const entry of plan.entries) {
        const file = bucket.file(entry.storagePath);
        const data = files.get(entry.page);
        try {
          await file.save(data.bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
            contentType: 'application/pdf', cacheControl: 'private, max-age=3600',
            metadata: { firebaseStorageDownloadTokens: randomUUID(), receiptRecoveryId: plan.recoveryId, sourcePage: String(entry.page), sha256: data.sha256 },
          } });
        } catch (error) {
          if (Number(error.code) !== 412) throw error;
          assert.equal(sha256((await file.download())[0]), data.sha256, 'Existing split object differs; refusing to overwrite');
          const [metadata] = await file.getMetadata();
          assert.equal(metadata.metadata?.receiptRecoveryId, plan.recoveryId, 'Existing split object belongs to a different operation');
        }
      }
      await commitRecovery({ db, manifest, plan, files, actor, now: admin.firestore.Timestamp.now(), issueRef });
    }
    const records = [];
    for (const entry of plan.entries) {
      const ref = sourceRef.parent.doc(entry.id);
      const [receipt, history, metadata, contents] = await Promise.all([
        ref.get(), ref.collection('processingHistory').doc(plan.recoveryId).get(),
        bucket.file(entry.storagePath).getMetadata(), bucket.file(entry.storagePath).download(),
      ]);
      assert(receipt.exists && history.exists, 'Saved receipt or audit event missing');
      const data = receipt.data();
      assert.equal(data.status, 'final'); assert.equal(data.skipProcessing, true);
      assert.equal(data.merchant.canonicalName, entry.merchant); assert.equal(data.date, entry.date);
      assert.equal(Math.round(data.totalAmount * 100), entry.amountCents); assert.equal(data.currency, entry.currency);
      assert.equal(data.category.id, entry.categoryId);
      assert.equal(data.sourceBundle.page, entry.page); assert.equal(data.sourceBundle.pageCount, manifest.pageCount);
      assert.equal(data.sourceBundle.storagePath, manifest.sourceStoragePath); assert.equal(data.sourceBundle.sha256, manifest.sourceSha256);
      assert.equal(data.sourceBundle.recoveryId, plan.recoveryId); assert.equal(data.file.storagePath, entry.storagePath);
      assert.notEqual(data.file.storagePath, manifest.sourceStoragePath);
      assert.equal(sha256(contents[0]), entry.fileSha256);
      assert.equal((await PDFDocument.load(contents[0])).getPageCount(), 1);
      assert.equal(Number(metadata[0].size), contents[0].length);
      assert.equal(metadata[0].contentType, 'application/pdf');
      assert.equal(metadata[0].metadata?.receiptRecoveryId, plan.recoveryId);
      assert(metadata[0].metadata?.firebaseStorageDownloadTokens, 'Owner download URL missing');
      const downloadToken = metadata[0].metadata.firebaseStorageDownloadTokens.split(',')[0];
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(manifest.bucket)}/o/${encodeURIComponent(entry.storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`;
      const download = await fetch(downloadUrl);
      assert.equal(download.status, 200, 'Client-facing PDF download failed');
      assert.equal(sha256(Buffer.from(await download.arrayBuffer())), entry.fileSha256, 'Client-facing PDF differs');
      records.push({ page: entry.page, id: entry.id, merchant: entry.merchant, date: entry.date, amount: data.totalAmount, currency: data.currency, pages: 1, sha256: entry.fileSha256, adminUrl: `http://localhost:4200/app/admin/receipt-issues/${manifest.userId}/${entry.id}` });
    }
    const [fresh, finalAudit, originalAgain] = await Promise.all([sourceRef.parent.get(), auditRef.get(), bucket.file(manifest.sourceStoragePath).download()]);
    assert.equal(sha256(originalAgain[0]), manifest.sourceSha256, 'Original not preserved');
    assert.equal(fresh.size, manifest.expectedAccountReceiptCount + plan.entries.length - 1, 'Unexpected account receipt count');
    assert.equal(fresh.docs.filter(doc => doc.data().sourceBundle?.recoveryId === plan.recoveryId).length, plan.entries.length);
    assert.equal(finalAudit.data().manifestSha256, plan.manifestSha256);
    assert.equal(finalAudit.data().sourceSnapshot.file.storagePath, manifest.sourceStoragePath);
    assert.equal(records.reduce((sum, r) => sum + Math.round(r.amount * 100), 0), manifest.expectedTotalCents);
    const profile = await db.doc(`users/${manifest.userId}`).get();
    if (mode === '--verify') assert.equal(profile.data().receiptCount, fresh.size, 'Receipt counter has not reconciled');
    const report = { ...summary, verifiedAt: new Date().toISOString(), verified: true, accountReceiptCount: fresh.size, profileReceiptCount: profile.data().receiptCount, originalPreserved: true, individualPagesVerified: true, records };
    await writeFile(join(dirname(manifestPath), 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, records: `${records.length} saved receipts individually verified` }, null, 2));
  }
} catch (error) {
  // Avoid serializing SDK request objects, which can contain authorization headers.
  console.error(`Recovery stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.terminate();
}
