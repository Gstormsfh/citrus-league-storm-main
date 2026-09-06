// Isolated synthetic Postgres/WASM only; not native concurrent-lock proof.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite} = await import(pathToFileURL(process.env.PGLITE_MODULE));
const db = new PGlite();
const root = new URL('../supabase/migrations/', import.meta.url);
const captures = JSON.parse(await readFile(new URL('captures/2026-09-06_pre_onice_gar_guards.json', root), 'utf8'));
const deps = JSON.parse(await readFile(new URL('captures/2026-09-06_gar_guard_input_dependencies.json', root), 'utf8'));
const views = JSON.parse(await readFile(new URL('captures/2026-09-06_gar_guard_view_dependencies.json', root), 'utf8'));
const migration = await readFile(new URL('20260906044310_guard_gar_candidate_replacement.sql', root), 'utf8');
const funcs = captures.filter(x => x.signature.startsWith('citrus_rebuild_gar_components(') || x.signature === 'citrus_recompute_gar_totals()');
let checks = 0;
for (const f of funcs) { assert.equal(createHash('md5').update(f.definition).digest('hex'), f.definition_md5); checks++; }
const five = funcs.find(x=>x.signature.endsWith('boolean,numeric)'));
const four = funcs.find(x=>x.signature.endsWith('boolean)'));
const columns = five.definition.split('insert into public.player_gar_components (')[1].split(')')[0].split(',').map(x=>x.trim());
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE raw_shots(season int,period_type text,xg_v5 numeric,is_goal boolean);
 CREATE TABLE player_game_stats(player_id int,is_goalie boolean);
 CREATE TABLE player_onice_xg(player_id int,season int,game_id int,state text,xgf numeric,xga numeric,xgf_flurry numeric,xga_flurry numeric,gf numeric,ga numeric);
 CREATE TABLE player_toi_by_state(player_id int,season int,game_id int,state text,toi_seconds numeric);
 CREATE TABLE player_penalty_events(committed_by int,drawn_by int,season int,game_id int,duration_min int);
 CREATE TABLE player_gar_components(${columns.map(c=>`${c} ${['player_id','season'].includes(c)?'int':c.endsWith('_at')?'timestamptz':'numeric'}`).join(',')},total_gar numeric,goals_per_minor numeric);
 CREATE FUNCTION citrus_game_type(bigint) RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT (($1/10000)%100)::int $$;
 CREATE VIEW player_gar_inputs_by_type AS ${views.find(x=>x.relation==='player_gar_inputs_by_type').definition}
 CREATE VIEW player_gar_inputs AS ${deps.find(x=>x.kind==='view').definition}
 ${deps.find(x=>x.kind==='function').definition};
 ${funcs.map(x=>x.definition).join(';')};
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
 GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated,service_role;
 ALTER TABLE player_gar_components ENABLE ROW LEVEL SECURITY;
 INSERT INTO raw_shots VALUES(2025,'REG',.5,true),(2025,'REG',.5,false),(2024,'REG',.5,true),(2024,'REG',.5,false);
 INSERT INTO player_game_stats VALUES(1,false),(2,false),(3,true);
 INSERT INTO player_toi_by_state
 SELECT p,s,s*1000000+20001,state,CASE state WHEN '5v5' THEN 12000 ELSE 1800 END
 FROM generate_series(1,3) p CROSS JOIN (VALUES(2024),(2025)) z(s) CROSS JOIN (VALUES('5v5'),('PP'),('PK')) states(state);
 INSERT INTO player_onice_xg
 SELECT p,s,s*1000000+20001,state,CASE state WHEN 'PP' THEN 3+p ELSE 2+p END,1,
 CASE state WHEN 'PP' THEN 3+p ELSE 2+p END,1,1,1
 FROM generate_series(1,3) p CROSS JOIN (VALUES(2024),(2025)) z(s) CROSS JOIN (VALUES('5v5'),('PP'),('PK')) states(state);`);
const state=async()=> (await db.query('SELECT to_jsonb(c) AS row FROM player_gar_components c ORDER BY season,player_id')).rows;
const values=async()=> (await db.query("SELECT to_jsonb(c)-'updated_at'-'calculated_at' AS row FROM player_gar_components c ORDER BY season,player_id")).rows;
const acl=async()=> (await db.query("SELECT oid::regprocedure::text AS signature,proacl::text,prosecdef FROM pg_proc WHERE proname IN ('citrus_rebuild_gar_components','citrus_recompute_gar_totals') ORDER BY 1")).rows;
const invoke5='SELECT * FROM citrus_rebuild_gar_components(ARRAY[2025],100::numeric,25::numeric,true,20::numeric)';
// Baseline valid formula output comes from the exact capture, not a reimplementation.
await db.exec(invoke5);
const baseline5=await values();
await db.exec('TRUNCATE player_gar_components');
// Existing same-prefix DEFAULT overload is ambiguous: isolate four-arg identity
// for its behavior checks, then restore the exact five-arg definition/ACL.
await db.exec(`DROP FUNCTION public.${five.signature}`);
const invoke4='SELECT * FROM citrus_rebuild_gar_components(ARRAY[2025],100::numeric,25::numeric,true)';
await db.exec(invoke4);
const baseline4=await values();
await db.exec(five.definition);
await db.exec(`GRANT EXECUTE ON FUNCTION public.${five.signature} TO authenticated,service_role`);
const originalAcl=await acl();
await db.exec(migration);
assert.deepEqual(await acl(),originalAcl);checks++;
await db.exec(migration);checks++;
const guarded5=(await db.query(`SELECT pg_get_functiondef('public.${five.signature}'::regprocedure) AS definition`)).rows[0].definition;
await db.exec('TRUNCATE player_gar_components');
await db.exec(invoke5);assert.deepEqual(await values(),baseline5);checks++;
await db.exec(`DROP FUNCTION public.${five.signature}; TRUNCATE player_gar_components`);
await db.exec(invoke4);assert.deepEqual(await values(),baseline4);checks++;
await db.exec(guarded5);
await db.exec(`GRANT EXECUTE ON FUNCTION public.${five.signature} TO authenticated,service_role`);
async function fail(sql, pattern) {
 const before=await state();
 await assert.rejects(db.exec(sql),pattern);
 assert.deepEqual(await state(),before);checks++;
}
for (const params of ["ARRAY[]::int[],100,25,true,20","ARRAY[2025,2025],100,25,true,20","ARRAY[NULL]::int[],100,25,true,20",
 "ARRAY[2025],NULL,25,true,20","ARRAY[2025],-1,25,true,20","ARRAY[2025],'NaN',25,true,20",
 "ARRAY[2025],100,101,true,20","ARRAY[2025],100,25,NULL,20","ARRAY[2025],100,25,true,'Infinity'"])
 await fail(`SELECT * FROM citrus_rebuild_gar_components(${params})`,/Invalid GAR/);
await fail('SELECT * FROM citrus_rebuild_gar_components(ARRAY[2025,2026],100,25,true,20)',/no inputs/);
await fail('SELECT * FROM citrus_rebuild_gar_components(ARRAY[2025],999999,25,true,20)',/candidate season empty/);
await db.exec('DELETE FROM raw_shots WHERE season=2025');await fail(invoke5,/source missing/);
await db.exec("INSERT INTO raw_shots VALUES(2025,'REG',.5,true),(2025,'REG',.5,false)");
for (const invalid of ['NULL',"'NaN'","'Infinity'",'-0.1','1.1']) {
 await db.exec(`UPDATE raw_shots SET xg_v5=${invalid} WHERE season=2025 AND is_goal`);
 await fail(invoke5,/source missing or invalid/);
 await db.exec('UPDATE raw_shots SET xg_v5=.5 WHERE season=2025 AND is_goal');
}
await db.exec('UPDATE raw_shots SET is_goal=NULL WHERE season=2025');await fail(invoke5,/source missing or invalid/);
await db.exec('UPDATE raw_shots SET is_goal=false WHERE season=2025');
await fail(invoke5.replace('true,20','false,20'),/No calibrated/);
await db.exec('UPDATE raw_shots SET is_goal=true WHERE season=2025');
await db.exec("UPDATE player_onice_xg SET xgf_flurry=NULL WHERE season=2025 AND state='PP'");await fail(invoke5,/required rates/);
await db.exec("UPDATE player_onice_xg SET xgf_flurry=xgf WHERE state='PP'");
await db.exec("UPDATE player_onice_xg SET xgf_flurry='NaN' WHERE season=2025 AND state='5v5'");await fail(invoke5,/required rates/);
await db.exec("UPDATE player_onice_xg SET xgf_flurry=xgf WHERE state='5v5'");
await db.exec("UPDATE player_toi_by_state SET toi_seconds=-1 WHERE season=2025 AND state='PP'");await fail(invoke5,/exposure/);
await db.exec("UPDATE player_toi_by_state SET toi_seconds=1800 WHERE season=2025 AND state='PP'");
for (const bad of ['NULL',"'NaN'","'Infinity'",'-1']) {
 // OTHER exposure is hidden from EV/ST rates and can be masked by SUM.
 await db.exec(`INSERT INTO player_toi_by_state VALUES(1,2025,2025020001,'OTHER',${bad})`);
 await fail(invoke5,/source exposure/);
 await db.exec("DELETE FROM player_toi_by_state WHERE season=2025 AND state='OTHER'");
}
await db.exec("INSERT INTO player_toi_by_state VALUES(1,2023,2023020001,'OTHER',NULL)");
await db.exec(invoke5);checks++; // Nonselected malformed exposure is not broadened into scope.
const gpm=deps.find(x=>x.kind==='function').definition;
for (const invalid of ['NULL',"'NaN'","'Infinity'",'0','-1']) {
 await db.exec(`CREATE OR REPLACE FUNCTION citrus_goals_per_minor() RETURNS numeric LANGUAGE sql STABLE SET search_path TO public,pg_temp AS $$ SELECT ${invalid}::numeric $$`);
 await fail(invoke5,/finite positive goals/);
 await fail('SELECT * FROM citrus_recompute_gar_totals()',/finite positive goals/);
}
await db.exec(gpm);
await db.exec('UPDATE player_gar_components SET evo_gar_per_60=NULL WHERE player_id=1');
await fail('SELECT * FROM citrus_recompute_gar_totals()',/required components/);
await db.exec(invoke5);
// Genuine zero special-team exposure retains the captured zero-rate defaults.
await db.exec("DELETE FROM player_toi_by_state WHERE season=2025 AND state IN ('PP','PK'); DELETE FROM player_onice_xg WHERE season=2025 AND state IN ('PP','PK')");
await db.exec(five.definition);await db.exec(invoke5);const zeroStBaseline=await values();
await db.exec(guarded5);await db.exec(invoke5);
assert.deepEqual(await values(),zeroStBaseline);checks++;
// Four-argument variant gets the same pre-delete protections, without adding
// five-argument goalie exclusion or weighted totals semantics.
await db.exec(`DROP FUNCTION public.${five.signature}`);
await fail('SELECT * FROM citrus_rebuild_gar_components(ARRAY[]::int[],100,25,true)',/Invalid GAR/);
await fail('SELECT * FROM citrus_rebuild_gar_components(ARRAY[2025],999999,25,true)',/candidate season empty/);
await db.exec('UPDATE raw_shots SET xg_v5=NULL WHERE season=2025');await fail(invoke4,/source missing or invalid/);
await db.exec('UPDATE raw_shots SET xg_v5=.5 WHERE season=2025');
await db.exec("UPDATE player_onice_xg SET xga_flurry='Infinity' WHERE season=2025 AND state='5v5'");await fail(invoke4,/required rates/);
await db.exec("UPDATE player_onice_xg SET xga_flurry=xga WHERE season=2025 AND state='5v5'");
await db.exec(invoke4);assert.equal((await db.query('SELECT count(*)::int n FROM player_gar_components WHERE season=2025')).rows[0].n,3);checks++;
await db.exec(guarded5);await db.exec(`GRANT EXECUTE ON FUNCTION public.${five.signature} TO authenticated,service_role`);
await db.exec(invoke5);
await db.exec('INSERT INTO player_gar_components(player_id,season,total_gar,updated_at) VALUES(99,2023,777,\'2020-01-01\')');
const unrelated=(await db.query('SELECT to_jsonb(c) row FROM player_gar_components c WHERE season=2023')).rows;
await db.exec(invoke5);
assert.deepEqual((await db.query('SELECT to_jsonb(c) row FROM player_gar_components c WHERE season=2023')).rows,unrelated);checks++;
await db.exec('UPDATE raw_shots SET is_goal=false WHERE season=2024; UPDATE raw_shots SET is_goal=(ctid IN (SELECT ctid FROM raw_shots WHERE season=2025 LIMIT 1)) WHERE season=2025');
const partial=(await db.query('SELECT * FROM citrus_rebuild_gar_components(ARRAY[2024,2025],100,25,false,20)')).rows;
assert.equal(partial.length,1);assert.match(partial[0].out_note,/2024/);assert.equal(partial[0].out_season,2025);checks++;
await db.exec(`UPDATE raw_shots SET xg_v5=0 WHERE season=2024;
 INSERT INTO raw_shots VALUES(2022,'REG',0,false);
 INSERT INTO player_toi_by_state SELECT player_id,2022,2022020001,state,toi_seconds FROM player_toi_by_state WHERE season=2024;
 INSERT INTO player_onice_xg SELECT player_id,2022,2022020001,state,xgf,xga,xgf_flurry,xga_flurry,gf,ga FROM player_onice_xg WHERE season=2024;
 INSERT INTO player_gar_components(player_id,season,total_gar,updated_at) VALUES(98,2022,456,'2020-01-01'),(97,2024,789,'2020-01-01')`);
const skippedBefore=(await db.query('SELECT to_jsonb(c) row FROM player_gar_components c WHERE season IN (2022,2024) ORDER BY season,player_id')).rows;
for (const variant of [5,4]) {
 if(variant===4) await db.exec(`DROP FUNCTION public.${five.signature}`);
 const output=(await db.query(`SELECT * FROM citrus_rebuild_gar_components(ARRAY[2024,2025,2022],100,25,false${variant===5?',20':''})`)).rows;
 assert.equal(output.length,1);assert.equal(output[0].out_season,2025);
 assert.equal(output[0].out_note,'skipped as uncalibrated: 2022 (undefined), 2024 (undefined)');
 assert.deepEqual((await db.query('SELECT to_jsonb(c) row FROM player_gar_components c WHERE season IN (2022,2024) ORDER BY season,player_id')).rows,skippedBefore);checks++;
}
await db.exec(guarded5);await db.exec(`GRANT EXECUTE ON FUNCTION public.${five.signature} TO authenticated,service_role`);
await db.exec('BEGIN; CREATE TEMP TABLE _cal(marker text); INSERT INTO _cal VALUES(\'caller\')');
const collisionBefore=await state();
await db.exec('SAVEPOINT before_call');
await assert.rejects(db.exec(invoke5),/temporary relation collision/);
await db.exec('ROLLBACK TO before_call');
assert.deepEqual(await state(),collisionBefore);
assert.deepEqual((await db.query('SELECT marker FROM _cal')).rows,[{marker:'caller'}]);checks++;
await db.exec('ROLLBACK');
await db.exec('SET ROLE authenticated');await assert.rejects(db.exec(invoke5),/permission denied/);checks++;await db.exec('RESET ROLE');
await db.exec('SET ROLE service_role');await db.exec(invoke5);checks++;await db.exec('RESET ROLE');
assert.deepEqual(await acl(),originalAcl);checks++;
// Explicit standalone totals remains global and refuses incomplete old rows.
await fail('SELECT * FROM citrus_recompute_gar_totals()',/required components/);
await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
await assert.rejects(db.exec(invoke5),/requires READ COMMITTED/);await db.exec('ROLLBACK');checks++;
// Guard rejects unexpected definition drift; exact capture is rollback material.
const total=funcs.find(x=>x.signature==='citrus_recompute_gar_totals()');
await db.exec(total.definition.replace('begin\n','begin\n -- unexpected drift\n'));
await assert.rejects(db.exec(migration),/definition drift/);checks++;
await db.exec(total.definition);await db.exec(migration);
for(const f of funcs) await db.exec(f.definition);
for(const f of funcs) {
 const hash=(await db.query(`SELECT md5(pg_get_functiondef('public.${f.signature}'::regprocedure)) h`)).rows[0].h;
 assert.equal(hash,f.definition_md5);checks++;
}
assert.deepEqual(await acl(),originalAcl);checks++;
await db.close();
console.log(`GAR candidate guard: ${checks} checks passed; captured formula parity, local-only.`);
