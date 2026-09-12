import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const migration=readFileSync('supabase/migrations/20260912073140_canonical_projection_runs.sql','utf8');
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE player_directory(player_id bigint,season int,team_abbrev text); INSERT INTO player_directory VALUES(1,2026,'A'),(2,2026,'B');
 CREATE TABLE nhl_games(season int,game_type text,home_team text,away_team text,game_date date); INSERT INTO nhl_games VALUES(2026,'regular','A','B',current_date); CREATE FUNCTION canonical_materialize_projection_run(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
 await db.exec(migration);
 const player=(id,team)=>({player_id:String(id),team,is_goalie:true,status:'projected',availability:{status:'unknown'},sources:[{file:'fixture',locator:'test',sha256:'b'.repeat(64)}],rate_policy:'preserve_override',exposure_policy:'preserve_season_override',exposure:{used:1,unit:'starts'},rates:{wins:.5,saves:25,shutouts:.1,goals_against:2},counts:{wins:.5,saves:25,shutouts:.1,goals_against:2}});
 const payload={schema_version:'citrus.canonical-projection-inputs.v1',season:2026,revision:'a'.repeat(64),players:[player(1,'A'),player(2,'B')],scope_player_ids:['1','2'],schedule:{A:1,B:1},teams:[{team:'A',lineup_slots:[{player_id:'1'}]},{team:'B',lineup_slots:[{player_id:'2'}]}],publish_blockers:[],contract:{publication_ready:true}};
 const stage=async(p=payload)=>(await db.query('select canonical_stage_projection_run($1::jsonb) id',[JSON.stringify(p)])).rows[0].id;
 return {db,payload,stage};
}
test('stage/validate/activate, immutable revision, published RLS and service-only mutation',async()=>{
 const {db,payload,stage}=await fixture(); try{
 const id=await stage();assert.equal(await stage(),id);
 const report=(await db.query('select canonical_validate_projection_run($1) report',[id])).rows[0].report;assert.equal(report.valid,true);
 await db.query('select canonical_activate_projection_run($1,$2)',[id,payload.revision]);
 await db.exec('SET ROLE authenticated');
 assert.equal((await db.query('select * from canonical_published_players')).rows.length,2);
 await assert.rejects(db.query('select canonical_stage_projection_run($1::jsonb)',[JSON.stringify(payload)]),/permission denied/);
 await db.exec('RESET ROLE');
 payload.players[0].name='changed';await assert.rejects(stage(),/Revision collision/);
 }finally{await db.close()}
});
test('blocks imported unresolved review even if ready flag was toggled',async()=>{
 const {db,payload,stage}=await fixture();try{
 payload.publish_blockers=[{code:'UNRESOLVED_ROLE'}]; const id=await stage();
 const report=(await db.query('select canonical_validate_projection_run($1) report',[id])).rows[0].report;
 assert.equal(report.valid,false);assert.ok(report.errors.some(e=>e.code==='IMPORTED_REVIEW_BLOCKERS'));
 await assert.rejects(db.query('select canonical_activate_projection_run($1,$2)',[id,payload.revision]),/publication blocked/);
 assert.equal((await db.query('select * from canonical_projection_active')).rows.length,0);
 }finally{await db.close()}
});
test('recomputes exposure identity and whole-team crease instead of trusting ledger',async()=>{
 const {db,payload,stage}=await fixture();try{
 payload.players[0].exposure.used=.25;const id=await stage();
 const report=(await db.query('select canonical_validate_projection_run($1) report',[id])).rows[0].report;
 assert.ok(report.errors.some(e=>e.code==='INVALID_PLAYER'));assert.ok(report.errors.some(e=>e.code==='CREASE_NOT_CONSERVED'));
 }finally{await db.close()}
});
test('zero exposure with zero unknown rates is valid; missing directory scope is blocked',async()=>{
 const {db,payload,stage}=await fixture();try{
 payload.players.push({...payload.players[0],player_id:'3',rates:{},counts:{wins:0,saves:0,shutouts:0,goals_against:0},exposure:{used:0,unit:'starts'}});
 payload.scope_player_ids=['1']; const id=await stage();const report=(await db.query('select canonical_validate_projection_run($1) report',[id])).rows[0].report;
 assert.deepEqual(report.errors.map(e=>e.code),['DIRECTORY_COVERAGE_MISMATCH']);
 }finally{await db.close()}
});

test('omitted scheduled team and unresolved lineup IDs cannot be hidden by empty blockers',async()=>{
 const{db,payload,stage}=await fixture();try{
 delete payload.schedule.B;payload.teams[0].lineup_slots[0].player_id=null;
 const id=await stage();const report=(await db.query('select canonical_validate_projection_run($1) report',[id])).rows[0].report;
 assert.ok(report.errors.some(e=>e.code==='SCHEDULE_TEAM_COVERAGE'));assert.ok(report.errors.some(e=>e.code==='UNRESOLVED_LINEUP_SLOT'));
 }finally{await db.close()}
});
test('rates-only metadata is validated and staged rows are hidden by RLS',async()=>{
 const{db,payload,stage}=await fixture();try{
 payload.players.push({...payload.players[0],player_id:'3',status:'rates_only',counts:null,exposure:{used:null},rate_policy:null,exposure_policy:'unallocated'});
 const id=await stage();const report=(await db.query('select canonical_validate_projection_run($1) report',[id])).rows[0].report;
 assert.ok(report.errors.some(e=>e.code==='INVALID_PLAYER'&&e.player_id==='3'));
 await db.exec('set role authenticated');assert.equal((await db.query('select * from canonical_projection_players')).rows.length,0);
 }finally{await db.close()}
});
