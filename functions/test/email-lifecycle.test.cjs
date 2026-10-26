const assert = require('node:assert/strict');
const {test} = require('node:test');
const admin = require('firebase-admin');
const {installFakeFirestore} = require('./fixtures/fake-firestore.cjs');
const {rawReceipts} = require('./fixtures/spend-summary.cjs');
const policy = require('../lib/email-lifecycle-policy');
const {DAY, HOUR, nextEmailTime, recentSendEvents, hasUsableReceipt} = policy;
const {deliverLifecycleEmail} = require('../lib/email-lifecycle');
const {dispatchOnboardingEmails, recordReceiptEmailActivation} = require('../lib/onboarding-emails');
const {dispatchScheduledSpendSummaryEmails, dispatchDeferredSpendSummaryEmails, sendSpendSummaryEmail} = require('../lib/spend-summary-email');
const {sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail} = require('../lib/email');
const {emailSuppressionDocumentId, verifyUnsubscribeToken} = require('../lib/email-suppression');
const T = value => admin.firestore.Timestamp.fromMillis(typeof value === 'string' ? Date.parse(value) : value);
const uid = 'lifecycle-user';
const userPath = `users/${uid}`;
const statePath = `emailLifecycleState/${uid}`;
const email = 'preview@example.com';
const start = Date.parse('2026-10-16T15:00:00Z');
const day3 = start + 3 * DAY;
const eventAt = at => ({scheduleTime: new Date(at).toISOString()});
const profile = {email, firstName:'Edmond', lastName:'Mbadu', notificationTimeZone:'America/Los_Angeles', createdAt:T(start), welcomeEmailSent:true, welcomeEmailSentAt:T(start)};
const enrollment = {userId:uid, enrolledAt:T(start), reminderDueAt:T(day3), events:[{key:'welcome-v1',at:start}]};
const summaryConfig = {timeZone:'America/Los_Angeles', weekly:{enabled:true,dayOfWeek:'monday',time:'08:00'}, monthly:{enabled:false,dayOfMonth:1,time:'08:00'}};

function harness(t, initial = {}, clock = start) {
  const originalNow = Date.now; Date.now = () => clock; t.after(() => {Date.now = originalNow;});
  const fake = installFakeFirestore(t, {[userPath]:{...profile}, ...initial});
  const sg = require('@sendgrid/mail');
  const requests = [];
  const savedRequest = sg.client.request, savedKey = sg.setApiKey;
  sg.setApiKey = () => {};
  sg.client.request = async request => {requests.push(JSON.parse(JSON.stringify(request.body))); return [{statusCode:202},{}];};
  const envNames = ['SENDGRID_API_KEY','APP_BASE_URL','UNSUBSCRIBE_TOKEN_SECRET'];
  const saved = envNames.map(key => [key,process.env[key]]);
  process.env.SENDGRID_API_KEY='local-only'; process.env.APP_BASE_URL='https://receipt-nest.com'; process.env.UNSUBSCRIBE_TOKEN_SECRET='test-signing-secret';
  const auth = admin.auth(); const originalGet = auth.getUser;
  let authUser = {email,emailVerified:true,disabled:false};
  auth.getUser = async () => {
    if (authUser instanceof Error) throw authUser;
    return authUser;
  };
  t.after(() => {
    sg.client.request=savedRequest; sg.setApiKey=savedKey; auth.getUser=originalGet;
    for (const [key,value] of saved) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });
  return {...fake,requests, setAuth:value => {authUser=value;}, html: () => requests.at(-1)?.content.find(c => c.type==='text/html').value};
}
function seedReceipts(h, rows = rawReceipts) {rows.forEach((data,i)=>h.documents.set(`${userPath}/receipts/${i}`,data));}
const deliver = (at, kind='week', key='week-2026-W42', send=async()=>{}) => deliverLifecycleEmail({userId:uid,recipient:email,kind,key,now:new Date(at),send});

// Boundary tests protect the actual sending budget, not just scheduled dates.
test('cadence: exact 48-hour and rolling seven-day boundaries, including legacy welcome records', () => {
  assert.equal(nextEmailTime([], start), start);
  assert.equal(nextEmailTime([{key:'welcome-v1',at:start}], start+DAY), start+2*DAY);
  assert.equal(nextEmailTime([{key:'welcome-v1',at:start}], start+2*DAY), start+2*DAY);
  const events = [{key:'welcome-v1',at:start},{key:'first-receipt-v1',at:start+3*DAY}];
  assert.equal(nextEmailTime(events,start+5*DAY),start+7*DAY);
  assert.equal(nextEmailTime(events,start+7*DAY),start+7*DAY);
  assert.deepEqual(recentSendEvents([],start+DAY,start),[{key:'welcome-v1',at:start}]);
  assert.equal(recentSendEvents(events,start+DAY,start).length,2);
});

test('activation distinguishes successful, zero-value and failed-review receipts', () => {
  assert.equal(hasUsableReceipt({status:'final'}),true);
  assert.equal(hasUsableReceipt({status:'needs_review',totalAmount:0}),true);
  assert.equal(hasUsableReceipt({status:'needs_review',extraction:{totalAmount:{value:'-4.20'}}}),true);
  for (const data of [{status:'needs_review'}, {status:'needs_review',totalAmount:''},{status:'processing',totalAmount:10},{status:'uploaded'},{status:'needs_review',totalAmount:'NaN'}]) assert.equal(hasUsableReceipt(data),false);
});

test('concurrent duplicate and competing jobs share a single atomic send slot', async t => {
  harness(t, {[userPath]:{...profile,welcomeEmailSentAt:null}});
  let calls=0;
  const results=await Promise.all([
    deliver(day3,'week','same-key',async()=>{calls++;}),
    deliver(day3,'week','same-key',async()=>{calls++;}),
    deliver(day3,'month','other-key',async()=>{calls++;}),
  ]);
  assert.equal(calls,1); assert.equal(results.filter(r=>r.sent).length,1);
  assert.ok(results.some(r=>r.reason==='already-claimed'));
  assert.ok(results.some(r=>r.reason==='cadence'));
});

test('definite provider rejection backs off six hours and permits a later retry', async t => {
  const h=harness(t,{[userPath]:{...profile,welcomeEmailSentAt:null}});
  await assert.rejects(deliver(day3,'week','retry-key',async()=>{throw Object.assign(new Error('unavailable'),{response:{statusCode:503}});}));
  assert.equal(h.documents.get(statePath).events.length,0);
  assert.equal((await deliver(day3+HOUR,'week','retry-key')).reason,'retry-later');
  assert.equal((await deliver(day3+6*HOUR,'week','retry-key')).sent,true);
});

test('ambiguous provider outcomes and failed acknowledgements never auto-resend a claimed email', async t => {
  const h=harness(t,{[userPath]:{...profile,welcomeEmailSentAt:null}});
  await assert.rejects(deliver(day3,'week','timeout-key',async()=>{throw new Error('network timeout');}));
  let calls=0;
  assert.equal((await deliver(day3+8*DAY,'week','timeout-key',async()=>{calls++;})).reason,'already-claimed');
  assert.equal(calls,0);
  const db=admin.firestore(), run=db.runTransaction;
  let transactions=0;
  db.runTransaction=callback=>{transactions++; return transactions===2?Promise.reject(new Error('ack write failed')):run(callback);};
  await assert.rejects(deliver(day3+8*DAY,'week','ack-key',async()=>{calls++;}));
  db.runTransaction=run;
  assert.equal(calls,1);
  assert.equal((await deliver(day3+16*DAY,'week','ack-key',async()=>{calls++;})).reason,'already-claimed');
  assert.equal(calls,1);
  assert.equal(h.documents.get(`emailLifecycleDeliveries/${uid}_ack-key`).status,'sending');
});

test('completion cannot recreate an account or lifecycle state deleted during a send', async t => {
  const h=harness(t,{[userPath]:{...profile,welcomeEmailSentAt:null}});
  await deliver(day3,'week','deleted-key',async()=>{
    h.documents.delete(userPath);h.documents.delete(statePath);h.documents.delete(`emailLifecycleDeliveries/${uid}_deleted-key`);
  });
  assert.equal(h.documents.has(userPath),false);assert.equal(h.documents.has(statePath),false);
  assert.equal(h.documents.has(`emailLifecycleDeliveries/${uid}_deleted-key`),false);
});

test('welcome keeps its workflow and video, enrolls once, and handles concurrent sign-in calls', async t => {
  const h=harness(t,{[userPath]:{...profile,welcomeEmailSent:false,welcomeEmailSentAt:null}});
  const req={auth:{uid,token:{email,email_verified:true}},data:{}};
  await Promise.all([sendWelcomeEmail.run(req),sendWelcomeEmail.run(req)]);
  await sendWelcomeEmail.run(req);
  assert.equal(h.requests.length,1);
  assert.equal(h.documents.get(userPath).welcomeEmailSent,true);
  const state=h.documents.get(statePath);
  assert.ok(state.enrolledAt);assert.equal(state.reminderDueAt.toMillis()-state.enrolledAt.toMillis(),3*DAY);
  assert.match(h.html(),/Add your first receipt/);assert.match(h.html(),/Watch the 85-second walkthrough/);
  assert.match(h.html(),/getting-started#walkthrough/);
  assert.doesNotMatch(h.html(),/gradient\(|box-shadow/);
  assert.equal((h.html().match(/id="receiptnest-social-footer"/g)||[]).length,1);
  assert.ok(h.requests[0].attachments.some(a=>a.content_id==='receiptnest-summary-logo'));
});

test('unverified welcome is rejected and existing welcomed accounts are not enrolled retroactively', async t => {
  const h=harness(t);
  h.setAuth({email,emailVerified:false});
  await assert.rejects(sendWelcomeEmail.run({auth:{uid,token:{email}},data:{}}),{code:'failed-precondition'});
  h.setAuth({email,emailVerified:true});
  await sendWelcomeEmail.run({auth:{uid,token:{email}},data:{}});
  await dispatchOnboardingEmails.run(eventAt(day3));
  assert.equal(h.requests.length,0);assert.equal(h.documents.has(statePath),false);
});

test('Day 3 reminder sends once, preserves signing, and does not send before its due time', async t => {
  const h=harness(t,{[statePath]:enrollment});
  await dispatchOnboardingEmails.run(eventAt(day3-HOUR));assert.equal(h.requests.length,0);
  await Promise.all([dispatchOnboardingEmails.run(eventAt(day3)),dispatchOnboardingEmails.run(eventAt(day3))]);
  await dispatchOnboardingEmails.run(eventAt(day3+DAY));
  assert.equal(h.requests.length,1);assert.equal(h.documents.get(statePath).reminderDueAt,null);
  assert.match(h.html(),/A little less paperwork/);
  assert.match(h.html(),/app\?addReceipt=1/);
  assert.match(h.html(),/app\?settings=notifications/);
  const body=h.requests[0];
  assert.equal(body.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  const url=new URL(body.headers['List-Unsubscribe'].slice(1,-1));
  assert.equal(verifyUnsubscribeToken(url.searchParams.get('token'),'test-signing-secret'),email);
  assert.match(body.content.find(c=>c.type==='text/plain').value,/getting-started#walkthrough/);
});

test('processed receipt permanently stops the reminder even if the receipt is deleted', async t => {
  const h=harness(t,{[statePath]:enrollment});
  h.documents.set(`${userPath}/receipts/one`,{status:'final',totalAmount:12});
  await recordReceiptEmailActivation.run({params:{userId:uid,receiptId:'one'},data:{after:{data:()=>({status:'final',totalAmount:12})}}});
  h.documents.delete(`${userPath}/receipts/one`);
  await dispatchOnboardingEmails.run(eventAt(day3));
  assert.equal(h.requests.length,0);assert.ok(h.documents.get(statePath).activatedAt);
  assert.equal(h.documents.get(statePath).reminderDueAt,null);
});

test('last-moment receipt checks cancel the reminder without depending on the activation trigger', async t => {
  const h=harness(t,{[statePath]:enrollment,[`${userPath}/receipts/one`]:{status:'needs_review',totalAmount:0}});
  await dispatchOnboardingEmails.run(eventAt(day3));
  assert.equal(h.requests.length,0);assert.equal(h.documents.get(statePath).reminderStatus,'activated');
});

test('failed-review receipts remain eligible; uploads still processing are deferred', async t => {
  await t.test('failed extraction',async t=>{
    const h=harness(t,{[statePath]:enrollment,[`${userPath}/receipts/one`]:{status:'needs_review'}});
    await recordReceiptEmailActivation.run({params:{userId:uid,receiptId:'one'},data:{after:{data:()=>({status:'needs_review'})}}});
    await dispatchOnboardingEmails.run(eventAt(day3));assert.equal(h.requests.length,1);
  });
  await t.test('processing',async t=>{
    const h=harness(t,{[statePath]:enrollment,[`${userPath}/receipts/one`]:{status:'processing'}});
    await dispatchOnboardingEmails.run(eventAt(day3));assert.equal(h.requests.length,0);
    assert.equal(h.documents.get(statePath).reminderDueAt.toMillis(),day3+6*HOUR);
  });
});

test('reminders honor local daytime, expiry, opt-outs, suppressions, and current account eligibility', async t => {
  for(const scenario of ['night','expired','preference','unsubscribed','disabled','unverified','changed-email','deleted-auth','deleted-profile']) await t.test(scenario,async t=>{
    const h=harness(t,{[statePath]:{...enrollment,reminderDueAt:T(day3-8*HOUR)}});
    if(scenario==='night')h.documents.set(userPath,{...profile,notificationTimeZone:'Asia/Tokyo'});
    if(scenario==='preference')h.documents.set(userPath,{...profile,notificationSettings:{onboardingEmails:false}});
    if(scenario==='unsubscribed')h.documents.set(`emailSuppressions/${emailSuppressionDocumentId(email)}`,{status:'unsubscribed'});
    if(scenario==='disabled')h.setAuth({email,emailVerified:true,disabled:true});
    if(scenario==='unverified')h.setAuth({email,emailVerified:false});
    if(scenario==='changed-email')h.setAuth({email:'new@example.com',emailVerified:true});
    if(scenario==='deleted-auth')h.setAuth(Object.assign(new Error('gone'),{code:'auth/user-not-found'}));
    if(scenario==='deleted-profile')h.documents.delete(userPath);
    await dispatchOnboardingEmails.run(eventAt(scenario==='expired'?start+14*DAY:day3));
    assert.equal(h.requests.length,0);
    const due=h.documents.get(statePath).reminderDueAt;
    if(scenario==='night')assert.equal(due.toMillis(),day3+HOUR);else assert.equal(due,null);
  });
});

test('automated empty summaries are skipped while manual empty previews still work', async t => {
  const h=harness(t,{'systemConfig/spendSummaryEmailSchedule':summaryConfig});
  await dispatchScheduledSpendSummaryEmails.run(eventAt(day3));
  assert.equal(h.requests.length,0);
  await sendSpendSummaryEmail.run({auth:{uid:'admin',token:{admin:true}},data:{to:email,userId:uid,periodType:'week',week:'2026-W42'}});
  assert.equal(h.requests.length,1);assert.match(h.html(),/No receipts were recorded/);
});

test('a real zero-amount receipt still gets a useful summary',async t=>{
  const h=harness(t,{'systemConfig/spendSummaryEmailSchedule':summaryConfig});
  seedReceipts(h,[{status:'final',date:'2026-10-16T12:00:00Z',totalAmount:0,merchant:{canonicalName:'Free receipt'}}]);
  await dispatchScheduledSpendSummaryEmails.run(eventAt(day3));
  assert.equal(h.requests.length,1);assert.match(h.html(),/Free receipt/);
});

test('monthly wins a schedule collision; weekly is deferred and retains its original period',async t=>{
  const now=Date.parse('2026-06-01T15:00:00Z');
  const h=harness(t,{[userPath]:{...profile,createdAt:T(now-10*DAY),welcomeEmailSentAt:T(now-10*DAY)},'systemConfig/spendSummaryEmailSchedule':{...summaryConfig,monthly:{enabled:true,dayOfMonth:1,time:'08:00'}}},now);
  seedReceipts(h,rawReceipts.map(r=>({...r,date:r.date.replace('2026-10-16','2026-05-29').replace('2026-10-15','2026-05-28').replace('2026-10-14','2026-05-27').replace('2026-10-13','2026-05-26').replace('2026-10-12','2026-05-25')})));
  await dispatchScheduledSpendSummaryEmails.run(eventAt(now));
  assert.equal(h.requests.length,1);assert.match(h.requests[0].subject,/Monthly.*May 2026/);
  const queue=[...h.documents].filter(([key])=>key.startsWith('spendSummaryEmailQueue/'));
  assert.equal(queue.length,1);assert.equal(queue[0][1].type,'week');
  assert.equal(queue[0][1].dueAt.toMillis(),now+2*DAY);
  assert.equal(queue[0][1].startKey,'2026-05-25');assert.equal(queue[0][1].timeZone,'America/Los_Angeles');
  assert.match(h.html(),/Need the original file/);
  await dispatchDeferredSpendSummaryEmails.run(eventAt(now+2*DAY-HOUR));assert.equal(h.requests.length,1);
  await dispatchDeferredSpendSummaryEmails.run(eventAt(now+2*DAY));
  assert.equal(h.requests.length,2);assert.match(h.requests[1].subject,/Weekly.*May 25/);
  assert.match(h.html(),/forward emailed receipts/);
  await dispatchDeferredSpendSummaryEmails.run(eventAt(now+3*DAY));assert.equal(h.requests.length,2);
  assert.equal([...h.documents.keys()].filter(k=>k.startsWith('spendSummaryEmailQueue/')).length,0);
});

test('deferred summaries recheck opt-outs, suppressions, empty periods, deletion, expiry and schedule state',async t=>{
  for(const scenario of ['preference','unsubscribed','empty','deleted','expired','disabled'])await t.test(scenario,async t=>{
    const h=harness(t,{[userPath]:{...profile,welcomeEmailSentAt:T(day3-DAY)},'systemConfig/spendSummaryEmailSchedule':summaryConfig});
    seedReceipts(h);await dispatchScheduledSpendSummaryEmails.run(eventAt(day3));assert.equal(h.requests.length,0);
    assert.equal([...h.documents.keys()].filter(k=>k.startsWith('spendSummaryEmailQueue/')).length,1);
    if(scenario==='preference')h.documents.set(userPath,{...h.documents.get(userPath),notificationSettings:{weeklySummaryEmails:false}});
    if(scenario==='unsubscribed')h.documents.set(`emailSuppressions/${emailSuppressionDocumentId(email)}`,{status:'unsubscribed'});
    if(scenario==='empty')for(const key of [...h.documents.keys()])if(key.includes('/receipts/'))h.documents.delete(key);
    if(scenario==='deleted')h.documents.delete(userPath);
    if(scenario==='disabled')h.documents.set('systemConfig/spendSummaryEmailSchedule',{...summaryConfig,weekly:{...summaryConfig.weekly,enabled:false}});
    await dispatchDeferredSpendSummaryEmails.run(eventAt(scenario==='expired'?day3+7*DAY:day3+DAY));
    assert.equal(h.requests.length,0);
    assert.equal([...h.documents.keys()].filter(k=>k.startsWith('spendSummaryEmailQueue/')).length,0);
  });
});

test('onboarding opt-out suppresses tips without disabling a meaningful weekly summary',async t=>{
  const h=harness(t,{[userPath]:{...profile,notificationSettings:{onboardingEmails:false}},'systemConfig/spendSummaryEmailSchedule':summaryConfig});
  seedReceipts(h);await dispatchScheduledSpendSummaryEmails.run(eventAt(day3));
  assert.equal(h.requests.length,1);assert.doesNotMatch(h.html(),/A small shortcut/);
});

test('verification and password reset remain immediate and outside the lifecycle cadence',async t=>{
  const h=harness(t,{[statePath]:{...enrollment,events:[{key:'month-x',at:day3},{key:'week-x',at:day3}]}});
  const auth=admin.auth(), originalVerify=auth.generateEmailVerificationLink, originalReset=auth.generatePasswordResetLink;
  auth.generateEmailVerificationLink=async()=> 'https://auth.example/verify?oobCode=verify-code';
  auth.generatePasswordResetLink=async()=> 'https://auth.example/reset?oobCode=reset-code';
  t.after(()=>{auth.generateEmailVerificationLink=originalVerify;auth.generatePasswordResetLink=originalReset;});
  await sendVerificationEmail.run({auth:{uid,token:{email}},data:{}});
  await sendPasswordResetEmail.run({data:{email}});
  assert.equal(h.requests.length,2);
  assert.match(h.requests[0].subject,/Verify/);assert.match(h.requests[1].subject,/Reset/);
  assert.match(h.html(),/receipt-nest.com\/reset-password\?oobCode=reset-code/);
  assert.equal(h.documents.get(statePath).events.length,2);
});

test('a delayed scheduler attempt uses actual delivery time for cadence and expiry',async t=>{
  const actual=day3+DAY;
  const h=harness(t,{[statePath]:enrollment,'systemConfig/spendSummaryEmailSchedule':summaryConfig},actual);
  // The job was scheduled on Day 3, but its delivery attempt happens on Day 4.
  await dispatchOnboardingEmails.run(eventAt(day3));
  assert.equal(h.requests.length,1);
  assert.equal(h.documents.get(statePath).events.at(-1).at,actual);
});

test('provider failures do not falsely mark a welcome sent or enroll its reminder',async t=>{
  const h=harness(t,{[userPath]:{...profile,welcomeEmailSent:false,welcomeEmailSentAt:null}});
  const sg=require('@sendgrid/mail');
  sg.client.request=async()=>{throw Object.assign(new Error('provider unavailable'),{response:{statusCode:503}});};
  await assert.rejects(sendWelcomeEmail.run({auth:{uid,token:{email}},data:{}}),{code:'internal'});
  assert.equal(h.documents.get(userPath).welcomeEmailSent,false);
  assert.equal(h.documents.get(statePath).enrolledAt,undefined);
  assert.equal(h.documents.get(statePath).reminderDueAt,undefined);
});

test('account deletion removes pending lifecycle work and preserves its confirmation email',async t=>{
  const h=harness(t,{[statePath]:enrollment,
    [`emailLifecycleDeliveries/${uid}_welcome-v1`]:{userId:uid,status:'sent'},
    [`spendSummaryEmailQueue/${uid}_week-2026-W42`]:{userId:uid,dueAt:T(day3)},
    [`${userPath}/receipts/one`]:{status:'final'},
  });
  const storage=admin.storage(), auth=admin.auth(), db=admin.firestore();
  const originalBucket=storage.bucket, originalDelete=auth.deleteUser, originalRecursive=db.recursiveDelete;
  const removed=[];
  storage.bucket=()=>({deleteFiles:async options=>{assert.equal(options.prefix,`users/${uid}/`);}});
  auth.deleteUser=async id=>{removed.push(id);};
  db.recursiveDelete=async ref=>{
    await originalRecursive(ref);
    // Simulate work completing after the first collection sweep; the final
    // cleanup must remove it before confirming full account deletion.
    h.documents.set(statePath,{userId:uid,events:[]});
    h.documents.set(`spendSummaryEmailQueue/${uid}_late`,{userId:uid});
  };
  t.after(()=>{storage.bucket=originalBucket;auth.deleteUser=originalDelete;db.recursiveDelete=originalRecursive;});
  const {deleteUserAccount}=require('../lib/account');
  await deleteUserAccount.run({auth:{uid,token:{email}},data:{}});
  assert.deepEqual(removed,[uid]);
  assert.equal([...h.documents.keys()].filter(k=>k===userPath||k.startsWith(userPath+'/')||k.startsWith('emailLifecycle')||k.startsWith('spendSummaryEmailQueue/')).length,0);
  assert.equal(h.requests.length,1);assert.match(h.requests[0].subject,/fully deleted/);
});
