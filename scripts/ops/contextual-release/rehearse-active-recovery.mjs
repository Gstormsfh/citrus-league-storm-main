// Runs a rollback-only exercise against the existing active production run.
// No new forecast, publication, persistent cron change or commit mode.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {validateConnection,hash,PROJECT} from './rehearse-production.mjs';
const [out,expectedRun]=process.argv.slice(2);
assert.ok(out&&!existsSync(out),'New evidence directory required');
assert.match(expectedRun??'',/^[a-f0-9-]{36}$/);
const helpers=readFileSync(new URL('../projection-release/first-publication/context.sql',import.meta.url),'utf8');
const capture=readFileSync(new URL('./capture-active.sql',import.meta.url),'utf8');
const restore=readFileSync(new URL('./restore-active.sql',import.meta.url),'utf8');
const db=new pg.Client({connectionString:validateConnection(execFileSync('gcloud',[
 'secrets','versions','access','latest','--secret=supabase-db-url','--project=citrus-fantasy-prod','--quiet'],
 {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()),connectionTimeoutMillis:15000});
const snapshot=async()=>(await db.query(`SELECT jsonb_build_object(
 'hashes',pg_temp.canonical_recovery_hashes(2026,current_date),'schema',pg_temp.canonical_recovery_schema(),
 'runs',(SELECT count(*) FROM canonical_projection_runs),
 'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j)) value`)).rows[0].value;
try{
 await db.connect();await db.query(helpers);const original=await snapshot();
 await db.query('BEGIN');let receipt;
 try{
  await db.query("SET LOCAL statement_timeout='180s';SET LOCAL lock_timeout='5s'");
  await db.query('CREATE TEMP TABLE recovery_request(payload jsonb) ON COMMIT DROP');
  const inserted=await db.query(`INSERT INTO recovery_request SELECT jsonb_build_object(
   'run_id',r.id,'revision',r.revision,'expected_active_run_id',r.id)
   FROM canonical_projection_runs r JOIN canonical_projection_active a ON a.run_id=r.id
   WHERE a.season=2026 AND r.id=$1`,[expectedRun]);
  assert.equal(inserted.rowCount,1,'Expected active run changed');
  await db.query(capture);
  // Existing materializer only; exercises exact row restoration including UUIDs.
  await db.query('SELECT canonical_materialize_projection_run($1)',[expectedRun]);
  await db.query('SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobid IN(31,34) ORDER BY jobid');
  await db.query(`UPDATE recovery_bundle SET payload=payload||jsonb_build_object(
   'post_hashes',pg_temp.canonical_recovery_hashes(2026,current_date),
   'post_jobs',(SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'active',active) ORDER BY jobid) FROM cron.job WHERE jobid IN(31,34)));
   DELETE FROM recovery_request;INSERT INTO recovery_request SELECT payload FROM recovery_bundle`);
  await db.query(restore);assert.deepEqual(await snapshot(),original,'Restoration changed data, history, access or jobs');
  receipt={status:'PASS',project:PROJECT,checkedAt:new Date().toISOString(),expectedRun,rolledBack:true,
   scope:'same-run production row-image restoration; distinct-run CAS covered by local PostgreSQL fixtures',
   captureSha256:hash(capture),restoreSha256:hash(restore),helperSha256:hash(helpers),hashes:original.hashes,
   schemaSha256:hash(JSON.stringify(original.schema)),cronSha256:hash(JSON.stringify(original.jobs))};
 }finally{await db.query('ROLLBACK');}
 assert.deepEqual(await snapshot(),original,'Outer rollback changed production');
 mkdirSync(out,{mode:0o700,recursive:true});writeFileSync(out+'/receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:receipt.status,rolledBack:true,hashes:receipt.hashes,scope:receipt.scope}));
}catch(e){console.error(JSON.stringify({status:'FAILED',type:e.name,code:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:undefined}));process.exitCode=1;}
finally{await db.end();}
