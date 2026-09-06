// Isolated synthetic SQL proof; not live coverage or multi-connection evidence.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));
const db=new PGlite();let checks=0;
const capture=await readFile(new URL('../supabase/migrations/captures/2026-09-06_pre_guard_onice_rebuild.sql',import.meta.url),'utf8');
const records=JSON.parse(await readFile(new URL('../supabase/migrations/captures/2026-09-06_pre_onice_gar_guards.json',import.meta.url),'utf8'));
const batch=records.find(r=>r.signature==='citrus_build_onice_batch(integer)');
assert.equal(createHash('md5').update(capture).digest('hex'),'f4ef097e9e3c66a52b0882fc6d130e29');checks++;
assert.equal(createHash('md5').update(batch.definition).digest('hex'),batch.definition_md5);checks++;
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE raw_shots(id bigint,game_id int,event_id int,season int,period int,time_in_period text,event_owner_team_id int,
 xg_v5 float8,is_goal boolean,situation_code text,period_type text);
 CREATE TABLE player_shifts_official(game_id int,player_id int,team_id int,period int,shift_start_time_seconds int,shift_end_time_seconds int);
 CREATE TABLE game_teams(game_id int,home_id int,away_id int,season int);
 CREATE TABLE game_strength_intervals(game_id int,period int,start_s int,end_s int,away_goalie int,away_skaters int,home_skaters int,home_goalie int);
 CREATE TABLE rebound_window_era(season_from int,max_gap_s smallint);
 CREATE FUNCTION citrus_rebound_window(p_season int) RETURNS smallint LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT max_gap_s FROM rebound_window_era WHERE season_from<=coalesce(p_season,2025) ORDER BY season_from DESC LIMIT 1),3::smallint) $$;
 CREATE TABLE player_onice_xg(game_id int,player_id int,state text,xgf numeric(9,4),xga numeric(9,4),xgf_flurry numeric(9,4),xga_flurry numeric(9,4),
 cf int,ca int,gf int,ga int,team_id int,season int,built_at timestamptz DEFAULT now(),PRIMARY KEY(game_id,player_id,state));
 CREATE TABLE shift_ingest_quality(game_id int,verdict text);
 CREATE TABLE strength_build_state(game_id int,built_at timestamptz,onice_built_at timestamptz);
 ALTER TABLE raw_shots ENABLE ROW LEVEL SECURITY; ALTER TABLE player_shifts_official ENABLE ROW LEVEL SECURITY;
 ALTER TABLE game_teams ENABLE ROW LEVEL SECURITY; ALTER TABLE game_strength_intervals ENABLE ROW LEVEL SECURITY;
 ALTER TABLE rebound_window_era ENABLE ROW LEVEL SECURITY; ALTER TABLE player_onice_xg ENABLE ROW LEVEL SECURITY;
 ALTER TABLE shift_ingest_quality ENABLE ROW LEVEL SECURITY; ALTER TABLE strength_build_state ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
 ${capture}; ${batch.definition};
 INSERT INTO game_teams VALUES(2025020001,10,20,2025);
 INSERT INTO raw_shots VALUES(1,2025020001,1,2025,1,'01:00',10,.2,false,'1551','REG'),
 (2,2025020001,2,2025,1,'01:02',10,.6,true,'1551','REG'),
 (3,2025020001,3,2025,1,'02:00',20,.3,false,NULL,'REG'),
 (4,2025020001,4,2025,5,NULL,20,NULL,true,NULL,'SO');
 INSERT INTO player_shifts_official VALUES(2025020001,100,10,1,0,120),(2025020001,200,20,1,0,120);
 INSERT INTO game_strength_intervals VALUES(2025020001,1,0,1200,1,5,5,1);
 INSERT INTO rebound_window_era VALUES(2017,3);
 INSERT INTO shift_ingest_quality VALUES(2025020001,'good');
 INSERT INTO strength_build_state VALUES(2025020001,'2025-01-01',NULL);
 INSERT INTO player_onice_xg(game_id,player_id,state,team_id,season,built_at) VALUES(2024020001,900,'5v5',90,2024,'2024-01-01');`);
const metadata=async()=>(await db.query("SELECT proacl::text,prosecdef FROM pg_proc WHERE oid='rebuild_onice_xg(integer[])'::regprocedure")).rows;
const acl=await metadata();
const state=async(math=false)=>(await db.query(`SELECT to_jsonb(t)${math?"-'built_at'":''} AS row FROM player_onice_xg t ORDER BY game_id,player_id,state`)).rows;
const markers=async()=>(await db.query('SELECT * FROM strength_build_state ORDER BY game_id')).rows;
await db.query('SELECT rebuild_onice_xg(ARRAY[2025020001])');const original=await state(true);
const migration=await readFile(new URL('../supabase/migrations/20260906044353_guard_onice_rebuild_inputs.sql',import.meta.url),'utf8');
await db.exec(migration);
const guarded=(await db.query("SELECT pg_get_functiondef('rebuild_onice_xg(integer[])'::regprocedure) AS definition")).rows[0].definition;
assert.equal(createHash('md5').update(guarded).digest('hex'),'3963fa98ce95d3f6db26ae8e38ce8373');
await db.exec(migration);assert.deepEqual(await metadata(),acl);checks++;
await db.exec(guarded.replace('declare n integer;','declare n integer; -- unknown drift')+';');
await assert.rejects(db.exec(migration),/drifted/);await db.exec('ROLLBACK');
assert.notEqual((await db.query("SELECT md5(pg_get_functiondef('rebuild_onice_xg(integer[])'::regprocedure)) AS hash")).rows[0].hash,
 '3963fa98ce95d3f6db26ae8e38ce8373');
await db.exec(guarded+';');checks++;
assert.deepEqual(await metadata(),acl);checks++;
await db.exec('SET ROLE service_role');
await db.query('SELECT rebuild_onice_xg(ARRAY[2025020001])');
assert.deepEqual(await state(true),original);checks++;
for(const name of ['_onice_guard_attributed','_onice_guard_candidate']) {
 await db.exec(`CREATE TEMP TABLE ${name}(marker text); INSERT INTO pg_temp.${name} VALUES('caller data')`);
 const before=await state(),beforeMarkers=await markers();
 await assert.rejects(db.query('SELECT * FROM citrus_build_onice_batch(100)'),/staging name collision/);
 assert.deepEqual((await db.query(`SELECT * FROM pg_temp.${name}`)).rows,[{marker:'caller data'}]);
 assert.deepEqual(await state(),before);assert.deepEqual(await markers(),beforeMarkers);
 await db.exec(`DROP TABLE pg_temp.${name}`);checks++;
}
assert.deepEqual((await db.query("SELECT to_regclass('pg_temp._onice_guard_attributed') AS a,to_regclass('pg_temp._onice_guard_candidate') AS b")).rows[0],{a:null,b:null});
async function rejectMutation(mutation,pattern,call='SELECT rebuild_onice_xg(ARRAY[2025020001])') {
 await db.exec('BEGIN');if(mutation) await db.exec(mutation);
 const before=await state(),beforeMarkers=await markers();
 await db.exec('SAVEPOINT guard_test');await assert.rejects(db.query(call),pattern);
 await db.exec('ROLLBACK TO guard_test');
 assert.deepEqual(await state(),before);assert.deepEqual(await markers(),beforeMarkers);
 await db.exec('ROLLBACK');checks++;
}
for(const games of ['NULL','ARRAY[]::int[]','ARRAY[NULL]::int[]','ARRAY[2025020001,2025020001]','ARRAY[2025010001]','ARRAY[2025020000]'])
 await rejectMutation('',/Explicit unique/,`SELECT rebuild_onice_xg(${games})`);
await rejectMutation('',/team identity/,'SELECT rebuild_onice_xg(ARRAY[2025020001,2025020002])');
await rejectMutation('DELETE FROM raw_shots WHERE period_type<>\'SO\'',/no eligible recorded/);
await rejectMutation('INSERT INTO game_teams VALUES(2025020002,10,20,2025)',/no eligible recorded/,
 'SELECT rebuild_onice_xg(ARRAY[2025020001,2025020002])');
await rejectMutation('UPDATE raw_shots SET id=2 WHERE id=1',/Invalid or duplicate/);
for(const score of ['NULL',"'NaN'","'Infinity'","'-Infinity'",'-0.1','1.1'])
 await rejectMutation(`UPDATE raw_shots SET xg_v5=${score} WHERE id=1`,/Invalid or duplicate/);
for(const change of ["time_in_period=NULL","time_in_period='01:99'","event_id=NULL","event_id=2",'season=2024',
 'event_owner_team_id=30','period=NULL','is_goal=NULL'])
 await rejectMutation(`UPDATE raw_shots SET ${change} WHERE id=1`,/Invalid or duplicate/);
await rejectMutation("UPDATE raw_shots SET time_in_period='20:01' WHERE id=1",/outside period/);
await rejectMutation('DELETE FROM player_shifts_official WHERE player_id=200',/both-team attribution/);
await rejectMutation('DELETE FROM game_strength_intervals',/both-team attribution/);
await rejectMutation('INSERT INTO game_strength_intervals SELECT * FROM game_strength_intervals',/both-team attribution/);
await rejectMutation('UPDATE player_shifts_official SET team_id=30 WHERE player_id=200',/shift identity/);
await rejectMutation('UPDATE game_teams SET season=2024',/team identity/);
await rejectMutation('INSERT INTO game_teams SELECT * FROM game_teams',/team identity/);
await rejectMutation("UPDATE raw_shots SET situation_code='9551' WHERE id=1",/both-team attribution/);
await rejectMutation('UPDATE raw_shots SET xg_v5=NULL WHERE id=1',/Invalid or duplicate/,'SELECT * FROM citrus_build_onice_batch(100)');
await db.exec('BEGIN; UPDATE raw_shots SET xg_v5=0 WHERE id=1; UPDATE raw_shots SET xg_v5=1 WHERE id=2');
await db.query('SELECT rebuild_onice_xg(ARRAY[2025020001])');
assert.equal(Number((await db.query('SELECT xgf FROM player_onice_xg WHERE player_id=100')).rows[0].xgf),1);
await db.exec('ROLLBACK');checks++;
await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
await assert.rejects(db.query('SELECT rebuild_onice_xg(ARRAY[2025020001])'),/READ COMMITTED/);await db.exec('ROLLBACK');checks++;
await db.exec('BEGIN');await db.query('SELECT rebuild_onice_xg(ARRAY[2025020001])');
await db.query('SELECT rebuild_onice_xg(ARRAY[2025020001])');await db.exec('COMMIT');
assert.deepEqual(await state(true),original);checks++;
await db.query('SELECT * FROM citrus_build_onice_batch(100)');assert.ok((await markers())[0].onice_built_at);checks++;
await db.exec('RESET ROLE');
await db.exec(capture+';');assert.deepEqual(await metadata(),acl);
assert.equal((await db.query("SELECT md5(pg_get_functiondef('rebuild_onice_xg(integer[])'::regprocedure)) AS hash")).rows[0].hash,'f4ef097e9e3c66a52b0882fc6d130e29');checks++;
await db.close();console.log(`On-ice guard: ${checks} checks passed (isolated PGlite; not full shift coverage)`);
