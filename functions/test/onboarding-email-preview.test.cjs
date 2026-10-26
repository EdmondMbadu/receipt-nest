const assert = require('node:assert/strict');
const {test} = require('node:test');
const {installFakeFirestore} = require('./fixtures/fake-firestore.cjs');
const {sendOnboardingTestEmail} = require('../lib/onboarding-email-preview');
const {buildOnboardingEmailMessage} = require('../lib/onboarding-email-message');
const {appendEmailSocialText} = require('../lib/email-social-links');

const sourceId='source-user';
const recipient='test-inbox@example.com';
const request=template=>({auth:{uid:'admin',token:{admin:true}},data:{to:recipient,userId:sourceId,template}});
function setup(t){
  const fake=installFakeFirestore(t,{
    'users/admin':{role:'admin'},
    [`users/${sourceId}`]:{firstName:'Edmond',email:'source@example.com',welcomeEmailSent:true,notificationSettings:{onboardingEmails:false}},
    [`users/${sourceId}/receipts/one`]:{status:'final',totalAmount:42},
    [`emailLifecycleState/${sourceId}`]:{userId:sourceId,reminderStatus:'sent',tips:{original:true}},
    [`emailLifecycleDeliveries/${sourceId}_first-receipt-v1`]:{userId:sourceId,status:'sent'},
  });
  const sg=require('@sendgrid/mail');
  const originalRequest=sg.client.request, originalKey=sg.setApiKey;
  const requests=[];
  sg.setApiKey=()=>{};
  sg.client.request=async request=>{requests.push(JSON.parse(JSON.stringify(request.body)));return [{statusCode:202},{}];};
  const saved=['SENDGRID_API_KEY','APP_BASE_URL'].map(key=>[key,process.env[key]]);
  process.env.SENDGRID_API_KEY='local-only';process.env.APP_BASE_URL='https://receipt-nest.com/';
  t.after(()=>{
    sg.client.request=originalRequest;sg.setApiKey=originalKey;
    for(const[key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });
  return {...fake,requests};
}

for(const template of ['welcome','first-receipt','receipt-shortcut','receipt-help'])test(`${template} admin test uses the production template and never changes source account state`,async t=>{
  const h=setup(t);
  const before=new Map(h.documents);
  const result=await sendOnboardingTestEmail.run({...request(template),data:{...request(template).data,to:'  Test-Inbox@Example.COM  '}});
  assert.equal(h.requests.length,1);assert.equal(result.to,recipient);assert.equal(result.template,template);
  const sent=h.requests[0];
  assert.equal(sent.personalizations[0].to[0].email,recipient);
  assert.equal(sent.personalizations[0].to.length,1);
  assert.equal(sent.from.email,'info@receipt-nest.com');assert.equal(sent.reply_to.name,'ReceiptNest');
  const expected=buildOnboardingEmailMessage(template,'https://receipt-nest.com','Edmond');
  assert.equal(sent.subject,`[Test] ${expected.subject}`);
  assert.equal(sent.content.find(c=>c.type==='text/html').value,expected.html);
  assert.equal(sent.content.find(c=>c.type==='text/plain').value,appendEmailSocialText(expected.text));
  assert.equal((expected.html.match(/id="receiptnest-social-footer"/g)||[]).length,1);
  assert.equal(sent.attachments[0].content_id,'receiptnest-summary-logo');
  assert.equal(sent.attachments[0].content,expected.attachments[0].content);
  assert.ok(expected.html.includes('href="https://receipt-nest.com/unsubscribe"'));
  assert.doesNotMatch(expected.html,/unsubscribe\?token=/);
  assert.ok(!sent.headers?.['List-Unsubscribe'],'test must not unsubscribe the selected source account');
  if(template==='first-receipt')assert.match(expected.html,/Hi Edmond,/);
  assert.deepEqual(h.documents,before,'preview must not write any Firestore data');
});

test('onboarding tests require authentication and admin authorization',async t=>{
  const h=setup(t);
  await assert.rejects(sendOnboardingTestEmail.run({data:request('welcome').data}),{code:'unauthenticated'});
  await assert.rejects(sendOnboardingTestEmail.run({auth:{uid:'normal-user',token:{}},data:request('welcome').data}),{code:'permission-denied'});
  assert.equal(h.requests.length,0);
  // Existing admin role profiles remain supported without a custom token claim.
  await sendOnboardingTestEmail.run({auth:{uid:'admin',token:{}},data:request('welcome').data});
  assert.equal(h.requests.length,1);
});

test('invalid recipients, source IDs and templates are rejected before contacting SendGrid',async t=>{
  const h=setup(t);
  const invalid=[{to:''},{to:'not-email'},{to:'one@example.com,two@example.com'},{to:'one,two@example.com'},{to:'one;two@example.com'},
    {to:'Name <one@example.com>'},{to:['one@example.com']},{userId:''},{userId:'other/path'},{userId:null},{template:'month'},{template:undefined},{template:['welcome']}];
  for(const input of invalid)await assert.rejects(sendOnboardingTestEmail.run({auth:request('welcome').auth,data:{...request('welcome').data,...input}}),{code:'invalid-argument'});
  assert.equal(h.requests.length,0);
});

test('missing source accounts and email configuration produce clear errors without state changes',async t=>{
  const h=setup(t);const before=new Map(h.documents);
  await assert.rejects(sendOnboardingTestEmail.run({...request('welcome'),data:{...request('welcome').data,userId:'gone'}}),{code:'not-found'});
  process.env.SENDGRID_API_KEY='';
  await assert.rejects(sendOnboardingTestEmail.run(request('welcome')),{code:'failed-precondition'});
  process.env.SENDGRID_API_KEY='local-only';process.env.APP_BASE_URL='';
  await assert.rejects(sendOnboardingTestEmail.run(request('first-receipt')),{code:'failed-precondition'});
  assert.equal(h.requests.length,0);assert.deepEqual(h.documents,before);
});

test('failed test deliveries do not mark welcome or reminder sent',async t=>{
  const h=setup(t),before=new Map(h.documents);
  require('@sendgrid/mail').client.request=async()=>{throw Object.assign(new Error('provider unavailable'),{response:{statusCode:503}});};
  await assert.rejects(sendOnboardingTestEmail.run(request('welcome')),{code:'internal'});
  assert.deepEqual(h.documents,before);
});
