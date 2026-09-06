// Isolated synthetic SQL semantics, not chronological calibration/model quality.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));
const db=new PGlite();
const originalHash='f561319c1b8dcc9ea17b3330cdc94af5';
const capture=await readFile(new URL('../supabase/migrations/captures/2026-09-06_pre_guard_xg_era_fit_exclusions.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260906034437_guard_xg_era_fit_exclusions.sql',import.meta.url),'utf8');
let checks=0;
assert.equal(createHash('md5').update(capture).digest('hex'),originalHash);checks++;
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE xg_v5_fit_rows(id integer PRIMARY KEY,season integer,is_rebound boolean,game_type integer,is_goal boolean,base numeric,bucket text,is_empty_net boolean);
 CREATE TABLE xg_v5_moat(bucket text PRIMARY KEY,mult numeric);
 CREATE TABLE xg_v5_shape(band integer PRIMARY KEY,lo numeric,hi numeric,mult numeric);
 CREATE TABLE xg_v5_era(season integer,is_rebound boolean,n integer NOT NULL,goals integer NOT NULL,expected numeric NOT NULL,mult numeric NOT NULL,fitted_at timestamptz DEFAULT now(),PRIMARY KEY(season,is_rebound));
 CREATE TABLE xg_v5_playoff(id integer PRIMARY KEY,n integer NOT NULL,goals integer NOT NULL,expected numeric NOT NULL,mult numeric NOT NULL,fitted_at timestamptz DEFAULT now());
 ALTER TABLE xg_v5_fit_rows ENABLE ROW LEVEL SECURITY; ALTER TABLE xg_v5_moat ENABLE ROW LEVEL SECURITY; ALTER TABLE xg_v5_shape ENABLE ROW LEVEL SECURITY;
 ALTER TABLE xg_v5_era ENABLE ROW LEVEL SECURITY; ALTER TABLE xg_v5_playoff ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
 ${capture}; GRANT EXECUTE ON FUNCTION citrus_fit_xg_v5_era(numeric,integer[]) TO service_role;
 INSERT INTO xg_v5_moat VALUES('fixture',1.1);
 INSERT INTO xg_v5_shape VALUES(1,0,2,.9);
 INSERT INTO xg_v5_fit_rows VALUES
 (1,2024,false,2,true,.2,'fixture',false),(2,2024,false,2,false,.1,'fixture',false),
 (3,2024,true,2,true,.4,'fixture',false),(4,2024,true,2,false,.2,'fixture',false),
 (5,2024,false,3,true,.3,'fixture',false),(6,2024,true,3,false,.1,'fixture',false),
 (7,2025,false,2,true,.8,'fixture',false),(8,2025,true,2,false,.9,'fixture',false),
 (9,2025,false,3,true,.8,'fixture',false);`);
const acl=async()=>(await db.query("SELECT proacl::text AS acl,prosecdef FROM pg_proc WHERE oid='citrus_fit_xg_v5_era(numeric,integer[])'::regprocedure")).rows[0];
const beforeAcl=await acl();
const state=async(full=false)=>({
 era:(await db.query(`SELECT to_jsonb(e)${full?'':"-'fitted_at'"} AS row FROM xg_v5_era e ORDER BY season,is_rebound`)).rows,
 playoff:(await db.query(`SELECT to_jsonb(p)${full?'':"-'fitted_at'"} AS row FROM xg_v5_playoff p ORDER BY id`)).rows,
});
const fit=(exclude='{}')=>db.query('SELECT * FROM citrus_fit_xg_v5_era(60,$1::integer[])',[exclude]);
await fit();const originalAll=await state();
await fit('{2025}');
assert.equal((await state()).playoff[0].row.n,3);checks++; // Original bug reproduced.
await db.exec(migration);
assert.deepEqual(await acl(),beforeAcl);checks++;
await db.exec('SET ROLE service_role');
await fit();assert.deepEqual(await state(),originalAll);checks++; // Unchanged eligible math.
await fit('{2025}');const excluded=await state();
assert.deepEqual(excluded.era.map(r=>r.row.season),[2024,2024]);
assert.equal(excluded.playoff[0].row.n,2);checks++;
await db.exec("UPDATE xg_v5_fit_rows SET base=1.7,is_goal=NOT is_goal WHERE season=2025");
await fit('{2025}');assert.deepEqual(await state(),excluded);checks++; // Excluded rows cannot affect either output.
async function noMutation(exclude,pattern) {
 const before=await state(true);
 await assert.rejects(fit(exclude),pattern);
 assert.deepEqual(await state(true),before);checks++;
}
await noMutation('{2024,2025}',/eligible regular and playoff/);
await noMutation('{2025,NULL}',/NULL elements/);
await db.exec('UPDATE xg_v5_fit_rows SET game_type=2 WHERE season=2024');
await noMutation('{2025}',/eligible regular and playoff/); // No eligible playoff: do not retain stale singleton as success.
await db.exec('UPDATE xg_v5_fit_rows SET game_type=3 WHERE season=2024');
await noMutation('{2025}',/eligible regular and playoff/); // No eligible regular.
await db.exec('UPDATE xg_v5_fit_rows SET game_type=2 WHERE id BETWEEN 1 AND 4; UPDATE xg_v5_fit_rows SET base=0 WHERE id IN (5,6)');
await noMutation('{2025}',/positive eligible playoff expectation/);
await db.exec('UPDATE xg_v5_fit_rows SET base=.3 WHERE id=5; UPDATE xg_v5_fit_rows SET base=.1 WHERE id=6');
await fit(null);const nullArray=await state();await fit('{}');assert.deepEqual(await state(),nullArray);checks++;
await db.exec('RESET ROLE; SET ROLE authenticated');
await assert.rejects(fit(),/permission denied/);checks++;
await db.exec('RESET ROLE');
// Independent arithmetic reference: original function on physically eligible rows.
await db.exec('DELETE FROM xg_v5_fit_rows WHERE season=2025');
await db.exec(capture+';');
assert.equal((await db.query("SELECT md5(pg_get_functiondef('citrus_fit_xg_v5_era(numeric,integer[])'::regprocedure)) AS hash")).rows[0].hash,originalHash);
assert.deepEqual(await acl(),beforeAcl);checks++;
await fit();assert.deepEqual(await state(),excluded);checks++;
await db.close();
console.log(`era exclusions: ${checks} checks passed (isolated PGlite)`);
