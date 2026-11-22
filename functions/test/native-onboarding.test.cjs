const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextNativeGuideProgress: next, validateNativeGuideChange } = require('../lib/native-onboarding-policy');
const initial = { version: 2, status: 'new', firstOpenedAt: 100, baselineReceiptCount: 0, updatedAt: 100 };
const receipt = { status: 'final', totalAmount: 12.5 };

test('the actual receipt can be paused, resumed, viewed and completed without moving enrollment', () => {
  const started = next(initial, 'introduce', 200);
  const upload = next(started, 'upload', 300, 'r1', receipt);
  const paused = next(upload, 'pause', 400);
  assert.equal(paused.receiptId, 'r1');
  const resumed = next(paused, 'introduce', 500);
  const viewed = next(resumed, 'view', 600, 'r1', receipt);
  const completed = next(viewed, 'complete', 700, 'r1', receipt);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.firstOpenedAt, 100);
  assert.equal(completed.viewedAt, 600);
  assert.equal(completed.firstUsableReceiptViewedAt, 600);
  for (const action of ['introduce', 'pause', 'restart', 'upload']) {
    assert.deepEqual(next(completed, action, 800, 'r2', receipt), completed);
  }
});
test('uploads, extraction failures, and missing receipts never count as a usable viewed outcome', () => {
  for (const bad of [undefined, { status: 'uploaded' }, { status: 'processing' }, { status: 'needs_review' }, { status: 'needs_review', totalAmount: '' }, { status: 'needs_review', totalAmount: 'NaN' }]) {
    assert.throws(() => next(initial, 'view', 200, 'r1', bad));
  }
});
test('a real zero-amount receipt counts, but review still must be confirmed before completing the guide', () => {
  const review = { status: 'needs_review', totalAmount: 0 };
  const viewed = next(initial, 'view', 200, 'r1', review);
  assert.equal(viewed.firstUsableReceiptViewedAt, 200);
  assert.throws(() => next(viewed, 'complete', 300, 'r1', review));
  assert.equal(next(viewed, 'complete', 300, 'r1', { status: 'final', totalAmount: 0 }).status, 'completed');
});
test('completion requires a view of the same receipt; restart resets the task but preserves activation', () => {
  assert.throws(() => next(initial, 'complete', 200, 'r1', receipt));
  const viewed = next(initial, 'view', 200, 'r1', receipt);
  assert.throws(() => next(viewed, 'complete', 300, 'r2', receipt));
  const restarted = next(viewed, 'restart', 300);
  assert.equal(restarted.receiptId, null); assert.equal(restarted.viewedAt, null);
  assert.equal(restarted.firstUsableReceiptViewedAt, 200);
});
test('ordinary receipt viewing records activation without reopening a paused or completed guide', () => {
  for (const status of ['paused', 'completed']) {
    const observed = next({ ...initial, status }, 'observe', 200, 'r1', receipt);
    assert.equal(observed.status, status);
    assert.equal(observed.firstUsableReceiptViewedAt, 200);
    assert.equal(observed.receiptId, undefined);
    assert.equal(next(observed, 'observe', 300, 'r2', receipt).firstUsableReceiptViewedAt, 200);
  }
});
test('invalid actions and receipt paths are rejected', () => {
  for (const id of ['', '../other', 'users/other/receipts/r', 'x'.repeat(129), null, 1]) {
    assert.throws(() => validateNativeGuideChange('upload', id));
  }
  assert.throws(() => validateNativeGuideChange('override', 'r1'));
});
test('native callables reject unsigned, unverified, and switched accounts', async () => {
  const { getNativeOnboardingState, saveNativeOnboardingProgress } = require('../lib/native-onboarding');
  for (const fn of [getNativeOnboardingState, saveNativeOnboardingProgress]) {
    await assert.rejects(fn.run({ data: {} }), { code: 'unauthenticated' });
    await assert.rejects(fn.run({ auth: { uid: 'a', token: {} }, data: { expectedUserId: 'a' } }), { code: 'failed-precondition' });
    await assert.rejects(fn.run({ auth: { uid: 'b', token: { email_verified: true } }, data: { expectedUserId: 'a' } }), { code: 'permission-denied' });
  }
});

test('three distinct usable receipts within 14 days are recorded once and remain recorded after deletion', () => {
  const { recordNativeReceiptMilestone: milestone } = require('../lib/native-onboarding-policy');
  const day = 86400000;
  let progress = { ...initial };
  for (let index = 1; index <= 3; index++) {
    progress = milestone(progress, `r${index}`, { status: 'final', createdAt: 100 + index * day }, 100 + index * day);
  }
  assert.equal(progress.receiptMilestones.length, 3);
  assert.equal(progress.firstReceiptSavedAt, 100 + day);
  assert.equal(progress.thirdReceiptSavedAt, 100 + 3 * day);
  assert.deepEqual(milestone(progress, 'r1', { status: 'final', createdAt: 100 + day }, 100 + 4 * day), progress);
  assert.deepEqual(milestone(progress, 'r3', { status: 'deleted', createdAt: 100 + day }, 100 + 4 * day), progress);
  assert.deepEqual(milestone(initial, 'old', { status: 'final', createdAt: 99 }, 200), initial);
  assert.deepEqual(milestone(initial, 'late', { status: 'final', createdAt: 100 + 15 * day }, 100 + 15 * day), initial);
  assert.deepEqual(milestone(initial, 'failed', { status: 'needs_review', createdAt: 101 }, 200), initial);
});

test('native callables count the full account and persist only native progress under the signed-in owner', async t => {
  const admin = require('firebase-admin');
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId: 'demo-native-onboarding' });
  const db = admin.firestore(app);
  const originalDoc = db.doc, originalTransaction = db.runTransaction;
  const paths = [];
  let progress;
  const profile = { exists: true, get: key => key === 'nativeOnboarding' ? progress : key === 'gettingStarted' ? { status: 'completed' } : undefined };
  const receiptRef = { id: 'r1' };
  const ref = { collection: name => {
    assert.equal(name, 'receipts');
    return { count: () => ({ get: async () => ({ data: () => ({ count: 4 }) }) }), doc: id => { assert.equal(id, 'r1'); return receiptRef; } };
  } };
  db.doc = path => { paths.push(path); return ref; };
  db.runTransaction = async callback => callback({
    get: async target => target === ref ? profile : { exists: true, data: () => receipt },
    update: (target, data) => { assert.equal(target, ref); assert.deepEqual(Object.keys(data), ['nativeOnboarding']); progress = data.nativeOnboarding; }
  });
  t.after(() => { db.doc = originalDoc; db.runTransaction = originalTransaction; });
  const { getNativeOnboardingState, saveNativeOnboardingProgress } = require('../lib/native-onboarding');
  const auth = { uid: 'owner', token: { email_verified: true } };
  const loaded = await getNativeOnboardingState.run({ auth, data: { expectedUserId: 'owner', uid: 'other' } });
  assert.equal(loaded.receiptCount, 4);
  assert.equal(loaded.progress.status, 'new');
  const enrollment = loaded.progress.firstOpenedAt;
  for (const action of ['introduce', 'upload', 'view', 'complete', 'pause']) {
    await saveNativeOnboardingProgress.run({ auth, data: { expectedUserId: 'owner', action, receiptId: 'r1', uid: 'other' } });
  }
  assert.equal(progress.status, 'completed');
  assert.equal(progress.firstOpenedAt, enrollment);
  assert.ok(paths.every(path => path === 'users/owner'));
});

test('the native report separates rollout cohorts and requires full observation windows', () => {
  const { summarizeNativeOnboarding } = require('../scripts/report-native-onboarding.cjs');
  const day = 86400000;
  const profile = (firstOpenedAt, other = {}) => ({ nativeOnboarding: { ...initial, cohort: 'new_account', firstOpenedAt, ...other } });
  const groups = summarizeNativeOnboarding([
    profile(100, { firstReceiptSavedAt: 200, firstUsableReceiptViewedAt: 300, thirdReceiptSavedAt: 100 + 10 * day }),
    profile(100, { firstReceiptSavedAt: 200 }), // Uploads alone never count as viewed.
    profile(100 + 15 * day, { firstReceiptSavedAt: 100 + 15 * day + 1, firstUsableReceiptViewedAt: 100 + 15 * day + 2 }),
    profile(100, { cohort: 'existing_account', firstReceiptSavedAt: 200, firstUsableReceiptViewedAt: 300 }),
    profile(100, { baselineReceiptCount: 2 }),
  ], 100 + 15 * day);
  assert.deepEqual(groups.new_account_zero_receipts.firstReceiptSavedAndViewed24h, { reached: 1, eligible: 2 });
  assert.deepEqual(groups.new_account_zero_receipts.threeReceipts14d, { reached: 1, eligible: 2 });
  assert.equal(groups.existing_account_zero_receipts.accounts, 1);
  assert.equal(groups.existing_one_to_four_receipts.accounts, 1);
});
