// Native-only synthetic fixture. Explicit empty disposable localhost PG required.
// ANALYTICS_TEST_PG_PORT=<port> node scripts/test_gar_candidate_races.mjs
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const port=Number(process.env.ANALYTICS_TEST_PG_PORT);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Explicit disposable local PG port required');
const clients=Array.from({length:3},()=>new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',
 password:'',ssl:false,connectionTimeoutMillis:3000,application_name:'citrus-disposable-gar-race'}));
const [admin,a,b]=clients,connected=new Set(),witnesses=[],cases=[];
let owned=false,result;
const emptySQL=`SELECT
 (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')+
 (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
 (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
 (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS n`;
try {
 const states=await Promise.allSettled(clients.map(async c=>{
  await c.connect();connected.add(c);
  await c.query("SET statement_timeout='8s'; SET lock_timeout='6s'; SET idle_in_transaction_session_timeout='15s'");
 }));
 for(const state of states) if(state.status==='rejected') throw state.reason;
 assert.equal(Number((await admin.query(emptySQL)).rows[0].n),0,'Refusing nonempty database/fixture roles');
 const root=new URL('../supabase/migrations/',import.meta.url);
 const captures=JSON.parse(await readFile(new URL('captures/2026-09-06_pre_onice_gar_guards.json',root),'utf8'));
 const deps=JSON.parse(await readFile(new URL('captures/2026-09-06_gar_guard_input_dependencies.json',root),'utf8'));
 const views=JSON.parse(await readFile(new URL('captures/2026-09-06_gar_guard_view_dependencies.json',root),'utf8'));
 const funcs=captures.filter(x=>x.signature.startsWith('citrus_rebuild_gar_components(')||x.signature==='citrus_recompute_gar_totals()');
 for(const f of funcs) assert.equal(createHash('md5').update(f.definition).digest('hex'),f.definition_md5);
 const five=funcs.find(x=>x.signature.endsWith('boolean,numeric)'));
 const columns=five.definition.split('insert into public.player_gar_components (')[1].split(')')[0].split(',').map(x=>x.trim());
 const migration=await readFile(new URL('20260906044310_guard_gar_candidate_replacement.sql',root),'utf8');
 // Reuse only the SQL fixture, with a fixed whitelist of substitutions; never
 // execute or import the PGlite harness. Unexpected interpolation fails closed.
 const source=await readFile(new URL('./test_gar_candidate_guard.mjs',import.meta.url),'utf8');
 const match=source.match(/await db\.exec\(`(CREATE ROLE anon;[\s\S]*?)`\);/);
 assert.ok(match,'Synthetic fixture boundary missing');
 let fixture=match[1].replace(/^ CREATE TABLE player_gar_components.*$/m,
  ` CREATE TABLE player_gar_components(${columns.map(c=>`${c} ${['player_id','season'].includes(c)?'int':c.endsWith('_at')?'timestamptz':'numeric'}`).join(',')},total_gar numeric,goals_per_minor numeric);`);
 fixture=fixture.replace("${views.find(x=>x.relation==='player_gar_inputs_by_type').definition}",views.find(x=>x.relation==='player_gar_inputs_by_type').definition)
  .replace("${deps.find(x=>x.kind==='view').definition}",deps.find(x=>x.kind==='view').definition)
  .replace("${deps.find(x=>x.kind==='function').definition}",deps.find(x=>x.kind==='function').definition)
  .replace("${funcs.map(x=>x.definition).join(';')}",funcs.map(x=>x.definition).join(';'));
 assert.ok(!fixture.includes('${'),'Unexpected fixture interpolation');
 await admin.query('BEGIN');
 try {await admin.query(fixture);await admin.query('COMMIT');owned=true;}
 catch(error){await admin.query('ROLLBACK');throw error;}
 await admin.query(migration);
 await a.query('SET ROLE service_role');await b.query('SET ROLE service_role');
 const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));
 assert.equal(new Set(pids).size,3);
 const rebuild=(c,season=2025)=>c.query('SELECT * FROM citrus_rebuild_gar_components($1::int[],100::numeric,25::numeric,true,20::numeric)',[[season]]);
 const totals=c=>c.query('SELECT * FROM citrus_recompute_gar_totals()');
 const settle=promise=>promise.then(()=>null,error=>error);
 const snapshot=async({client=admin,math=false,other=false}={})=>(await client.query(
  `SELECT to_jsonb(c)${math?"-'updated_at'-'calculated_at'":''} row FROM player_gar_components c
   ${other?'WHERE season<>2025':''} ORDER BY season,player_id`)).rows;
 async function blocked(scenario,table,mode){
  const deadline=Date.now()+3000;
  while(Date.now()<deadline){
   const {rows:[state]}=await admin.query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'schema',n.nspname,'mode',l.mode)),'[]'::jsonb)
     FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE l.pid=$1 AND NOT l.granted) waiting_locks
    FROM pg_stat_activity WHERE pid=$1`,[pids[2]]);
   if(state.wait_event_type==='Lock'&&state.blockers.includes(pids[1])&&
      state.waiting_locks.some(l=>l.schema==='public'&&l.table===table&&l.mode===mode)){
    witnesses.push({scenario,blocker_pid:pids[1],...state});return;
   }
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error(`Missing independent exact relation-lock witness: ${scenario}`);
 }
 async function rejected(query,pattern){
  const before=await snapshot();await assert.rejects(b.query(query),pattern);assert.deepEqual(await snapshot(),before);
 }
 await rebuild(a,2024);await rebuild(a);
 const baseline=await snapshot({math:true}),otherBefore=await snapshot({other:true});
 for(const [table,bad,good,where,pattern] of [
  ['raw_shots','xg_v5=NULL','xg_v5=.5','season=2025',/source missing or invalid/],
  ['player_toi_by_state','toi_seconds=NULL','toi_seconds=1800',"season=2025 AND state='PP'",/source exposure/]
 ]){
  // Correction commits are seen by the queued statement after its SHARE lock.
  await admin.query(`UPDATE ${table} SET ${bad} WHERE ${where}`);
  await a.query('BEGIN');await a.query(`UPDATE ${table} SET ${good} WHERE ${where}`);
  let pending=settle(rebuild(b));
  await blocked(`${table}: correction commit`,table,'ShareLock');
  await a.query('COMMIT');assert.equal(await pending,null);
  assert.deepEqual(await snapshot({math:true}),baseline);
  cases.push(`${table} correction commit is reflected without stale-snapshot rejection`);
  // Committed invalid input must reject without touching any previous output.
  const before=await snapshot();
  await a.query('BEGIN');await a.query(`UPDATE ${table} SET ${bad} WHERE ${where}`);
  pending=settle(rebuild(b));await blocked(`${table}: invalid commit`,table,'ShareLock');
  await a.query('COMMIT');assert.match((await pending)?.message??'',pattern);
  assert.deepEqual(await snapshot(),before);
  await admin.query(`UPDATE ${table} SET ${good} WHERE ${where}`);
  cases.push(`${table} invalid commit rejects with exact output/timestamp preservation`);
  // Uncommitted invalid rows must not leak through a rollback.
  await a.query('BEGIN');await a.query(`UPDATE ${table} SET ${bad} WHERE ${where}`);
  pending=settle(rebuild(b));await blocked(`${table}: source rollback`,table,'ShareLock');
  await a.query('ROLLBACK');assert.equal(await pending,null);
  assert.deepEqual(await snapshot({math:true}),baseline);
  cases.push(`${table} rollback retains valid prior math`);
  await a.query('BEGIN');await rebuild(a);
  pending=settle(b.query(`UPDATE ${table} SET ${good} WHERE ${where}`));
  await blocked(`${table}: writer waits behind rebuild`,table,'RowExclusiveLock');
  await a.query('COMMIT');assert.equal(await pending,null);
 }
 await a.query('BEGIN');await rebuild(a);
 let pending=settle(b.query('UPDATE player_gar_components SET updated_at=updated_at WHERE season=2024'));
 await blocked('output writer waits behind rebuild','player_gar_components','RowExclusiveLock');
 await a.query('COMMIT');assert.equal(await pending,null);cases.push('output writer serialized');
 await a.query('BEGIN');await rebuild(a);pending=settle(rebuild(b));
 await blocked('second rebuild waits behind first','player_gar_components','ShareRowExclusiveLock');
 await a.query('COMMIT');assert.equal(await pending,null);
 assert.deepEqual(await snapshot({math:true}),baseline);assert.deepEqual(await snapshot({other:true}),otherBefore);
 cases.push('second rebuild serialized; nonselected season rows and timestamps exact');
 // Explicit totals is still global, but serializes with the guarded rebuild.
 await a.query('BEGIN');await totals(a);
 const afterGlobalOthers=await snapshot({client:a,other:true});
 pending=settle(rebuild(b));
 await blocked('rebuild waits behind standalone totals','player_gar_components','ShareRowExclusiveLock');
 await a.query('COMMIT');assert.equal(await pending,null);
 assert.deepEqual(await snapshot({other:true}),afterGlobalOthers);
 await a.query('BEGIN');await rebuild(a);pending=settle(totals(b));
 await blocked('standalone totals waits behind rebuild','player_gar_components','ShareRowExclusiveLock');
 await a.query('COMMIT');assert.equal(await pending,null);
 assert.deepEqual(await snapshot({math:true}),baseline);cases.push('standalone totals serialized in both directions');
 // Required-rate rejection remains atomic after the concurrency exercises.
 await admin.query("UPDATE player_onice_xg SET xgf_flurry=NULL WHERE season=2025 AND state='PP'");
 await rejected('SELECT * FROM citrus_rebuild_gar_components(ARRAY[2025],100,25,true,20)',/required rates/);
 result={status:'passed',postgres:(await admin.query('SHOW server_version')).rows[0].server_version,
  independentConnections:3,backendPids:pids,lockWitnesses:witnesses,cases,
  migrationSha256:createHash('sha256').update(migration).digest('hex'),
  mathEquivalence:'exact JSON numeric values excluding successful-run timestamps; all failure/nonselected snapshots exact',
  limitations:['synthetic recorded inputs only','not source completeness/model calibration/production load proof',
   'native races cover five-argument builder and standalone totals; four-argument formula/guards covered in isolated harness']};
} finally {
 await Promise.allSettled([...connected].map(c=>c.query('ROLLBACK')));
 await Promise.allSettled([a,b].map(c=>c.end()));
 try{
  if(owned){
   await admin.query(`DROP FUNCTION citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric);
    DROP FUNCTION citrus_rebuild_gar_components(integer[],numeric,numeric,boolean);
    DROP FUNCTION citrus_recompute_gar_totals(); DROP FUNCTION citrus_goals_per_minor();
    DROP VIEW player_gar_inputs; DROP VIEW player_gar_inputs_by_type; DROP FUNCTION citrus_game_type(bigint);
    DROP TABLE player_gar_components,player_penalty_events,player_toi_by_state,player_onice_xg,player_game_stats,raw_shots;
    REVOKE USAGE ON SCHEMA public FROM service_role,authenticated,anon;
    DROP ROLE service_role; DROP ROLE authenticated; DROP ROLE anon;`);
   assert.equal(Number((await admin.query(emptySQL)).rows[0].n),0,'Fixture cleanup residue');
   if(result) result.cleanup='verified: zero public objects, fixture roles, or user schemas';
  }
 }finally{await admin.end();}
}
console.log(JSON.stringify(result));
