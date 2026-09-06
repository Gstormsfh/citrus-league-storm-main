// Requires a NEW, EMPTY, disposable local Postgres database. Refuses remote
// hosts. No production/staging credentials are used or accepted by this script.
import { Client } from 'pg';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const port = Number(process.env.ANALYTICS_TEST_PG_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Explicit disposable local PG port required');
const clients = Array.from({length:3},()=>new Client({host:'127.0.0.1',port,user:'postgres',
  database:'postgres',password:'',ssl:false,connectionTimeoutMillis:3000,
  application_name:'citrus-disposable-analytics-race'}));
const [admin,a,b]=clients;
const connected=new Set();
let fixturesOwned=false;
let result;
let checks=0;
const lockWitnesses=[];
try {
  const connections=await Promise.allSettled(clients.map(async client=>{
    await client.connect();connected.add(client);
    await client.query("SET statement_timeout='5s'; SET lock_timeout='4s'; SET idle_in_transaction_session_timeout='10s';");
  }));
  for(const state of connections) if(state.status==='rejected') throw state.reason;
  const {rows:[existing]}=await admin.query(`SELECT
    (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')+
    (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
    (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS n`);
  if(Number(existing.n)!==0) throw new Error('Refusing nonempty database or pre-existing fixture roles');
  await admin.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS');
  fixturesOwned=true;
  for(const file of ['20260906005705_analytics_versioned_publication_contract.sql','20260906013428_analytics_canonical_event_observations.sql']) {
    await admin.query(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  await a.query('SET ROLE service_role'); await b.query('SET ROLE service_role');
  const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const blockerPid=(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.notEqual(pid,blockerPid);
  const adminPid=(await admin.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.equal(new Set([pid,blockerPid,adminPid]).size,3);
  async function blocked(scenario) {
    const until=Date.now()+2500;
    while(Date.now()<until) {
      const {rows:[state]}=await admin.query('SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1',[pid]);
      if(state.wait_event_type==='Lock' && state.blockers.includes(blockerPid)) {
        lockWitnesses.push({scenario,...state});checks++;return;
      }
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error('Expected independent connection to block on row lock');
  }
  async function batch() {
    const sid=randomUUID(),bid=randomUUID();
    await admin.query("INSERT INTO analytics_source_snapshots(id,source,observed_at,payload) VALUES($1,'race',now()-interval '1 day','{}')",[sid]);
    await admin.query(`INSERT INTO analytics_metric_batches(id,source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,expected_entities,validation)
      VALUES($1,$2,'fixture','v1','unit',2025,'regular','skaters','v1','none',$3,now(),1,
      jsonb_build_object('status','passed','entity_ids',jsonb_build_array(1),'gate_version','fixture-v1',
      'evidence_sha256',repeat('a',64),'freshness_observed_at','2020-01-01T00:00:00Z'))`,[bid,sid,'0'.repeat(40)]);
    return bid;
  }
  const value=(client,id,entity=1)=>client.query("INSERT INTO analytics_metric_values VALUES($1,$2,1,'available','verified',NULL)",[id,entity]);
  const publish=(client,id)=>client.query("INSERT INTO analytics_publications(batch_id,reason) VALUES($1,'race test')",[id]);
  // A inserts final value; B must wait, then observe the committed complete set.
  const first=await batch();
  await a.query('BEGIN'); await value(a,first);
  const awaitingPublish=publish(b,first).then(()=>null,error=>error);
  await blocked('publish waits for final value commit'); await a.query('COMMIT');
  assert.equal(await awaitingPublish,null);checks++;
  // A publishes; B's pre-existing statement must see the seal after waiting.
  const second=await batch(); await value(a,second);
  await a.query('BEGIN'); await publish(a,second);
  const awaitingInsert=value(b,second,2).then(()=>null,error=>error);
  await blocked('value append waits for publication commit'); await a.query('COMMIT');
  assert.match((await awaitingInsert)?.message ?? '',/sealed/);checks++;
  // Rolled-back final value cannot be mistaken for a complete batch.
  const third=await batch();await a.query('BEGIN');await value(a,third);
  const rolledBack=publish(b,third).then(()=>null,error=>error);
  await blocked('publish waits for final value rollback');await a.query('ROLLBACK');
  assert.match((await rolledBack)?.message ?? '',/Incomplete/);checks++;
  // Snapshot isolation cannot bypass a later seal by seeing stale membership.
  await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await assert.rejects(value(b,second,3),/READ COMMITTED/);checks++;
  await b.query('ROLLBACK');
  await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await assert.rejects(publish(b,second),/READ COMMITTED/);checks++;
  await b.query('ROLLBACK');

  const [snapshot,events,manifest]=JSON.parse(execFileSync('python3',['-c',`
import json
from acquisition.event_observation_service import prepare_observation
from tests.test_canonical_events import game,shot
print(json.dumps(prepare_observation(game([shot()]),'2026-01-01T00:00:00Z')))
`],{cwd:new URL('../data-pipeline/',import.meta.url),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'}));
  async function insert(client,table,row) {
    const keys=Object.keys(row);
    return client.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
  }
  await insert(a,'analytics_source_snapshots',snapshot);
  await a.query('BEGIN');await insert(a,'analytics_event_observations',events[0]);
  const seal=insert(b,'analytics_event_observation_sets',manifest).then(()=>null,error=>error);
  await blocked('seal waits for final observation commit');await a.query('COMMIT');assert.equal(await seal,null);checks++;
  const sealingId=randomUUID();
  await insert(a,'analytics_source_snapshots',{...snapshot,id:sealingId,observed_at:'2026-01-02T00:00:00Z'});
  await insert(a,'analytics_event_observations',{...events[0],snapshot_id:sealingId});
  await a.query('BEGIN');
  await insert(a,'analytics_event_observation_sets',{...manifest,snapshot_id:sealingId});
  const append=insert(b,'analytics_event_observations',{...events[0],snapshot_id:sealingId,event_id:2}).then(()=>null,error=>error);
  await blocked('observation append waits for seal commit');await a.query('COMMIT');assert.match((await append)?.message ?? '',/sealed/);checks++;
  // A's uncommitted final observation disappears; B must reject its seal.
  const rollbackId=randomUUID();
  await insert(a,'analytics_source_snapshots',{...snapshot,id:rollbackId,observed_at:'2026-01-03T00:00:00Z'});
  await a.query('BEGIN');
  await insert(a,'analytics_event_observations',{...events[0],snapshot_id:rollbackId});
  const rollbackSeal=insert(b,'analytics_event_observation_sets',{...manifest,snapshot_id:rollbackId}).then(()=>null,error=>error);
  await blocked('seal waits for final observation rollback');await a.query('ROLLBACK');
  assert.match((await rollbackSeal)?.message ?? '',/Incomplete or conflicting/);checks++;
  await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await assert.rejects(insert(b,'analytics_event_observations',{...events[0],event_id:3}),/READ COMMITTED/);checks++;
  await b.query('ROLLBACK');
  await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await assert.rejects(insert(b,'analytics_event_observation_sets',{...manifest,snapshot_id:rollbackId}),/READ COMMITTED/);checks++;
  await b.query('ROLLBACK');
  const {rows:[counts]}=await admin.query(`SELECT
    (SELECT count(*)::int FROM analytics_publications) AS publications,
    (SELECT count(*)::int FROM analytics_metric_values) AS values,
    (SELECT count(*)::int FROM analytics_event_observation_sets) AS seals,
    (SELECT count(*)::int FROM analytics_event_observations) AS observations`);
  assert.deepEqual(counts,{publications:2,values:2,seals:2,observations:2});checks++;
  const {rows:[version]}=await admin.query('SHOW server_version');
  result={checks,postgres:version.server_version,independentConnections:3,lockWitnesses,status:'passed'};
} finally {
  // Release every in-flight lock before cleanup; never remove pre-existing data.
  await Promise.allSettled([...connected].map(client=>client.query('ROLLBACK')));
  await Promise.allSettled([a,b].map(client=>client.end()));
  try {
    if(fixturesOwned) {
      await admin.query(`DROP TABLE IF EXISTS analytics_event_observation_sets,analytics_event_observations,
        analytics_publications,analytics_metric_values,analytics_metric_batches,analytics_source_snapshots;
        DROP FUNCTION IF EXISTS analytics_guard_event_append(),analytics_guard_event_seal(),
        analytics_guard_publication(),analytics_guard_value_insert(),analytics_hash_snapshot(),analytics_deny_revision();
        DROP ROLE service_role; DROP ROLE authenticated; DROP ROLE anon;`);
      const {rows:[residue]}=await admin.query(`SELECT
        (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
        (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
        (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS n`);
      assert.equal(Number(residue.n),0,'Disposable fixture cleanup left objects/roles');
      if(result) result.cleanup='verified: zero fixture objects/roles';
    }
  } finally {await admin.end();}
}
console.log(JSON.stringify(result));
