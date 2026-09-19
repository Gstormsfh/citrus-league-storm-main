// Append the exact reviewed source without activating it or changing outputs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {hash,validateConnection} from './rehearse-production.mjs';
const [path,expectedActive,mode]=process.argv.slice(2);
assert.ok(['rehearse','stage'].includes(mode));assert.match(expectedActive??'',/^[a-f0-9]{64}$/);
const raw=readFileSync(path,'utf8');assert.equal(hash(raw),'361b0c4b183eb17c14d32b65227f45e25676e6b77f675de1a730989f1cb6d1da');
const db=new pg.Client({connectionString:validateConnection(execFileSync('gcloud',[
 'secrets','versions','access','latest','--secret=supabase-db-url','--project=citrus-fantasy-prod','--quiet'],
 {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()),connectionTimeoutMillis:15000});
let committed=false;
try{
 await db.connect();await db.query('BEGIN');
 await db.query("SET LOCAL statement_timeout='55s';SET LOCAL lock_timeout='5s'");
 await db.query('SELECT pg_advisory_xact_lock(724811,2026)');
 const before=(await db.query('SELECT canonical_contextual_dependencies() value')).rows[0].value;
 assert.equal(before.active.revision,expectedActive);assert.equal(before.draftBlockers,0);
 const id=(await db.query('SELECT canonical_stage_projection_run($1::jsonb) id',[raw])).rows[0].id;
 const report=(await db.query('SELECT canonical_validate_projection_run($1) report',[id])).rows[0].report;
 assert.equal(report.valid,true,'Source validation failed');
 const row=(await db.query('SELECT revision,payload=$2::jsonb exact FROM canonical_projection_runs WHERE id=$1',[id,raw])).rows[0];
 assert.equal(row.revision,'70fd8899e67480cf7cd061a3b88e4a4110bc5a2f27ae756c300f48635fec8255');assert.equal(row.exact,true);
 const after=(await db.query('SELECT canonical_contextual_dependencies() value')).rows[0].value;
 assert.deepEqual(after.active,before.active);assert.deepEqual(after.jobs,before.jobs);
 if(mode==='stage'){await db.query('COMMIT');committed=true;}
 console.log(JSON.stringify({status:mode==='stage'?'STAGED_NOT_ACTIVE':'REHEARSAL_PASS',sourceRun:id,sourceRevision:row.revision,
   exactSourceBytesSha256:hash(raw),valid:report.valid,activeUnchanged:true,cronUnchanged:true}));
}catch(e){console.error(JSON.stringify({status:'FAILED',type:e.name,code:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:undefined}));process.exitCode=1;}
finally{if(!committed)await db.query('ROLLBACK').catch(()=>{});await db.end();}
