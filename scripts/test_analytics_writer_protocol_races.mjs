// Native proof only. Explicit empty disposable localhost PostgreSQL required.
// ANALYTICS_TEST_PG_PORT=<port> node scripts/test_analytics_writer_protocol_races.mjs
// Caller owns exact Docker container lifecycle; this harness owns SQL fixtures.
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const port=Number(process.env.ANALYTICS_TEST_PG_PORT);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Explicit disposable local PG port required');
const clients=Array.from({length:3},()=>new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password:'',
 ssl:false,connectionTimeoutMillis:3000,application_name:'citrus-disposable-protocol-races'}));
const [admin,a,b]=clients,connected=new Set(),witnesses=[],cases=[];let owned=false,result;
let pendingCalls=[],lastPolls=[],originalFailure;
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

 const protocolPredecessors=JSON.parse(await readFile(new URL('../supabase/migrations/captures/2026-09-06_analytics_writer_protocol_rollback.json',import.meta.url),'utf8'));
 const protocolMigration=await readFile(new URL('../supabase/migrations/20260906054106_coordinate_analytics_writer_entry_locks.sql',import.meta.url),'utf8');
 // Remove only incompatible synthetic return signatures before full-set install.
 await admin.query('DROP FUNCTION citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric),refresh_xg_season_layer(integer)');
 for(const row of protocolPredecessors) {
  assert.equal(createHash('md5').update(row.definition).digest('hex'),row.definition_md5);
  await admin.query(row.definition+';');
 }
 const acl=async()=>(await admin.query("SELECT oid::regprocedure::text AS signature,proacl::text,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1")).rows;
 const beforeACL=await acl();
 await admin.query(protocolMigration);await admin.query(protocolMigration);
 assert.deepEqual((await acl()).filter(r=>r.signature!=='analytics_enter_writer_protocol()'),beforeACL);
 for(const row of protocolPredecessors) {
  const desired=row.definition.replace(/\nbegin\n/i,m=>m+'  PERFORM public.analytics_enter_writer_protocol();\n');
  assert.equal((await admin.query('SELECT pg_get_functiondef($1::regprocedure) AS d',[row.signature])).rows[0].d,desired);
 }
 cases.push('all sixteen exact entry definitions instrumented; ACL/security preserved; migration replay succeeds');
 // Reinstall explicitly labeled synthetic unrelated dependencies for orchestration.
 // Exact protocol-instrumented nightly/scorer/onice batch/onice guard remain intact.
 const composedSource=await readFile(new URL('./test_nightly_composed_locks.mjs',import.meta.url),'utf8');
 const syntheticSQL=composedSource.match(/await admin\.query\(`([\s\S]*?)`\);/)[1];
 // Exact production parameter names/return shapes differ from these explicit
 // stubs. Drop only the known stub-replaced signatures before recreation.
 await admin.query(`DROP FUNCTION xg_shot_empty_net(text,boolean,boolean),citrus_game_type(integer),
  xg_v5(text,float8,float8,boolean,boolean,int,int,boolean,boolean,float8,float8,int,smallint),
  citrus_repair_shift_clocks(integer),citrus_build_strength_batch(integer),citrus_build_toi_batch(integer),
  citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric),
  apply_rink_adjustment_live(integer),score_xg_sql_v2(integer),refresh_xg_season_layer(integer),
  rebuild_goalie_gsax_primary(),rebuild_goalie_gsax_primary(integer),record_rebuild_audit(integer,text,bigint,bigint,text)`);
 for(const match of syntheticSQL.matchAll(/CREATE FUNCTION[\s\S]*?\$s\$[\s\S]*?\$s\$;/g))
  await admin.query(match[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
   .replace('rebuild_goalie_gsax_primary()','rebuild_goalie_gsax_primary(p_season integer DEFAULT 2025)'));

 const inspect=async pid=>(await admin.query(`SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('type',l.locktype,'classid',l.classid,'objid',l.objid,
    'objsubid',l.objsubid,'table',c.relname,'mode',l.mode,'granted',l.granted)),'[]'::jsonb)
   FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation WHERE l.pid=$1) AS locks
  FROM pg_stat_activity WHERE pid=$1`,[pid])).rows[0];
 async function witness(scenario,predicate) {
  const until=Date.now()+3000;
  while(Date.now()<until) {
   const left=await inspect(pids[1]),right=await inspect(pids[2]);
   lastPolls.push({scenario,left,right});if(lastPolls.length>8)lastPolls.shift();
   if(predicate(left,right)){witnesses.push({scenario,left,right});return;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Missing protocol witness: '+scenario);
 }
 const gate=(s,granted)=>s.locks.some(l=>l.type==='advisory'&&Number(l.classid)===60906
  &&Number(l.objid)===54106&&l.objsubid===2&&l.mode==='ExclusiveLock'&&l.granted===granted);
 const blockedGate=(x,y)=>gate(x,true)&&gate(y,false)&&y.blockers.includes(x.pid);
 const run=c=>c.query('SELECT nightly_xg_pipeline() AS result');
 const outcome=p=>p.then(r=>({status:'success',rows:r.rows}),e=>({status:'error',code:e.code,message:e.message,detail:e.detail}));
 const snapshot=async()=>(await admin.query('SELECT to_jsonb(t) AS row FROM player_onice_xg t ORDER BY game_id,player_id,state')).rows;
 const markers=async()=>(await admin.query('SELECT * FROM strength_build_state ORDER BY game_id')).rows;
 await a.query("SET citrus.test_barrier='1'");await b.query("SET citrus.test_barrier='2'");
 await admin.query('SELECT pg_advisory_lock(60906,1)');
 const first=outcome(run(a));pendingCalls=[first];
 await witness('first nightly holds protocol before scorer/barrier',(x)=>gate(x,true)&&x.wait_event==='advisory');
 const second=outcome(run(b));pendingCalls.push(second);
 await witness('second nightly blocked before source writer', (x,y)=>blockedGate(x,y)
  &&!y.locks.some(l=>l.table==='raw_shots'&&l.mode==='RowExclusiveLock'&&l.granted));
 await admin.query('SELECT pg_advisory_unlock(60906,1)');
 const outcomes=await Promise.all(pendingCalls);assert.ok(outcomes.every(o=>o.status==='success'));
 assert.ok((await markers())[0].onice_built_at);cases.push('two composed nightly calls serialize without upgrade deadlock');
 await a.query('BEGIN');await a.query('SELECT * FROM citrus_score_v5_batch(50000)');
 const before=await snapshot();
 const builder=outcome(b.query('SELECT rebuild_onice_xg(ARRAY[2025020001])'));pendingCalls=[builder];
 await witness('direct scorer composition serializes independent direct builder',blockedGate);
 await a.query('SELECT rebuild_onice_xg(ARRAY[2025020001])');await a.query('COMMIT');
 assert.equal((await builder).status,'success');
 assert.deepEqual((await snapshot()).map(r=>({...r.row,built_at:null})),before.map(r=>({...r.row,built_at:null})));
 cases.push('manual scorer then builder shares transaction gate; competing direct builder waits');
 for(const sql of ['UPDATE raw_shots SET xg_v5=xg_v5 WHERE id=1',
   'SELECT * FROM raw_shots FOR UPDATE','LOCK TABLE raw_shots IN SHARE MODE',
   'UPDATE player_onice_xg SET built_at=built_at WHERE game_id=2025020001']) {
  await a.query('BEGIN');await a.query('SELECT analytics_enter_writer_protocol()');
  await b.query('BEGIN');await b.query(sql);
  const prior=await snapshot(),priorMarkers=await markers();
  await assert.rejects(b.query('SELECT rebuild_onice_xg(ARRAY[2025020001])'),/Unsupported prior protected locks/);
  await b.query('ROLLBACK');assert.deepEqual(await snapshot(),prior);assert.deepEqual(await markers(),priorMarkers);
  const s=await inspect(pids[2]);assert.ok(!gate(s,true)&&!gate(s,false));
  await a.query('ROLLBACK');
 }
 cases.push('prior source/output row/write/strong locks reject before waiting for occupied gate');
 await b.query('BEGIN; SELECT analytics_enter_writer_protocol(); UPDATE raw_shots SET xg_v5=xg_v5 WHERE id=1');
 await b.query('SELECT rebuild_onice_xg(ARRAY[2025020001])');await b.query('ROLLBACK');
 cases.push('supported explicit protocol then DML then nested builder succeeds');
 await b.query('BEGIN; SELECT pg_advisory_xact_lock_shared(60906,54106)');
 await assert.rejects(b.query('SELECT analytics_enter_writer_protocol()'),/prior analytics protocol lock mode/);await b.query('ROLLBACK');
 await admin.query('UPDATE strength_build_state SET onice_built_at=NULL');
 const failureBefore=await snapshot(),failureMarkers=await markers();
 await admin.query('UPDATE raw_shots SET time_in_period=NULL WHERE id=1');
 await assert.rejects(run(a),/Invalid or duplicate/);
 assert.deepEqual(await snapshot(),failureBefore);assert.deepEqual(await markers(),failureMarkers);
 cases.push('failed composed source guard preserves prior outputs and markers');
 result={status:'passed',postgres:(await admin.query('SHOW server_version')).rows[0].server_version,
  independentConnections:3,backendPids:pids,lockWitnesses:witnesses,cases,outcomes,
  protocolMigrationSha256:createHash('sha256').update(protocolMigration).digest('hex'),
  exactRuntimeFunctions:['protocol nightly','protocol official scorer','protocol onice batch','protocol guarded onice'],
  limitations:['cooperating protocol only; arbitrary SQL can acquire advisory key','other runtime dependencies are explicitly synthetic',
   'all16 definition/ACL instrumentation verified separately; not full model integration','global serialization may block long batch work']};
} catch(error) {
 originalFailure=error;
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
   await admin.query(`DROP FUNCTION IF EXISTS analytics_enter_writer_protocol(),
      citrus_rebuild_gar_components(integer[],numeric,numeric,boolean),citrus_recompute_gar_totals(),
      rebuild_strength_intervals(integer[]),rebuild_toi_by_state(integer[]),rebuild_goalie_gsax_primary(integer),
      nightly_xg_pipeline(),citrus_score_v5_batch(integer),citrus_repair_shift_clocks(integer),
      citrus_build_strength_batch(integer),citrus_build_toi_batch(integer),
      citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric),
      apply_rink_adjustment_live(integer),score_xg_sql_v2(integer),refresh_xg_season_layer(integer),
      rebuild_goalie_gsax_primary(),record_rebuild_audit(integer,text,bigint,bigint,text),
      xg_shot_empty_net(text,boolean,boolean),citrus_game_type(integer),
      xg_v5(text,float8,float8,boolean,boolean,int,int,boolean,boolean,float8,float8,int,smallint),
      citrus_build_onice_batch(integer),rebuild_onice_xg(integer[]),citrus_rebound_window(integer);
    DROP TABLE IF EXISTS nhl_game_arena,nhl_shots,strength_build_state,shift_ingest_quality,player_onice_xg,rebound_window_era,
      game_strength_intervals,game_teams,player_shifts_official,raw_shots;
    DROP ROLE IF EXISTS service_role; DROP ROLE IF EXISTS authenticated; DROP ROLE IF EXISTS anon;`);
   assert.equal(Number((await admin.query(residueSQL)).rows[0].n),0,'Fixture cleanup residue');
   if(result) result.cleanup='verified: zero public objects, fixture roles, or user schemas';
  }
 } catch(cleanupError) {
  console.error(JSON.stringify({status:'cleanup_failed',message:cleanupError.message,originalError:originalFailure?.message}));
  if(!originalFailure) throw cleanupError;
 } finally {await admin.end();}
}
console.log(JSON.stringify(result));
