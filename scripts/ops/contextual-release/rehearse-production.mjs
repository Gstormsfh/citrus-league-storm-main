// Production diagnostics only. This executable has no commit/install mode.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
export const PROJECT='iezwazccqqrhrjupxzvf';
export const PATCHES=[
 ['20260919022717_canonical_preparation_rpc_timeout.sql','4568771b71420285f366543c6c5a8041c0d057afdb5eaa1b437167e48991e85a'],
 ['20260919025248_canonical_linear_preparation_assembly.sql','061edea689d2b3986e373c54875987c9b525bb906f5bdfc0c2516ce98712a7ba'],
 ['20260919033351_canonical_direct_context_materialization.sql','9fb4f5868341bf36a607a569ac68748b60356c40f00ad59865c43fdd8a336023']];
export const hash=x=>createHash('sha256').update(x).digest('hex');
const names=['canonical_prepare_projection_refresh','canonical_prepare_staged_source_refresh',
 'canonical_apply_bound_finishing','canonical_materialize_projection_run'];
const definitions=`SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,
 pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef security_definer
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY($1) ORDER BY p.oid::regprocedure::text`;
const state=`SELECT jsonb_build_object(
 'active',(SELECT jsonb_agg(to_jsonb(a) ORDER BY season) FROM canonical_projection_active a),
 'runs',(SELECT count(*) FROM canonical_projection_runs),
 'daily',(SELECT md5(string_agg(to_jsonb(p)::text,E'\n' ORDER BY season,player_id,game_id)) FROM player_projected_stats p),
 'ros',(SELECT md5(string_agg(to_jsonb(p)::text,E'\n' ORDER BY season,player_id)) FROM player_ros_projections p),
 'cron',(SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'active',active) ORDER BY jobid) FROM cron.job)
 ) snapshot`;
export function validateConnection(value){
 const url=new URL(value);
 assert.ok(url.hostname===`db.${PROJECT}.supabase.co`||
  (url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username)===`postgres.${PROJECT}`),'Wrong database target');
 return value;
}
export function loadPatches(){return PATCHES.map(([name,expected])=>{
 const sql=readFileSync(new URL('./reviewed/'+name,import.meta.url),'utf8');
 assert.equal(hash(sql),expected,'Reviewed SQL changed');return {name,sha256:expected,sql};
});}
export async function rehearse(db,patches,expectedRun){
 assert.match(expectedRun,/^[0-9a-f-]{36}$/);
 const snapshot=async()=>(await db.query(state)).rows[0].snapshot;
 const functions=async()=>(await db.query(definitions,[names])).rows;
 let original,originalFunctions,receipt;
 await db.query('BEGIN');
 try{
  await db.query("SET LOCAL statement_timeout='180s';SET LOCAL lock_timeout='5s'");
  await db.query('SELECT pg_advisory_xact_lock(724811,2026)');
  assert.equal((await db.query('SELECT count(*)::int n FROM draft_freeze_blockers(4,6)')).rows[0].n,0,'Draft freeze active');
  await db.query('LOCK TABLE canonical_projection_active,player_ros_projections,player_projected_stats IN SHARE ROW EXCLUSIVE MODE');
  original=await snapshot();originalFunctions=await functions();assert.equal(originalFunctions.length,4);
  assert.equal(original.active.find(a=>a.season===2026)?.run_id,expectedRun,'Active source changed');
  const revision=(await db.query('SELECT revision FROM canonical_projection_runs WHERE id=$1',[expectedRun])).rows[0]?.revision;
  assert.match(revision??'',/^[a-f0-9]{64}$/);
  const preparedBefore=(await db.query('SELECT canonical_prepare_projection_refresh(2026,$1)::text exact',[revision])).rows[0].exact;
  await db.query('SELECT canonical_materialize_projection_run($1)',[expectedRun]);
  await db.query("CREATE TEMP TABLE expected_daily ON COMMIT DROP AS SELECT to_jsonb(p)-'projection_id' row FROM player_projected_stats p;CREATE TEMP TABLE expected_ros ON COMMIT DROP AS SELECT to_jsonb(p) row FROM player_ros_projections p");
  for(const patch of patches)await db.query(patch.sql);
  const installed=await functions();
  for(let i=0;i<installed.length;i++){
   const {definition:a,...left}=originalFunctions[i],{definition:b,...right}=installed[i];
   assert.deepEqual(right,left,'Function access metadata changed');assert.notEqual(a,b);
  }
  const preparedAfter=(await db.query('SELECT canonical_prepare_projection_refresh(2026,$1)::text exact',[revision])).rows[0].exact;
  assert.equal(preparedAfter,preparedBefore,'Preparation changed numerical/policy bytes');
  await db.query('SELECT canonical_materialize_projection_run($1)',[expectedRun]);
  const parity={};
  for(const [kind,table,expression] of [['daily','player_projected_stats',"to_jsonb(p)-'projection_id'"],['ros','player_ros_projections','to_jsonb(p)']]){
   parity[kind]=(await db.query(`WITH actual AS MATERIALIZED(SELECT ${expression} row FROM ${table} p),delta AS
    ((SELECT row FROM actual EXCEPT ALL SELECT row FROM expected_${kind}) UNION ALL
     (SELECT row FROM expected_${kind} EXCEPT ALL SELECT row FROM actual))
    SELECT (SELECT count(*)::int FROM actual) rows,count(*)::int differences FROM delta`)).rows[0];
   assert.equal(parity[kind].differences,0,'Whole-row parity: '+kind);
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM draft_freeze_blockers(4,6)')).rows[0].n,0,'Draft freeze changed');
  const after=await snapshot();assert.deepEqual(after.active,original.active);assert.deepEqual(after.cron,original.cron);assert.equal(after.runs,original.runs);
  receipt={status:'PASS',project:PROJECT,rolledBack:true,checkedAt:new Date().toISOString(),
   expectedRun,original,originalFunctions,installedFunctions:installed,parity,
   preparationSha256:hash(preparedBefore),patches:patches.map(({sql,...p})=>p)};
 }finally{await db.query('ROLLBACK');}
 if(original)assert.deepEqual(await snapshot(),original,'Rollback did not restore exact outputs/cron/history');
 if(originalFunctions)assert.deepEqual(await functions(),originalFunctions,'Rollback did not restore exact definitions');
 return receipt;
}
async function main(){
 const [out,expectedRun]=process.argv.slice(2);assert.ok(out&&!existsSync(out),'New private evidence directory required');
 const patches=loadPatches();
 const db=new pg.Client({connectionString:validateConnection(execFileSync('gcloud',[
  'secrets','versions','access','latest','--secret=supabase-db-url','--project=citrus-fantasy-prod','--quiet'],
  {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()),connectionTimeoutMillis:15000});
 try{
  await db.connect();const receipt=await rehearse(db,patches,expectedRun);
  mkdirSync(out,{recursive:true,mode:0o700});writeFileSync(out+'/receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:receipt.status,rolledBack:true,parity:receipt.parity,preparationSha256:receipt.preparationSha256}));
 }finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{
 console.error(JSON.stringify({status:'FAILED',type:e.name,code:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:undefined}));process.exitCode=1;
});
