const{test}=require('node:test');const assert=require('node:assert/strict');
const harness=require('./fixtures/email-harness.cjs');
const {source}=require('./fixtures/forwarded-transfer.cjs');
const {processStoredEmailPdf,retryForwardedEmailPdf,cleanupForwardedEmailFiles}=require('../lib/email-pdf-worker');
const {inboundEmailWebhook}=require('../lib/email-ingest');

test('forwarded email is archived, extracted without AI and queued immediately; redelivery is idempotent',async t=>{
  const h=harness(t,{'receiptForwardingAliases/customer':{userId:'owner'},'users/owner':{subscriptionPlan:'pro'}});
  process.env.RECEIPT_INBOUND_DOMAIN='inbound.example.com';process.env.EMAIL_INGEST_WEBHOOK_KEY='test-key';
  const req={method:'POST',headers:{'content-type':'application/json'},query:{key:'test-key'},body:{subject:source.subject,from:source.sender,to:'customer@inbound.example.com',html:source.html,text:source.text,'message-id':'<test-transfer@example.com>'}};
  let status,result;const res={status(value){status=value;return this;},json(value){result=value;return this;},send(value){result=value;return this;}};
  await inboundEmailWebhook(req,res);assert.equal(status,200);assert.equal(result.createdReceipts,1);
  const receipts=[...h.documents].filter(([path])=>path.startsWith('users/owner/receipts/'));
  assert.equal(receipts.length,1);const [path,data]=receipts[0];
  assert.equal(data.totalAmount,670.99);assert.equal(data.date,'2026-11-07');assert.equal(data.category.id,'money_transfers');
  assert.equal(data.extraction.source,'email_rules');assert.equal(data.email.renderStatus,'queued');assert.equal(data.file.mimeType,'image/png');
  assert.match(h.files.get(data.email.sourceStoragePath).bytes.toString(),/final footer retained/);
  assert.equal(JSON.parse(h.files.get(data.email.sourceStoragePath).bytes).fields.html,source.html);
  assert.ok(h.files.get(data.file.storagePath).metadata.metadata.firebaseStorageDownloadTokens);
  await inboundEmailWebhook(req,res);assert.equal(result.createdReceipts,0);
  assert.equal([...h.documents.keys()].filter(p=>p.startsWith('users/owner/receipts/')).length,1);
  let renders=0;
  await processStoredEmailPdf(h.doc(path),data.email.renderRequestId,{bucket:h.bucket,freeze:async html=>({html,missingAssets:0}),render:async html=>{renders++;assert.match(html,/final footer retained/);return Buffer.from('%PDF-test');}});
  const ready=h.documents.get(path);assert.equal(ready.email.renderStatus,'ready');assert.equal(ready.file.mimeType,'application/pdf');
  assert.equal(ready.totalAmount,670.99);assert.ok(h.files.get(ready.file.storagePath).metadata.metadata.firebaseStorageDownloadTokens);
  await processStoredEmailPdf(h.doc(path),data.email.renderRequestId,{bucket:h.bucket,freeze:async html=>({html,missingAssets:0}),render:async()=>{renders++;}});
  assert.equal(renders,1);
});

test('worker preserves concurrent manual edits and never replaces an attached invoice',async t=>{
  const path='users/owner/receipts/attachment';const sourcePath='users/owner/receipts/source.json';
  const h=harness(t,{[path]:{totalAmount:600,category:{id:'other'},notes:'before',file:{storagePath:'users/owner/receipts/invoice.pdf'},email:{pipelineVersion:2,ingestMode:'attachment',renderStatus:'queued',renderRequestId:'1234567890abcdef',documentStoragePath:sourcePath}}});
  h.files.set(sourcePath,{bytes:Buffer.from(JSON.stringify(source)),metadata:{}});
  await processStoredEmailPdf(h.doc(path),'1234567890abcdef',{bucket:h.bucket,freeze:async html=>({html,missingAssets:0}),render:async()=>{
    await h.doc(path).update({totalAmount:999,notes:'manual edit',category:{id:'gifts_donations',assignedBy:'user'}});return Buffer.from('%PDF-test');
  }});
  const result=h.documents.get(path);assert.equal(result.totalAmount,999);assert.equal(result.notes,'manual edit');assert.equal(result.category.assignedBy,'user');
  assert.equal(result.file.storagePath,'users/owner/receipts/invoice.pdf');assert.ok(result.email.pdfStoragePath);
});

test('ordinary purchase emails use one AI call, supported source evidence and contextual category',async t=>{
  const h=harness(t,{'receiptForwardingAliases/customer':{userId:'owner'},'users/owner':{subscriptionPlan:'pro'}});
  process.env.RECEIPT_INBOUND_DOMAIN='inbound.example.com';process.env.EMAIL_INGEST_WEBHOOK_KEY='test-key';
  const {VertexAI}=require('@google-cloud/vertexai');const original=VertexAI.prototype.getGenerativeModel;
  let calls=0;
  VertexAI.prototype.getGenerativeModel=()=>({generateContent:async()=>{calls++;return{response:{candidates:[{content:{parts:[{text:JSON.stringify({total:999,merchant:'Café Example',currency:'EUR',date:'2026-11-08',category:'Restaurants & Dining',transactionType:'purchase',totalEvidence:'Grand total | 12,50 EUR',dateEvidence:'Receipt date | 2026-11-07'})}]}}]}};}});
  t.after(()=>{VertexAI.prototype.getGenerativeModel=original;});
  let status,result;const res={status(value){status=value;return this;},json(value){result=value;return this;},send(value){result=value;return this;}};
  await inboundEmailWebhook({method:'POST',headers:{'content-type':'application/json'},query:{key:'test-key'},body:{
    from:'Customer <customer@example.com>',to:'customer@inbound.example.com',subject:'Fwd: Café Example receipt','message-id':'<purchase@example.com>',
    html:'<p>Café Example</p><table><tr><td>Receipt date</td><td>2026-11-07</td></tr><tr><td>Grand total</td><td>12,50 EUR</td></tr></table>',
  }},res);
  assert.equal(status,200);assert.equal(result.createdReceipts,1);assert.equal(calls,1);
  const receipt=[...h.documents].find(([path])=>path.startsWith('users/owner/receipts/'))[1];
  assert.equal(receipt.totalAmount,12.5);assert.equal(receipt.currency,'EUR');assert.equal(receipt.date,'2026-11-07');assert.equal(receipt.category.id,'restaurants');
  assert.equal(receipt.status,'final');assert.equal(receipt.extraction.source,'gemini');
});

test('malformed AI output leaves a reviewable receipt and never invents merchant/currency/date',async t=>{
  const h=harness(t,{'receiptForwardingAliases/customer':{userId:'owner'},'users/owner':{subscriptionPlan:'pro'}});
  process.env.RECEIPT_INBOUND_DOMAIN='inbound.example.com';process.env.EMAIL_INGEST_WEBHOOK_KEY='test-key';
  const {VertexAI}=require('@google-cloud/vertexai');const original=VertexAI.prototype.getGenerativeModel;
  VertexAI.prototype.getGenerativeModel=()=>({generateContent:async()=>({response:{candidates:[{content:{parts:[{text:'null'}]}}]}})});
  t.after(()=>{VertexAI.prototype.getGenerativeModel=original;});
  let status;const res={status(value){status=value;return this;},json(){return this;},send(){return this;}};
  await inboundEmailWebhook({method:'POST',headers:{'content-type':'application/json'},query:{key:'test-key'},body:{from:'Customer <customer@example.com>',to:'customer@inbound.example.com',subject:'Receipt','message-id':'<malformed@example.com>',text:'Total $25.00'}},res);
  assert.equal(status,200);const receipt=[...h.documents].find(([path])=>path.startsWith('users/owner/receipts/'))[1];
  assert.equal(receipt.status,'needs_review');assert.equal(receipt.currency,undefined);assert.equal(receipt.date,undefined);assert.equal(receipt.extraction.supplierName,undefined);
  assert.ok(receipt.email.sourceStoragePath);assert.equal(receipt.email.renderStatus,'queued');
});

test('three failed render attempts stop, retain the archive, and allow only the owner to request a fresh retry',async t=>{
  const path='users/owner/receipts/email';const sourcePath='users/owner/receipts/source.json';
  const h=harness(t,{[path]:{file:{storagePath:'preview.png'},email:{pipelineVersion:2,renderStatus:'queued',renderRequestId:'1234567890abcdef',documentStoragePath:sourcePath}}});
  h.files.set(sourcePath,{bytes:Buffer.from(JSON.stringify(source)),metadata:{}});
  for(let i=0;i<3;i++)await assert.rejects(processStoredEmailPdf(h.doc(path),'1234567890abcdef',{bucket:h.bucket,freeze:async html=>({html,missingAssets:0}),render:async()=>{throw new Error('browser unavailable');}}),/browser unavailable/);
  assert.equal(h.documents.get(path).email.renderStatus,'failed');assert.equal(h.documents.get(path).email.renderAttempts,3);assert.ok(h.files.has(sourcePath));
  await assert.rejects(retryForwardedEmailPdf.run({data:{receiptId:'email'}}),{code:'unauthenticated'});
  await assert.rejects(retryForwardedEmailPdf.run({auth:{uid:'another'},data:{receiptId:'email'}}),{code:'not-found'});
  await retryForwardedEmailPdf.run({auth:{uid:'owner'},data:{receiptId:'email'}});
  assert.equal(h.documents.get(path).email.renderStatus,'queued');assert.equal(h.documents.get(path).email.renderAttempts,0);
  assert.notEqual(h.documents.get(path).email.renderRequestId,'1234567890abcdef');
});

test('foreign archive paths are ignored and deletion during rendering does not recreate the receipt or leave its PDF',async t=>{
  const path='users/owner/receipts/email';const h=harness(t,{[path]:{email:{pipelineVersion:2,renderStatus:'queued',renderRequestId:'1234567890abcdef',documentStoragePath:'users/another/receipts/source.json'}}});
  let calls=0;const dependencies={bucket:h.bucket,freeze:async html=>({html,missingAssets:0}),render:async()=>{calls++;return Buffer.from('%PDF-test');}};
  await processStoredEmailPdf(h.doc(path),'1234567890abcdef',dependencies);assert.equal(calls,0);
  const sourcePath='users/owner/receipts/source.json';h.files.set(sourcePath,{bytes:Buffer.from(JSON.stringify(source)),metadata:{}});
  await h.doc(path).update({'email.documentStoragePath':sourcePath});
  await processStoredEmailPdf(h.doc(path),'1234567890abcdef',{...dependencies,render:async()=>{await h.doc(path).delete();return Buffer.from('%PDF-test');}});
  assert.equal(h.documents.has(path),false);assert.equal([...h.files.keys()].filter(p=>p.endsWith('_email.pdf')||p.endsWith('_email.html')).length,0);
});

test('deleting one attachment keeps the shared email archive until the final receipt is deleted',async t=>{
  const sourcePath='users/owner/receipts/source.json';const email={pipelineVersion:2,sourceStoragePath:sourcePath,documentStoragePath:'users/owner/receipts/document.json',initialHtmlStoragePath:'users/owner/receipts/initial.html',htmlStoragePath:'users/owner/receipts/first_email.html'};
  const h=harness(t,{'users/owner/receipts/second':{email}});
  for(const path of [sourcePath,email.documentStoragePath,email.initialHtmlStoragePath,email.htmlStoragePath])h.files.set(path,{bytes:Buffer.from('test'),metadata:{}});
  await cleanupForwardedEmailFiles.run({params:{userId:'owner',receiptId:'first'},data:{data:()=>({email})}});
  assert.ok(h.files.has(sourcePath));assert.ok(h.files.has(email.initialHtmlStoragePath));assert.equal(h.files.has(email.htmlStoragePath),false);
  h.documents.delete('users/owner/receipts/second');
  await cleanupForwardedEmailFiles.run({params:{userId:'owner',receiptId:'second'},data:{data:()=>({email})}});
  assert.equal(h.files.size,0);
});
