// Exact, read-only production export. A successful export is not buyer acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import pg from 'pg';
import {hash,validateConnection} from './rehearse-production.mjs';
export function verifyEdition(row,expectedRevision){
 assert.match(expectedRevision,/^[a-f0-9]{64}$/);assert.equal(row.season,2026);
 for(const kind of ['runtime','source']){
  const doc=JSON.parse(row[kind]),{revision,...body}=doc;
  assert.equal(hash(row[kind+'_preimage']),revision,'Exact database preimage mismatch');
  assert.deepEqual(JSON.parse(row[kind+'_preimage']),body);
  assert.equal(revision,row[kind+'_revision']);
 }
 const runtime=JSON.parse(row.runtime),source=JSON.parse(row.source);
 assert.equal(runtime.revision,expectedRevision);
 assert.equal(source.revision,'70fd8899e67480cf7cd061a3b88e4a4110bc5a2f27ae756c300f48635fec8255');
 assert.equal(hash(row.source),'361b0c4b183eb17c14d32b65227f45e25676e6b77f675de1a730989f1cb6d1da');
 assert.equal(runtime.source_revision,source.revision);assert.equal(runtime.source_run_id,row.source_run_id);
 assert.equal(runtime.daily_context.status,'validated');assert.equal(row.last_refresh_status,'success');
 return {runtime,source};
}
async function main(){
 const [expectedRevision,out]=process.argv.slice(2);assert.ok(out&&!existsSync(out),'Fresh output directory required');
 const db=new pg.Client({connectionString:validateConnection(execFileSync('gcloud',[
  'secrets','versions','access','latest','--secret=supabase-db-url','--project=citrus-fantasy-prod','--quiet'],
  {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()),connectionTimeoutMillis:15000});
 try{
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout='55s';SET LOCAL ROLE service_role");
  const rows=(await db.query(`SELECT a.season,a.run_id,a.source_run_id,a.activated_at,a.last_refresh_status,
   r.revision runtime_revision,s.revision source_revision,r.payload::text runtime,(r.payload-'revision')::text runtime_preimage,
   s.payload::text source,(s.payload-'revision')::text source_preimage
   FROM canonical_projection_active a JOIN canonical_projection_runs r ON r.id=a.run_id
   JOIN canonical_projection_runs s ON s.id=a.source_run_id WHERE a.season=2026`)).rows;
  assert.equal(rows.length,1);const row=rows[0];verifyEdition(row,expectedRevision);
  await db.query('COMMIT');mkdirSync(out,{mode:0o700});const files={};
  for(const key of ['runtime','runtime_preimage','source','source_preimage']){
   const name=key.replace('_','.')+'.json';writeFileSync(out+'/'+name,row[key],{flag:'wx',mode:0o600});files[name]=hash(row[key]);
  }
  // JSON.parse is suitable for identities, not an exact high-precision decimal
  // comparison. Independently check raw payload/preimage pairs with Decimal.
  execFileSync(process.env.CITRUS_REVIEW_PYTHON||'python3',['-c',
   'import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from raw_json import verify_postgres_revision; root=Path(sys.argv[2]); verify_postgres_revision(root/"runtime.json",root/"runtime.preimage.json",sys.argv[3]); verify_postgres_revision(root/"source.json",root/"source.preimage.json",sys.argv[4])',
   fileURLToPath(new URL('../projection-release/active-run/',import.meta.url)),out,row.runtime_revision,row.source_revision],
   {stdio:['ignore','pipe','pipe'],timeout:30000});
  const receipt={status:'PASS',scope:'Exact production runtime export; customer acceptance pending',publicationReady:false,
   readOnly:true,project:'iezwazccqqrhrjupxzvf',capturedAt:new Date().toISOString(),revision:row.runtime_revision,
   sourceRevision:row.source_revision,runId:row.run_id,sourceRunId:row.source_run_id,activatedAt:row.activated_at,files};
  writeFileSync(out+'/receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(receipt));
 }catch(e){console.error(JSON.stringify({status:'FAILED',type:e.name,code:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:undefined}));process.exitCode=1;}
 finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
