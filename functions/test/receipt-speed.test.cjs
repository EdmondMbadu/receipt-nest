const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const Module=require('node:module');
const sharp=require('sharp');

test('bootstrap isolates workers while preserving full discovery and other function entry points',()=>{
  for(const target of ['', 'processReceipt','processAdminReceiptRetry','generateAiInsights']){
    const script=`const M=require('node:module'),a=M._load;let calls=[];M._load=function(r,p,m){if(r==='firebase-admin')return{apps:[],initializeApp:()=>calls.push('admin'),firestore:()=>({settings:()=>{}})};if(r==='firebase-functions')return{setGlobalOptions:()=>{}};if(r==='./receipt-processor'){calls.push('worker');return{processReceipt:1,processAdminReceiptRetry:2}};if(r==='./index'){calls.push('all');return{originalExports:3}};return a.apply(this,arguments)};const result=require('./lib/bootstrap');console.log(JSON.stringify({calls,keys:Object.keys(result)}));`;
    const result=spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),encoding:'utf8',env:{...process.env,FUNCTION_TARGET:target}});
    assert.equal(result.status,0,result.stderr);
    const value=JSON.parse(result.stdout.trim());
    if(target.startsWith('process')){assert.deepEqual(value.keys,[target]);assert.deepEqual(value.calls,['admin','worker']);}
    else {assert.deepEqual(value.keys,['originalExports']);assert.deepEqual(value.calls,['all']);}
  }
});

test('worker retains extraction and validation contracts for originals, failures and HEIC conversion',async t=>{
  const admin=require('firebase-admin');
  if(!admin.apps.length)admin.initializeApp({projectId:'demo-receipt-speed',storageBucket:'receipt-nest.firebasestorage.app'});
  const logger=require('firebase-functions').logger;
  const logs=[];
  for(const key of ['info','warn','error']){const old=logger[key];logger[key]=(...args)=>logs.push(args);t.after(()=>logger[key]=old);}
  let current,models=0;
  const originalLoad=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==='@google-cloud/vertexai')return{VertexAI:class{
      constructor(){models++;}
      getGenerativeModel(config){return{generateContent:async request=>{
        current.requests.push({config,request});
        if(current.failStorage&&request.contents[0].parts[0].fileData)throw new Error(current.failStorage);
        if(current.modelError)throw new Error(current.modelError);
        return{response:{candidates:[{content:{parts:[{text:current.response}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}};
      }}};
    }};
    if(request==='./receipt-processing-state'&&parent?.filename.endsWith('receipt-processor.js'))return{
      claimReceiptAttempt:async()=>current.claim===false?null:current.input,
      finishReceiptAttempt:async(ref,id,input,retry,proposed,failure)=>{current.result={proposed,failure};},
    };
    return originalLoad.apply(this,arguments);
  };
  const worker=require('../lib/receipt-processor');
  const legacy=process.env.RECEIPT_LEGACY_MODULE?require(process.env.RECEIPT_LEGACY_MODULE):null;
  Module._load=originalLoad;
  const db=admin.firestore(),storage=admin.storage();
  const oldCollection=db.collection,oldBucket=storage.bucket;
  db.collection=()=>({get:async()=>({docs:[]}),add:async()=>({id:'merchant-created'})});
  storage.bucket=()=>({name:'receipt-nest.firebasestorage.app',file:()=>({download:async()=>{current.downloads++;return[current.bytes];}})});
  t.after(()=>{db.collection=oldCollection;storage.bucket=oldBucket;});
  const normal={total:12.5,merchant:'Corner Cafe',date:'2026-08-14',currency:'USD',category:'Restaurants & Dining'};
  async function run(api,changes={}){
    current={requests:[],downloads:0,bytes:Buffer.from('unchanged original file'),response:JSON.stringify(normal),input:{userId:'u',file:{storagePath:'users/u/receipts/original.jpg',mimeType:'image/jpeg'}},...changes};
    await api.processReceipt.run({id:'attempt',time:new Date().toISOString(),params:{userId:'u',receiptId:'r1'},data:{}});
    return current;
  }
  for(const mime of ['image/jpeg','image/png','image/webp','application/pdf']){
    await t.test(`original ${mime} preserves exact bytes, request and extracted result`,async()=>{
      const input={userId:'u',file:{storagePath:'users/u/receipts/original_1',mimeType:mime}};
      const before=legacy?await run(legacy,{input}):null;
      const after=await run(worker,{input});
      assert.equal(after.downloads,1);assert.equal(after.requests.length,1);
      const request=after.requests[0];
      assert.deepEqual(request.config,{model:'gemini-2.5-flash',generationConfig:{temperature:.1,maxOutputTokens:1024,responseMimeType:'application/json'}});
      assert.deepEqual(request.request.contents[0].parts[0],{inlineData:{mimeType:mime,data:after.bytes.toString('base64')}});
      assert.equal(after.result.failure,undefined);
      assert.equal(after.result.proposed.totalAmount,12.5);assert.equal(after.result.proposed.currency,'USD');assert.equal(after.result.proposed.date,'2026-08-14');
      assert.equal(after.result.proposed.merchant.canonicalName,'Corner Cafe');assert.equal(after.result.proposed.category.id,'restaurants');
      if(before){assert.deepEqual(after.result,before.result);assert.equal(request.request.contents[0].parts[1].text,before.requests[0].request.contents[0].parts[1].text);}
    });
  }
  for(const message of ['429 quota exceeded','GCS read deadline exceeded','503 unavailable'])await t.test(message,async()=>{
    const value=await run(worker,{modelError:message});
    assert.equal(value.requests.length,1);assert.equal(value.downloads,1);assert.ok(value.result.failure);
  });
  for(const response of ['{broken','',JSON.stringify({merchant:'Corner Cafe',date:'2026-08-14',currency:'USD'})])await t.test('partial or malformed extraction preserves the existing result/failure',async()=>{
    const before=legacy?await run(legacy,{response}):null;
    const after=await run(worker,{response});
    assert.equal(after.requests.length,1);assert.equal(after.downloads,1);
    if(before)assert.deepEqual(after.result,before.result);
    else if(response.startsWith('{"merchant'))assert.equal(after.result.proposed.totalAmount,undefined);
    else assert.ok(after.result.failure);
  });
  await t.test('HEIC conversion still yields the same JPEG bytes and settings',async()=>{
    const bytes=await sharp({create:{width:16,height:16,channels:3,background:'white'}}).png().toBuffer();
    const input={userId:'u',file:{storagePath:'users/u/receipts/original.heic',mimeType:'image/heic'}};
    const before=legacy?await run(legacy,{input,bytes}):null;
    const after=await run(worker,{input,bytes});
    assert.equal(after.downloads,1);assert.equal(after.requests.length,1);
    assert.equal(after.requests[0].request.contents[0].parts[0].inlineData.mimeType,'image/jpeg');
    if(before){assert.deepEqual(after.requests[0].request,before.requests[0].request);assert.deepEqual(after.result,before.result);}
  });
  await t.test('invalid HEIC is retained as a conversion failure without invoking a model',async()=>{
    const input={userId:'u',file:{storagePath:'users/u/receipts/broken.heic',mimeType:'image/heic'}};
    const value=await run(worker,{input});assert.equal(value.requests.length,0);assert.equal(value.result.failure.stage,'conversion');
  });
  await t.test('ownership checks and already claimed attempts remain ahead of all file/model access',async()=>{
    let value=await run(worker,{claim:false});assert.equal(value.requests.length,0);assert.equal(value.downloads,0);assert.equal(value.result,undefined);
    value=await run(worker,{input:{userId:'u',file:{storagePath:'users/other/receipts/original.jpg',mimeType:'image/jpeg'}}});
    assert.equal(value.requests.length,0);assert.equal(value.downloads,0);assert.ok(value.result.failure);
  });
  assert.ok(models>0);
  assert.ok(logs.some(([label,fields])=>label==='Receipt processing timing'&&fields.workerMs>=0));
});
