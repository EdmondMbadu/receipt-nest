const assert = require('node:assert/strict');
const {test} = require('node:test');
const admin = require('firebase-admin');
const {installFakeFirestore} = require('./fixtures/fake-firestore.cjs');
const {restartZeroReceiptOnboarding} = require('../lib/onboarding-restart');
const {emailSuppressionDocumentId} = require('../lib/email-suppression');
const {DAY} = require('../lib/email-lifecycle-policy');
const startedAt = new Date('2026-10-26T19:00:00Z');
const options = {userId: 'zero-user', runId: 'zero-receipts-2026-10-26', startedAt};
const email = 'zero@example.com';
const user = 'users/zero-user', state = 'emailLifecycleState/zero-user';
const T = ms => admin.firestore.Timestamp.fromMillis(ms);
function setup(t, seed = {}, auth = {}) {
  const fake = installFakeFirestore(t, {[user]: {email, welcomeEmailSent: true, receiptCount: 100}, ...seed});
  const service = admin.auth(), getUser = service.getUser;
  service.getUser = async () => ({email, emailVerified: true, disabled: false, ...auth});
  t.after(() => {service.getUser = getUser;});
  return fake;
}
test('preview is read-only and ignores stale receipt counters', async t => {
  const h = setup(t);
  const before = [...h.documents];
  assert.equal(await restartZeroReceiptOnboarding(options), 'eligible');
  assert.deepEqual([...h.documents], before);
});
test('explicit restart replaces old progression, preserves history and never changes the welcome', async t => {
  const old = {userId: options.userId, enrolledAt: T(1), activatedAt: T(2), onboardingHandled: {'first-receipt': 'sent', 'receipt-help': 'claimed'}, reminderStatus: 'completed', events: [{key:'week-old',at:startedAt.getTime()-DAY}], tips: {forwarding:true}};
  const h = setup(t, {[state]: old});
  assert.equal(await restartZeroReceiptOnboarding({...options, dryRun:false}), 'enrolled');
  const next = h.documents.get(state);
  assert.equal(next.enrolledAt.toMillis(), startedAt.getTime());
  assert.equal(next.reminderDueAt.toMillis(), startedAt.getTime()+3*DAY);
  assert.deepEqual(next.onboardingHandled, {});
  assert.equal(next.activatedAt, null);
  assert.deepEqual(next.events, old.events); assert.deepEqual(next.tips, old.tips);
  assert.equal(h.documents.get(user).welcomeEmailSent, true);
  const audit = h.documents.get(`emailLifecycleRestarts/${options.userId}_${options.runId}`);
  assert.equal(audit.userId, options.userId); assert.deepEqual(audit.previous.onboardingHandled, old.onboardingHandled);
  assert.equal([...h.documents.keys()].some(p => p.startsWith('emailLifecycleDeliveries/')), false);
});
test('rerunning a completed or concurrent restart cannot move the clock or erase new progress', async t => {
  const h=setup(t);
  const results=await Promise.all([restartZeroReceiptOnboarding({...options,dryRun:false}),restartZeroReceiptOnboarding({...options,dryRun:false})]);
  assert.deepEqual(results.sort(),['already-enrolled','enrolled']);
  h.documents.get(state).onboardingHandled={'first-receipt':'sent'};
  assert.equal(await restartZeroReceiptOnboarding({...options,startedAt:new Date(startedAt.getTime()+DAY),dryRun:false}),'already-enrolled');
  assert.equal(h.documents.get(state).enrolledAt.toMillis(),startedAt.getTime());
  assert.deepEqual(h.documents.get(state).onboardingHandled,{'first-receipt':'sent'});
});
for (const receipt of [{status:'final',totalAmount:0},{status:'processing'},{status:'needs_review'},{status:'uploaded'}]) {
  test(`any actual receipt excludes enrollment (${receipt.status}), even with a zero counter`,async t=>{
    const h=setup(t,{[user]:{email,receiptCount:0},[`${user}/receipts/r`]:receipt});
    assert.equal(await restartZeroReceiptOnboarding({...options,dryRun:false}),'has-receipts');
    assert.equal(h.documents.has(state),false);
  });
}
for (const [label,seed,auth,reason] of [
  ['opted out',{[user]:{email,notificationSettings:{onboardingEmails:false}}},{},'preference'],
  ['unsubscribed',{[`emailSuppressions/${emailSuppressionDocumentId(email)}`]:{status:'unsubscribed'}},{},'unsubscribed'],
  ['disabled',{}, {disabled:true},'account-not-eligible'],
  ['unverified',{}, {emailVerified:false},'account-not-eligible'],
  ['mismatched email',{[user]:{email:'other@example.com'}},{},'address-changed'],
]) test(`restart respects ${label}`,async t=>{
  const h=setup(t,seed,auth), before=[...h.documents];
  assert.equal(await restartZeroReceiptOnboarding({...options,dryRun:false}),reason);
  assert.deepEqual([...h.documents],before);
});
test('a profile deleted between auth and the transaction is never recreated',async t=>{
  const h=setup(t);h.documents.delete(user);
  assert.equal(await restartZeroReceiptOnboarding({...options,dryRun:false}),'account-missing');
  assert.equal(h.documents.size,0);
});
test('missing auth skips but operational auth errors abort without changing state',async t=>{
  const h=setup(t); const service=admin.auth();
  service.getUser=async()=>{throw Object.assign(new Error('not found'),{code:'auth/user-not-found'});};
  assert.equal(await restartZeroReceiptOnboarding({...options,dryRun:false}),'account-missing');
  service.getUser=async()=>{throw new Error('network error');};
  await assert.rejects(restartZeroReceiptOnboarding({...options,dryRun:false}),/network error/);
  assert.equal(h.documents.has(state),false);
});
