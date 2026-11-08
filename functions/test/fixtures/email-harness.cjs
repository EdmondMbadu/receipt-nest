const assert=require('node:assert/strict');
const admin=require('firebase-admin');

module.exports=function emailHarness(t,initial={}) {
  if(!admin.apps.length)admin.initializeApp({projectId:'demo-email-tests'});
  const db=admin.firestore(),storage=admin.storage();
  const documents=new Map(Object.entries(initial)),files=new Map();
  const get=(data,key)=>key.split('.').reduce((value,part)=>value?.[part],data);
  const materialize=value=>{
    if(value?.isEqual?.(admin.firestore.FieldValue.serverTimestamp()))return admin.firestore.Timestamp.now();
    if(Array.isArray(value))return value.map(materialize);
    if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,materialize(v)]));
    return value;
  };
  const update=(path,data)=>{
    const result=structuredCopy(documents.get(path));
    for(const [key,raw]of Object.entries(data)){
      const parts=key.split('.');let target=result;
      for(const part of parts.slice(0,-1))target=target[part]||= {};
      if(raw?.isEqual?.(admin.firestore.FieldValue.delete()))delete target[parts.at(-1)];
      else target[parts.at(-1)]=materialize(raw);
    }
    documents.set(path,result);
  };
  function structuredCopy(value){if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,structuredCopy(v)]));return value;}
  const snapshot=path=>({id:path.split('/').at(-1),ref:doc(path),exists:documents.has(path),data:()=>structuredCopy(documents.get(path)),get:key=>get(documents.get(path),key)});
  const doc=path=>({path,id:path.split('/').at(-1),parent:collection(path.split('/').slice(0,-1).join('/')),
    get:async()=>snapshot(path),collection:name=>collection(path+'/'+name),
    create:async data=>{if(documents.has(path))throw Object.assign(new Error('exists'),{code:6});documents.set(path,materialize(data));},
    set:async data=>documents.set(path,materialize(data)),update:async data=>update(path,data),delete:async()=>documents.delete(path)});
  const collection=(path,filters=[],max=Infinity)=>({path,parent:path.includes('/')?{id:path.split('/').at(-2)}:null,
    doc:id=>doc(path+'/'+id),where:(key,op,value)=>{assert.equal(op,'==');return collection(path,[...filters,[key,value]],max);},limit:n=>collection(path,filters,n),
    count:()=>({get:async()=>({data:()=>({count:[...documents.keys()].filter(p=>p.startsWith(path+'/')&&p.split('/').length===path.split('/').length+1).length})})}),
    add:async data=>{const ref=doc(path+'/generated-'+documents.size);await ref.create(data);return ref;},
    get:async()=>{const docs=[...documents.keys()].filter(p=>p.startsWith(path+'/')&&p.split('/').length===path.split('/').length+1&&filters.every(([key,v])=>get(documents.get(p),key)===v)).slice(0,max).map(snapshot);return{docs,empty:!docs.length,size:docs.length};}});
  let tail=Promise.resolve();
  const runTransaction=callback=>{
    const pending=tail.then(async()=>{
      const writes=[];const result=await callback({get:async ref=>{assert.equal(writes.length,0);return snapshot(ref.path);},
        set:(ref,data)=>writes.push(()=>ref.set(data)),update:(ref,data)=>writes.push(()=>update(ref.path,data)),delete:ref=>writes.push(()=>ref.delete())});
      for(const write of writes)await write();return result;
    });tail=pending.catch(()=>{});return pending;
  };
  for(const [key,value]of Object.entries({doc,collection,runTransaction})){const old=db[key];db[key]=value;t.after(()=>{db[key]=old;});}
  const bucket={file:path=>({
    save:async(bytes,options)=>files.set(path,{bytes:Buffer.from(bytes),metadata:options?.metadata||{}}),
    getMetadata:async()=>{if(!files.has(path))throw Object.assign(new Error('missing'),{code:404});return[{...files.get(path).metadata,size:files.get(path).bytes.length}];},
    download:async()=>{if(!files.has(path))throw Object.assign(new Error('missing'),{code:404});return[files.get(path).bytes];},
    delete:async()=>files.delete(path),
  })};
  const oldBucket=storage.bucket;storage.bucket=()=>bucket;t.after(()=>{storage.bucket=oldBucket;});
  return{documents,files,doc,bucket,snapshot};
};
