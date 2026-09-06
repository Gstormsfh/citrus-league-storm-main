// Full 16-definition integrity/entry protocol tests; synthetic tables, no models.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));
const db=new PGlite();let checks=0;
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const predecessors=JSON.parse(await read('../supabase/migrations/captures/2026-09-06_analytics_writer_protocol_rollback.json'));
const live=JSON.parse(await read('../supabase/migrations/captures/2026-09-06_pre_analytics_writer_entry_protocol.json'));
const migration=await read('../supabase/migrations/20260906054106_coordinate_analytics_writer_entry_locks.sql');
assert.equal(predecessors.length,16);assert.equal(live.length,16);checks++;
for(const row of [...live,...predecessors])assert.equal(createHash('md5').update(row.definition).digest('hex'),row.definition_md5);
checks++;
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS');
for(const row of predecessors) {
 await db.exec(row.definition+';');
 // Exercise mixed actual-style ACLs without granting new table access.
 if(!row.acl?.includes('=X/'))await db.exec(`REVOKE ALL ON FUNCTION ${row.signature} FROM PUBLIC`);
 await db.exec(`GRANT EXECUTE ON FUNCTION ${row.signature} TO service_role`);
}
const metadata=async()=>(await db.query("SELECT oid::regprocedure::text AS signature,proacl::text,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1")).rows;
const before=await metadata();
await db.exec(migration);await db.exec(migration);checks++;
assert.deepEqual((await metadata()).filter(r=>r.signature!=='analytics_enter_writer_protocol()'),before);checks++;
for(const row of predecessors) {
 const current=(await db.query('SELECT pg_get_functiondef($1::regprocedure) AS d',[row.signature])).rows[0].d;
 assert.equal(current,row.definition.replace(/\nbegin\n/i,m=>m+'  PERFORM public.analytics_enter_writer_protocol();\n'));
}
checks++;
const target=predecessors.find(r=>r.signature==='nightly_xg_pipeline()');
const guarded=target.definition.replace(/\nbegin\n/i,m=>m+'  PERFORM public.analytics_enter_writer_protocol();\n');
await db.exec(guarded.replace('declare','declare -- unknown drift')+';');
await assert.rejects(db.exec(migration),/definition drift/);await db.exec('ROLLBACK');checks++;
await db.exec(guarded+';');
const helper=(await db.query("SELECT pg_get_functiondef('analytics_enter_writer_protocol()'::regprocedure) AS d")).rows[0].d;
await db.exec(helper.replace('declare v_prior text;','declare v_prior text; -- unknown drift')+';');
await assert.rejects(db.exec(migration),/helper drift/);await db.exec('ROLLBACK');checks++;
await db.exec(helper+';');
await db.exec(`CREATE TABLE raw_shots(id int PRIMARY KEY,xg_v5 float8);
 CREATE TABLE player_onice_xg(id int PRIMARY KEY,marker text);
 ALTER TABLE raw_shots ENABLE ROW LEVEL SECURITY; ALTER TABLE player_onice_xg ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON raw_shots,player_onice_xg TO service_role;
 INSERT INTO raw_shots VALUES(1,.2); INSERT INTO player_onice_xg VALUES(1,'prior good'); SET ROLE service_role;`);
const invoke='SELECT analytics_enter_writer_protocol()';
// PGlite reports NULL pg_locks.pid, so it cannot prove backend ownership checks.
const ownershipAvailable=(await db.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid()) AS yes')).rows[0].yes;
if(ownershipAvailable) {
for(const sql of ['UPDATE raw_shots SET xg_v5=.3 WHERE id=1','SELECT * FROM raw_shots FOR UPDATE',
 'LOCK TABLE raw_shots IN SHARE MODE',"UPDATE player_onice_xg SET marker='changed' WHERE id=1"]) {
 await db.exec('BEGIN');await db.exec(sql);await db.exec('SAVEPOINT prior');
 await assert.rejects(db.query(invoke),/Unsupported prior protected locks/);
 await db.exec('ROLLBACK TO prior');
 assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=60906 AND objid=54106")).rows[0].n,0);
 await db.exec('ROLLBACK');checks++;
}
await db.exec('BEGIN');await db.query(invoke);await db.exec('UPDATE raw_shots SET xg_v5=.3 WHERE id=1');
await db.query(invoke);await db.exec('ROLLBACK');checks++;
assert.equal((await db.query('SELECT xg_v5 FROM raw_shots WHERE id=1')).rows[0].xg_v5,.2);checks++;
await db.exec('BEGIN; SELECT * FROM raw_shots');await db.query(invoke);await db.exec('ROLLBACK');checks++;
await db.exec("BEGIN; SET LOCAL citrus.analytics_protocol='true'; UPDATE raw_shots SET xg_v5=.3 WHERE id=1");
await assert.rejects(db.query(invoke),/Unsupported prior protected locks/);await db.exec('ROLLBACK');checks++;
await db.exec('BEGIN; SELECT pg_advisory_xact_lock_shared(60906,54106)');
await assert.rejects(db.query(invoke),/prior analytics protocol lock mode/);await db.exec('ROLLBACK');checks++;
}
await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');await assert.rejects(db.query(invoke),/READ COMMITTED/);await db.exec('ROLLBACK');checks++;
await db.exec('RESET ROLE');
for(const row of predecessors)await db.exec(row.definition+';');
await db.exec('DROP FUNCTION analytics_enter_writer_protocol()');
assert.deepEqual(await metadata(),before);
for(const row of predecessors)assert.equal((await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) AS hash',[row.signature])).rows[0].hash,row.definition_md5);
checks++;
await db.close();console.log(`Analytics writer entry protocol: ${checks} checks passed (16 exact definitions; isolated PGlite; native ownership checks ${ownershipAvailable?'executed':'required separately: pg_locks.pid is NULL'})`);
