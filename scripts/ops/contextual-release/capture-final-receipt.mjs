// Read-only closure evidence for the actual Scheduler-invoked production run.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import pg from 'pg';
import {hash,validateConnection} from './rehearse-production.mjs';
import {reviewCoverage} from './review-coverage.mjs';
const out='/tmp/citrus-production-closeout-20260919';mkdirSync(out,{mode:0o700});
const revision='2a12d68a25f0fd45134a9ca457e3c7a8c4ab81d61239f46f2f183a608e234883';
const cloud=JSON.parse(readFileSync('/tmp/citrus-production-scheduled-audit-20260919/cloud-receipt.json'));
assert.equal(cloud.revision,revision);assert.equal(cloud.finalStatus,'success');assert.ok(cloud.completionMilliseconds<55000);
const db=new pg.Client({connectionString:validateConnection(execFileSync('gcloud',[
 'secrets','versions','access','latest','--secret=supabase-db-url','--project=citrus-fantasy-prod','--quiet'],
 {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()),connectionTimeoutMillis:15000});
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const snapshot=(await db.query('SELECT canonical_contextual_dependencies() value')).rows[0].value;
 const health=(await db.query('SELECT canonical_contextual_output_health() value')).rows[0].value;
 assert.equal(snapshot.active.revision,revision);assert.equal(snapshot.active.last_refresh_status,'success');
 const legacy=snapshot.jobs.filter(j=>[31,34].includes(j.jobid));assert.equal(legacy.length,2);assert.ok(legacy.every(j=>j.active===false));
 for(const [family,count] of [['skaters','skaters'],['goalies','goalies']]){
  const h=health[family];assert.ok(Number(h[count])>0&&Number(h.daily_rows)>0);assert.equal(Number(h.distinct_revisions),1);
  for(const key of ['matching_output_players','daily_ros_revision_matches','active_revision_matches'])assert.equal(h[key],true);
  for(const [key,value] of Object.entries(h)){
   if(key.startsWith('all_')||key==='optional_plus_minus_coverage_matches')assert.equal(value,true,key);
   if(key.startsWith('maximum_'))assert.ok(value!==null&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1e-7,key);
  }
 }
 await db.query('COMMIT');
 const execution=JSON.parse(execFileSync('gcloud',['run','jobs','executions','describe','citrus-contextual-production-nmh2k','--project=citrus-fantasy-prod','--region=northamerica-northeast1','--format=json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.equal(execution.status.succeededCount,1);assert.ok(execution.status.completionTime);
 const logs=JSON.parse(execFileSync('gcloud',['logging','read','resource.type="cloud_run_job" AND resource.labels.job_name="citrus-contextual-monitor" AND jsonPayload.event="contextual.independent.health"','--project=citrus-fantasy-prod','--limit=1','--format=json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.equal(logs[0].jsonPayload.healthy,true);assert.equal(logs[0].jsonPayload.phase,'published');assert.equal(logs[0].jsonPayload.revision,revision);
 assert.ok(Date.now()-Date.parse(logs[0].timestamp)<360000);
 const source=JSON.parse(readFileSync('/tmp/citrus-production-final-edition-20260919/source.json'));
 const policy=JSON.parse(readFileSync('/tmp/citrus-production-overlay-20260919-v2/production-policy.json'));
 const receipt={status:'PASS',scope:'Production Scheduler invocation, protected publication, exact output and independent monitoring; paid buyer acceptance not included',
  capturedAt:new Date().toISOString(),publicationReady:false,active:snapshot.active,legacyJobs:legacy,health,
  execution:{name:execution.metadata.name,start:execution.status.startTime,end:execution.status.completionTime,succeededCount:execution.status.succeededCount},
  completionMilliseconds:cloud.completionMilliseconds,independentMonitor:logs[0].jsonPayload,
  paidWindowReview:reviewCoverage(source,policy,'2026-09-30T05:59:59Z')};
 writeFileSync(out+'/receipt.json',JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
 for(const [name,path] of Object.entries({cloud:'/tmp/citrus-production-scheduled-audit-20260919/cloud-receipt.json',population:'/tmp/citrus-production-scheduled-population-20260919.json',
  publication:'/tmp/citrus-production-publication-20260919/result.json',readiness:'/tmp/citrus-production-readiness-20260919/publish-readiness.json',
  email:'/tmp/citrus-production-readiness-20260919/email-receipt.json'})){
  const raw=readFileSync(path);writeFileSync(out+'/'+name+'.json',raw,{flag:'wx',mode:0o600});
 }
 console.log(JSON.stringify({status:'PASS',revision,receiptSha256:hash(readFileSync(out+'/receipt.json')),out}));
}finally{await db.end();}
