// Native-only: explicit empty disposable localhost PostgreSQL; never hosted.
// ANALYTICS_TEST_PG_PORT=<port> node scripts/test_xg_season_refresh_races.mjs
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const port=Number(process.env.ANALYTICS_TEST_PG_PORT);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Explicit disposable local PG port required');
const clients=Array.from({length:3},()=>new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',
  password:'',ssl:false,connectionTimeoutMillis:3000,application_name:'citrus-disposable-xg-refresh-race'}));
const [admin,a,b]=clients,connected=new Set(),witnesses=[];
let owned=false,result;
const tables=['player_xg_season','goalie_xg_season','team_xg_season'];
// Native float8 sums can vary with tuple visitation order after UPDATE.
// Absolute 1e-12 is only for these small synthetic aggregate fixtures; never
// apply it to failure-preservation snapshots, identities, counts, or nulls.
const mathAbsoluteTolerance=1e-12;
const floatFields=new Set(['xg','finishing','xg_ev','xg_pp','xg_pk','xg_en','avg_dist',
  'avg_xg_per_shot','xg_faced','gsax','xg_faced_ev','xg_faced_pk',
  'avg_shot_dist_faced','xg_for','xg_against']);
let observedMaxAbsoluteMathDrift=0;
function assertMathEquivalent(actual,expected) {
  assert.equal(actual.length,expected.length);
  for(let table=0;table<expected.length;table++) {
    assert.equal(actual[table].length,expected[table].length);
    for(let index=0;index<expected[table].length;index++) {
      const left=actual[table][index].row,right=expected[table][index].row;
      assert.deepEqual(Object.keys(left).sort(),Object.keys(right).sort());
      for(const key of Object.keys(right)) {
        if(floatFields.has(key)&&typeof left[key]==='number'&&typeof right[key]==='number') {
          assert.ok(Number.isFinite(left[key])&&Number.isFinite(right[key]),`Nonfinite ${key}`);
          const drift=Math.abs(left[key]-right[key]);
          observedMaxAbsoluteMathDrift=Math.max(observedMaxAbsoluteMathDrift,drift);
          assert.ok(drift<=mathAbsoluteTolerance,`${tables[table]} ${key} drift ${drift}`);
        } else assert.deepEqual(left[key],right[key],`${tables[table]} ${key}`);
      }
    }
  }
}
const cases=[];
const emptySQL=`SELECT
  (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')+
  (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
  (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
  (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS n`;
try {
  const states=await Promise.allSettled(clients.map(async client=>{
    await client.connect();connected.add(client);
    await client.query("SET statement_timeout='8s'; SET lock_timeout='6s'; SET idle_in_transaction_session_timeout='15s'");
  }));
  for(const state of states) if(state.status==='rejected') throw state.reason;
  assert.equal(Number((await admin.query(emptySQL)).rows[0].n),0,'Refusing nonempty database/fixture roles');
  const capture=await readFile(new URL('../supabase/migrations/captures/2026-09-06_pre_guard_xg_season_refresh_inputs.sql',import.meta.url),'utf8');
  assert.equal(createHash('md5').update(capture).digest('hex'),'4ed76fd708c6ff03c79891241f9dd7ce');
  const migration=await readFile(new URL('../supabase/migrations/20260906035158_guard_xg_season_refresh_inputs.sql',import.meta.url),'utf8');
  // Reuse only the exact synthetic SQL fixture from the isolated math regression.
  // No eval/import executes that harness or its PGlite-only scenarios.
  const fixtureSource=await readFile(new URL('./test_xg_season_refresh_guard.mjs',import.meta.url),'utf8');
  const match=fixtureSource.match(/await db\.exec\(`(CREATE ROLE anon;[\s\S]*?)`\);/);
  assert.ok(match,'Synthetic fixture boundary missing');
  assert.equal((match[1].match(/\$\{/g)||[]).length,1,'Unexpected fixture interpolation');
  assert.ok(match[1].includes('${capture}'));
  await admin.query('BEGIN');
  try {await admin.query(match[1].replace('${capture}',capture));await admin.query('COMMIT');owned=true;}
  catch(error) {await admin.query('ROLLBACK');throw error;}
  await admin.query(migration);
  await a.query('SET ROLE service_role');await b.query('SET ROLE service_role');
  const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
  assert.equal(new Set(pids).size,3);
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
    throw new Error(`No independent-backend exact relation lock witness: ${scenario}`);
  }
  const refresh=c=>c.query('SELECT * FROM refresh_xg_season_layer(2025)');
  const settle=promise=>promise.then(()=>null,error=>error);
  const snapshot=async({other=false,math=false}={})=>{
    const rows=[];
    for(const table of tables) {
      const entity=table==='player_xg_season'?'player_id':table==='goalie_xg_season'?'goalie_id':'team_id';
      rows.push((await admin.query(`SELECT to_jsonb(t)${math?"-'updated_at'":''} AS row
        FROM ${table} t ${other?'WHERE season<>2025':''}
        ORDER BY season,game_type,${entity}${entity==='team_id'?'':',team_id'}`)).rows);
    }
    return rows;
  };
  const others=await snapshot({other:true});
  await refresh(a);
  const baseline=await snapshot({math:true});
  async function rejected(query,pattern) {
    const before=await snapshot();await assert.rejects(b.query(query),pattern);
    assert.deepEqual(await snapshot(),before);
  }
  await rejected('SELECT * FROM refresh_xg_season_layer(2026)',/empty/);
  cases.push('empty requested season preserves every prior output');

  await a.query('BEGIN');await refresh(a);
  let pending=settle(b.query('UPDATE nhl_shots SET xg_sql=NULL WHERE event_id=1'));
  await blocked('source writer waits through refresh commit','nhl_shots','RowExclusiveLock');
  await a.query('COMMIT');assert.equal(await pending,null);
  await rejected('SELECT * FROM refresh_xg_season_layer(2025)',/missing or invalid probabilities/);
  cases.push('post-refresh invalid source cannot damage published outputs');

  await a.query('BEGIN');await a.query('UPDATE nhl_shots SET xg_sql=.6 WHERE event_id=1');
  pending=settle(refresh(b));
  await blocked('refresh waits for correction commit','nhl_shots','ShareLock');
  await a.query('COMMIT');assert.equal(await pending,null);
  assertMathEquivalent(await snapshot({math:true}),baseline);
  cases.push('committed correction then replay restores baseline math within float-only tolerance');

  const beforeInvalid=await snapshot();
  await a.query('BEGIN');await a.query('UPDATE nhl_shots SET xg_sql=NULL WHERE event_id=1');
  pending=settle(refresh(b));
  await blocked('refresh sees preceding invalid source commit','nhl_shots','ShareLock');
  await a.query('COMMIT');assert.match((await pending)?.message??'',/missing or invalid probabilities/);
  assert.deepEqual(await snapshot(),beforeInvalid);
  cases.push('overlapping invalid source commit rejects without any output mutation');
  await admin.query('UPDATE nhl_shots SET xg_sql=.6 WHERE event_id=1');

  await a.query('BEGIN');await a.query('UPDATE nhl_shots SET xg_sql=NULL WHERE event_id=1');
  pending=settle(refresh(b));
  await blocked('refresh sees preceding source rollback','nhl_shots','ShareLock');
  await a.query('ROLLBACK');assert.equal(await pending,null);
  assertMathEquivalent(await snapshot({math:true}),baseline);
  cases.push('source rollback cannot leak uncommitted invalid input');

  for(const table of tables) {
    await a.query('BEGIN');await refresh(a);
    pending=settle(b.query(`UPDATE ${table} SET updated_at=updated_at WHERE season=2024`));
    await blocked(`${table} writer waits through refresh commit`,table,'RowExclusiveLock');
    await a.query('COMMIT');assert.equal(await pending,null);
  }
  cases.push('all three output writers serialize after refresh');
  await a.query('BEGIN');await refresh(a);
  pending=settle(refresh(b));
  await blocked('second refresh waits at first output lock','goalie_xg_season','ShareRowExclusiveLock');
  await a.query('COMMIT');assert.equal(await pending,null);
  assertMathEquivalent(await snapshot({math:true}),baseline);
  assert.deepEqual(await snapshot({other:true}),others);
  cases.push('independent refresh replay preserves math and other-season exact rows');
  result={status:'passed',postgres:(await admin.query('SHOW server_version')).rows[0].server_version,
    independentConnections:3,backendPids:pids,lockWitnesses:witnesses,cases,
    mathEquivalence:{absoluteTolerance:mathAbsoluteTolerance,observedMaxAbsoluteDrift:observedMaxAbsoluteMathDrift,
      floatFields:[...floatFields].sort(),scope:'successful synthetic replay aggregates only; failure snapshots and other-season rows exact'},
    migrationSha256:createHash('sha256').update(migration).digest('hex'),
    limitations:['synthetic recorded population only','not absent-game coverage, model lineage, or production load proof']};
} finally {
  await Promise.allSettled([...connected].map(c=>c.query('ROLLBACK')));
  await Promise.allSettled([a,b].map(c=>c.end()));
  try {
    if(owned) {
      await admin.query(`DROP FUNCTION refresh_xg_season_layer(integer);
        DROP TABLE player_xg_season,goalie_xg_season,team_xg_season,nhl_shots;
        DROP ROLE service_role; DROP ROLE authenticated; DROP ROLE anon;`);
      assert.equal(Number((await admin.query(emptySQL)).rows[0].n),0,'Fixture cleanup residue');
      if(result) result.cleanup='verified: zero public objects, fixture roles, or user schemas';
    }
  } finally {await admin.end();}
}
console.log(JSON.stringify(result));
