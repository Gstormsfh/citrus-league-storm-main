// Explicit operator entrypoint. Requires a verified prepared attempt, policy,
// external readiness receipts and a fresh private evidence directory.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {atomicPublish} from './atomic-publication.mjs';
import {hash,validateConnection} from './rehearse-production.mjs';
const [attempt,policyPath,readinessPath,out,mode]=process.argv.slice(2);
assert.ok(['rehearse','publish'].includes(mode)&&out&&!existsSync(out));
const cloud=JSON.parse(readFileSync(resolve(attempt,'cloud-receipt.json'),'utf8'));
assert.equal(cloud.status,'PASS');assert.equal(cloud.finalStatus,'prepared');assert.equal(cloud.finalStage,'completion');
assert.match(cloud.execution,/^citrus-contextual-production-[a-z0-9-]+$/);
const exactRequest=readFileSync(resolve(attempt,'completion-request.exact.json'),'utf8');
assert.equal(hash(exactRequest),cloud.files.find(f=>f.name==='completion-request.exact.json').sha256);
const policyRaw=readFileSync(policyPath,'utf8'),policy={...JSON.parse(policyRaw),sha256:hash(policyRaw)};
assert.equal(policy.sha256,'26893b8573829ac1b52f4b9be8284eae416f7d1a0d648b9f2a8fceaa06226bbd');
const readiness=JSON.parse(readFileSync(readinessPath,'utf8'));
assert.ok(Array.isArray(readiness.evidence)&&readiness.evidence.length>=4,'Concrete readiness evidence required');
for(const evidence of readiness.evidence){assert.match(evidence.sha256,/^[a-f0-9]{64}$/);assert.equal(hash(readFileSync(evidence.path)),evidence.sha256);}
mkdirSync(out,{recursive:true,mode:0o700});
function save(name,raw){const path=resolve(out,name);writeFileSync(path,raw,{flag:'wx',mode:0o600});const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}return path;}
const prefix='gs://citrus-fantasy-prod-research-evidence/contextual-worker/production-recovery/'+cloud.execution+'/'+mode+'-'+Date.now()+'/';
async function backup(stage,raw,sha){
 const path=save(stage+'.exact.json',raw),uri=prefix+stage+'.json';
 execFileSync('gcloud',['storage','cp',path,uri,'--if-generation-match=0','--custom-metadata=sha256='+sha,
  '--content-type=application/json','--quiet'],{stdio:['ignore','pipe','pipe'],timeout:120000});
 const downloaded=execFileSync('gcloud',['storage','cat',uri],{stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:256*1024*1024});
 assert.equal(hash(downloaded),sha,'Remote backup readback mismatch');
 const receipt={uri,verifiedSha256:sha,bytes:downloaded.length,verifiedAt:new Date().toISOString()};
 save(stage+'-receipt.json',JSON.stringify(receipt,null,2)+'\n');return receipt;
}
save('intent.json',JSON.stringify({mode,execution:cloud.execution,requestSha256:hash(exactRequest),policySha256:policy.sha256,
 readinessSha256:hash(readFileSync(readinessPath)),operatorSha256:hash(readFileSync(new URL('./atomic-publication.mjs',import.meta.url))),at:new Date().toISOString()},null,2)+'\n');
const db=new pg.Client({connectionString:validateConnection(execFileSync('gcloud',[
 'secrets','versions','access','latest','--secret=supabase-db-url','--project=citrus-fantasy-prod','--quiet'],
 {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()),connectionTimeoutMillis:15000});
try{
 await db.connect();
 const result=await atomicPublish(db,{exactRequest,policy,readiness,backup,commit:mode==='publish'});
 save('result.json',JSON.stringify(result,null,2)+'\n');
 if(mode==='publish'){
  const active=(await db.query('SELECT canonical_contextual_dependencies() value')).rows[0].value;
  assert.equal(active.active.revision,result.result.revision);
  assert.ok(active.jobs.filter(j=>[31,34].includes(j.jobid)).every(j=>j.active===false));
  const event={actor:'operator_atomic_publication',committed:true,stage:'completion',status:'success',
   at:new Date().toISOString(),request_sha256:hash(exactRequest),result:result.result,recovery:result.recoveryReceipt};
  const raw=JSON.stringify(event),path=save('operator-publication.json',raw);
  const uri='gs://citrus-fantasy-prod-research-evidence/contextual-worker/production-attempts/'+cloud.execution+'/operator-publication.json';
  execFileSync('gcloud',['storage','cp',path,uri,'--if-generation-match=0','--custom-metadata=sha256='+hash(raw)+',scope=production-operations',
   '--content-type=application/json','--quiet'],{stdio:['ignore','pipe','pipe'],timeout:60000});
  assert.equal(hash(execFileSync('gcloud',['storage','cat',uri],{stdio:['ignore','pipe','pipe'],timeout:60000})),hash(raw));
 }
 console.log(JSON.stringify({status:result.status,result:result.result,recovery:result.recoveryReceipt}));
}catch(e){
 save('stopped.json',JSON.stringify({status:'STOPPED_INSPECT_SAVED_INTENT_AND_DB_BEFORE_RETRY',type:e.name,
  code:e.code==='COMMIT_UNCERTAIN'?e.code:undefined,at:new Date().toISOString()},null,2)+'\n');
 console.error(JSON.stringify({status:'STOPPED_INSPECT_SAVED_INTENT_AND_DB_BEFORE_RETRY',type:e.name,code:e.code==='COMMIT_UNCERTAIN'?e.code:undefined}));process.exitCode=1;
}finally{await db.end();}
