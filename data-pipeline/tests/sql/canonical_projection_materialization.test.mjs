import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const paths=['20260912073140_canonical_projection_runs.sql','20260912073240_canonical_projection_materialization.sql','20260912073340_canonical_projection_refresh.sql'];
const sql=paths.map(p=>readFileSync('supabase/migrations/'+p,'utf8'));
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE player_directory(player_id bigint,season int,team_abbrev text);INSERT INTO player_directory VALUES(1,2026,'A'),(2,2026,'A'),(3,2026,'B');
 CREATE TABLE nhl_games(game_id bigint,season int,game_type text,home_team text,away_team text,home_team_id int,away_team_id int,game_date date);
 INSERT INTO nhl_games VALUES(2026020001,2026,'regular','A','B',1,2,current_date),(2026020002,2026,'regular','B','A',2,1,current_date+1);
 CREATE TABLE player_game_stats(player_id bigint,game_id bigint,icetime_seconds int,nhl_toi_seconds int,goalie_gp int);
 CREATE FUNCTION project_ros(integer) RETURNS TABLE(player_id integer,r_wins numeric,r_saves numeric,r_so numeric,r_ga numeric,exp_gp numeric) LANGUAGE sql AS $$ SELECT 1,.6,30,.1,2,2 $$;
 CREATE FUNCTION project_rookies(integer) RETURNS TABLE(player_id integer,r_wins numeric,r_saves numeric,r_so numeric,r_ga numeric,exp_gp numeric) LANGUAGE sql AS $$ SELECT 2,.4,20,.1,3,2 $$;
 CREATE FUNCTION get_season_game_count(integer) RETURNS integer LANGUAGE sql AS $$SELECT 2$$;
 CREATE FUNCTION rebuild_ros_projections(integer) RETURNS TABLE(rows_written integer,skaters integer,goalies integer,target_games integer) LANGUAGE sql AS $$SELECT 0,0,0,2$$;
 CREATE FUNCTION rebuild_player_projected_stats(integer) RETURNS TABLE(rows_written integer,players integer,games integer) LANGUAGE sql AS $$SELECT 0,0,0$$;`);
 for(const table of ['player_ros_projections','player_projected_stats']){
  const cols=sql[1].match(new RegExp('INSERT INTO public.'+table+'\\(([^)]+)\\)'))[1].split(',').map(x=>x.trim()).filter(x=>!['projection_run_id','projection_revision'].includes(x));
  const ints=['player_id','season','games_played','game_id','opponent_team_id'];const bools=['is_goalie','is_home_game'];const times=['created_at','updated_at'];const texts=['player_name','team_abbrev','position','calculation_method','opponent_abbrev'];
  await db.exec(`CREATE TABLE ${table}(${cols.map(c=>`${c} ${ints.includes(c)?'bigint':bools.includes(c)?'boolean':times.includes(c)?'timestamptz':texts.includes(c)?'text':c==='projection_date'?'date':'numeric'}`).join(',')})`);
 }
 await db.exec(`CREATE FUNCTION get_ros_projections(integer[]) RETURNS TABLE(games_remaining integer) LANGUAGE plpgsql AS $$ BEGIN RETURN QUERY SELECT r.games_remaining FROM player_ros_projections r WHERE r.player_id=ANY($1);END $$; REVOKE ALL ON FUNCTION get_ros_projections(integer[]) FROM PUBLIC;GRANT EXECUTE ON FUNCTION get_ros_projections(integer[]) TO authenticated;`);
 for(const s of sql)await db.exec(s);
 const player=(id,team,gp)=>({player_id:String(id),name:'test'+id,position:'G',team,is_goalie:true,status:'projected',availability:{status:'unknown'},sources:[{file:'fixture'}],rate_policy:'preserve_override',exposure_policy:'preserve_season_override',exposure:{used:gp,unit:'starts'},rates:{wins:.5,saves:25,shutouts:.1,goals_against:2},counts:{wins:.5*gp,saves:25*gp,shutouts:.1*gp,goals_against:2*gp}});
 const payload={schema_version:'citrus.canonical-projection-inputs.v1',season:2026,revision:'a'.repeat(64),players:[player(1,'A',1.5),player(2,'A',.5),player(3,'B',2)],scope_player_ids:['1','2','3'],schedule:{A:2,B:2},teams:[{team:'A',lineup_slots:[{player_id:'1'}]},{team:'B',lineup_slots:[{player_id:'3'}]}],publish_blockers:[],contract:{publication_ready:true}};
 const publish=async()=>{const id=(await db.query('select canonical_stage_projection_run($1::jsonb) id',[JSON.stringify(payload)])).rows[0].id;await db.query('select canonical_activate_projection_run($1,$2)',[id,payload.revision]);return id};
 return{db,payload,publish};
}
test('activation atomically materializes fractional workloads and category/points identity',async()=>{
 const{db,publish}=await setup();try{const id=await publish();
 const rows=(await db.query(`select r.player_id,r.games_remaining::float8 gp,sum(d.projected_gp)::float8 daily_gp,r.projected_saves_ros::float8 saves,sum(d.projected_saves)::float8 daily_saves,r.total_projected_points::float8 points,sum(d.total_projected_points)::float8 daily_points,bool_and(d.projection_run_id=r.projection_run_id) matched from player_ros_projections r join player_projected_stats d using(player_id) group by r.player_id,r.games_remaining,r.projected_saves_ros,r.total_projected_points`)).rows;
 assert.equal(rows.length,3);for(const r of rows){assert.equal(r.gp,r.daily_gp);assert.equal(r.saves,r.daily_saves);assert.equal(r.points,r.daily_points);assert.equal(r.matched,true)}
 assert.equal(rows.find(r=>r.player_id===1).gp,1.5);
 assert.equal(Number((await db.query('select * from get_ros_projections(ARRAY[1])')).rows[0].games_remaining),1.5);
 assert.equal((await db.query("select has_function_privilege('anon','get_ros_projections(integer[])','EXECUTE') allowed")).rows[0].allowed,false);assert.equal((await db.query('select run_id from canonical_projection_active')).rows[0].run_id,id);
 }finally{await db.close()}
});
test('nightly refresh preserves overrides, refreshes MODEL rates and records new lineage',async()=>{
 const{db,payload,publish}=await setup();try{payload.players[0].rate_policy='refresh_model';const initial=await publish();
 const result=(await db.query('select canonical_refresh_projection_run(2026) result')).rows[0].result;
 assert.notEqual(result.status,'failed',JSON.stringify(result));assert.notEqual(result.run_id,initial);
 const rows=(await db.query('select player_id,projected_saves_ros::float8 saves from player_ros_projections order by player_id')).rows;
 assert.equal(rows[0].saves,45);assert.equal(rows[1].saves,12.5);
 assert.equal((await db.query('select last_refresh_status from canonical_projection_active')).rows[0].last_refresh_status,'success');
 }finally{await db.close()}
});
test('refresh input failure retains published pointer and exposes failure health',async()=>{
 const{db,payload,publish}=await setup();try{payload.players[2].rate_policy='refresh_model';const initial=await publish();
 const result=(await db.query('select canonical_refresh_projection_run(2026) result')).rows[0].result;
 assert.equal(result.status,'failed');const active=(await db.query('select * from canonical_projection_active')).rows[0];assert.equal(active.run_id,initial);assert.equal(active.last_refresh_status,'failed');assert.match(active.last_refresh_error,/Model rates missing/);
 }finally{await db.close()}
});
test('SQL default scorer derives the same canonical weights, including negative and zero',async()=>{
 const{db}=await setup();try{const stats=JSON.parse(readFileSync('packages/shared/src/constants/scoringDefaults.json')).stats;
 for(const goalie of [false,true]){const relevant=stats.filter(s=>s.group===(goalie?'goalie':'skater'));const counts=Object.fromEntries(relevant.map((s,i)=>[s.key,i+1]));const expected=relevant.reduce((sum,s)=>sum+s.points*counts[s.key],0);const actual=(await db.query('select canonical_default_points($1,$2)::float8 points',[JSON.stringify(counts),goalie])).rows[0].points;assert.ok(Math.abs(actual-expected)<1e-10)}
 }finally{await db.close()}
});

test('remaining policy subtracts actual skater games and allocates full-season crease weights once',async()=>{
 const{db,payload,publish}=await setup();try{
 const rates={goals:.5,assists:.5,shots_on_goal:2,blocks:1,power_play_points:.2,short_handed_points:0,hits:1,penalty_minutes:1};
 payload.players.push({...payload.players[0],player_id:'4',position:'C',is_goalie:false,exposure:{used:2,unit:'games'},rates,counts:Object.fromEntries(Object.entries(rates).map(([k,v])=>[k,v*2]))});payload.scope_player_ids.push('4');
 await db.exec("insert into player_directory values(4,2026,'A')");await publish();
 await db.exec("update nhl_games set game_date=current_date-1 where game_id=2026020001;insert into player_game_stats values(4,2026020001,600,600,0)");
 const result=(await db.query('select canonical_refresh_projection_run(2026) result')).rows[0].result;assert.notEqual(result.status,'failed',JSON.stringify(result));
 const rows=(await db.query('select player_id,games_remaining::float8 gp,projected_goals::float8 goals from player_ros_projections order by player_id')).rows;
 assert.deepEqual(rows.map(r=>r.gp),[.75,.25,1,1]);assert.equal(rows[3].goals,.5);
 }finally{await db.close()}
});
test('failed refresh cannot redistribute yesterday snapshot across a shorter daily schedule',async()=>{
 const{db,payload,publish}=await setup();try{
 payload.players[2].rate_policy='refresh_model';await publish();
 await db.exec('update nhl_games set game_date=current_date-1 where game_id=2026020001');
 await db.query('select canonical_refresh_projection_run(2026)');
 await db.query('select * from rebuild_player_projected_stats(2026)');
 const active=(await db.query('select last_refresh_status,last_refresh_error from canonical_projection_active')).rows[0];assert.equal(active.last_refresh_status,'failed');assert.match(active.last_refresh_error,/horizon is stale/);
 assert.equal((await db.query('select count(*)::int n from player_projected_stats')).rows[0].n,6);
 }finally{await db.close()}
});

test('published nightly run exposes immutable source inputs with authenticated RLS',async()=>{
 const{db,payload,publish}=await setup();try{
 payload.players[0].rate_policy='refresh_model';const sourceId=await publish();
 const result=(await db.query('select canonical_refresh_projection_run(2026) result')).rows[0].result;assert.notEqual(result.status,'failed');
 await db.exec('set role authenticated');
 const published=(await db.query('select * from canonical_published_runs')).rows[0];
 assert.equal(published.source_run_id,sourceId);assert.equal(published.source_revision,payload.revision);assert.deepEqual(published.source_payload,payload);
 assert.notEqual(published.revision,published.source_revision);assert.equal(published.payload.players.find(p=>p.player_id==='1').counts.saves,45);assert.equal(published.source_payload.players[0].counts.saves,37.5);
 }finally{await db.close()}
});
test('republication requires exact active revision CAS and rejects stale editors',async()=>{
 const{db,payload,publish}=await setup();try{
 await publish();const old=payload.revision;payload.revision='b'.repeat(64);
 const staged=(await db.query('select canonical_stage_projection_run($1) id',[JSON.stringify(payload)])).rows[0].id;
 await assert.rejects(db.query('select canonical_activate_projection_run($1,$2)',[staged,payload.revision]),/Active revision changed/);
 await db.query('select canonical_activate_projection_run($1,$2,$3)',[staged,payload.revision,old]);
 await assert.rejects(db.query('select canonical_activate_projection_run($1,$2,$3)',[staged,payload.revision,old]),/Active revision changed/);
 assert.equal((await db.query('select revision from canonical_published_runs')).rows[0].revision,payload.revision);
 }finally{await db.close()}
});
