// Native proof only. Explicit empty disposable localhost PostgreSQL required.
// ANALYTICS_TEST_PG_PORT=<port> node scripts/test_nightly_composed_locks.mjs
// Caller owns exact Docker container lifecycle; this harness owns SQL fixtures.
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const port=Number(process.env.ANALYTICS_TEST_PG_PORT);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Explicit disposable local PG port required');
const clients=Array.from({length:3},()=>new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password:'',
 ssl:false,connectionTimeoutMillis:3000,application_name:'citrus-disposable-nightly-locks'}));
const [admin,a,b]=clients,connected=new Set(),witnesses=[],cases=[];let owned=false,result;
let pendingCalls=[],lastPolls=[];
const residueSQL=`SELECT
 (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')+
 (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
 (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
 (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS n`;
try {
 const states=await Promise.allSettled(clients.map(async c=>{await c.connect();connected.add(c);
  await c.query("SET statement_timeout='8s'; SET lock_timeout='6s'; SET idle_in_transaction_session_timeout='15s'");}));
 for(const state of states) if(state.status==='rejected') throw state.reason;
 assert.equal(Number((await admin.query(residueSQL)).rows[0].n),0,'Refusing nonempty database/fixture roles');
 const capture=await readFile(new URL('../supabase/migrations/captures/2026-09-06_pre_guard_onice_rebuild.sql',import.meta.url),'utf8');
 assert.equal(createHash('md5').update(capture).digest('hex'),'f4ef097e9e3c66a52b0882fc6d130e29');
 const records=JSON.parse(await readFile(new URL('../supabase/migrations/captures/2026-09-06_pre_onice_gar_guards.json',import.meta.url),'utf8'));
 const batch=records.find(r=>r.signature==='citrus_build_onice_batch(integer)');
 assert.equal(createHash('md5').update(batch.definition).digest('hex'),batch.definition_md5);
 const source=await readFile(new URL('./test_onice_rebuild_guard.mjs',import.meta.url),'utf8');
 const match=source.match(/await db\.exec\(`(CREATE ROLE anon;[\s\S]*?)`\);/);
 assert.ok(match,'Synthetic fixture boundary missing');
 assert.equal((match[1].match(/\$\{/g)||[]).length,2);
 assert.ok(match[1].includes('${capture}')&&match[1].includes('${batch.definition}'));
 // Only exact synthetic SQL is reused. No eval/import or PGlite execution.
 const fixture=match[1].replace('${capture}',()=>capture).replace('${batch.definition}',()=>batch.definition);
 await admin.query('BEGIN');
 try {await admin.query(fixture);await admin.query('COMMIT');owned=true;}
 catch(error) {await admin.query('ROLLBACK');throw error;}
 const migration=await readFile(new URL('../supabase/migrations/20260906044353_guard_onice_rebuild_inputs.sql',import.meta.url),'utf8');
 await admin.query(migration);await admin.query(migration);
 await a.query('SET ROLE service_role');await b.query('SET ROLE service_role');
 const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
 assert.equal(new Set(pids).size,3);

 const captures=JSON.parse(await readFile(new URL('../supabase/migrations/captures/2026-09-06_nightly_lock_audit.json',import.meta.url),'utf8'));
 const exact=name=>captures.find(r=>r.signature===name);
 for(const item of captures) assert.equal(createHash('md5').update(item.definition).digest('hex'),item.definition_md5);
 assert.equal(exact('nightly_xg_pipeline()').definition_md5,'d2d83cd96d845d95d9bbe14bf3128471');
 // Explicit synthetic dependencies: only orchestration, scorer SQL, onice batch,
 // and guarded onice attribution execute exact captured/local definitions.
 // Scorer has ZERO eligible rows: helper stubs are resolved but never evaluated.
 await admin.query(`
  ALTER TABLE raw_shots ADD shot_type text, ADD distance float8, ADD angle float8,
   ADD is_rebound boolean, ADD is_home_team boolean, ADD home_skaters_on_ice int,
   ADD away_skaters_on_ice int, ADD is_empty_net boolean, ADD has_pass_before_shot boolean,
   ADD pass_quality_score float8, ADD goalie_movement_score float8;
  CREATE TABLE nhl_shots(game_id int,event_id int,season int,team_id int,is_home boolean,distance float8,xg_sql float8);
  CREATE TABLE nhl_game_arena(game_id int PRIMARY KEY,season int,home_team int);
  ALTER TABLE nhl_shots ENABLE ROW LEVEL SECURITY; ALTER TABLE nhl_game_arena ENABLE ROW LEVEL SECURITY;
  INSERT INTO nhl_shots VALUES(2025020001,1,2025,10,true,20,.2);
  CREATE FUNCTION xg_shot_empty_net(text,boolean,boolean) RETURNS boolean LANGUAGE plpgsql AS $s$
   BEGIN RAISE EXCEPTION 'Synthetic scorer helper must not execute'; END $s$;
  CREATE FUNCTION citrus_game_type(integer) RETURNS smallint LANGUAGE plpgsql AS $s$
   BEGIN RAISE EXCEPTION 'Synthetic scorer helper must not execute'; END $s$;
  CREATE FUNCTION xg_v5(text,float8,float8,boolean,boolean,int,int,boolean,boolean,float8,float8,int,smallint)
   RETURNS float8 LANGUAGE plpgsql AS $s$
   BEGIN RAISE EXCEPTION 'Synthetic scorer helper must not execute'; END $s$;
  CREATE FUNCTION citrus_repair_shift_clocks(integer) RETURNS TABLE(out_pattern text,out_repaired int,out_games int)
   LANGUAGE plpgsql AS $s$ BEGIN
    PERFORM pg_advisory_xact_lock_shared(60906,current_setting('citrus.test_barrier')::integer); RETURN;
   END $s$;
  CREATE FUNCTION citrus_build_strength_batch(integer) RETURNS TABLE(processed int,remaining bigint)
   LANGUAGE sql AS $s$ SELECT 0,0::bigint $s$;
  CREATE FUNCTION citrus_build_toi_batch(integer) RETURNS TABLE(processed int,remaining bigint)
   LANGUAGE sql AS $s$ SELECT 0,0::bigint $s$;
  CREATE FUNCTION citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric)
   RETURNS TABLE(out_players bigint) LANGUAGE sql AS $s$ SELECT 0::bigint $s$;
  CREATE FUNCTION apply_rink_adjustment_live(integer) RETURNS bigint LANGUAGE sql AS $s$ SELECT 0::bigint $s$;
  CREATE FUNCTION score_xg_sql_v2(integer) RETURNS bigint LANGUAGE sql AS $s$ SELECT 0::bigint $s$;
  CREATE FUNCTION refresh_xg_season_layer(integer) RETURNS void LANGUAGE plpgsql AS $s$ BEGIN RETURN; END $s$;
  CREATE FUNCTION rebuild_goalie_gsax_primary() RETURNS TABLE(o_count bigint,o_metric text)
   LANGUAGE sql AS $s$ SELECT 0::bigint,'goalies_written'::text $s$;
  CREATE FUNCTION record_rebuild_audit(integer,text,bigint,bigint,text) RETURNS text
   LANGUAGE sql AS $s$ SELECT 'synthetic audit stub'::text $s$;
  GRANT SELECT,INSERT,UPDATE,DELETE ON nhl_shots,nhl_game_arena TO service_role;
 `);
 await admin.query(exact('citrus_score_v5_batch(integer)').definition+';');
 await admin.query(exact('nightly_xg_pipeline()').definition+';');
 for(const signature of ['citrus_score_v5_batch(integer)','nightly_xg_pipeline()']) {
  assert.equal((await admin.query('SELECT md5(pg_get_functiondef($1::regprocedure)) AS hash',[signature])).rows[0].hash,exact(signature).definition_md5);
 }
 const inspect=async pid=>(await admin.query(`SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'mode',l.mode,'granted',l.granted)),'[]'::jsonb)
   FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE l.pid=$1 AND c.relnamespace='public'::regnamespace) AS relation_locks
  FROM pg_stat_activity WHERE pid=$1`,[pid])).rows[0];
 async function witness(label,predicate) {
  const deadline=Date.now()+3000;
  while(Date.now()<deadline) {
   const left=await inspect(pids[1]),right=await inspect(pids[2]);
   lastPolls.push({label,observed_at:new Date().toISOString(),left,right});
   if(lastPolls.length>12) lastPolls.shift();
   if(predicate(left,right)) {witnesses.push({scenario:label,left,right});return;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Missing composed-lock witness: '+label);
 }
 const snapshot=async()=>(await admin.query('SELECT to_jsonb(t) AS row FROM player_onice_xg t ORDER BY game_id,player_id,state')).rows;
 const markers=async()=>(await admin.query('SELECT * FROM strength_build_state ORDER BY game_id')).rows;
 const before=await snapshot(),beforeMarkers=await markers();
 const lockIdentity=(await admin.query("SELECT 'public.raw_shots'::regclass::oid AS relation_oid,(SELECT oid FROM pg_database WHERE datname=current_database()) AS database_oid")).rows[0];
 await admin.query('SELECT pg_advisory_lock(60906,1),pg_advisory_lock(60906,2)');
 await a.query("RESET ROLE; SET deadlock_timeout='2s'; SET citrus.test_barrier='1'; SET ROLE service_role");
 await b.query("RESET ROLE; SET deadlock_timeout='2s'; SET citrus.test_barrier='2'; SET ROLE service_role");
 const calls=pendingCalls=[a,b].map(c=>c.query('SELECT nightly_xg_pipeline() AS result').then(r=>({status:'success',result:r.rows[0].result}),
  e=>({status:'error',code:e.code,message:e.message,detail:e.detail,where:e.where})));
 const hasLock=(s,mode,granted)=>s.relation_locks.some(l=>l.table==='raw_shots'&&l.mode===mode&&l.granted===granted);
 await witness('both exact nightly/scorer prefixes hold source RowExclusive before guard',
  (x,y)=>x.wait_event==='advisory'&&y.wait_event==='advisory'&&hasLock(x,'RowExclusiveLock',true)&&hasLock(y,'RowExclusiveLock',true));
 await admin.query('SELECT pg_advisory_unlock(60906,1)');
 await witness('first source SHARE upgrade waits on second prefix RowExclusive',
  (x,y)=>x.blockers.includes(y.pid)&&y.wait_event==='advisory'
   &&hasLock(x,'ShareLock',false)
   &&hasLock(x,'RowExclusiveLock',true)&&hasLock(y,'RowExclusiveLock',true));
 await admin.query('SELECT pg_advisory_unlock(60906,2)');
 const outcomes=await Promise.all(calls);
 assert.equal(outcomes.filter(o=>o.status==='error'&&o.code==='40P01').length,1);
 assert.equal(outcomes.filter(o=>o.status==='success').length,1);
 const deadlock=outcomes.find(o=>o.code==='40P01');
 // PostgreSQL can detect a simple upgrade cycle before both waiters are
 // observable by polling. Validate its exact relation/database/PID graph.
 for(const [pid,other] of [[pids[1],pids[2]],[pids[2],pids[1]]]) {
  assert.ok(deadlock.detail.includes(`Process ${pid} waits for ShareLock on relation ${lockIdentity.relation_oid} of database ${lockIdentity.database_oid}; blocked by process ${other}.`),
   'Deadlock DETAIL must prove both exact raw_shots upgrade edges');
 }
 assert.match(deadlock.where,/LOCK TABLE public\.raw_shots IN SHARE MODE/);
 assert.match(deadlock.where,/rebuild_onice_xg/);
 assert.match(deadlock.where,/citrus_build_onice_batch/);
 assert.match(deadlock.where,/nightly_xg_pipeline/);
 witnesses.push({scenario:'server-confirmed exact two-way SHARE upgrade cycle',...lockIdentity,detail:deadlock.detail,where:deadlock.where});
 assert.deepEqual((await snapshot()).filter(r=>r.row.game_id===2024020001),before);
 assert.ok((await markers())[0].onice_built_at);
 assert.equal(beforeMarkers[0].onice_built_at,null);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM player_onice_xg WHERE game_id=2025020001')).rows[0].n,2);
 cases.push('observed deadlock: exactly one 40P01 victim and one committed complete candidate');
 // Whole transaction rollback check through the exact orchestrator: scorer's
 // zero-row UPDATE still precedes a failed guarded onice rebuild.
 await admin.query("UPDATE strength_build_state SET onice_built_at=NULL; UPDATE raw_shots SET time_in_period=NULL WHERE id=1");
 const failureBefore=await snapshot(),failureMarkers=await markers();
 await assert.rejects(a.query('SELECT nightly_xg_pipeline()'),/Invalid or duplicate/);
 assert.deepEqual(await snapshot(),failureBefore);assert.deepEqual(await markers(),failureMarkers);
 cases.push('unguarded exception propagation preserves prior output and completion marker exactly');
 result={status:'passed_expected_deadlock_reproduction',postgres:(await admin.query('SHOW server_version')).rows[0].server_version,
  independentConnections:3,backendPids:pids,lockIdentity,lockWitnesses:witnesses,cases,outcomes,
  exactFunctions:['nightly_xg_pipeline()','citrus_score_v5_batch(integer)','citrus_build_onice_batch(integer)','guarded rebuild_onice_xg(integer[])'],
  syntheticDependencies:['repair function advisory barrier','strength/TOI/GAR/legacy refresh/GSAx/audit no-op dependencies',
   'scorer expression helpers raise if evaluated; scorer intentionally has no eligible rows'],
  migrationSha256:createHash('sha256').update(migration).digest('hex'),
  limitations:['NOT full nightly pipeline integration','does not certify model calculations, corpus coverage or a remediation']};
} catch(error) {
 // Keep actual server deadlock DETAIL and final lock states if a fast deadlock
 // detector resolves a cycle before a polling query can witness both waiters.
 if(connected.has(admin)) await admin.query('SELECT pg_advisory_unlock_all()');
 const outcomes=await Promise.all(pendingCalls);
 console.error(JSON.stringify({status:'failed_witness',error:error.message,lockWitnesses:witnesses,lastPolls,outcomes}));
 throw error;
} finally {
 await Promise.allSettled([...connected].map(c=>c.query('ROLLBACK')));
 await Promise.allSettled([a,b].map(c=>c.end()));
 try {
  await admin.query('SELECT pg_advisory_unlock_all()');
  if(owned) {
   await admin.query(`DROP FUNCTION nightly_xg_pipeline(),citrus_score_v5_batch(integer),citrus_repair_shift_clocks(integer),
      citrus_build_strength_batch(integer),citrus_build_toi_batch(integer),
      citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric),
      apply_rink_adjustment_live(integer),score_xg_sql_v2(integer),refresh_xg_season_layer(integer),
      rebuild_goalie_gsax_primary(),record_rebuild_audit(integer,text,bigint,bigint,text),
      xg_shot_empty_net(text,boolean,boolean),citrus_game_type(integer),
      xg_v5(text,float8,float8,boolean,boolean,int,int,boolean,boolean,float8,float8,int,smallint),
      citrus_build_onice_batch(integer),rebuild_onice_xg(integer[]),citrus_rebound_window(integer);
    DROP TABLE nhl_game_arena,nhl_shots,strength_build_state,shift_ingest_quality,player_onice_xg,rebound_window_era,
      game_strength_intervals,game_teams,player_shifts_official,raw_shots;
    DROP ROLE service_role; DROP ROLE authenticated; DROP ROLE anon;`);
   assert.equal(Number((await admin.query(residueSQL)).rows[0].n),0,'Fixture cleanup residue');
   if(result) result.cleanup='verified: zero public objects, fixture roles, or user schemas';
  }
 } finally {await admin.end();}
}
console.log(JSON.stringify(result));
