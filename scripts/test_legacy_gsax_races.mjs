// Requires an empty disposable localhost PostgreSQL instance. No hosted access.
// ANALYTICS_TEST_PG_PORT=<explicit local port> node scripts/test_legacy_gsax_races.mjs
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const port=Number(process.env.ANALYTICS_TEST_PG_PORT);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Explicit disposable local PG port required');
const clients=Array.from({length:3},()=>new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',
  password:'',ssl:false,connectionTimeoutMillis:3000,application_name:'citrus-disposable-gsax-race'}));
const [admin,a,b]=clients;
const connected=new Set();
let fixturesOwned=false,result,checks=0;
const lockWitnesses=[];
try {
  const connections=await Promise.allSettled(clients.map(async client=>{
    await client.connect();connected.add(client);
    await client.query("SET statement_timeout='5s'; SET lock_timeout='4s'; SET idle_in_transaction_session_timeout='10s'");
  }));
  for(const state of connections) if(state.status==='rejected') throw state.reason;
  const {rows:[existing]}=await admin.query(`SELECT
    (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')+
    (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
    (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS n`);
  assert.equal(Number(existing.n),0,'Refusing nonempty database or pre-existing fixture roles');
  const capture=await readFile(new URL('../supabase/migrations/captures/2026-09-06_pre_guard_legacy_gsax_season_rebuild.sql',import.meta.url),'utf8');
  assert.equal(createHash('md5').update(capture).digest('hex'),'fcedc5b3881858ba74b3113b064058f4');checks++;
  await admin.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS');
  fixturesOwned=true;
  await admin.query(`CREATE TABLE nhl_shots(event_id int PRIMARY KEY,season int,game_type text,goalie_id int,event_type text,is_goal boolean,is_empty_net boolean,xg_sql float8);
    CREATE TABLE goalie_xg_season(season int,game_type text,goalie_id int,team_id int,shots_faced int,sog_faced int,goals_allowed int,xg_faced float8,gsax float8,PRIMARY KEY(season,game_type,goalie_id,team_id));
    CREATE TABLE goalie_gsax_primary(goalie_id int PRIMARY KEY,total_shots_faced int,total_xga numeric,total_ga int,raw_gsax numeric,regressed_gsax numeric,league_sv_pct numeric,calculated_at timestamptz,updated_at timestamptz,season int);
    ALTER TABLE nhl_shots ENABLE ROW LEVEL SECURITY; ALTER TABLE goalie_xg_season ENABLE ROW LEVEL SECURITY; ALTER TABLE goalie_gsax_primary ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
    ${capture};
    REVOKE ALL ON FUNCTION rebuild_goalie_gsax_primary(integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION rebuild_goalie_gsax_primary(integer) TO service_role;
    INSERT INTO nhl_shots VALUES(1,2025,'regular',1,'goal',true,false,.5),(2,2025,'regular',1,'missed-shot',false,false,.25);
    INSERT INTO goalie_xg_season VALUES(2025,'regular',1,10,2,1,1,.75,-.25);
    INSERT INTO goalie_gsax_primary(goalie_id,season,total_shots_faced) VALUES(99,2024,70);`);
  await admin.query(await readFile(new URL('../supabase/migrations/20260906024510_guard_legacy_gsax_season_rebuild.sql',import.meta.url),'utf8'));
  await a.query('SET ROLE service_role');await b.query('SET ROLE service_role');
  const pids=await Promise.all(clients.map(async client=>(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
  assert.equal(new Set(pids).size,3);checks++;
  const [,blockerPid,pid]=pids;
  async function blocked(scenario,table,mode) {
    const until=Date.now()+2500;
    while(Date.now()<until) {
      const {rows:[state]}=await admin.query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'mode',l.mode)),'[]'::jsonb)
         FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE l.pid=$1 AND NOT l.granted) AS waiting_locks
        FROM pg_stat_activity WHERE pid=$1`,[pid]);
      if(state.wait_event_type==='Lock'&&state.blockers.includes(blockerPid)
        &&state.waiting_locks.some(lock=>lock.table===table&&lock.mode===mode)) {
        lockWitnesses.push({scenario,...state});checks++;return;
      }
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error(`Expected exact backend/relationship lock witness: ${scenario}`);
  }
  const rebuild=client=>client.query('SELECT * FROM rebuild_goalie_gsax_primary(2025)');
  const snapshot=async()=>(await admin.query('SELECT to_jsonb(g) AS row FROM goalie_gsax_primary g ORDER BY goalie_id')).rows;
  async function rejectWithoutMutation(sql,pattern) {
    const before=await snapshot();
    await assert.rejects(b.query(sql),pattern);
    assert.deepEqual(await snapshot(),before);checks++;
  }
  await rebuild(a);
  await rejectWithoutMutation('SELECT * FROM rebuild_goalie_gsax_primary(2026)',/empty/);

  // Source mutations cannot enter after the guard checks but before commit.
  await a.query('BEGIN');await rebuild(a);
  const shotWrite=b.query("INSERT INTO nhl_shots VALUES(3,2025,'regular',1,'missed-shot',false,false,.1)").then(()=>null,error=>error);
  await blocked('recorded shot writer waits for rebuild commit','nhl_shots','RowExclusiveLock');
  await a.query('COMMIT');assert.equal(await shotWrite,null);checks++;
  await rejectWithoutMutation('SELECT * FROM rebuild_goalie_gsax_primary(2025)',/incomplete or inconsistent/);
  await admin.query('DELETE FROM nhl_shots WHERE event_id=3');

  await a.query('BEGIN');await rebuild(a);
  const aggregateWrite=b.query('UPDATE goalie_xg_season SET xg_faced=9 WHERE season=2025').then(()=>null,error=>error);
  await blocked('aggregate writer waits for rebuild commit','goalie_xg_season','RowExclusiveLock');
  await a.query('COMMIT');assert.equal(await aggregateWrite,null);checks++;
  await rejectWithoutMutation('SELECT * FROM rebuild_goalie_gsax_primary(2025)',/incomplete or inconsistent/);
  await admin.query('UPDATE goalie_xg_season SET xg_faced=.75 WHERE season=2025');

  // A prior source writer commits incomplete data while B waits for source lock.
  const before=await snapshot();
  await a.query('BEGIN');await a.query('UPDATE nhl_shots SET xg_sql=NULL WHERE event_id=1');
  const invalidRebuild=rebuild(b).then(()=>null,error=>error);
  await blocked('rebuild sees preceding source commit','nhl_shots','ShareLock');
  await a.query('COMMIT');assert.match((await invalidRebuild)?.message??'',/unresolved or unscored/);
  assert.deepEqual(await snapshot(),before);checks++;
  await admin.query('UPDATE nhl_shots SET xg_sql=.5 WHERE event_id=1');

  // Rolled-back source changes must not cause a stale/partial rebuild.
  await a.query('BEGIN');await a.query('UPDATE nhl_shots SET xg_sql=NULL WHERE event_id=1');
  const afterRollback=rebuild(b).then(()=>null,error=>error);
  await blocked('rebuild sees preceding source rollback','nhl_shots','ShareLock');
  await a.query('ROLLBACK');assert.equal(await afterRollback,null);checks++;

  // Legacy output remains mutable, but another writer cannot interleave writes.
  await a.query('BEGIN');await rebuild(a);
  const outputWrite=b.query('UPDATE goalie_gsax_primary SET total_shots_faced=71 WHERE goalie_id=99').then(()=>null,error=>error);
  await blocked('output writer waits for rebuild commit','goalie_gsax_primary','RowExclusiveLock');
  await a.query('COMMIT');assert.equal(await outputWrite,null);checks++;
  const {rows:finalRows}=await admin.query('SELECT goalie_id,season,total_shots_faced,total_xga::text,raw_gsax::text,regressed_gsax::text FROM goalie_gsax_primary ORDER BY goalie_id');
  assert.deepEqual(finalRows,[{goalie_id:1,season:2025,total_shots_faced:2,total_xga:'0.7500',raw_gsax:'-0.2500',regressed_gsax:'-0.0010'},
    {goalie_id:99,season:2024,total_shots_faced:71,total_xga:null,raw_gsax:null,regressed_gsax:null}]);checks++;
  const {rows:[version]}=await admin.query('SHOW server_version');
  result={checks,postgres:version.server_version,independentConnections:3,lockWitnesses,status:'passed'};
} finally {
  await Promise.allSettled([...connected].map(client=>client.query('ROLLBACK')));
  await Promise.allSettled([a,b].map(client=>client.end()));
  try {
    if(fixturesOwned) {
      await admin.query(`DROP FUNCTION IF EXISTS rebuild_goalie_gsax_primary(integer);
        DROP TABLE IF EXISTS goalie_gsax_primary,goalie_xg_season,nhl_shots;
        DROP ROLE service_role; DROP ROLE authenticated; DROP ROLE anon;`);
      const {rows:[residue]}=await admin.query(`SELECT
        (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
        (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
        (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS n`);
      assert.equal(Number(residue.n),0,'GSAx fixture cleanup left objects/roles');
      if(result) result.cleanup='verified: zero fixture objects/roles';
    }
  } finally {await admin.end();}
}
console.log(JSON.stringify(result));
