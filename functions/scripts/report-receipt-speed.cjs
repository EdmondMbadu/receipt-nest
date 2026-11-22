#!/usr/bin/env node
// Reads JSON exported by gcloud logging read. Prints timing aggregates only.
const fs=require('node:fs');
const rows=JSON.parse(fs.readFileSync(process.argv[2]||0,'utf8'));
if(!Array.isArray(rows))throw new Error('Expected an array of Cloud Logging entries');
const timings=rows.map(row=>row.jsonPayload).filter(row=>row?.message==='Receipt processing timing');
function summarize(values){
  const sorted=values.filter(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const percentile=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
  return{samples:sorted.length,p50Ms:percentile(.5),p90Ms:percentile(.9),p95Ms:percentile(.95),maxMs:sorted.at(-1)};
}
const phases=Object.fromEntries(['eventDeliveryMs','claimMs','filePrepareMs','extractionMs','merchantMs','categoryMs','commitMs','workerMs'].map(key=>[key,summarize(timings.map(row=>row[key]))]));
console.log(JSON.stringify({invocations:timings.length,completed:timings.filter(row=>row.outcome==='completed').length,failed:timings.filter(row=>row.outcome==='failed').length,phases},null,2));
