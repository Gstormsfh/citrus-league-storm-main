import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {validateConnection,hash} from './rehearse-production.mjs';
const sql=readFileSync(new URL('../../../supabase/migrations/20260919044611_contextual_worker_operational_health.sql',import.meta.url),'utf8');
const db=new pg.Client({connectionString:validateConnection(execFileSync('gcloud',[
 'secrets','versions','access','latest','--secret=supabase-db-url','--project=citrus-fantasy-prod','--quiet'],
 {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()),connectionTimeoutMillis:15000});
try{
 await db.connect();await db.query('BEGIN');
 try{
  await db.query(sql);await db.query('SET LOCAL ROLE service_role');
  const snapshot=(await db.query('SELECT canonical_contextual_dependencies() value')).rows[0].value;
  assert.ok(snapshot.jobs.length===7&&snapshot.runs.length>0&&snapshot.active.revision);
  const started=Date.now(),health=(await db.query('SELECT canonical_contextual_output_health() value')).rows[0].value;
  assert.ok(Number(health.skaters.skaters)>0&&Number(health.goalies.goalies)>0);
  await db.query('RESET ROLE');
  for(const role of ['anon','authenticated']){
   await db.query('SAVEPOINT access_check');await db.query('SET LOCAL ROLE '+role);
   await assert.rejects(db.query('SELECT canonical_contextual_dependencies()'),e=>e.code==='42501');
   await db.query('ROLLBACK TO SAVEPOINT access_check');
  }
  const publicFns=(await db.query("SELECT prosecdef FROM pg_proc WHERE oid IN('canonical_contextual_dependencies()'::regprocedure,'canonical_contextual_output_health()'::regprocedure)")).rows;
  assert.ok(publicFns.length===2&&publicFns.every(r=>r.prosecdef===false));
  console.log(JSON.stringify({status:'PASS',rollbackOnly:true,migrationSha256:hash(sql),healthQueryMs:Date.now()-started,
   activeRevision:snapshot.active.revision,skaters:health.skaters.skaters,goalies:health.goalies.goalies,
   currentOutputsContextual:health.skaters.all_contextual,serviceOnly:true}));
 }finally{await db.query('ROLLBACK');}
 assert.equal((await db.query("SELECT to_regprocedure('canonical_contextual_dependencies()') value")).rows[0].value,null);
}catch(e){console.error(JSON.stringify({status:'FAILED',type:e.name,code:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:undefined}));process.exitCode=1;}
finally{await db.end();}
