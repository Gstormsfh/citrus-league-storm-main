// Native proof only. Explicit empty disposable localhost PostgreSQL required.
// ANALYTICS_TEST_PG_PORT=<port> node scripts/test_onice_rebuild_races.mjs
// Caller owns exact Docker container lifecycle; this harness owns SQL fixtures.
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const port=Number(process.env.ANALYTICS_TEST_PG_PORT);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Explicit disposable local PG port required');
const clients=Array.from({length:3},()=>new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password:'',
 ssl:false,connectionTimeoutMillis:3000,application_name:'citrus-disposable-onice-race'}));
const [admin,a,b]=clients,connected=new Set(),witnesses=[],cases=[];let owned=false,result;
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
 const rebuild=c=>c.query('SELECT rebuild_onice_xg(ARRAY[2025020001])');
 const settle=p=>p.then(()=>null,e=>e);
 const snapshot=async(math=false)=>(await admin.query(`SELECT to_jsonb(t)${math?"-'built_at'":''} AS row
  FROM player_onice_xg t ORDER BY game_id,player_id,state`)).rows;
 const markers=async()=>(await admin.query('SELECT * FROM strength_build_state ORDER BY game_id')).rows;
 async function blocked(scenario,table,mode) {
  const deadline=Date.now()+3000;
  while(Date.now()<deadline) {
   const {rows:[state]}=await admin.query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'mode',l.mode)),'[]'::jsonb)
     FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE l.pid=$1 AND NOT l.granted) AS waiting_locks
    FROM pg_stat_activity WHERE pid=$1`,[pids[2]]);
   if(state.wait_event_type==='Lock'&&state.blockers.includes(pids[1])
      &&state.waiting_locks.some(l=>l.table===table&&l.mode===mode)) {
    witnesses.push({scenario,blocker_pid:pids[1],...state});return;
   }
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error(`Missing independent exact relation lock witness: ${scenario}`);
 }
 await rebuild(a);const baseline=await snapshot(true);
 const priorOther=(await snapshot()).filter(r=>r.row.game_id===2024020001);
 // Each source table remains locked until transaction commit, not just return.
 for(const [table,sql] of [
  ['raw_shots','UPDATE raw_shots SET xg_v5=xg_v5 WHERE id=1'],
  ['player_shifts_official','UPDATE player_shifts_official SET team_id=team_id WHERE player_id=100'],
  ['game_teams','UPDATE game_teams SET home_id=home_id'],
  ['game_strength_intervals','UPDATE game_strength_intervals SET start_s=start_s'],
  ['rebound_window_era','UPDATE rebound_window_era SET max_gap_s=max_gap_s'],
 ]) {
  await a.query('BEGIN');await rebuild(a);const pending=settle(b.query(sql));
  await blocked(`${table} source writer waits for rebuild commit`,table,'RowExclusiveLock');
  await a.query('COMMIT');assert.equal(await pending,null);
 }
 cases.push('all five source writers serialized until builder commit');
 const before=await snapshot(),beforeMarkers=await markers();
 await a.query('BEGIN');await a.query('UPDATE raw_shots SET xg_v5=NULL WHERE id=1');
 let pending=settle(b.query('SELECT * FROM citrus_build_onice_batch(100)'));
 await blocked('batch observes preceding invalid source commit','raw_shots','ShareLock');
 await a.query('COMMIT');assert.match((await pending)?.message??'',/Invalid or duplicate/);
 assert.deepEqual(await snapshot(),before);assert.deepEqual(await markers(),beforeMarkers);
 cases.push('invalid source commit leaves prior outputs and completion markers exact');
 await a.query('BEGIN');await a.query('UPDATE raw_shots SET xg_v5=.2 WHERE id=1');
 pending=settle(b.query('SELECT * FROM citrus_build_onice_batch(100)'));
 await blocked('batch observes preceding correction commit','raw_shots','ShareLock');
 await a.query('COMMIT');assert.equal(await pending,null);
 assert.deepEqual(await snapshot(true),baseline);assert.ok((await markers())[0].onice_built_at);
 cases.push('correction commit enables exact-math replay and completion');
 await a.query('BEGIN');await a.query('UPDATE raw_shots SET xg_v5=NULL WHERE id=1');
 pending=settle(rebuild(b));await blocked('builder observes source rollback','raw_shots','ShareLock');
 await a.query('ROLLBACK');assert.equal(await pending,null);assert.deepEqual(await snapshot(true),baseline);
 cases.push('rolled-back invalid source cannot leak into candidate');
 await a.query('BEGIN');await rebuild(a);
 pending=settle(b.query('UPDATE player_onice_xg SET built_at=built_at WHERE game_id=2024020001'));
 await blocked('output writer waits for builder commit','player_onice_xg','RowExclusiveLock');
 await a.query('COMMIT');assert.equal(await pending,null);
 cases.push('independent output writer serializes');
 await a.query('BEGIN');await rebuild(a);pending=settle(rebuild(b));
 await blocked('second builder waits for first commit','player_onice_xg','ShareRowExclusiveLock');
 await a.query('COMMIT');assert.equal(await pending,null);
 assert.deepEqual(await snapshot(true),baseline);
 assert.deepEqual((await snapshot()).filter(r=>r.row.game_id===2024020001),priorOther);
 cases.push('two builders serialize and preserve other-game exact rows');
 result={status:'passed',postgres:(await admin.query('SHOW server_version')).rows[0].server_version,
  independentConnections:3,backendPids:pids,lockWitnesses:witnesses,cases,
  migrationSha256:createHash('sha256').update(migration).digest('hex'),
  limitations:['synthetic basic both-team attribution only','not full shift coverage or unreviewed-writer deadlock proof']};
} finally {
 await Promise.allSettled([...connected].map(c=>c.query('ROLLBACK')));
 await Promise.allSettled([a,b].map(c=>c.end()));
 try {
  if(owned) {
   await admin.query(`DROP FUNCTION citrus_build_onice_batch(integer),rebuild_onice_xg(integer[]),citrus_rebound_window(integer);
    DROP TABLE strength_build_state,shift_ingest_quality,player_onice_xg,rebound_window_era,
      game_strength_intervals,game_teams,player_shifts_official,raw_shots;
    DROP ROLE service_role; DROP ROLE authenticated; DROP ROLE anon;`);
   assert.equal(Number((await admin.query(residueSQL)).rows[0].n),0,'Fixture cleanup residue');
   if(result) result.cleanup='verified: zero public objects, fixture roles, or user schemas';
  }
 } finally {await admin.end();}
}
console.log(JSON.stringify(result));
