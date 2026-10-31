import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const categories = { groceries: 'Groceries', restaurants: 'Restaurants & Dining', transportation: 'Transportation' };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);

export function validateManifest(manifest) {
  assert.equal(manifest.version, 1, 'Unsupported manifest version');
  assert(validId(manifest.userId) && validId(manifest.sourceReceiptId), 'Invalid target');
  assert(/^[a-f0-9]{64}$/.test(manifest.sourceSha256), 'Missing source checksum');
  assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{9}Z$/.test(manifest.expectedSourceUpdateTime), 'Exact source revision required');
  assert(Number.isInteger(manifest.pageCount) && manifest.pageCount > 1 && manifest.pageCount <= 100, 'Invalid page count');
  assert.equal(manifest.receipts.length, manifest.pageCount, 'One reviewed receipt per page required');
  assert(Number.isInteger(manifest.expectedAccountReceiptCount) && manifest.expectedAccountReceiptCount > 0, 'Account count required');
  const prefix = `users/${manifest.userId}/receipts/`;
  assert(manifest.sourceStoragePath.startsWith(prefix) && !manifest.sourceStoragePath.slice(prefix.length).includes('/'), 'Source must belong to owner');
  for (const [index, receipt] of manifest.receipts.entries()) {
    assert.equal(receipt.page, index + 1, 'Pages must cover the source exactly once in order');
    assert(typeof receipt.merchant === 'string' && receipt.merchant.trim() && receipt.merchant.length <= 200, 'Merchant required');
    assert(/^\d{4}-\d\d-\d\d$/.test(receipt.date) && Number.isFinite(Date.parse(receipt.date)) && new Date(receipt.date).toISOString().slice(0, 10) === receipt.date, 'Invalid transaction date');
    assert(Number.isSafeInteger(receipt.amountCents) && receipt.amountCents > 0 && receipt.amountCents <= 1e12, 'Positive integer cents required');
    assert(/^[A-Z]{3}$/.test(receipt.currency), 'Currency required');
    assert(categories[receipt.categoryId], 'Unsupported reviewed category');
    assert(typeof receipt.notes === 'string' && receipt.notes.length <= 1500, 'Review notes required');
    assert.equal(receipt.reviewed, true, 'Every receipt must be visually reviewed');
    assert(/^[a-f0-9]{64}$/.test(receipt.fileSha256), 'Reviewed split checksum required');
  }
  assert.equal(manifest.expectedTotalCents, manifest.receipts.reduce((sum, r) => sum + r.amountCents, 0), 'Total does not reconcile');
  assert.equal(new Set(manifest.receipts.map(r => r.currency)).size, 1, 'This recovery requires a single reconciled currency');
  return manifest;
}

export function recoveryPlan(manifest) {
  validateManifest(manifest);
  const recoveryId = `bundle-${sha256(`${manifest.userId}/${manifest.sourceReceiptId}/${manifest.sourceSha256}`).slice(0, 32)}`;
  return {
    recoveryId,
    manifestSha256: sha256(JSON.stringify(manifest)),
    entries: manifest.receipts.map(receipt => ({
      ...receipt,
      id: receipt.page === 1 ? manifest.sourceReceiptId : `${manifest.sourceReceiptId}-page-${String(receipt.page).padStart(2, '0')}`,
      storagePath: `users/${manifest.userId}/receipts/${recoveryId}-page-${String(receipt.page).padStart(2, '0')}.pdf`,
    })),
  };
}

export function timestampKey(timestamp) {
  return `${new Date(timestamp.seconds * 1000).toISOString().slice(0, 19)}.${String(timestamp.nanoseconds).padStart(9, '0')}Z`;
}

export function receiptRecord(manifest, plan, entry, source, file, now) {
  const prefix = `Recovered from page ${entry.page} of ${manifest.pageCount} of ${source.file.originalName}.`;
  return {
    id: entry.id, userId: manifest.userId, status: 'final', skipProcessing: true,
    file: { storagePath: entry.storagePath, originalName: `${entry.date} ${entry.merchant.replace(/[^A-Za-z0-9 &()-]/g, '')} - receipt ${String(entry.page).padStart(2, '0')}.pdf`, mimeType: 'application/pdf', sizeBytes: file.bytes.length, uploadedAt: now },
    merchant: { canonicalName: entry.merchant, rawName: entry.merchant, matchedBy: 'manual', matchConfidence: 1 },
    totalAmount: entry.amountCents / 100, currency: entry.currency, date: entry.date,
    category: { id: entry.categoryId, name: categories[entry.categoryId], assignedBy: 'user', confidence: 1 },
    notes: `${prefix}${entry.notes ? ` ${entry.notes}` : ''}`,
    sourceBundle: {
      recoveryId: plan.recoveryId, sourceReceiptId: manifest.sourceReceiptId,
      storagePath: source.file.storagePath, originalName: source.file.originalName,
      page: entry.page, pageCount: manifest.pageCount, sha256: manifest.sourceSha256,
      receiptSha256: file.sha256, recoveredAt: now,
    },
    createdAt: source.createdAt, updatedAt: now, processedAt: now,
    processingAttempt: { id: plan.recoveryId, state: 'verified', stage: 'complete', startedAt: now, finishedAt: now, reason: 'Individual receipt verified against original PDF page', pipelineVersion: 'manual-bundle-recovery-v1' },
  };
}

/** All receipt changes and the immutable source snapshot commit together. */
export async function commitRecovery({ db, manifest, plan, files, actor, now, issueRef }) {
  const userRef = db.doc(`users/${manifest.userId}`);
  const sourceRef = userRef.collection('receipts').doc(manifest.sourceReceiptId);
  const auditRef = db.doc(`receiptBundleRecoveries/${plan.recoveryId}`);
  return db.runTransaction(async tx => {
    const [audit, account, receipts, issue] = await Promise.all([
      tx.get(auditRef), tx.get(userRef), tx.get(userRef.collection('receipts')), tx.get(issueRef),
    ]);
    if (audit.exists) {
      assert.equal(audit.data().manifestSha256, plan.manifestSha256, 'Recovery exists with a different manifest');
      assert.equal(audit.data().state, 'complete', 'Recovery is not complete');
      return { alreadyApplied: true };
    }
    assert(account.exists, 'Owner no longer exists');
    assert.equal(receipts.size, manifest.expectedAccountReceiptCount, 'Account receipts changed; review again');
    const source = receipts.docs.find(doc => doc.id === manifest.sourceReceiptId);
    assert(source?.exists, 'Source receipt no longer exists');
    assert.equal(timestampKey(source.updateTime), manifest.expectedSourceUpdateTime, 'Source changed; review again');
    assert.equal(source.data().file.storagePath, manifest.sourceStoragePath, 'Source file changed');
    assert(!source.data().sourceBundle, 'Source has already been split');
    assert(!['uploaded', 'processing'].includes(source.data().status), 'Source is processing');
    const existingIds = new Set(receipts.docs.map(doc => doc.id));
    for (const entry of plan.entries.slice(1)) assert(!existingIds.has(entry.id), 'A target receipt already exists');
    for (const entry of plan.entries) {
      const file = files.get(entry.page);
      assert(file?.bytes?.length && file.sha256 === sha256(file.bytes), 'Missing or changed split file');
    }
    for (const entry of plan.entries) {
      const ref = userRef.collection('receipts').doc(entry.id);
      const record = receiptRecord(manifest, plan, entry, source.data(), files.get(entry.page), now);
      if (entry.page === 1) tx.set(ref, record);
      else tx.create(ref, record);
      tx.create(ref.collection('processingHistory').doc(plan.recoveryId), {
        action: 'bundle_split', outcome: 'resolved', actor, at: now, cause: 'file_problem',
        reason: 'Recovered one receipt from a combined PDF', notes: record.notes,
        before: entry.page === 1 ? { status: source.data().status, file: source.data().file } : null,
        after: { merchant: entry.merchant, totalAmount: record.totalAmount, currency: entry.currency, date: entry.date, category: record.category.name, file: record.file },
        sourceBundle: record.sourceBundle,
      });
    }
    tx.set(issueRef, {
      ...(issue.data() || {}), userId: manifest.userId, receiptId: manifest.sourceReceiptId, receiptPath: sourceRef.path,
      state: 'resolved', kind: issue.data()?.kind || 'incomplete', cause: 'file_problem',
      reason: issue.data()?.reason || `Combined PDF contained ${manifest.pageCount} separate receipts`,
      notes: `Recovered ${manifest.pageCount} individually verified receipts; original PDF preserved.`,
      openedAt: issue.data()?.openedAt || source.data().createdAt, updatedAt: now, resolvedAt: now,
      resolution: 'bundle_split', resolvedBy: actor,
    });
    tx.create(auditRef, {
      state: 'complete', userId: manifest.userId, sourceReceiptId: manifest.sourceReceiptId,
      sourceSnapshot: source.data(), sourceUpdateTime: source.updateTime,
      sourceStoragePath: manifest.sourceStoragePath, sourceSha256: manifest.sourceSha256,
      manifestSha256: plan.manifestSha256, manifest, actor, completedAt: now,
      receiptIds: plan.entries.map(entry => entry.id), originalReceiptCount: receipts.size,
      expectedReceiptCount: receipts.size + plan.entries.length - 1,
    });
    return { alreadyApplied: false };
  });
}
