// Isolated recorded-population safeguard; no official coverage/calibration claim.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));
const db=new PGlite();
const hash='4ed76fd708c6ff03c79891241f9dd7ce';
const capture=await readFile(new URL('../supabase/migrations/captures/2026-09-06_pre_guard_xg_season_refresh_inputs.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260906035158_guard_xg_season_refresh_inputs.sql',import.meta.url),'utf8');
let checks=0;
assert.equal(createHash('md5').update(capture).digest('hex'),hash);checks++;
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE nhl_shots(event_id int PRIMARY KEY,game_id int,season int,game_type text,shooter_id int,goalie_id int,team_id int,is_home boolean,
 event_type text,is_goal boolean,xg_sql float8,is_power_play boolean DEFAULT false,is_shorthanded boolean DEFAULT false,is_empty_net boolean DEFAULT false,
 distance_adj float8 DEFAULT 20,prev_event_type text,seconds_since_prev int,is_rush boolean DEFAULT false);
 CREATE TABLE player_xg_season(season int,game_type text,player_id int,team_id int,shots int,sog int,goals int,xg float8,finishing float8,
 shots_ev int,shots_pp int,shots_pk int,goals_ev int,goals_pp int,goals_sh int,xg_ev float8,xg_pp float8,xg_pk float8,goals_en int,xg_en float8,
 avg_dist float8,avg_xg_per_shot float8,rebounds_shot int,rush_shots int,updated_at timestamptz,PRIMARY KEY(season,game_type,player_id,team_id));
 CREATE TABLE goalie_xg_season(season int,game_type text,goalie_id int,team_id int,shots_faced int,sog_faced int,goals_allowed int,xg_faced float8,gsax float8,
 xg_faced_ev float8,goals_allowed_ev int,xg_faced_pk float8,goals_allowed_pk int,avg_shot_dist_faced float8,updated_at timestamptz,PRIMARY KEY(season,game_type,goalie_id,team_id));
 CREATE TABLE team_xg_season(season int,game_type text,team_id int,shots_for int,goals_for int,xg_for float8,shots_against int,goals_against int,xg_against float8,updated_at timestamptz,PRIMARY KEY(season,game_type,team_id));
 ALTER TABLE nhl_shots ENABLE ROW LEVEL SECURITY; ALTER TABLE player_xg_season ENABLE ROW LEVEL SECURITY;
 ALTER TABLE goalie_xg_season ENABLE ROW LEVEL SECURITY; ALTER TABLE team_xg_season ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
 ${capture}; REVOKE ALL ON FUNCTION refresh_xg_season_layer(integer) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION refresh_xg_season_layer(integer) TO service_role;
 INSERT INTO nhl_shots(event_id,game_id,season,game_type,shooter_id,goalie_id,team_id,is_home,event_type,is_goal,xg_sql,is_empty_net) VALUES
 (1,2025020001,2025,'regular',1,20,100,true,'goal',true,.6,false),
 (2,2025020001,2025,'regular',2,10,200,false,'missed-shot',false,0,false),
 (3,2025020001,2025,'regular',1,20,100,true,'shot-on-goal',false,.2,false),
 (4,2025020001,2025,'regular',1,NULL,100,true,'goal',true,1,true),
 (5,2025030001,2025,'playoff',3,10,200,false,'goal',true,.8,false),
 (6,2025030001,2025,'playoff',4,20,100,true,'shot-on-goal',false,.2,false),
 (7,2025020001,2025,'regular',NULL,10,200,false,'shot-on-goal',false,.4,false),
 (8,2024020001,2024,'regular',9,90,900,true,'goal',true,NULL,false);
 INSERT INTO player_xg_season(season,game_type,player_id,team_id,xg,updated_at) VALUES(2024,'regular',9,900,7,'2024-01-01');
 INSERT INTO goalie_xg_season(season,game_type,goalie_id,team_id,xg_faced,updated_at) VALUES(2024,'regular',90,900,7,'2024-01-01');
 INSERT INTO team_xg_season(season,game_type,team_id,xg_for,updated_at) VALUES(2024,'regular',900,7,'2024-01-01');`);
const tables=['player_xg_season','goalie_xg_season','team_xg_season'];
const state=async(full=false)=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t)${full?'':"-'updated_at'"} AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
const acl=async()=>(await db.query("SELECT proacl::text AS acl,prosecdef FROM pg_proc WHERE oid='refresh_xg_season_layer(integer)'::regprocedure")).rows[0];
const beforeAcl=await acl();
await db.query('SELECT * FROM refresh_xg_season_layer(2025)');const original=await state();
await db.exec(migration);assert.deepEqual(await acl(),beforeAcl);checks++;
await db.exec('CREATE TABLE public._sides(marker text); INSERT INTO public._sides VALUES(\'persistent fixture\')');
await db.exec('SET ROLE service_role');
await db.query('SELECT * FROM refresh_xg_season_layer(2025)');assert.deepEqual(await state(),original);checks++;
const {rows:players}=await db.query("SELECT player_id,game_type,shots,sog,goals,xg,goals_en FROM player_xg_season WHERE season=2025 ORDER BY player_id");
assert.deepEqual(players.map(r=>[r.player_id,r.game_type,r.shots,r.sog,r.goals,r.goals_en]),
 [[1,'regular',3,3,2,1],[2,'regular',1,0,0,0],[3,'playoff',1,1,1,0],[4,'playoff',1,1,0,0]]);checks++;
const {rows:[goalie]}=await db.query("SELECT shots_faced,sog_faced,goals_allowed,xg_faced FROM goalie_xg_season WHERE season=2025 AND game_type='regular' AND goalie_id=20");
assert.deepEqual(goalie,{shots_faced:2,sog_faced:2,goals_allowed:1,xg_faced:.8});checks++;
async function rejected(season,pattern) {
 const before=await state(true);
 await assert.rejects(db.query('SELECT * FROM refresh_xg_season_layer($1)',[season]),pattern);
 assert.deepEqual(await state(true),before);checks++;
}
await rejected(null,/Explicit.*season/);await rejected(2026,/empty/);
for(const bad of [null,'NaN','Infinity','-Infinity',-.01,1.01]) {
 await db.query('UPDATE nhl_shots SET xg_sql=$1 WHERE event_id=1',[bad]);
 await rejected(2025,/missing or invalid probabilities/);
}
await db.exec('UPDATE nhl_shots SET xg_sql=.6 WHERE event_id=1');
// Even an outcome filtered out of player totals cannot hide an unscored source row.
await db.exec('UPDATE nhl_shots SET xg_sql=NULL WHERE event_id=7');await rejected(2025,/missing or invalid probabilities/);
await db.exec('UPDATE nhl_shots SET xg_sql=.4 WHERE event_id=7');
await db.exec("INSERT INTO nhl_shots(event_id,game_id,season,game_type,xg_sql) VALUES(9,2026020001,2026,'regular',.1)");
await rejected(2026,/empty/); // Records without any eligible entity do not clear outputs.
await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
await assert.rejects(db.query('SELECT * FROM refresh_xg_season_layer(2025)'),/READ COMMITTED/);checks++;
await db.exec('ROLLBACK; RESET ROLE; SET ROLE authenticated');
await assert.rejects(db.query('SELECT * FROM refresh_xg_season_layer(2025)'),/permission denied/);checks++;
await db.exec('RESET ROLE');
assert.deepEqual((await db.query('SELECT marker FROM public._sides')).rows,[{marker:'persistent fixture'}]);checks++;
assert.deepEqual(await state(),original);checks++;
await db.exec(capture+';');assert.deepEqual(await acl(),beforeAcl);
assert.equal((await db.query("SELECT md5(pg_get_functiondef('refresh_xg_season_layer(integer)'::regprocedure)) AS hash")).rows[0].hash,hash);checks++;
await db.close();
console.log(`xG season refresh guard: ${checks} checks passed (isolated PGlite)`);
