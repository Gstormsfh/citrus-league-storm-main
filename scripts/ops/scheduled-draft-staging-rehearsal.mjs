// Rollback-only rehearsal of the real staging ignition and event chain.
// No production target, persistent fixture, customer league or auth session.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const project='jjgspcpvqaiitloglxbb';
const connectionString=execFileSync('gcloud',['secrets','versions','access','latest',
  '--secret=SUPABASE_DB_URL','--project=citrus-fantasy-staging','--quiet'],
  {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const target=new URL(connectionString);
assert.ok(target.hostname===`db.${project}.supabase.co` ||
  (target.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(target.username)===`postgres.${project}`),
  'Only the fixed staging database is permitted');
const db=new pg.Client({connectionString,connectionTimeoutMillis:15000});
const users=[randomUUID(),randomUUID()];
const leagues=Array.from({length:5},()=>randomUUID());
const migration=readFileSync(new URL('../../supabase/migrations/20260918172827_scheduled_draft_failure_isolation.sql',import.meta.url),'utf8');
let before;
try{
  await db.connect();
  before=(await db.query("select pg_get_functiondef('public.start_due_scheduled_drafts(integer)'::regprocedure) definition")).rows[0].definition;
  await db.query('begin');
  await db.query("set local statement_timeout='20s'; set local lock_timeout='3s'");
  await db.query(migration);
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);
  // Grace zero selects only the transaction's exact now(). Guard explicitly
  // against touching any existing league before invoking the real sweep.
  assert.equal((await db.query("select count(*)::int n from leagues where scheduled_draft_time=now() and draft_status in ('not_started','queued')")).rows[0].n,0);
  for(const id of users) await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')",[id,`scheduler-${id}@example.invalid`]);
  for(const [i,id] of leagues.entries()){
    await db.query(`insert into leagues(id,name,commissioner_id,league_size,draft_rounds,scheduled_draft_time,settings)
      values($1,'Scheduled draft rollback rehearsal',$2,2,3,now(),$3)`,
      [id,users[0],JSON.stringify({draftType:i===4?'offline':'snake',pickTimeLimit:90})]);
    for(const [n,owner] of users.entries()) await db.query('insert into teams(league_id,team_name,owner_id) values($1,$2,$3)',[id,`Rehearsal ${n+1}`,owner]);
  }
  await db.query('create temporary table scheduler_rehearsal_faults(league_id uuid,phase text) on commit drop');
  await db.query('insert into scheduler_rehearsal_faults values($1,$2),($3,$4)',[leagues[0],'order',leagues[1],'notice']);
  await db.query(`create function public.citrus_scheduler_rollback_fault() returns trigger language plpgsql as $$begin
    if exists(select 1 from pg_temp.scheduler_rehearsal_faults f where f.league_id=new.league_id and f.phase=tg_argv[0]) then
      raise exception 'injected rehearsal failure'; end if; return new; end$$;
    create trigger citrus_scheduler_rollback_order before insert on draft_order for each row execute function public.citrus_scheduler_rollback_fault('order');
    create trigger citrus_scheduler_rollback_notice before insert on notifications for each row execute function public.citrus_scheduler_rollback_fault('notice');`);
  // A bad pick clock exercises the actual ignition's error path, not a stub.
  await db.query(`update leagues set settings=settings||'{"pickTimeLimit":"invalid"}'::jsonb where id=$1`,[leagues[2]]);
  const results=(await db.query('select * from start_due_scheduled_drafts(0)')).rows;
  assert.equal(results.length,4);
  const outcomes=new Map(results.map(r=>[r.league_id,r.outcome]));
  assert.equal(outcomes.get(leagues[0]),'failed');
  assert.equal(outcomes.get(leagues[1]),'started');
  assert.equal(outcomes.get(leagues[2]),'failed');
  assert.equal(outcomes.get(leagues[3]),'started');
  assert.equal(outcomes.has(leagues[4]),false);
  const events=(await db.query("select league_id,count(*)::int n from draft_events where league_id=any($1::uuid[]) and event_type='draft_started' group by league_id",[leagues])).rows;
  assert.equal(events.length,2);assert.ok(events.every(r=>r.n===1));
  for(const id of [leagues[1],leagues[3]]){
    const state=(await db.query('select draft_status,draft_state,pick_deadline from leagues where id=$1',[id])).rows[0];
    assert.equal(state.draft_status,'in_progress');assert.equal(state.draft_state,'active');assert.ok(state.pick_deadline);
  }
  assert.equal((await db.query("select count(*)::int n from draft_metrics where league_id=$1 and metric='scheduled_start_notification_failed'",[leagues[1]])).rows[0].n,1);
  const retry=(await db.query('select * from start_due_scheduled_drafts(0)')).rows;
  assert.equal(retry.length,2);assert.ok(retry.every(r=>r.outcome==='failed'));
  assert.equal((await db.query("select count(*)::int n from draft_events where league_id=any($1::uuid[]) and event_type='draft_started'",[leagues])).rows[0].n,2);
  await db.query('rollback');
  assert.equal((await db.query("select pg_get_functiondef('public.start_due_scheduled_drafts(integer)'::regprocedure) definition")).rows[0].definition,before);
  assert.equal((await db.query('select count(*)::int n from leagues where id=any($1::uuid[])',[leagues])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from auth.users where id=any($1::uuid[])',[users])).rows[0].n,0);
  console.log(JSON.stringify({status:'PASS',project,real_ignition:true,started:2,isolated_failures:2,notice_failure_preserved_start:true,offline_skipped:true,retry_duplicate_events:0,rollback_verified:true,production_writes:false}));
}catch(error){
  await db.query('rollback').catch(()=>{});
  console.error(JSON.stringify({status:'FAIL',code:error.code||error.name,message:error.message}));
  process.exitCode=1;
}finally{await db.end();}
