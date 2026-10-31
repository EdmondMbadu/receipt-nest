import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitRecovery, recoveryPlan, receiptRecord, sha256, timestampKey, validateManifest } from '../lib/receipt-bundle-recovery.mjs';

const bytes = Buffer.from('reviewed test PDF');
const manifest = () => ({ version: 1, userId: 'owner', sourceReceiptId: 'source', sourceSha256: 'a'.repeat(64), sourceStoragePath: 'users/owner/receipts/original.pdf', expectedSourceUpdateTime: '2026-07-17T04:53:07.780159000Z', expectedAccountReceiptCount: 1, pageCount: 2, expectedTotalCents: 1495,
  receipts: [1, 2].map(page => ({ page, merchant: 'Market', date: '2026-06-22', currency: 'AUD', amountCents: page === 1 ? 1000 : 495, categoryId: 'restaurants', notes: '', reviewed: true, fileSha256: sha256(bytes) })) });
const timestamp = { seconds: 1784263987, nanoseconds: 780159000 };
const source = { id: 'source', userId: 'owner', status: 'needs_review', createdAt: 'original upload time', file: { storagePath: 'users/owner/receipts/original.pdf', originalName: 'Original.pdf', mimeType: 'application/pdf', sizeBytes: 123 } };

test('review manifest rejects missing pages, unreviewed fields, invalid dates, currencies and totals', () => {
  const scenarios = [
    m => m.receipts.pop(), m => m.receipts[1].page = 1, m => m.receipts[0].reviewed = false,
    m => m.receipts[0].date = '2026-02-30', m => m.receipts[0].currency = 'USD',
    m => m.expectedTotalCents++, m => m.receipts[0].amountCents = 0.5,
    m => m.sourceStoragePath = 'users/another/receipts/original.pdf', m => m.receipts[0].fileSha256 = '',
  ];
  for (const change of scenarios) { const m = manifest(); change(m); assert.throws(() => validateManifest(m)); }
  assert.equal(validateManifest(manifest()).pageCount, 2);
});

test('each page has a deterministic unique ID and file, with original ID retained only for page one', () => {
  const m = manifest(); const a = recoveryPlan(m); const b = recoveryPlan(m);
  assert.deepEqual(a, b); assert.equal(a.entries[0].id, m.sourceReceiptId);
  assert.equal(new Set(a.entries.map(r => r.id)).size, 2);
  assert.equal(new Set(a.entries.map(r => r.storagePath)).size, 2);
  assert(a.entries.every(r => r.storagePath !== m.sourceStoragePath));
  const record = receiptRecord(m, a, a.entries[1], source, { bytes, sha256: sha256(bytes) }, 'now');
  assert.equal(record.totalAmount, 4.95); assert.equal(record.currency, 'AUD');
  assert.equal(record.status, 'final'); assert.equal(record.skipProcessing, true);
  assert.equal(record.createdAt, source.createdAt); assert.equal(record.sourceBundle.storagePath, m.sourceStoragePath);
  assert.equal(record.sourceBundle.page, 2); assert.equal(record.file.mimeType, 'application/pdf');
  assert.equal(record.merchant.matchedBy, 'manual');
});

function fakeDb({ changed = false, completed = false, conflicting = false } = {}) {
  const docs = new Map();
  const m = manifest(); const p = recoveryPlan(m);
  const ref = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`) });
  const collection = path => ({ path, doc: id => ref(`${path}/${id}`), query: true });
  const snap = (path, value, updateTime = timestamp) => ({ ...ref(path), ref: ref(path), exists: value !== undefined, data: () => value, updateTime });
  docs.set('users/owner', { receiptCount: 1 }); docs.set('users/owner/receipts/source', source);
  if (completed) docs.set(`receiptBundleRecoveries/${p.recoveryId}`, { state: 'complete', manifestSha256: p.manifestSha256 });
  if (conflicting) docs.set(`users/owner/receipts/${p.entries[1].id}`, { status: 'final' });
  let writes = []; let commits = 0;
  return { docs, doc: ref, get writes() { return writes; }, get commits() { return commits; },
    async runTransaction(callback) {
      const staged = [];
      const result = await callback({
        get: async target => {
          assert.equal(staged.length, 0, 'All reads must happen before writes');
          if (target.query) {
            const result = [...docs.entries()].filter(([path]) => path.startsWith(`${target.path}/`) && path.split('/').length === target.path.split('/').length + 1).map(([path, data]) => snap(path, data, changed ? { ...timestamp, nanoseconds: 999000000 } : timestamp));
            return { docs: result, size: result.length };
          }
          return snap(target.path, docs.get(target.path));
        },
        set: (target, data) => staged.push({ path: target.path, data }),
        create: (target, data) => { assert(!docs.has(target.path)); staged.push({ path: target.path, data }); },
      });
      for (const write of staged) docs.set(write.path, write.data);
      writes.push(...staged); commits++; return result;
    },
  };
}
const run = db => { const m = manifest(); const p = recoveryPlan(m); return commitRecovery({ db, manifest: m, plan: p, files: new Map([1, 2].map(n => [n, { bytes, sha256: sha256(bytes) }])), actor: 'authorized-admin', now: 'recovery time', issueRef: db.doc('receiptIssues/source') }); };

test('receipt records, source snapshot, resolution and per-receipt history commit together', async () => {
  assert.equal(timestampKey(timestamp), manifest().expectedSourceUpdateTime);
  const db = fakeDb(); await run(db);
  assert.equal(db.commits, 1);
  const receipts = [...db.docs.keys()].filter(path => /^users\/owner\/receipts\/[^/]+$/.test(path));
  assert.equal(receipts.length, 2); assert.equal(db.docs.get('users/owner').receiptCount, 1, 'Existing creation triggers own count increments');
  const audit = [...db.docs.entries()].find(([path]) => path.startsWith('receiptBundleRecoveries/'))[1];
  assert.deepEqual(audit.sourceSnapshot, source); assert.equal(audit.expectedReceiptCount, 2);
  assert.equal(db.docs.get('receiptIssues/source').state, 'resolved');
  assert.equal(db.writes.filter(w => w.path.includes('/processingHistory/')).length, 2);
});

test('rerunning a completed recovery never creates duplicates or overwrites subsequent edits', async () => {
  const db = fakeDb(); await run(db);
  const count = db.writes.length;
  db.docs.get('users/owner/receipts/source').notes = 'Customer edit after recovery';
  assert.equal((await run(db)).alreadyApplied, true);
  assert.equal(db.writes.length, count);
  assert.equal(db.docs.get('users/owner/receipts/source').notes, 'Customer edit after recovery');
});

test('a concurrent source edit or an existing destination stops all database writes', async () => {
  for (const config of [{ changed: true }, { conflicting: true }]) {
    const db = fakeDb(config); await assert.rejects(run(db));
    assert.equal(db.writes.length, 0); assert.equal(db.commits, 0);
  }
});
