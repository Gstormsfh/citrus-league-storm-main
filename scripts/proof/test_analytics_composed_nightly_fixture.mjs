// Additive synthetic integration fixture. No hosted connection or model fitting.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo = new URL('../../',import.meta.url);
const read = path => readFile(new URL(path,repo),'utf8');
const md5 = value => createHash('md5').update(value).digest('hex');
export async function install(db,{legacyRefresh=false}={}) {
 const predecessors=JSON.parse(await read('supabase/migrations/captures/2026-09-06_analytics_writer_protocol_rollback.json'));
 const helpers=JSON.parse(await read('scripts/proof/captures/composed_helpers_20260906.json'));
 const views=JSON.parse(await read('scripts/proof/captures/composed_views_20260906.json'));
 const garDeps=JSON.parse(await read('supabase/migrations/captures/2026-09-06_gar_guard_input_dependencies.json'));
 for(const row of [...predecessors,...helpers]) assert.equal(md5(row.definition),row.definition_md5);
 for(const row of views.filter(r=>r.definition)) assert.equal(md5(row.definition),row.definition_md5);
 const five=predecessors.find(r=>r.signature.endsWith('numeric,numeric,boolean,numeric)'));
 const columns=five.definition.split('insert into public.player_gar_components (')[1].split(')')[0].split(',').map(x=>x.trim());
 await db.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE raw_shots(id bigint PRIMARY KEY,game_id int,event_id int,season int,period int,time_in_period text,
 event_owner_team_id int,xg_v5 numeric,is_goal boolean,situation_code text,period_type text,
 shot_type text,distance numeric,angle numeric,is_rebound boolean,is_home_team boolean,
 home_skaters_on_ice int,away_skaters_on_ice int,is_empty_net boolean,has_pass_before_shot boolean,
 pass_quality_score numeric,goalie_movement_score numeric);
 CREATE TABLE raw_nhl_data(game_id int PRIMARY KEY,raw_json jsonb);
 CREATE TABLE player_shifts_official(shift_id bigint PRIMARY KEY,game_id int,player_id int,team_id int,
 period int,shift_start_time_seconds int,shift_end_time_seconds int,duration_seconds int,end_time text);
 CREATE TABLE shift_clock_repairs(game_id int,player_id int,period int,shift_id bigint PRIMARY KEY,
 pattern text,old_start int,old_end int,duration_s int,new_start int,new_end int);
 CREATE TABLE game_teams(game_id int PRIMARY KEY,home_id int,away_id int,season int);
 CREATE TABLE game_strength_intervals(game_id int,period int,start_s int,end_s int,
 away_goalie smallint,away_skaters smallint,home_skaters smallint,home_goalie smallint);
 CREATE TABLE rebound_window_era(season_from int,max_gap_s smallint);
 CREATE TABLE player_onice_xg(game_id int,player_id int,state text,xgf numeric(9,4),xga numeric(9,4),
 xgf_flurry numeric(9,4),xga_flurry numeric(9,4),cf int,ca int,gf int,ga int,team_id int,season int,
 built_at timestamptz DEFAULT now(),PRIMARY KEY(game_id,player_id,state));
 CREATE TABLE player_toi_by_state(game_id int,player_id int,state text,toi_seconds int,team_id int,season int);
 CREATE TABLE shift_ingest_quality(game_id int PRIMARY KEY,verdict text);
 CREATE TABLE strength_build_state(game_id int PRIMARY KEY,built_at timestamptz,n_intervals int,
 toi_built_at timestamptz,onice_built_at timestamptz);
 CREATE TABLE player_game_stats(player_id int,is_goalie boolean);
 CREATE TABLE player_penalty_events(committed_by int,drawn_by int,season int,game_id int,duration_min int);
 CREATE TABLE player_gar_components(${columns.map(c=>`${c} ${['player_id','season'].includes(c)?'int':c.endsWith('_at')?'timestamptz':'numeric'}`).join(',')},total_gar numeric,goals_per_minor numeric);
 CREATE TABLE nhl_shots(game_id int,event_id int,season int,team_id int,is_home boolean,distance numeric,xg_sql numeric);
 CREATE TABLE nhl_game_arena(game_id int PRIMARY KEY,season int,home_team int);
 CREATE TABLE xg_rebuild_audit(season int,layer text,expected bigint,actual bigint,status text,detail text);
 `);
 if(legacyRefresh) {
  // Reuse isolated synthetic table contracts only, never their executable test.
  const refreshFixture=await read('scripts/test_xg_season_refresh_guard.mjs');
  for(const name of ['player_xg_season','goalie_xg_season','team_xg_season']) {
   const ddl=refreshFixture.match(new RegExp(`CREATE TABLE ${name}\\([\\s\\S]*?;`));
   assert.ok(ddl);await db.query(ddl[0]);
  }
  const gsaxFixture=await read('scripts/test_legacy_gsax_guard.mjs');
  const ddl=gsaxFixture.match(/CREATE TABLE goalie_gsax_primary\([\s\S]*?;/);assert.ok(ddl);await db.query(ddl[0]);
  await db.query(`ALTER TABLE nhl_shots ADD game_type text,ADD shooter_id int,ADD goalie_id int,
   ADD event_type text,ADD is_goal boolean,ADD is_power_play boolean DEFAULT false,
   ADD is_shorthanded boolean DEFAULT false,ADD is_empty_net boolean DEFAULT false,
   ADD distance_adj float8 DEFAULT 20,ADD prev_event_type text,ADD seconds_since_prev int,ADD is_rush boolean DEFAULT false,
   ADD x_norm float8,ADD y_norm float8,ADD x_adj float8,ADD y_adj float8,ADD angle_adj float8;
   CREATE TABLE nhl_rink_cdf(coord text,home_team int,season int,v int,cdf_mid float8,n_group int);
   CREATE TABLE nhl_rink_ref_knots(coord text,k int,v float8)`);
  await db.query(helpers.find(r=>r.signature==='rink_cdf_season_for(integer,integer)').definition);
 }
 for(const signature of ['citrus_game_type(bigint)','citrus_rebound_window(integer)',
   'record_rebuild_audit(integer,text,bigint,bigint,text)','xg_shot_empty_net(text,boolean,boolean)'])
  await db.query(helpers.find(r=>r.signature===signature).definition);
 await db.query(`CREATE VIEW player_gar_inputs_by_type AS ${views.find(r=>r.name==='player_gar_inputs_by_type').definition}`);
 await db.query(`CREATE VIEW player_gar_inputs AS ${garDeps.find(r=>r.kind==='view').definition}`);
 await db.query(garDeps.find(r=>r.kind==='function').definition);
 // All exact protocol predecessors install unchanged, then the full frozen
 // protocol migration instruments them. Unused legacy dependencies are replaced
 // below and explicitly listed in returned evidence, never claimed tested.
 for(const row of predecessors) await db.query(row.definition);
 await db.query(await read('supabase/migrations/20260906054106_coordinate_analytics_writer_entry_locks.sql'));
 const exact=[];
 for(const row of predecessors) {
  const actual=(await db.query('SELECT pg_get_functiondef($1::regprocedure) AS d',[row.signature])).rows[0].d;
  assert.equal(actual,row.definition.replace(/\nbegin\n/i,m=>m+'  PERFORM public.analytics_enter_writer_protocol();\n'));
  exact.push({signature:row.signature,predecessor_md5:row.definition_md5,installed_md5:md5(actual)});
 }
 const stubs=['score_xg_sql_v2(integer)',
  ...(!legacyRefresh?['apply_rink_adjustment_live(integer)','refresh_xg_season_layer(integer)','rebuild_goalie_gsax_primary(integer)']:[])];
 for(const signature of stubs) await db.query(`DROP FUNCTION public.${signature}`);
 await db.query(`
 ${!legacyRefresh?'CREATE FUNCTION apply_rink_adjustment_live(integer) RETURNS bigint LANGUAGE sql AS $$SELECT 0::bigint$$;':''}
 CREATE FUNCTION score_xg_sql_v2(integer) RETURNS bigint LANGUAGE sql AS $$SELECT 0::bigint$$;
 ${!legacyRefresh?`CREATE FUNCTION refresh_xg_season_layer(integer) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 CREATE FUNCTION rebuild_goalie_gsax_primary(integer DEFAULT 2025) RETURNS TABLE(o_count bigint,o_metric text)
 LANGUAGE sql AS $$SELECT 0::bigint,'goalies_written'::text$$;`:''}
 CREATE FUNCTION xg_v5(text,numeric,numeric,boolean,boolean,int,int,boolean,boolean,numeric,numeric,int,smallint)
 RETURNS numeric LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Unreviewed model inference boundary must not execute';END$$;
 DO $$DECLARE r record;BEGIN FOR r IN SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'
 LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.relname);END LOOP;END$$;
 GRANT USAGE ON SCHEMA public TO service_role;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
 INSERT INTO rebound_window_era VALUES(2017,3);
 INSERT INTO game_teams SELECT 2025020000+g,10,20,2025 FROM generate_series(1,8) g;
 INSERT INTO shift_ingest_quality SELECT game_id,'good' FROM game_teams;
 INSERT INTO raw_nhl_data SELECT game_id,jsonb_build_object('plays',(
 SELECT jsonb_agg(jsonb_build_object('periodDescriptor',jsonb_build_object('number',p,'periodType','REG'),
 'timeInPeriod',t,'situationCode',sc,'sortOrder',p*10+k) ORDER BY p,k)
 FROM generate_series(1,3) p CROSS JOIN (VALUES(1,'00:00','1551'),(2,'16:40','1451'),(3,'18:20','1541')) v(k,t,sc))) FROM game_teams;
 INSERT INTO player_shifts_official SELECT row_number() OVER(),game_id,player,team,period,st,en,en-st,'20:00'
 FROM game_teams CROSS JOIN generate_series(1,3) period CROSS JOIN
 (SELECT player,10 team FROM generate_series(101,105) player UNION ALL SELECT player,20 FROM generate_series(201,205) player) ps
 CROSS JOIN (VALUES(0,1000),(1000,1100),(1100,1200)) v(st,en)
 WHERE NOT(team=20 AND player=205 AND st=1000) AND NOT(team=10 AND player=105 AND st=1100);
 INSERT INTO raw_shots(id,game_id,event_id,season,period,time_in_period,event_owner_team_id,xg_v5,is_goal,situation_code,period_type)
 SELECT row_number() OVER(),game_id,period*10+k,2025,period,t,team,xg,goal,sc,'REG'
 FROM game_teams CROSS JOIN generate_series(1,3) period CROSS JOIN
 (VALUES(1,'01:00',10,.5,true,'1551'),(2,'02:00',20,.5,false,'1551'),
 (3,'17:00',10,.75,true,'1451'),(4,'17:10',20,.25,false,'1451'),
 (5,'19:00',20,.75,true,'1541'),(6,'19:10',10,.25,false,'1541')) v(k,t,team,xg,goal,sc);
 INSERT INTO player_game_stats SELECT player,false FROM generate_series(101,105) player
 UNION ALL SELECT player,false FROM generate_series(201,205) player;
 INSERT INTO nhl_shots(game_id,event_id,season,team_id,is_home,distance,xg_sql) VALUES(2025020001,1,2025,10,true,20,.5);
 `);
 if(legacyRefresh) await db.query(`
 UPDATE nhl_shots SET game_type='regular',shooter_id=101,goalie_id=9002,event_type='goal',is_goal=true;
 INSERT INTO nhl_shots(game_id,event_id,season,team_id,is_home,distance,xg_sql,game_type,shooter_id,goalie_id,event_type,is_goal)
 VALUES(2025020001,2,2025,20,false,20,.5,'regular',201,9001,'shot-on-goal',false),
 (2025020001,3,2025,10,true,25,.2,'regular',102,9002,'missed-shot',false),
 (2025020001,4,2025,20,false,25,.8,'regular',202,9001,'goal',true);
 INSERT INTO player_xg_season(season,game_type,player_id,team_id,xg,updated_at) VALUES(2024,'regular',999,90,7,'2024-01-01');
 INSERT INTO goalie_xg_season(season,game_type,goalie_id,team_id,xg_faced,updated_at) VALUES(2024,'regular',9999,90,7,'2024-01-01');
 INSERT INTO team_xg_season(season,game_type,team_id,xg_for,updated_at) VALUES(2024,'regular',90,7,'2024-01-01');
 INSERT INTO goalie_gsax_primary(goalie_id,season,total_shots_faced,updated_at) VALUES(9999,2024,7,'2024-01-01');
 UPDATE nhl_shots SET distance_adj=NULL,x_norm=70,y_norm=6;
 INSERT INTO nhl_rink_cdf VALUES('x',10,2025,70,.3005,2000),('y',10,2025,6,.4005,2000);
 INSERT INTO nhl_rink_ref_knots VALUES('x',300,69),('x',301,71),('y',400,5),('y',401,7);
 `);
 return {exact:exact.filter(r=>!stubs.includes(r.signature)),stubs,
  modelInference:'throw-on-use xg_v5; pre-scored synthetic raw rows; scorer zero eligible rows',
  rink:legacyRefresh?'exact interpolation with explicitly synthetic CDF/knots, not learned rink adjustment acceptance':'stubbed',
  source:'8 synthetic games, 3 regulation periods, 5v5/PP/PK segments; shift quality is a declared synthetic table input'};
}
export async function snapshot(db,{legacyRefresh=false}={}) {
 const tables=['game_strength_intervals','player_toi_by_state','player_onice_xg','player_gar_components','strength_build_state','xg_rebuild_audit'];
 const result={};
 if(legacyRefresh)tables.push('player_xg_season','goalie_xg_season','team_xg_season','goalie_gsax_primary');
 for(const table of tables) result[table]=(await db.query(`SELECT to_jsonb(t) row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}
