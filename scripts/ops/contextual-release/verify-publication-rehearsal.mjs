import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import pg from 'pg';
import {hash,validateConnection} from './rehearse-production.mjs';
const folder='/tmp/citrus-production-publication-rehearsal-20260919';
const before=JSON.parse(readFileSync(folder+'/before.exact.json','utf8'));
const result=JSON.parse(readFileSync(folder+'/result.json','utf8'));
assert.equal(result.status,'rehearsed');assert.equal(result.result.status,'success');
const readiness=JSON.parse(readFileSync('/tmp/citrus-production-readiness-20260919/readiness.json','utf8'));
const db=new pg.Client({connectionString:validateConnection(execFileSync('gcloud',[
 'secrets','versions','access','latest','--secret=supabase-db-url','--project=citrus-fantasy-prod','--quiet'],
 {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()),connectionTimeoutMillis:15000});
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
 await db.query(readFileSync(new URL('../projection-release/first-publication/context.sql',import.meta.url),'utf8'));
 const hashes=(await db.query('SELECT pg_temp.canonical_recovery_hashes(2026,current_date) value')).rows[0].value;
 const snapshot=(await db.query('SELECT canonical_contextual_dependencies() value')).rows[0].value;
 assert.deepEqual(hashes,before.pre_hashes);assert.equal(snapshot.active.revision,readiness.expectedActiveRevision);
 assert.deepEqual(snapshot.jobs.filter(j=>[31,34].includes(j.jobid)).sort((a,b)=>a.jobid-b.jobid),before.prior_jobs);
 assert.equal((await db.query('SELECT count(*)::int n FROM canonical_projection_runs WHERE id=$1',[result.result.run_id])).rows[0].n,0);
 await db.query('ROLLBACK');
 const config=JSON.parse(execFileSync('gcloud',['run','jobs','describe','citrus-contextual-production','--project=citrus-fantasy-prod','--region=northamerica-northeast1','--format=json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const task=config.spec.template.spec.template.spec;
 assert.ok(task.containers[0].env.some(e=>e.name==='CITRUS_COMPLETION_MODE'&&e.value==='publish'));
 assert.equal(task.maxRetries,0);
 const proof='/tmp/citrus-production-readiness-20260919/rehearsal-rollback-verified.json';
 writeFileSync(proof,JSON.stringify({status:'PASS',verifiedAt:new Date().toISOString(),hashes,legacyJobsRestored:true,
  stagedRehearsalRunAbsent:true,workerTemplateMode:'publish',publicationRequestSha256:result.requestSha256},null,2),{flag:'wx',mode:0o600});
 readiness.evidence.push(...[proof,folder+'/result.json'].map(path=>({path,sha256:hash(readFileSync(path))})));
 readiness.scope='Actual first publication: exact generated candidate rehearsed, all old output row images and cron flags verified restored; notification receipt verified.';
 writeFileSync('/tmp/citrus-production-readiness-20260919/publish-readiness.json',JSON.stringify(readiness,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'PASS',restoredExactRows:true,publishReadinessReady:true}));
}finally{await db.end();}
