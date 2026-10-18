const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextGuideProgress } = require('../lib/getting-started-policy');
const { buildWelcomeEmailContent } = require('../lib/welcome-email-content');

test('seen and progress keep the original seen timestamp across visits', () => {
  const seen = nextGuideProgress(undefined, 'seen', 0, 100);
  assert.equal(seen.status, 'seen');
  assert.deepEqual(nextGuideProgress(seen, 'seen', 0, 200), seen);
  const progress = nextGuideProgress(seen, 'progress', 2, 300);
  assert.equal(progress.step, 2); assert.equal(progress.seenAt, 100); assert.equal(progress.updatedAt, 300);
});
test('late tab writes cannot reopen a completed or dismissed guide', () => {
  for (const action of ['complete', 'dismiss']) {
    const terminal = nextGuideProgress(undefined, action, 3, 100);
    assert.deepEqual(nextGuideProgress(terminal, 'progress', 1, 200), terminal);
    assert.deepEqual(nextGuideProgress(terminal, 'seen', 0, 200), terminal);
  }
});
test('manual replay can complete a previously dismissed guide', () => {
  const dismissed = nextGuideProgress(undefined, 'dismiss', 0, 100);
  assert.equal(nextGuideProgress(dismissed, 'complete', 4, 200).status, 'completed');
});
test('invalid remote actions and step values are rejected', () => {
  for (const [action,step] of [['reset',1],['progress',-1],['progress',5],['progress','2'],['progress',1.5],['progress',undefined]]) {
    assert.throws(() => nextGuideProgress(undefined,action,step,100));
  }
});
test('welcome email has a readable video link with images blocked and a matching thumbnail destination', () => {
  const email = buildWelcomeEmailContent('https://receipt-nest.com/');
  assert.match(email.text, /Watch the 85-second walkthrough: https:\/\/receipt-nest.com\/getting-started/);
  assert.equal((email.bodyHtml.match(/href="https:\/\/receipt-nest.com\/getting-started#walkthrough"/g)||[]).length,2);
  assert.ok(email.bodyHtml.indexOf('Add your first receipt') < email.bodyHtml.indexOf('Prefer a quick demonstration?'));
  assert.match(email.bodyHtml, /alt="Watch the 85-second/);
  assert.match(email.text, /\/app\?addReceipt=1/);
  assert.doesNotMatch(email.bodyHtml, /<video|<iframe|autoplay/);
});

test('onboarding callables reject unsigned and unverified callers', async () => {
  const {getGettingStartedState,saveGettingStartedProgress} = require('../lib/getting-started');
  for (const fn of [getGettingStartedState,saveGettingStartedProgress]) {
    await assert.rejects(fn.run({data:{}}), {code:'unauthenticated'});
    await assert.rejects(fn.run({auth:{uid:'test-user',token:{}},data:{}}), {code:'failed-precondition'});
  }
});

test('server reads the full account count and writes only the authenticated user’s guide state', async t => {
  const admin = require('firebase-admin');
  const app = admin.apps.length ? admin.app() : admin.initializeApp({projectId:'demo-receiptnest-onboarding'});
  const db = admin.firestore(app);
  const originalDoc = db.doc;
  const originalTransaction = db.runTransaction;
  const paths = [];
  let stored;
  const ref = {
    get:async()=>({get:key=>key==='gettingStarted'?stored:undefined}),
    collection:name=>{
      assert.equal(name,'receipts');
      return {count:()=>({get:async()=>({data:()=>({count:4})})})};
    }
  };
  db.doc = path => {paths.push(path);return ref;};
  db.runTransaction = async callback => callback({
    get:async()=>({exists:true,get:()=>stored}),
    update:(_ref,data)=>{assert.deepEqual(Object.keys(data),['gettingStarted']); stored=data.gettingStarted;}
  });
  t.after(()=>{db.doc=originalDoc;db.runTransaction=originalTransaction;});
  const {getGettingStartedState,saveGettingStartedProgress} = require('../lib/getting-started');
  const auth={uid:'owner',token:{email_verified:true}};
  const initial=await getGettingStartedState.run({auth,data:{uid:'someone-else'}});
  assert.equal(initial.receiptCount,4);assert.equal(initial.progress,null);
  await saveGettingStartedProgress.run({auth,data:{action:'seen',step:0,uid:'someone-else'}});
  await saveGettingStartedProgress.run({auth,data:{action:'dismiss',step:0}});
  await saveGettingStartedProgress.run({auth,data:{action:'progress',step:1}});
  assert.equal(stored.status,'dismissed');
  assert.ok(paths.every(path=>path==='users/owner'));
});
