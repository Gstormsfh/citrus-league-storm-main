// Explicit empty disposable localhost PG17.6 only; caller owns container lifecycle.
// ANALYTICS_TEST_PG_PORT=... node scripts/proof/test_analytics_composed_nightly_native.mjs
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {install,snapshot} from './test_analytics_composed_nightly_fixture.mjs';
const port=Number(process.env.ANALYTICS_TEST_PG_PORT);
const options={legacyRefresh:process.env.ANALYTICS_COMPOSED_LEGACY_REFRESH==='1'};
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Explicit disposable local port required');
const clients=Array.from({length:3},()=>new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password:'',
 ssl:false,connectionTimeoutMillis:3000,application_name:'citrus-composed-nightly-proof'}));
const [admin,a,b]=clients,connected=[],witnesses=[],cases=[];let owned=false,boundary,result,failure;
const residue=`SELECT (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN('public','information_schema') AND nspname !~ '^pg_')+
 (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
 (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
 (SELECT count(*) FROM pg_roles WHERE rolname IN('anon','authenticated','service_role')) AS n`;
const settle=p=>p.then(r=>({ok:true,rows:r.rows}),e=>({ok:false,code:e.code,message:e.message,detail:e.detail}));
let pending=[];
try {
 for(const c of clients){await c.connect();connected.push(c);await c.query("SET statement_timeout='15s';SET lock_timeout='10s';SET idle_in_transaction_session_timeout='20s'");}
 assert.equal(Number((await admin.query(residue)).rows[0].n),0,'Refusing nonempty target');
 const version=(await admin.query('SHOW server_version')).rows[0].server_version;
 assert.match(version,/^17\.6(?:\s|$)/);
 const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));
 assert.equal(new Set(pids).size,3);
 // Frozen migration has its own transaction; claim only this verified empty
 // disposable namespace before setup so partial setup is still cleaned.
 owned=true;boundary=await install(admin,options);
 const state=()=>snapshot(admin,options);
 const older=()=>admin.query(`SELECT jsonb_agg(row ORDER BY row::text) rows FROM (
 SELECT to_jsonb(t) row FROM player_xg_season t WHERE season=2024 UNION ALL
 SELECT to_jsonb(t) FROM goalie_xg_season t WHERE season=2024 UNION ALL
 SELECT to_jsonb(t) FROM team_xg_season t WHERE season=2024 UNION ALL
 SELECT to_jsonb(t) FROM goalie_gsax_primary t WHERE season=2024) z`);
 const priorSeason=options.legacyRefresh?(await older()).rows:null;
 await a.query('SET ROLE service_role');await b.query('SET ROLE service_role');
 const inspect=async()=> (await admin.query(`SELECT s.pid,s.wait_event_type,s.wait_event,pg_blocking_pids(s.pid) blockers,
 coalesce((SELECT jsonb_agg(jsonb_build_object('kind',l.locktype,'table',c.relname,'mode',l.mode,'granted',l.granted,
 'classid',l.classid,'objid',l.objid,'objsubid',l.objsubid)) FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation WHERE l.pid=s.pid),'[]') locks
 FROM pg_stat_activity s WHERE s.pid=ANY($1::int[]) ORDER BY s.pid`,[pids])).rows;
 async function witness(name,predicate){let last;const deadline=Date.now()+4000;
  while(Date.now()<deadline){last=await inspect();if(predicate(last)){witnesses.push({name,backends:last});return;}
   await new Promise(r=>setTimeout(r,15));}
  throw Object.assign(new Error('Missing exact independent lock witness '+name),{last});}
 const lock=(s,table,mode,granted)=>s.locks.some(l=>l.table===table&&l.mode===mode&&l.granted===granted);
 const gate=(s,granted)=>s.locks.some(l=>l.kind==='advisory'&&Number(l.classid)===60906&&Number(l.objid)===54106&&l.objsubid===2&&l.mode==='ExclusiveLock'&&l.granted===granted);
 await admin.query('BEGIN; LOCK TABLE public.raw_nhl_data IN ACCESS EXCLUSIVE MODE');
 const first=settle(a.query('SELECT nightly_xg_pipeline() result'));pending=[first];
 await witness('actual nightly strength input blocked after protected entry',rows=>{
  const x=rows.find(r=>r.pid===pids[1]);return gate(x,true)&&lock(x,'raw_shots','RowExclusiveLock',true)
   &&lock(x,'raw_nhl_data','AccessShareLock',false)&&x.blockers.includes(pids[0]);});
 const second=settle(b.query('SELECT nightly_xg_pipeline() result'));pending.push(second);
 await witness('second full composed nightly waits before protected DML',rows=>{
  const x=rows.find(r=>r.pid===pids[1]),y=rows.find(r=>r.pid===pids[2]);return gate(x,true)&&gate(y,false)
   &&y.blockers.includes(x.pid)&&!lock(y,'raw_shots','RowExclusiveLock',true);});
 await admin.query('COMMIT');
 const outcomes=await Promise.all(pending);pending=[];assert.ok(outcomes.every(r=>r.ok),JSON.stringify(outcomes));
 assert.match(outcomes[0].rows[0].result,/strength=8 toi=8 onice=8 gar=10/);
 assert.match(outcomes[1].rows[0].result,/strength=0 toi=0 onice=0 gar=10/);
 cases.push({name:'two exact composed nightly calls serialize',outcomes});
 const built=await state();
 assert.equal(built.game_strength_intervals.length,72);assert.equal(built.player_toi_by_state.length,224);
 assert.equal(built.player_onice_xg.length,224);assert.equal(built.player_gar_components.length,10);
 assert.equal(built.xg_rebuild_audit.length,2);
 await a.query('BEGIN');await a.query('SELECT nightly_xg_pipeline()');
 await b.query('BEGIN');
 const writer=settle(b.query('UPDATE raw_shots SET xg_v5=1.5 WHERE id=1'));pending=[writer];
 await witness('independent source correction waits behind composed GAR source SHARE',rows=>{
  const x=rows.find(r=>r.pid===pids[1]),y=rows.find(r=>r.pid===pids[2]);return lock(x,'raw_shots','ShareLock',true)
   &&lock(y,'raw_shots','RowExclusiveLock',false)&&y.blockers.includes(x.pid);});
 await a.query('COMMIT');assert.equal((await writer).ok,true);pending=[];
 await b.query('UPDATE strength_build_state SET onice_built_at=NULL WHERE game_id=2025020001;COMMIT');
 const invalidBefore=await state();
 const invalid=await settle(a.query('SELECT nightly_xg_pipeline()'));
 assert.equal(invalid.ok,false);assert.match(invalid.message,/Invalid or duplicate/);
 assert.deepEqual(await state(),invalidBefore);cases.push({name:'committed invalid source fails without partial outputs/markers/audit',outcome:invalid});
 await b.query('UPDATE raw_shots SET xg_v5=.5 WHERE id=1');
 const repaired=(await a.query('SELECT nightly_xg_pipeline() result')).rows[0];assert.match(repaired.result,/onice=1 gar=10/);
 cases.push({name:'source correction replay restores completed pipeline',result:repaired});
 if(options.legacyRefresh) {
  assert.match(outcomes[0].rows[0].result,/adjusted=4/);
  const adjusted=(await admin.query('SELECT x_adj,y_adj,distance_adj FROM nhl_shots WHERE event_id=1')).rows[0];
  assert.equal(adjusted.x_adj,70);assert.equal(adjusted.y_adj,6);
  assert.ok(Math.abs(adjusted.distance_adj-Math.sqrt(397))<1e-12);
  assert.match(repaired.result,/gsax=2/);
  assert.equal(built.player_xg_season.length,5);assert.equal(built.goalie_xg_season.length,3);
  assert.equal(built.team_xg_season.length,3);assert.equal(built.goalie_gsax_primary.length,3);
  assert.deepEqual((await older()).rows,priorSeason);
  await a.query('BEGIN');await a.query('SELECT nightly_xg_pipeline()');
  await b.query('BEGIN');
  const legacyWriter=settle(b.query('UPDATE nhl_shots SET xg_sql=1.5 WHERE event_id=1'));pending=[legacyWriter];
  await witness('legacy correction blocked behind composed refresh and GSAx source SHARE',rows=>{
   const x=rows.find(r=>r.pid===pids[1]),y=rows.find(r=>r.pid===pids[2]);return lock(x,'nhl_shots','ShareLock',true)
    &&lock(y,'nhl_shots','RowExclusiveLock',false)&&y.blockers.includes(x.pid);});
  await a.query('COMMIT');assert.equal((await legacyWriter).ok,true);pending=[];await b.query('COMMIT');
  const before=await state();const rejection=await settle(a.query('SELECT nightly_xg_pipeline()'));
  assert.equal(rejection.ok,false);assert.match(rejection.message,/missing or invalid probabilities/);
  assert.deepEqual(await state(),before);
  await b.query('UPDATE nhl_shots SET xg_sql=.5 WHERE event_id=1');
  const replay=(await a.query('SELECT nightly_xg_pipeline() result')).rows[0];assert.match(replay.result,/gsax=2/);
  assert.deepEqual((await older()).rows,priorSeason);
  cases.push({name:'actual legacy refresh-to-GSAx rejection/correction preserves all outputs and prior season',rejection,replay});
 }
 result={status:'passed-native-partial-composed-nightly',version,independent_backend_ids:pids,boundary,cases,witnesses,
  options,counts:Object.fromEntries(Object.entries(built).map(([k,v])=>[k,v.length])),full_nightly_acceptance:false};
} catch(error){failure=error;console.error(JSON.stringify({status:'failed',message:error.message,last:error.last,detail:error.detail}));}
finally {
 for(const c of connected){try{await c.query('ROLLBACK');}catch{}}
 await Promise.allSettled(pending);
 if(owned){
  // Empty-target preflight + fixture transaction establish exclusive ownership
  // of every public object here; no other database/schema/container is touched.
  await admin.query('RESET ROLE');
  const functions=(await admin.query("SELECT oid::regprocedure::text signature FROM pg_proc WHERE pronamespace='public'::regnamespace")).rows;
  for(const f of functions)await admin.query(`DROP FUNCTION IF EXISTS public.${f.signature} CASCADE`);
  const objects=(await admin.query("SELECT relname,relkind FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN('r','v','m')")).rows;
  for(const o of objects)await admin.query(`DROP ${o.relkind==='v'?'VIEW':o.relkind==='m'?'MATERIALIZED VIEW':'TABLE'} IF EXISTS public."${o.relname.replaceAll('"','""')}" CASCADE`);
  await a.query('RESET ROLE');await b.query('RESET ROLE');
  const roles=(await admin.query("SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated','service_role')")).rows;
  for(const {rolname} of roles)await admin.query(`DROP OWNED BY ${rolname};DROP ROLE ${rolname}`);
  const left=Number((await admin.query(residue)).rows[0].n);assert.equal(left,0);if(result)result.cleanup_objects_and_roles=left;
 }
 for(const c of connected)await c.end();
}
if(failure)throw failure;
console.log(JSON.stringify(result,null,2));
