// Isolated PostgreSQL rehearsal: real order/sweep/notification functions,
// with a deliberately small ignition stub. No network or customer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const baseline = readFileSync(new URL('../../supabase/migrations/20260912050000_scheduled_draft_builds_its_own_order.sql', import.meta.url), 'utf8');
const repair = readFileSync(new URL('../../supabase/migrations/20260918172827_scheduled_draft_failure_isolation.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function fixture(fixed = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql as $$select nullif(current_setting('test.role', true), '')$$;
    create table leagues(id uuid primary key, commissioner_id uuid, scheduled_draft_time timestamptz,
      draft_status text default 'not_started', league_size int default 2, draft_rounds int default 3, settings jsonb default '{}');
    create table profiles(id uuid primary key);
    create table teams(id uuid primary key, league_id uuid, owner_id uuid);
    create table draft_order(league_id uuid, round_number int, team_order jsonb, draft_session_id uuid, deleted_at timestamptz,
      unique(league_id, round_number));
    create table notifications(league_id uuid, user_id uuid references profiles, type text, title text, message text, metadata jsonb);
    create table draft_metrics(metric text, league_id uuid, value int, detail jsonb, ts timestamptz default now());
    create table ignition(league_id uuid unique, key uuid);
    create table faults(league_id uuid, phase text);
    create function start_draft_v2(p_league_id uuid, p_actor jsonb, p_key uuid, p_correlation uuid) returns jsonb
    language plpgsql as $$begin
      if exists(select 1 from faults where league_id=p_league_id and phase='start') then
        raise exception 'injected ignition failure'; end if;
      insert into ignition values(p_league_id,p_key);
      update leagues set draft_status='in_progress' where id=p_league_id;
      return jsonb_build_object('was_duplicate',false,'first_pick_deadline',now()+interval '90 seconds');
    end$$;
    create function injected_failure() returns trigger language plpgsql as $$begin
      if exists(select 1 from faults where league_id=new.league_id and phase=tg_argv[0]) then
        raise exception 'injected % failure',tg_argv[0]; end if;
      return new;
    end$$;
    create trigger broken_order before insert on draft_order for each row execute function injected_failure('order');
    create trigger broken_notice before insert on notifications for each row execute function injected_failure('notice');
    insert into profiles values('${id(900)}'),('${id(901)}');
  `);
  await db.exec(baseline);
  if (fixed) await db.exec(repair);
  return db;
}

async function league(db, n, { type = 'snake', status = 'not_started', offset = '-1 minute', teams = 2 } = {}) {
  await db.query(`insert into leagues(id,commissioner_id,scheduled_draft_time,draft_status,settings)
    values($1,$2,now()+$3::interval,$4,$5)`, [id(n), id(900), offset, status, {draftType:type}]);
  for (let i = 0; i < teams; i++) await db.query('insert into teams values($1,$2,$3)', [id(n*10+i),id(n),id(900+i)]);
}
const sweep = async db => (await db.query('select * from start_due_scheduled_drafts()')).rows;

test('reproduces baseline preparation failure aborting the whole sweep', async () => {
  const db = await fixture(false);
  try {
    await league(db,1); await league(db,2);
    await db.query(`insert into faults values($1,'order')`,[id(1)]);
    await assert.rejects(sweep(db),/injected order failure/);
    assert.equal((await db.query('table ignition')).rows.length,0);
  } finally { await db.close(); }
});

for (const phase of ['order','start','notice']) test(`isolates ${phase} failures and still starts the next league`, async () => {
  const db = await fixture();
  try {
    await league(db,1); await league(db,2);
    await db.query('insert into faults values($1,$2)',[id(1),phase]);
    const results = await sweep(db);
    assert.deepEqual(results.map(r=>r.outcome),[phase==='notice'?'started':'failed','started']);
    assert.equal((await db.query('select * from ignition where league_id=$1',[id(2)])).rows.length,1);
    assert.equal((await db.query('select * from draft_order where league_id=$1',[id(1)])).rows.length,phase==='notice'?3:0);
    if (phase==='notice') assert.equal((await db.query("select * from draft_metrics where metric='scheduled_start_notification_failed'")).rows.length,1);
  } finally { await db.close(); }
});

test('only starts due live drafts; future, expired, offline and running drafts remain untouched', async () => {
  const db=await fixture();
  try {
    await league(db,1); await league(db,2,{offset:'10 minutes'});
    await league(db,3,{offset:'-121 minutes'}); await league(db,4,{type:'offline'});
    await league(db,5,{status:'in_progress'}); await league(db,6,{status:'completed'});
    assert.deepEqual((await sweep(db)).map(r=>r.league_id),[id(1)]);
    assert.equal((await db.query('select count(*)::int n from draft_order')).rows[0].n,3);
    assert.equal((await sweep(db)).length,0);
    assert.equal((await db.query('table ignition')).rows.length,1);
  } finally { await db.close(); }
});

for(const type of ['snake','linear']) test(`${type} builds all rounds and preserves a custom order`,async()=>{
  const db=await fixture();
  try{
    await league(db,1,{type});
    await sweep(db);
    const rows=(await db.query('select * from draft_order order by round_number')).rows;
    assert.equal(rows.length,3);
    assert.deepEqual(rows[1].team_order,type==='snake'?[...rows[0].team_order].reverse():rows[0].team_order);
    assert.deepEqual(rows[2].team_order,rows[0].team_order);
    assert.equal(new Set(rows.map(r=>r.draft_session_id)).size,1);
    await league(db,2,{type});
    const custom=[id(21),id(20)];
    await db.query('insert into draft_order values($1,1,$2,$3,null)',[id(2),JSON.stringify(custom),id(999)]);
    await sweep(db);
    assert.deepEqual((await db.query('select team_order from draft_order where league_id=$1',[id(2)])).rows,[{team_order:custom}]);
  }finally{await db.close();}
});

test('incomplete league retries safely, deduplicates notices, and starts when filled',async()=>{
  const db=await fixture();
  try{
    await league(db,1,{teams:1});
    assert.equal((await sweep(db))[0].outcome,'blocked');
    assert.equal((await sweep(db))[0].outcome,'blocked');
    assert.equal((await db.query('table notifications')).rows.length,1);
    assert.equal((await db.query('table draft_metrics')).rows.length,1);
    await db.query("update leagues set scheduled_draft_time=scheduled_draft_time-interval '1 minute'");
    await sweep(db);
    assert.equal((await db.query('table notifications')).rows.length,2);
    await db.query('insert into teams values($1,$2,$3)',[id(11),id(1),id(901)]);
    assert.equal((await sweep(db))[0].outcome,'started');
    assert.equal((await db.query("select * from notifications where metadata->>'kind'='scheduled_draft_started'")).rows.length,2);
  }finally{await db.close();}
});

test('customer roles cannot execute the scheduler or bypass its internal role guard',async()=>{
  const db=await fixture();
  try{
    for(const role of ['anon','authenticated']){
      assert.equal((await db.query("select has_function_privilege($1,'start_due_scheduled_drafts(integer)','execute') allowed",[role])).rows[0].allowed,false);
      await db.query("select set_config('test.role',$1,false)",[role]);
      await assert.rejects(sweep(db),/unauthorized/);
    }
    assert.match(repair,/for update of l skip locked/i);
  }finally{await db.close();}
});

