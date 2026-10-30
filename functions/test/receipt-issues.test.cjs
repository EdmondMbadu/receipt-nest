const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../lib/receipt-issue-policy');
const valid = { totalAmount: 23.5, currency: 'USD', date: '2026-10-20', merchant: { canonicalName: 'Corner Market', matchedBy: 'ai' }, category: { id: 'groceries', name: 'Groceries', assignedBy: 'ai' } };

test('normal processing stays out of the queue; uploaded and processing receipts become stuck at ten minutes', () => {
  for (const status of ['uploaded', 'processing']) {
    const data = { status, createdAt: 1000, updatedAt: 1000 };
    assert.equal(policy.diagnoseReceipt(data, 600999), null);
    assert.equal(policy.diagnoseReceipt(data, 601000).kind, 'stuck');
    assert.equal(policy.diagnoseReceipt({ ...data, skipProcessing: true }, 9999999), null);
  }
});
test('failures, partial extractions, and older review receipts receive evidence-based diagnoses', () => {
  assert.equal(policy.diagnoseReceipt({ status: 'needs_review' }).kind, 'incomplete');
  assert.equal(policy.diagnoseReceipt({ ...valid, status: 'final' }), null);
  assert.equal(policy.diagnoseReceipt({ ...valid, date: '', status: 'final', processingAttempt: {state: 'succeeded'} }).reason, 'Missing date');
  assert.equal(policy.diagnoseReceipt({ status: 'needs_review', processingAttempt: { state: 'failed', reason: 'Service unavailable', cause: 'service_error' } }).kind, 'failed');
  assert.equal(policy.processingFailure(new Error('429 quota'), 'extraction').code, 'rate_limit');
  assert.equal(policy.processingFailure(new Error('secret payload'), 'file').reason, 'The original file could not be opened');
  assert.equal(policy.processingFailure(new Error('bad JSON with private details'), 'extraction').reason, 'The model returned no usable receipt data');
});
test('retry merging replaces old extraction values, preserves manual values, and respects edits made in flight', () => {
  const initial = { ...valid, extraction: { totalAmount: {value: 23.5}, currency: {value:'USD'}, date:{value:'2026-10-20'} } };
  const proposed = { totalAmount: 28, currency: 'CAD', date: '2026-10-21', merchant: {canonicalName:'New'}, category:{name:'Other'} };
  assert.equal(policy.mergeRetryValues(initial, initial, proposed, true).totalAmount, 28);
  assert.equal(policy.mergeRetryValues(initial, {...initial,totalAmount:99}, proposed, true).totalAmount, undefined);
  const manual = {...initial, totalAmount: 77, merchant:{canonicalName:'Verified',matchedBy:'manual'}, category:{name:'Verified',assignedBy:'user'}};
  const merged = policy.mergeRetryValues(manual, manual, proposed, true);
  assert.equal(merged.totalAmount, undefined); assert.equal(merged.merchant, undefined); assert.equal(merged.category, undefined);
  assert.equal(policy.mergeRetryValues({}, {}, proposed, true).totalAmount, 28);
});

test('admin callables and the processing worker enforce authorization, concurrency, history, and issue lifecycle', async t => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId:'demo-receipt-issues' });
  const db = admin.firestore();
  const originals = Object.fromEntries(['doc','collection','collectionGroup','getAll','runTransaction','recursiveDelete'].map(key => [key,db[key]]));
  t.after(() => { for (const [key,value] of Object.entries(originals)) db[key]=value; });
  const documents = new Map();
  let clock = Date.now();
  const timestamp = () => admin.firestore.Timestamp.fromMillis(++clock);
  const materialize = value => {
    if (value instanceof admin.firestore.Timestamp) return value;
    if (value?.isEqual?.(admin.firestore.FieldValue.serverTimestamp())) return timestamp();
    if (Array.isArray(value)) return value.map(materialize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,materialize(v)]));
    return value;
  };
  const seed = (path,data) => documents.set(path,{data:materialize(data),time:timestamp()});
  const snapshot = path => {
    const saved = documents.get(path);
    return {ref:doc(path),id:path.split('/').at(-1),exists:!!saved,updateTime:saved?.time,data:()=>saved?.data,
      get:key=>key.split('.').reduce((v,k)=>v?.[k],saved?.data)};
  };
  const doc = path => ({path,id:path.split('/').at(-1),parent:collection(path.split('/').slice(0,-1).join('/')),
    get:async()=>snapshot(path),delete:async()=>documents.delete(path),collection:name=>collection(`${path}/${name}`)});
  const collection = (path, group=false, predicate=()=>true, sort=null, max=Infinity) => ({path,id:path.split('/').at(-1),get parent(){return path.includes('/') ? doc(path.split('/').slice(0,-1).join('/')) : null;},
    doc:id=>doc(`${path}/${id}`),select:()=>collection(path,group,predicate,sort,max),
    where:(key,operator,value)=>collection(path,group,data=>predicate(data)&&(operator==='in'?value.includes(data[key]):data[key]===value),sort,max),
    orderBy:(key,direction)=>collection(path,group,predicate,{key,direction},max),limit:value=>collection(path,group,predicate,sort,value),
    get:async()=>{
      let docs=[...documents.keys()].filter(p=>group?p.split('/').at(-2)===path:p.split('/').slice(0,-1).join('/')===path).map(snapshot).filter(s=>predicate(s.data()));
      if(sort) docs.sort((a,b)=>(policy.millis(a.get(sort.key))-policy.millis(b.get(sort.key)))*(sort.direction==='desc'?-1:1));
      docs=docs.slice(0,max);return {docs,size:docs.length};
    }});
  db.doc=doc;db.collection=path=>collection(path);db.collectionGroup=path=>collection(path,true);db.getAll=async(...refs)=>refs.map(ref=>snapshot(ref.path));
  db.recursiveDelete=async ref=>{for(const path of documents.keys())if(path===ref.path||path.startsWith(ref.path+'/'))documents.delete(path);};
  let tail=Promise.resolve();
  db.runTransaction=callback=>{
    const run=tail.then(async()=>{
      const writes=[];
      const result=await callback({get:async ref=>{assert.equal(writes.length,0,'all transaction reads precede writes');return snapshot(ref.path);},
        update:(ref,data)=>writes.push({ref,data,merge:true}),set:(ref,data,options)=>writes.push({ref,data,merge:options?.merge}),create:(ref,data)=>{assert.ok(!documents.has(ref.path));writes.push({ref,data});}});
      for(const write of writes) seed(write.ref.path,{...(write.merge?documents.get(write.ref.path)?.data:{}),...write.data});
      return result;
    });tail=run.catch(()=>{});return run;
  };
  const api=require('../lib/receipt-issues');
  const worker=require('../lib/receipt-processing-state');
  const auth={uid:'admin',token:{admin:true}};
  const path='users/customer/receipts/receipt-1';
  seed('users/customer',{email:'customer@example.com'});
  seed(path,{status:'needs_review',createdAt:timestamp(),updatedAt:timestamp(),file:{originalName:'receipt.jpg'},userId:'customer'});
  const issueRef=worker.issueRefFor('customer','receipt-1');
  let detail=()=>api.getAdminReceiptIssue.run({auth,data:{userId:'customer',receiptId:'receipt-1'}});
  const act=async(action,extra={})=>api.actOnAdminReceiptIssue.run({auth,data:{userId:'customer',receiptId:'receipt-1',revision:(await detail()).revision,cause:'unknown',notes:'Verified against original',action,...extra}});

  await t.test('unsigned and non-admin callers cannot list, read, or change receipt issues',async()=>{
    for(const callable of [api.getAdminReceiptIssues, api.getAdminReceiptIssue, api.getAdminReceiptPreview, api.actOnAdminReceiptIssue]) {
      await assert.rejects(callable.run({data:{}}),{code:'unauthenticated'});
      await assert.rejects(callable.run({auth:{uid:'customer',token:{}},data:{}}),{code:'permission-denied'});
    }
    await assert.rejects(api.getAdminReceiptIssue.run({auth,data:{userId:'customer/other',receiptId:'x'}}),{code:'invalid-argument'});
  });
  await t.test('older review receipts appear without a migration or invented error',async()=>{
    const result=await api.getAdminReceiptIssues.run({auth,data:{}});
    assert.equal(result.rows.length,1);assert.equal(result.rows[0].cause,'unknown');assert.equal(result.rows[0].email,'customer@example.com');
    assert.equal((await detail()).events.length,0);
  });
  await t.test('awaiting-user state persists, missing fields cannot be resolved, malformed corrections are rejected',async()=>{
    await act('awaiting_user');assert.equal((await detail()).row.state,'awaiting_user');
    await assert.rejects(act('resolve'),{code:'failed-precondition'});
    await assert.rejects(act('correct',{values:{...valid,merchant:'Shop',date:'2026-02-30',category:'Other'}}),{code:'invalid-argument'});
    await assert.rejects(act('awaiting_user',{notes:''}),{code:'invalid-argument'});
  });
  let attempt;
  await t.test('concurrent retry requests create one job and duplicate worker delivery does not rerun extraction',async()=>{
    const revision=(await detail()).revision;
    const request={auth,data:{userId:'customer',receiptId:'receipt-1',revision,cause:'service_error',action:'retry',notes:''}};
    const results=await Promise.allSettled([api.actOnAdminReceiptIssue.run(request),api.actOnAdminReceiptIssue.run(request)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    attempt=results.find(x=>x.status==='fulfilled').value.attemptId;
    assert.equal([...documents.keys()].filter(p=>p.startsWith('receiptProcessingJobs/')).length,1);
    const claimed=await worker.claimReceiptAttempt(doc(path),attempt,true);assert.ok(claimed);
    assert.equal(await worker.claimReceiptAttempt(doc(path),attempt,true),null);
    assert.equal(await worker.claimReceiptAttempt(doc(path),'creation-event',false),null);
    await assert.rejects(act('retry'),{code:'failed-precondition'});
  });
  await t.test('successful retries validate fields, close the issue, and retain request and result evidence',async()=>{
    const initial=snapshot(path).data();
    await worker.finishReceiptAttempt(doc(path),attempt,initial,true,{...valid,extraction:{totalAmount:{value:23.5}}});
    const result=await detail();assert.equal(result.row.state,'resolved');assert.equal(result.receipt.status,'final');
    assert.match(result.row.reason,/Missing/,'resolution preserves the failure reason for recurring-problem analysis');
    assert.ok(result.events.some(event=>event.action==='retry_requested'));
    assert.ok(result.events.some(event=>event.action==='retry'&&event.after.totalAmount===23.5));
    assert.equal((await api.getAdminReceiptIssues.run({auth,data:{}})).rows[0].state,'resolved');
  });
  await t.test('manual corrections keep original extraction and capture both field values and root cause',async()=>{
    await act('correct',{cause:'extraction_mistake',values:{...valid,totalAmount:25,merchant:'Verified shop',category:'Groceries',categoryId:'groceries'}});
    const result=await detail();assert.equal(result.receipt.totalAmount,25);assert.equal(result.receipt.extraction.totalAmount.value,23.5);
    const event=result.events.find(event=>event.action==='correct');assert.equal(event.before.totalAmount,23.5);assert.equal(event.after.totalAmount,25);assert.equal(event.cause,'extraction_mistake');
  });
  await t.test('stale completions cannot overwrite a newer attempt or an admin resolution',async()=>{
    const before=snapshot(path).data();
    await worker.finishReceiptAttempt(doc(path),attempt,before,true,{...valid,totalAmount:999});
    assert.equal(snapshot(path).get('totalAmount'),25);
    await act('reopen');assert.equal((await detail()).row.state,'open');
  });
  await t.test('stuck worker leases can be replaced and the old worker result is ignored',async()=>{
    seed(path,{...snapshot(path).data(),status:'processing',processingAttempt:{id:'old',state:'running',startedAt:Date.now()-700000}});
    const initial=snapshot(path).data();const retry=await act('retry');
    await worker.finishReceiptAttempt(doc(path),'old',initial,true,{...valid,totalAmount:1234});
    assert.equal(snapshot(path).get('processingAttempt.id'),retry.attemptId);assert.equal(snapshot(path).get('totalAmount'),25);
  });
  await t.test('failed attempts and incomplete initial extractions stay open with distinct outcomes',async()=>{
    const attemptId=snapshot(path).get('processingAttempt.id');
    const initial=await worker.claimReceiptAttempt(doc(path),attemptId,true);
    await worker.finishReceiptAttempt(doc(path),attemptId,initial,true,{}, {cause:'service_error',reason:'Service unavailable',code:'service_unavailable',stage:'extraction'});
    assert.equal((await detail()).row.kind,'failed');assert.equal((await detail()).row.state,'open');
    const other=doc('users/customer/receipts/partial');seed(other.path,{userId:'customer',status:'uploaded',createdAt:timestamp()});
    const first=await worker.claimReceiptAttempt(other,'initial',false);
    await worker.finishReceiptAttempt(other,'initial',first,false,{totalAmount:10,currency:'USD',merchant:valid.merchant,extraction:{totalAmount:{value:10}}});
    assert.equal(snapshot(other.path).get('status'),'needs_review');
    const result=await api.getAdminReceiptIssue.run({auth,data:{userId:'customer',receiptId:'partial'}});
    assert.equal(result.row.kind,'incomplete');assert.equal(result.row.reason,'Missing date');assert.equal(result.events[0].outcome,'incomplete');
  });
  await t.test('receipt deletion cleans both its issue and private processing history',async()=>{
    assert.ok([...documents.keys()].some(key=>key.startsWith(path+'/processingHistory/')));
    await api.cleanupReceiptIssue.run({params:{userId:'customer',receiptId:'receipt-1'}});
    assert.ok(!documents.has(issueRef.path));assert.ok(![...documents.keys()].some(key=>key.startsWith(path+'/processingHistory/')));
  });
});
