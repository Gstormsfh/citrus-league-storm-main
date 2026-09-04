#!/usr/bin/env bash
# CITRUS-CLASSIFICATION ----------------------------------------------------------
# CATEGORY: PROOF (scratch Postgres only; never points at a Supabase project)
# Purpose:     Prove 20260903190000_faab_waiver_gate_due_since_last_run.sql and
#              20260903191000_should_process_waivers_now_per_league_boolean.sql
#              against prod-shaped tables: the OLD 30-minute window can never
#              match at the real cron fire instant for any real configured
#              waiver_process_time; the NEW "due since last run" gate is true for
#              an old unprocessed claim, false for a claim newer than due_at,
#              false once processed after due_at, true for a 00:00 league the old
#              signed-interval arithmetic could not reach, self-heals a missed
#              run, and is correct across both DST boundaries for a 02:00 league;
#              should_process_waivers_now(uuid) is a never-NULL boolean that is
#              false for an unknown id; the 0-arg diagnostic keeps its exact
#              return shape and its anon privilege chain; both migrations are
#              idempotent. Exit 0 = PASS.
# Last active: 2026-09-03
# Invoked:     PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash scripts/proof/faab-waiver-due-gate.proof.sh
# Reads:       supabase/migrations/20260903190000_faab_waiver_gate_due_since_last_run.sql
#              supabase/migrations/20260903191000_should_process_waivers_now_per_league_boolean.sql
#              supabase/migrations/captures/2026-09-03_pre_faab_waiver_gate_due_since_last_run.sql
#              supabase/migrations/captures/2026-09-03_pre_should_process_waivers_now_per_league_boolean.sql
# Writes:      scratch database waiver_proof (dropped and recreated)
# ----------------------------------------------------------------------------
# WHAT EACH STEP ASSERTS
#   [0]  the two capture files still hash to the digests the migrations quote
#   [1]  prod-shaped schema, Supabase roles, per-league FAAB worker stub
#   [1b] fixtures, and the pre-change return shape recorded for step [12]
#   [2]  the captures really are the broken bodies (1800 / 300 both present)
#   [3]  CLAIM 1 - the old 30-minute gate cannot match: 0 rows at the real fire
#        instant with a positive control that it can match at 02:10 Eastern;
#        0 of 1825 (daily fire, configured time) pairs over a whole year;
#        the midnight non-wrap defect
#   [4]  migration 1 applies and commits with NO cron schema (guarded path)
#   [5]  with a recording cron stub, jobid 16 is preserved and 15 3 * * *
#        becomes 15 * * * * with the command string unchanged
#   [6]  migration 2 applies, running its own post-conditions
#   [7]  time-injectable twins derived from the installed bodies, proved equal
#        to them at now()
#   [8]  CLAIM 2 - due for an old pending claim; not due for a claim newer than
#        due_at; not due once processed at or after due_at; due for a 00:00
#        league including from 23:45 local; not due with no claims; not due
#        with only a cancelled claim; due when no time is configured; and the
#        orchestrator picks exactly the leagues the boolean says
#   [9]  CLAIM 3 - a league two days overdue processes on the first run back
#   [10] CLAIM 4 - spring forward and fall back, 02:00 leagues, one run each,
#        plus what actually suppresses the duplicated 01:xx hour
#   [11] CLAIM 5 - the overload is boolean, never NULL, false for unknown ids
#   [12] CLAIM 6 - the 0-arg return shape, names, types, volatility and
#        security are unchanged, and the anon call chain works end to end
#   [13] the real orchestrator at the real clock, fixtures placed relative to
#        the real due moment
#   [14] due-moment invariants over 1296 evaluations across nine days
#   [15] CLAIM 7 - both migrations re-apply with no observable change
#
# A DEFECT WAS FOUND AND FIXED while writing this. The DST note in
# 20260903190000 asserted that waiver_last_due_at resolves an ambiguous
# fall-back 01:00 to the FIRST occurrence and that NOT EXISTS(processed_at >=
# due_at) makes the repeated hour a no-op. Both halves are false, measured
# here: PostgreSQL resolves it to the standard-time (SECOND) reading, and the
# repeated hour is suppressed by the pending-claim EXISTS instead. The comment
# was corrected; no SQL changed, and step [10] now pins the real mechanism.
# ----------------------------------------------------------------------------
# HARVEST PROVENANCE (INS-16: harvested, not composed). Read read-only from
# production project iezwazccqqrhrjupxzvf on 2026-09-03:
#   information_schema.columns  -> public.leagues (31 columns) and
#                                  public.waiver_claims (13 columns), reproduced
#                                  below with their exact types, nullability and
#                                  defaults.
#   pg_constraint               -> leagues_waiver_type_check,
#                                  leagues_pool_status_check,
#                                  leagues_trade_review_type_check,
#                                  leagues_trade_veto_threshold_check,
#                                  leagues_join_code_key, leagues_pkey,
#                                  leagues_commissioner_id_fkey,
#                                  leagues_pool_winner_id_fkey,
#                                  waiver_claims_status_check, valid_priority,
#                                  waiver_claims_pkey,
#                                  waiver_claims_league_id_fkey,
#                                  waiver_claims_team_id_fkey.
#   pg_type/pg_enum             -> draft_status = not_started, queued,
#                                  in_progress, completed.
#   pg_proc                     -> process_faab_waivers_for_league(uuid) RETURNS
#                                  TABLE(claim_id uuid, team_id uuid,
#                                  player_id integer, bid_amount numeric,
#                                  status text, failure_reason text), SECURITY
#                                  DEFINER, search_path=public. Stubbed here.
#   public.leagues              -> 55 rows; waiver_process_time is 02:00:00 on 17
#                                  leagues and 03:00:00 on 38. No other value is
#                                  configured anywhere.
#   cron.job                    -> jobid 16, jobname process-faab-waivers,
#                                  schedule '15 3 * * *', command
#                                  'SELECT public.process_all_faab_waivers()'.
# profiles, teams and auth.users are created here as minimal foreign-key targets
# only; nothing under proof reads their columns.
#
# PINNING TIME. Every claim in this file that depends on "what time is it" is
# proved at an explicitly named instant, never at the wall clock of the run:
#   * The migrations' own functions read now(), and now() cannot be set in a
#     stock PostgreSQL. So step [7] DERIVES time-injectable twins from the
#     bodies that are actually installed, by taking pg_get_functiondef() of each
#     installed function and substituting its single now()/NOW() call for a
#     p_now parameter. The substitution refuses to proceed unless it finds
#     exactly one occurrence, so the twin cannot silently drift from its source.
#   * Step [7] then proves the twins are faithful: for a grid of process times
#     and for every fixture league, twin(x, now()) must equal real(x) evaluated
#     in the same statement. A twin that disagreed with its source would fail
#     here before it was ever used to prove anything.
#   * Every later assertion names its instant as a literal timestamptz, so this
#     script returns the same verdict at 03:00 on a Tuesday as at 23:59 on a
#     spring-forward Sunday.
#
# pg_cron. A scratch cluster has no pg_cron, and the FAAB migration calls
# cron.schedule() inside a DO block with EXCEPTION WHEN others. BOTH paths are
# exercised, in this order, because each proves something the other cannot:
#   step [4] applies the migration with NO cron schema at all, proving the guard
#            swallows the missing-schema error and the surrounding transaction
#            still commits (a guard that aborted the migration would be a
#            production apply failure);
#   step [5] then creates a minimal cron schema with a cron.job table and a
#            recording cron.schedule(text,text,text) stub and re-applies, so the
#            migration's real code path runs and the exact arguments it passes
#            can be asserted.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG1="$ROOT/supabase/migrations/20260903190000_faab_waiver_gate_due_since_last_run.sql"
MIG2="$ROOT/supabase/migrations/20260903191000_should_process_waivers_now_per_league_boolean.sql"
CAP1="$ROOT/supabase/migrations/captures/2026-09-03_pre_faab_waiver_gate_due_since_last_run.sql"
CAP2="$ROOT/supabase/migrations/captures/2026-09-03_pre_should_process_waivers_now_per_league_boolean.sql"

md5of() { # md5sum on Linux, md5 -q on macOS
  if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | awk '{print $1}';
  else md5 -q "$1"; fi
}

echo "[0] the captures under test are the byte-exact live prod bodies"
# These two digests are md5(pg_get_functiondef(...)) taken read-only against
# production on 2026-09-03 and quoted in each migration's rationale block. If a
# capture is edited, or the wrong file is picked up, every later "the old body
# did X" statement in this proof would be about fiction, so this check is fatal.
for pair in "$CAP1:ca07ae202f5bfeb799b81cdb64ca465d" "$CAP2:8e2f537a5d96e274e8f2b2700d5a4b1f"; do
  f="${pair%:*}"; want="${pair##*:}"; got="$(md5of "$f")"
  if [ "$got" != "$want" ]; then
    echo "FAIL capture digest drift: $f"
    echo "     expected $want"
    echo "     actual   $got"
    exit 1
  fi
  echo "     ok $(basename "$f") = $got"
done

P0="psql -v ON_ERROR_STOP=1 -qX"
$P0 -c "drop database if exists waiver_proof;"
$P0 -c "create database waiver_proof;"
P="$P0 -d waiver_proof"

echo "[1] prod-shaped schema, Supabase roles, and the per-league FAAB stub"
$P <<'SQL'
-- Output and error text stay in UTC so a failure message reads the same on any
-- runner. Nothing under proof depends on this GUC: waiver_last_due_at() casts
-- with an explicit AT TIME ZONE in both directions.
set time zone 'UTC';

-- Supabase ships these roles; a scratch cluster does not. Both migrations
-- GRANT to all three, and 20260903191000 asserts anon privileges in its own
-- post-condition, so they must exist before either file is applied.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin;  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin;          end if;
end $$;

create schema if not exists auth;
create schema if not exists proof;
create table auth.users (id uuid primary key);
create table public.profiles (id uuid primary key);
create table public.teams (id uuid primary key, league_id uuid not null, team_name text);

create type public.draft_status as enum ('not_started','queued','in_progress','completed');

-- leagues.join_code defaults to generate_join_code() in production.
create function public.generate_join_code() returns text language sql volatile as $fn$
  select upper(substr(md5(random()::text), 1, 6));
$fn$;
-- waiver_claims.id defaults to uuid_generate_v4() in production (uuid-ossp).
create function public.uuid_generate_v4() returns uuid language sql volatile as $fn$
  select gen_random_uuid();
$fn$;

-- public.leagues: all 31 columns, in ordinal position, with the production
-- types, nullability and defaults.
create table public.leagues (
  id                        uuid                     not null default gen_random_uuid(),
  name                      text                     not null,
  commissioner_id           uuid                     not null,
  draft_status              public.draft_status      not null default 'not_started'::public.draft_status,
  join_code                 text                     not null default public.generate_join_code(),
  roster_size               integer                  not null default 21,
  draft_rounds              integer                  not null default 21,
  settings                  jsonb                             default '{}'::jsonb,
  created_at                timestamp with time zone not null default now(),
  updated_at                timestamp with time zone not null default now(),
  scoring_settings          jsonb                             default '{}'::jsonb,
  league_size               integer,
  roster_slots              jsonb                             default '{"C": 2, "D": 4, "G": 2, "LW": 2, "RW": 2}'::jsonb,
  waiver_process_time       time without time zone            default '03:00:00'::time without time zone,
  waiver_period_hours       integer                           default 48,
  waiver_game_lock          boolean                           default true,
  waiver_type               text                              default 'rolling'::text,
  allow_trades_during_games boolean                           default true,
  scheduled_draft_time      timestamp with time zone,
  trade_review_type         text                              default 'none'::text,
  trade_review_period_hours integer                           default 48,
  trade_veto_threshold      numeric                           default 0.5,
  pool_status               text                              default 'active'::text,
  pool_winner_id            uuid,
  pool_winner_declared_at   timestamp with time zone,
  draft_event_counter       bigint                   not null default 0,
  draft_state               text                     not null default 'not_started'::text,
  pick_deadline             timestamp with time zone,
  feature_flags             jsonb                    not null default '{}'::jsonb,
  draft_generation          integer                  not null default 0,
  draft_shadow_mode         boolean                  not null default true,
  constraint leagues_pkey primary key (id),
  constraint leagues_join_code_key unique (join_code),
  constraint leagues_commissioner_id_fkey foreign key (commissioner_id) references public.profiles(id) on delete cascade,
  constraint leagues_pool_winner_id_fkey  foreign key (pool_winner_id) references auth.users(id),
  constraint leagues_pool_status_check check (pool_status = any (array['active'::text,'completed'::text,'archived'::text])),
  constraint leagues_trade_review_type_check check (trade_review_type = any (array['none'::text,'commissioner'::text,'league_vote'::text])),
  constraint leagues_trade_veto_threshold_check check ((trade_veto_threshold > (0)::numeric) and (trade_veto_threshold <= (1)::numeric)),
  constraint leagues_waiver_type_check check (waiver_type = any (array['rolling'::text,'reverse_draft_order'::text,'reverse_standings'::text,'faab'::text]))
);

-- public.waiver_claims: all 13 columns, production types and defaults.
create table public.waiver_claims (
  id                  uuid                     not null default public.uuid_generate_v4(),
  league_id           uuid                     not null,
  team_id             uuid                     not null,
  player_id           integer                  not null,
  drop_player_id      integer,
  priority            integer,
  status              text                     not null,
  created_at          timestamp with time zone not null default now(),
  processed_at        timestamp with time zone,
  failure_reason      text,
  bid_amount          numeric,
  is_conditional_drop boolean                           default false,
  updated_at          timestamp with time zone not null default now(),
  constraint waiver_claims_pkey primary key (id),
  constraint waiver_claims_league_id_fkey foreign key (league_id) references public.leagues(id) on delete cascade,
  constraint waiver_claims_team_id_fkey   foreign key (team_id)   references public.teams(id)   on delete cascade,
  constraint waiver_claims_status_check check (status = any (array['pending'::text,'successful'::text,'failed'::text,'cancelled'::text])),
  constraint valid_priority check (priority >= 0)
);

-- The zero-argument diagnostic and the new boolean overload are both SECURITY
-- INVOKER, so anon must be able to read these two tables for the privilege
-- chain in step [12] to mean anything.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.leagues, public.waiver_claims to anon, authenticated, service_role;

-- Stub for the per-league worker the orchestrator loops over. Prod-shaped
-- signature and prod-shaped side effect: it resolves every pending claim in the
-- league and stamps processed_at on each one, which is exactly the signal the
-- new gate reads back ("nothing processed since due_at").
create function public.process_faab_waivers_for_league(p_league_id uuid)
returns table(claim_id uuid, team_id uuid, player_id integer, bid_amount numeric, status text, failure_reason text)
language plpgsql security definer set search_path to 'public' as $fn$
begin
  return query
  update public.waiver_claims wc
     set status = 'successful', processed_at = now(), updated_at = now()
   where wc.league_id = p_league_id and wc.status = 'pending'
  returning wc.id, wc.team_id, wc.player_id, wc.bid_amount, wc.status, wc.failure_reason;
end $fn$;
SQL

echo "[1b] fixtures: one commissioner, one team per league, prod-shaped leagues"
$P <<'SQL'
set time zone 'UTC';
insert into public.profiles values ('99999999-9999-4999-8999-999999999999');

-- Every league carries the same commissioner and one team. waiver_type is
-- 'faab' wherever process_all_faab_waivers() has to see the league, because
-- that filter is unchanged by the migration and must stay unchanged.
--
-- OLD* leagues cover the five waiver_process_time values the FAAB migration's
-- rationale block evaluates. 02:00 and 03:00 are the only two that exist in
-- production (17 and 38 leagues); 01:00, 04:00 and 12:00 are quoted in the same
-- table and are carried here so the arithmetic claim is proved over the whole
-- set the migration asserts, not just the subset that is live today.
insert into public.leagues (id, name, commissioner_id, waiver_type, waiver_process_time, league_size) values
  ('10000000-0000-4000-8000-000000000001','old-0100','99999999-9999-4999-8999-999999999999','faab','01:00:00',12),
  ('10000000-0000-4000-8000-000000000002','old-0200','99999999-9999-4999-8999-999999999999','faab','02:00:00',12),
  ('10000000-0000-4000-8000-000000000003','old-0300','99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('10000000-0000-4000-8000-000000000004','old-0400','99999999-9999-4999-8999-999999999999','faab','04:00:00',12),
  ('10000000-0000-4000-8000-000000000005','old-1200','99999999-9999-4999-8999-999999999999','faab','12:00:00',12),
  -- new-gate cases
  ('20000000-0000-4000-8000-00000000000a','ng-a-old-pending', '99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('20000000-0000-4000-8000-00000000000b','ng-b-late-claim',  '99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('20000000-0000-4000-8000-00000000000c','ng-c-processed',   '99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('20000000-0000-4000-8000-00000000000d','ng-d-midnight',    '99999999-9999-4999-8999-999999999999','faab','00:00:00',12),
  ('20000000-0000-4000-8000-00000000000e','ng-e-missed-run',  '99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('20000000-0000-4000-8000-00000000000f','ng-f-no-claims',   '99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('20000000-0000-4000-8000-000000000010','ng-g-null-time',   '99999999-9999-4999-8999-999999999999','faab',null,12),
  ('20000000-0000-4000-8000-000000000011','ng-h-cancelled',   '99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  -- DST cases
  ('30000000-0000-4000-8000-000000000001','dst-spring-0200','99999999-9999-4999-8999-999999999999','faab','02:00:00',12),
  ('30000000-0000-4000-8000-000000000002','dst-fall-0200',  '99999999-9999-4999-8999-999999999999','faab','02:00:00',12),
  ('30000000-0000-4000-8000-000000000003','dst-fall-0100',  '99999999-9999-4999-8999-999999999999','faab','01:00:00',12),
  -- real-clock end-to-end cases
  ('40000000-0000-4000-8000-000000000001','rt-due',      '99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('40000000-0000-4000-8000-000000000002','rt-not-due',  '99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('40000000-0000-4000-8000-000000000003','rt-processed','99999999-9999-4999-8999-999999999999','faab','03:00:00',12),
  ('40000000-0000-4000-8000-000000000004','rt-rolling',  '99999999-9999-4999-8999-999999999999','rolling','03:00:00',12);

insert into public.teams (id, league_id, team_name)
  select ('50000000-0000-4000-8000-' || lpad(row_number() over (order by l.id)::text, 12, '0'))::uuid, l.id, l.name || '-t1'
    from public.leagues l;
SQL

echo "[2] install the captured pre-change bodies and record their return shape"
$P -f "$CAP1" >/dev/null
$P -f "$CAP2" >/dev/null
$P <<'SQL'
set time zone 'UTC';
-- The 0-arg diagnostic's exact return shape is recorded from the CAPTURED body,
-- before either migration runs, so step [12] can prove shape stability against
-- what production actually has rather than against a string typed from memory.
create table proof.shape_before as
  select pg_get_function_result('public.should_process_waivers_now()'::regprocedure) as result_shape,
         (select array_agg(x order by ord)
            from unnest(p.proargnames) with ordinality as t(x, ord)) as argnames,
         (select array_agg(format_type(x, null) order by ord)
            from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as t(x, ord)) as argtypes,
         p.prosecdef, p.provolatile, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='should_process_waivers_now' and p.pronargs = 0;

do $$
declare v_faab text; v_diag text;
begin
  v_faab := pg_get_functiondef('public.process_all_faab_waivers()'::regprocedure);
  v_diag := pg_get_functiondef('public.should_process_waivers_now()'::regprocedure);

  -- Confirm the captures really are the broken bodies the migrations describe.
  -- If these fail, the captures were replaced and nothing downstream is proof.
  if position('1800' in v_faab) = 0 then
    raise exception 'capture 1 does not contain the 30-minute window; it is not the pre-change body';
  end if;
  if position('ABS(EXTRACT(EPOCH FROM (' in v_faab) = 0 then
    raise exception 'capture 1 does not contain the signed TIME - TIME subtraction';
  end if;
  if position('< 300' in v_diag) = 0 then
    raise exception 'capture 2 does not contain the 300-second clock window';
  end if;
  if (select count(*) from proof.shape_before) <> 1 then
    raise exception 'expected exactly one 0-arg should_process_waivers_now before the migration';
  end if;
  raise notice 'captures installed: faab body md5 %, diagnostic body md5 %', md5(v_faab), md5(v_diag);
end $$;
SQL

echo "[3] CLAIM 1: the OLD 30-minute gate can never match at the real fire instant"
$P <<'SQL'
set time zone 'UTC';
-- Give every OLD* league a pending claim, so the ONLY thing that can keep the
-- old orchestrator from returning rows is its time predicate.
insert into public.waiver_claims (league_id, team_id, player_id, status, created_at, updated_at, bid_amount)
select l.id, t.id, 8478402, 'pending', timestamptz '2026-08-01 00:00:00+00', timestamptz '2026-08-01 00:00:00+00', 10
  from public.leagues l join public.teams t on t.league_id = l.id
 where l.name like 'old-%';

-- Derive a time-injectable twin of the body that is ACTUALLY INSTALLED, by
-- substituting its single NOW() for a parameter. Nothing is retyped: if the
-- capture ever stops containing exactly one NOW(), this refuses to build.
do $$
declare d text; n int;
begin
  d := pg_get_functiondef('public.process_all_faab_waivers()'::regprocedure);
  n := (length(d) - length(replace(d, 'NOW()', ''))) / length('NOW()');
  if n <> 1 then
    raise exception 'expected exactly 1 NOW() in the captured orchestrator, found % - the twin would not be faithful', n;
  end if;
  if position('public.process_all_faab_waivers()' in d) = 0 then
    raise exception 'could not find the header to rename while building the old-gate twin';
  end if;
  d := replace(d, 'public.process_all_faab_waivers()', 'proof.old_orchestrator_at(p_now timestamptz)');
  d := replace(d, 'NOW()', 'p_now');
  execute d;
end $$;

do $$
declare
  -- The real fire instant: cron.job 16 is '15 3 * * *' and pg_cron evaluates it
  -- in the database timezone, which prod reports as UTC.
  k_fire   constant timestamptz := timestamptz '2026-09-03 03:15:00+00';
  -- A control instant chosen to sit inside the old window for the 02:00 league:
  -- 06:10 UTC is 02:10 America/New_York, 600 seconds from 02:00:00.
  k_inside constant timestamptz := timestamptz '2026-09-03 06:10:00+00';
  v_rows int;
  v_name text;
  v_bad  int;
  v_local time;
begin
  -- (a) Positive control. A 0-row result only means something if this twin can
  --     ever return rows at all.
  select count(*), min(league_name) into v_rows, v_name from proof.old_orchestrator_at(k_inside);
  if v_rows <> 1 or v_name <> 'old-0200' then
    raise exception 'CONTROL FAILED: at 02:10 America/New_York the old gate should match exactly the 02:00 league, got % row(s) %', v_rows, v_name;
  end if;
  -- The control must not have left a mark; the twin is SECURITY DEFINER and
  -- calls the same worker the real orchestrator does.
  update public.waiver_claims set status='pending', processed_at=null
   where league_id in (select id from public.leagues where name like 'old-%');

  -- (b) The actual claim. At 03:15 UTC = 23:15 America/New_York, no league
  --     configured at any real value is inside the 30-minute window.
  select (k_fire at time zone 'America/New_York')::time into v_local;
  if v_local <> time '23:15:00' then
    raise exception 'the fire instant does not land at 23:15 America/New_York, it lands at %', v_local;
  end if;
  select count(*) into v_rows from proof.old_orchestrator_at(k_fire);
  if v_rows <> 0 then
    raise exception 'FAIL the old gate matched % league(s) at the real fire instant', v_rows;
  end if;
  -- and it left every claim untouched, so no league was silently processed.
  select count(*) into v_bad from public.waiver_claims wc join public.leagues l on l.id = wc.league_id
   where l.name like 'old-%' and (wc.status <> 'pending' or wc.processed_at is not null);
  if v_bad <> 0 then raise exception 'FAIL the 0-row run still mutated % claim(s)', v_bad; end if;
  raise notice 'PASS at 2026-09-03 03:15+00 (23:15 America/New_York) the old gate matched 0 of 5 leagues, each holding a pending claim';

  -- (c) Generalise it. Evaluate the captured predicate verbatim at every daily
  --     03:15 UTC fire for a full year (which straddles both DST changes, so
  --     the local time is 23:15 EDT or 22:15 EST) against every configured
  --     value. Not one combination is inside the window.
  select count(*) into v_bad
    from generate_series(timestamptz '2026-01-01 03:15:00+00',
                         timestamptz '2026-12-31 03:15:00+00', interval '1 day') g(fire)
    cross join (values ('01:00:00'::time),('02:00:00'::time),('03:00:00'::time),
                       ('04:00:00'::time),('12:00:00'::time)) v(t)
   where abs(extract(epoch from (v.t - (g.fire at time zone 'America/New_York')::time))) < 1800;
  if v_bad <> 0 then
    raise exception 'FAIL the old gate was satisfiable on % of 1825 (fire instant, configured time) pairs', v_bad;
  end if;

  -- (d) The smallest gap over that whole year, so the miss is not marginal.
  select min(abs(extract(epoch from (v.t - (g.fire at time zone 'America/New_York')::time))))::int into v_bad
    from generate_series(timestamptz '2026-01-01 03:15:00+00',
                         timestamptz '2026-12-31 03:15:00+00', interval '1 day') g(fire)
    cross join (values ('01:00:00'::time),('02:00:00'::time),('03:00:00'::time),
                       ('04:00:00'::time),('12:00:00'::time)) v(t);
  raise notice 'PASS old gate never matches: 0/1825 fire-instant pairs inside 1800s; closest approach % s', v_bad;

  -- (e) The second, independent defect: TIME - TIME does not wrap. A league
  --     configured at 00:00 is unreachable from the half hour before midnight,
  --     which is precisely where a midnight league most needs to be reachable.
  select count(*) into v_bad
    from generate_series(0, 29) m(i)
   where abs(extract(epoch from (time '00:00:00' - (time '23:30:00' + (m.i || ' minutes')::interval)))) < 1800;
  if v_bad <> 0 then
    raise exception 'FAIL expected the old midnight gate to be false for all 30 minutes before midnight, it was true % time(s)', v_bad;
  end if;
  if abs(extract(epoch from (time '00:00:00' - time '23:45:00'))) <> 85500 then
    raise exception 'FAIL the non-wrap arithmetic is not what the migration says it is';
  end if;
  raise notice 'PASS midnight non-wrap: at 23:45 local the old gate reads 85500s from a 00:00 league, not 900s';
end $$;
SQL

echo "[4] apply migration 1 with NO cron schema: the guarded path must commit"
$P -f "$MIG1"
$P <<'SQL'
set time zone 'UTC';
do $$
declare v_body text;
begin
  if to_regnamespace('cron') is not null then
    raise exception 'this step is only meaningful with no cron schema present';
  end if;
  -- The guard swallowed the missing-schema error AND the transaction committed:
  -- both helpers and the new orchestrator body are here.
  if to_regprocedure('public.waiver_processing_timezone()') is null then
    raise exception 'FAIL waiver_processing_timezone() was not created; the cron guard aborted the migration';
  end if;
  if to_regprocedure('public.waiver_last_due_at(time without time zone)') is null then
    raise exception 'FAIL waiver_last_due_at(time) was not created';
  end if;
  v_body := pg_get_functiondef('public.process_all_faab_waivers()'::regprocedure);
  if position('1800' in v_body) <> 0 then raise exception 'FAIL the 30-minute window survived the apply'; end if;
  if position('waiver_last_due_at' in v_body) = 0 then raise exception 'FAIL the new body does not call waiver_last_due_at'; end if;
  if public.waiver_processing_timezone() <> 'America/New_York' then
    raise exception 'FAIL waiver_processing_timezone() returned %, but the applied schema says the stored times are Eastern', public.waiver_processing_timezone();
  end if;
  if public.waiver_last_due_at(null::time) is not null then
    raise exception 'FAIL waiver_last_due_at(NULL) must be NULL so a league with no configured time stays due at every run';
  end if;
  raise notice 'PASS migration 1 committed with pg_cron absent; the EXCEPTION guard is not load-bearing for the DDL';
end $$;
SQL

echo "[5] create a recording cron stub and re-apply: the real cron path must run"
$P <<'SQL'
set time zone 'UTC';
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
-- pg_cron's schedule() upserts by job name and returns the jobid. The stub
-- keeps that contract so the migration's claim that jobid 16 is preserved can
-- be exercised rather than asserted.
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $fn$
declare v_id bigint;
begin
  insert into cron.job as j (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning j.jobid into v_id;
  return v_id;
end $fn$;
-- Seed the live row exactly as production has it, so the re-schedule is an
-- UPDATE of jobid 16 and not an INSERT of a new job.
insert into cron.job (jobid, jobname, schedule, command)
  values (16, 'process-faab-waivers', '15 3 * * *', 'SELECT public.process_all_faab_waivers()');
SQL
$P -f "$MIG1"
$P <<'SQL'
set time zone 'UTC';
do $$
declare v_sched text; v_cmd text; v_id bigint; v_n int;
begin
  select jobid, schedule, command into v_id, v_sched, v_cmd from cron.job where jobname = 'process-faab-waivers';
  if v_id <> 16 then
    raise exception 'FAIL cron.schedule() did not upsert by name; jobid moved from 16 to %', v_id;
  end if;
  if v_sched <> '15 * * * *' then
    raise exception 'FAIL expected the hourly cadence 15 * * * *, cron.job holds %', v_sched;
  end if;
  if v_cmd <> 'SELECT public.process_all_faab_waivers()' then
    raise exception 'FAIL the command string changed to %', v_cmd;
  end if;
  select count(*) into v_n from cron.job;
  if v_n <> 1 then raise exception 'FAIL the migration created % cron jobs instead of updating one', v_n; end if;
  raise notice 'PASS cron path ran: jobid 16 preserved, 15 3 * * * -> 15 * * * *, command unchanged';
end $$;
SQL

echo "[6] apply migration 2 (its own post-conditions run inside it)"
$P -f "$MIG2"

echo "[7] derive time-injectable twins from the installed bodies and prove them faithful"
$P <<'SQL'
set time zone 'UTC';
-- now() cannot be set in a stock PostgreSQL, so instead of trusting a hand
-- written copy of the gate, each twin is generated from the definition that is
-- actually installed and refuses to build unless the substitution site is
-- unique. proof.last_due_at is the only place now() is replaced; the two
-- callers are rewritten to call the twin instead of the real helper.
do $$
declare d text; n int;
begin
  ---------------------------------------------------------------- last_due_at
  d := pg_get_functiondef('public.waiver_last_due_at(time without time zone)'::regprocedure);
  n := (length(d) - length(replace(d, 'now()', ''))) / length('now()');
  if n <> 1 then
    raise exception 'expected exactly 1 now() in waiver_last_due_at, found %; the twin would not be faithful', n;
  end if;
  if position('public.waiver_last_due_at(p_process_time time without time zone)' in d) = 0 then
    raise exception 'waiver_last_due_at header is not the shape the twin builder expects: %', left(d, 200);
  end if;
  d := replace(d, 'public.waiver_last_due_at(p_process_time time without time zone)',
                  'proof.last_due_at(p_process_time time without time zone, p_now timestamptz)');
  d := replace(d, 'now()', 'p_now');
  execute d;

  ------------------------------------------------------- should_process(uuid)
  d := pg_get_functiondef('public.should_process_waivers_now(uuid)'::regprocedure);
  n := (length(d) - length(replace(d, 'public.waiver_last_due_at(l.waiver_process_time)', '')))
       / length('public.waiver_last_due_at(l.waiver_process_time)');
  if n <> 1 then
    raise exception 'expected exactly 1 waiver_last_due_at call in should_process_waivers_now(uuid), found %', n;
  end if;
  -- All of this function's time-awareness must arrive through the helper. A
  -- direct now() here would not be injected, and every named-instant assertion
  -- below would silently start reading the wall clock instead.
  if position('now()' in d) <> 0 then
    raise exception 'should_process_waivers_now(uuid) reads now() directly; the twin could not pin time and this proof would be worthless';
  end if;
  d := replace(d, 'public.should_process_waivers_now(p_league_id uuid)',
                  'proof.should_process_at(p_league_id uuid, p_now timestamptz)');
  d := replace(d, 'public.waiver_last_due_at(l.waiver_process_time)',
                  'proof.last_due_at(l.waiver_process_time, p_now)');
  execute d;

  ------------------------------------------------------------- orchestrator
  d := pg_get_functiondef('public.process_all_faab_waivers()'::regprocedure);
  n := (length(d) - length(replace(d, 'public.waiver_last_due_at(l.waiver_process_time)', '')))
       / length('public.waiver_last_due_at(l.waiver_process_time)');
  if n <> 1 then
    raise exception 'expected exactly 1 waiver_last_due_at call in process_all_faab_waivers, found %', n;
  end if;
  if position('now()' in d) <> 0 or position('NOW()' in d) <> 0 then
    raise exception 'process_all_faab_waivers reads the clock directly; the twin could not pin time';
  end if;
  d := replace(d, 'public.process_all_faab_waivers()', 'proof.orchestrator_at(p_now timestamptz)');
  d := replace(d, 'public.waiver_last_due_at(l.waiver_process_time)',
                  'proof.last_due_at(l.waiver_process_time, p_now)');
  execute d;
end $$;

-- One hourly run of the scheduled handler, at an instant we name.
create function proof.run_at(p_league_id uuid, p_now timestamptz) returns boolean
language plpgsql as $fn$
declare v_due boolean;
begin
  v_due := proof.should_process_at(p_league_id, p_now);
  if v_due then
    -- Mirrors process_faab_waivers_for_league(): resolve every pending claim and
    -- stamp processed_at, which is the signal the gate reads back.
    update public.waiver_claims set status='successful', processed_at = p_now, updated_at = p_now
     where league_id = p_league_id and status = 'pending';
  end if;
  return v_due;
end $fn$;

do $$
declare v_bad int;
begin
  -- Faithfulness, part 1: the twin helper agrees with the real helper for every
  -- process time that matters, evaluated inside ONE statement so both see the
  -- same now().
  select count(*) into v_bad
    from (values ('00:00:00'::time),('01:00:00'::time),('02:00:00'::time),('03:00:00'::time),
                 ('04:00:00'::time),('12:00:00'::time),('23:59:59'::time),(null::time)) v(t)
   where proof.last_due_at(v.t, now()) is distinct from public.waiver_last_due_at(v.t);
  if v_bad <> 0 then
    raise exception 'FAIL the derived twin disagrees with waiver_last_due_at on % of 8 process times', v_bad;
  end if;

  -- Faithfulness, part 2: the twin gate agrees with the real gate for every
  -- fixture league, again inside one statement.
  select count(*) into v_bad from public.leagues l
   where proof.should_process_at(l.id, now()) is distinct from public.should_process_waivers_now(l.id);
  if v_bad <> 0 then
    raise exception 'FAIL the derived twin disagrees with should_process_waivers_now(uuid) on % league(s)', v_bad;
  end if;
  raise notice 'PASS twins derived from the installed bodies and equal to them at now()';
end $$;
SQL

echo "[8] CLAIM 2: the new gate, evaluated at a named instant"
$P <<'SQL'
set time zone 'UTC';
-- Anchor: 2026-09-03 12:00 UTC = 08:00 America/New_York. For a 03:00 league the
-- last due moment is 2026-09-03 07:00+00; for the 00:00 league it is
-- 2026-09-03 04:00+00.
insert into public.waiver_claims (league_id, team_id, player_id, status, created_at, updated_at, processed_at, bid_amount)
select l.id, t.id, v.player_id, v.status, v.created_at, v.created_at, v.processed_at, 15
  from (values
    -- (a) pending since before the last due moment -> due
    ('20000000-0000-4000-8000-00000000000a'::uuid, 8478402, 'pending',    timestamptz '2026-09-03 05:00:00+00', null::timestamptz),
    -- (b) submitted AFTER the last due moment -> waits for the next one
    ('20000000-0000-4000-8000-00000000000b'::uuid, 8477934, 'pending',    timestamptz '2026-09-03 09:00:00+00', null::timestamptz),
    -- (c) old pending claim, but the league was already processed after due_at
    ('20000000-0000-4000-8000-00000000000c'::uuid, 8471675, 'pending',    timestamptz '2026-09-03 05:00:00+00', null::timestamptz),
    ('20000000-0000-4000-8000-00000000000c'::uuid, 8476945, 'successful', timestamptz '2026-09-03 05:00:00+00', timestamptz '2026-09-03 07:20:00+00'),
    -- (d) midnight league, pending since yesterday
    ('20000000-0000-4000-8000-00000000000d'::uuid, 8480069, 'pending',    timestamptz '2026-09-02 12:00:00+00', null::timestamptz),
    -- (e) missed run: due two days ago, still pending, never processed
    ('20000000-0000-4000-8000-00000000000e'::uuid, 8474564, 'pending',    timestamptz '2026-09-01 05:00:00+00', null::timestamptz),
    -- (g) no configured process time, pending claim
    ('20000000-0000-4000-8000-000000000010'::uuid, 8475167, 'pending',    timestamptz '2026-09-03 05:00:00+00', null::timestamptz),
    -- (h) an old claim that is NOT pending and was never stamped: the gate must
    --     not treat withdrawn or already-resolved work as a reason to run
    ('20000000-0000-4000-8000-000000000011'::uuid, 8479318, 'cancelled',  timestamptz '2026-09-03 05:00:00+00', null::timestamptz)
  ) v(league_id, player_id, status, created_at, processed_at)
  join public.leagues l on l.id = v.league_id
  join public.teams   t on t.league_id = l.id;

do $$
declare
  k_now  constant timestamptz := timestamptz '2026-09-03 12:00:00+00';  -- 08:00 America/New_York
  k_2345 constant timestamptz := timestamptz '2026-09-04 03:45:00+00';  -- 23:45 America/New_York
  v_due  timestamptz;
  v_b    boolean;
begin
  -- The due moment the whole step turns on, stated rather than assumed.
  v_due := proof.last_due_at('03:00:00'::time, k_now);
  if v_due <> timestamptz '2026-09-03 07:00:00+00' then
    raise exception 'FAIL last due moment for a 03:00 league at 08:00 Eastern should be 2026-09-03 07:00+00, got %', v_due;
  end if;
  v_due := proof.last_due_at('00:00:00'::time, k_now);
  if v_due <> timestamptz '2026-09-03 04:00:00+00' then
    raise exception 'FAIL last due moment for a 00:00 league should be 2026-09-03 04:00+00, got %', v_due;
  end if;
  -- The boundary itself, because "> local_now" and ">= local_now" differ by a
  -- whole day here and only at this instant. Standing exactly on the due
  -- moment, the due moment is NOW, not yesterday.
  v_due := proof.last_due_at('03:00:00'::time, timestamptz '2026-09-03 07:00:00+00');
  if v_due <> timestamptz '2026-09-03 07:00:00+00' then
    raise exception 'FAIL standing exactly on the due moment, last_due_at returned % instead of that moment', v_due;
  end if;
  -- and one second before it, it is still yesterday's slot.
  v_due := proof.last_due_at('03:00:00'::time, timestamptz '2026-09-03 06:59:59+00');
  if v_due <> timestamptz '2026-09-02 07:00:00+00' then
    raise exception 'FAIL one second before the due moment, last_due_at should be yesterday 07:00+00, got %', v_due;
  end if;

  -- (a) TRUE: an old unprocessed claim.
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000a', k_now);
  if v_b is not true then raise exception 'FAIL (a) league with a claim pending since before due_at should be due, got %', v_b; end if;

  -- (b) FALSE: the claim arrived after the due moment.
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000b', k_now);
  if v_b is not false then raise exception 'FAIL (b) a claim submitted after due_at must wait for the next due moment, got %', v_b; end if;

  -- (c) FALSE: already processed after the due moment.
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000c', k_now);
  if v_b is not false then raise exception 'FAIL (c) a league processed after due_at must not be due again, got %', v_b; end if;
  --     and the guard is the processed_at stamp, not luck: move that stamp to
  --     one second BEFORE due_at and the same league becomes due again.
  update public.waiver_claims set processed_at = timestamptz '2026-09-03 06:59:59+00'
   where league_id = '20000000-0000-4000-8000-00000000000c' and processed_at is not null;
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000c', k_now);
  if v_b is not true then raise exception 'FAIL (c) the NOT EXISTS guard is not keyed on due_at; a stamp before due_at should not suppress the run, got %', v_b; end if;
  update public.waiver_claims set processed_at = timestamptz '2026-09-03 07:20:00+00'
   where league_id = '20000000-0000-4000-8000-00000000000c' and processed_at is not null;
  --     boundary: processed_at exactly AT due_at also suppresses (>= not >).
  update public.waiver_claims set processed_at = timestamptz '2026-09-03 07:00:00+00'
   where league_id = '20000000-0000-4000-8000-00000000000c' and processed_at is not null;
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000c', k_now);
  if v_b is not false then raise exception 'FAIL (c) processed_at exactly at due_at must suppress the run, got %', v_b; end if;

  -- (d) TRUE at 00:00, including from 23:45 local where the old arithmetic read
  --     85500 seconds away. This is the case TIME - TIME could never reach.
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000d', k_now);
  if v_b is not true then raise exception 'FAIL (d) midnight league with an old pending claim should be due, got %', v_b; end if;
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000d', k_2345);
  if v_b is not true then raise exception 'FAIL (d) midnight league should still be due at 23:45 local, got %', v_b; end if;
  if abs(extract(epoch from (time '00:00:00' - (k_2345 at time zone 'America/New_York')::time))) < 1800 then
    raise exception 'FAIL (d) the control is wrong: the old gate would have matched at 23:45 too';
  end if;

  -- (f) FALSE: no claims at all.
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000f', k_now);
  if v_b is not false then raise exception 'FAIL (f) a league with no claims must not be due, got %', v_b; end if;

  -- (g) NULL waiver_process_time keeps its historic meaning: due at every run.
  v_b := proof.should_process_at('20000000-0000-4000-8000-000000000010', k_now);
  if v_b is not true then raise exception 'FAIL (g) a league with no configured time should be due at every run, got %', v_b; end if;

  -- (h) FALSE: an old claim that is not pending is not work.
  v_b := proof.should_process_at('20000000-0000-4000-8000-000000000011', k_now);
  if v_b is not false then raise exception 'FAIL (h) a league whose only claim is cancelled must not be due, got %', v_b; end if;

  raise notice 'PASS new gate: old pending true, late claim false, processed-since false (at and after due_at), midnight true from 23:45 local, no-claims false, cancelled-only false, NULL-time true';
end $$;

-- The orchestrator built on the same predicate agrees, league for league, and
-- still refuses to look at anything that is not waiver_type = 'faab'.
-- The selection is captured first and its side effects undone immediately, so
-- the comparison below reads the same fixture state the orchestrator saw.
create temporary table orch_sel as
  select o.league_id from proof.orchestrator_at(timestamptz '2026-09-03 12:00:00+00') o;
update public.waiver_claims set status = 'pending', processed_at = null
 where league_id in ('20000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000d',
                     '20000000-0000-4000-8000-00000000000e','20000000-0000-4000-8000-000000000010',
                     '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
                     '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',
                     '10000000-0000-4000-8000-000000000005');
do $$
declare k_now constant timestamptz := timestamptz '2026-09-03 12:00:00+00'; v_bad int; v_hit int;
begin
  select count(*) into v_hit from orch_sel;
  if v_hit = 0 then
    raise exception 'CONTROL FAILED: the new orchestrator selected no league at all at the anchor, so the comparison below is vacuous';
  end if;
  select count(*) into v_bad
    from public.leagues l
   where l.waiver_type = 'faab'
     and (l.id in (select league_id from orch_sel))
         is distinct from proof.should_process_at(l.id, k_now);
  if v_bad <> 0 then
    raise exception 'FAIL the orchestrator and the boolean overload disagree on % faab league(s)', v_bad;
  end if;
  -- and nothing that is not faab was picked up.
  select count(*) into v_bad from orch_sel o join public.leagues l on l.id = o.league_id
   where l.waiver_type <> 'faab';
  if v_bad <> 0 then raise exception 'FAIL the orchestrator selected % non-faab league(s)', v_bad; end if;
  raise notice 'PASS orchestrator selected % faab league(s), matching should_process_waivers_now(uuid) league for league', v_hit;
end $$;
SQL

echo "[9] CLAIM 3: a missed run self-heals instead of waiting for tomorrow"
$P <<'SQL'
set time zone 'UTC';
do $$
declare
  -- ng-e has a claim pending since 2026-09-01 05:00+00 and has never been
  -- processed. Its 03:00 slot came and went on the 1st, the 2nd and the 3rd.
  k_recover constant timestamptz := timestamptz '2026-09-03 12:00:00+00';
  v_b boolean; v_due timestamptz; v_fires int; v_first timestamptz;
begin
  v_due := proof.last_due_at('03:00:00'::time, k_recover);
  if k_recover - v_due < interval '5 hours' then
    raise exception 'FAIL the fixture does not represent a missed run; due_at is only % ago', k_recover - v_due;
  end if;
  v_b := proof.should_process_at('20000000-0000-4000-8000-00000000000e', k_recover);
  if v_b is not true then
    raise exception 'FAIL a league whose due time passed two days ago with a pending claim must be due now, got %', v_b;
  end if;

  -- The old gate, at that same recovery instant, still says no: it is a window
  -- on the clock, so a missed run is simply lost until the window comes round.
  if abs(extract(epoch from (time '03:00:00' - (k_recover at time zone 'America/New_York')::time))) < 1800 then
    raise exception 'FAIL the control is wrong: the old gate would also have fired at the recovery instant';
  end if;

  -- Now simulate the outage end to end: the cron is dead from 2026-09-01 00:15
  -- through 2026-09-03 11:15 UTC and comes back at 12:15. The league must
  -- process on the FIRST run after recovery, exactly once.
  select count(*) filter (where fired), min(ts) filter (where fired)
    into v_fires, v_first
    from (select g.ts, proof.run_at('20000000-0000-4000-8000-00000000000e', g.ts) as fired
            from generate_series(timestamptz '2026-09-03 12:15:00+00',
                                 timestamptz '2026-09-04 12:15:00+00', interval '1 hour') g(ts)
           order by g.ts) s;
  if v_fires <> 1 then
    raise exception 'FAIL expected exactly one catch-up run in the 25 hours after recovery, got %', v_fires;
  end if;
  if v_first <> timestamptz '2026-09-03 12:15:00+00' then
    raise exception 'FAIL the catch-up should happen on the first run after recovery (12:15+00), it happened at %', v_first;
  end if;
  raise notice 'PASS missed run self-heals: due two days late, processed on the first run back, once';
end $$;
SQL

echo "[10] CLAIM 4: DST, both directions, for the 02:00 leagues (17 in production)"
$P <<'SQL'
set time zone 'UTC';
-- Spring forward 2026-03-08: 02:00 America/New_York does not exist. Fall back
-- 2026-11-01: 01:00 occurs twice. Claims are created just before the day under
-- test so the PREVIOUS day's slot cannot be the one that fires.
insert into public.waiver_claims (league_id, team_id, player_id, status, created_at, updated_at, bid_amount)
select l.id, t.id, 8478402, 'pending', v.created_at, v.created_at, 5
  from (values
    ('30000000-0000-4000-8000-000000000001'::uuid, timestamptz '2026-03-08 00:00:00+00'),
    ('30000000-0000-4000-8000-000000000002'::uuid, timestamptz '2026-11-01 00:00:00+00'),
    ('30000000-0000-4000-8000-000000000003'::uuid, timestamptz '2026-11-01 00:00:00+00')
  ) v(league_id, created_at)
  join public.leagues l on l.id = v.league_id
  join public.teams   t on t.league_id = l.id;

do $$
declare v_local text; v_due timestamptz; v_fires int; v_first timestamptz; v_hits int; v_stamp timestamptz;
begin
  --------------------------------------------------------------- spring forward
  -- The gap is real: 01:59 EST is followed by 03:00 EDT.
  select (timestamptz '2026-03-08 06:59:00+00' at time zone 'America/New_York')::text
      || ' -> ' || (timestamptz '2026-03-08 07:00:00+00' at time zone 'America/New_York')::text
    into v_local;
  if v_local <> '2026-03-08 01:59:00 -> 2026-03-08 03:00:00' then
    raise exception 'FAIL this runner has no 2026 spring-forward transition where expected: %', v_local;
  end if;

  -- A 02:00 league still gets a real due instant on the day 02:00 does not
  -- exist. Postgres resolves the nonexistent local time forward to the moment
  -- the offset changed, which is 03:00 EDT = 07:00 UTC.
  v_due := proof.last_due_at('02:00:00'::time, timestamptz '2026-03-08 07:15:00+00');
  if v_due <> timestamptz '2026-03-08 07:00:00+00' then
    raise exception 'FAIL a 02:00 league on spring-forward day resolved to %, expected 2026-03-08 07:00+00', v_due;
  end if;
  -- Before that instant the league is still pinned to yesterday's slot, so it
  -- cannot fire twice on the same local day.
  v_due := proof.last_due_at('02:00:00'::time, timestamptz '2026-03-08 06:15:00+00');
  if v_due <> timestamptz '2026-03-07 07:00:00+00' then
    raise exception 'FAIL at 01:15 EST the last due moment should still be 2026-03-07 07:00+00, got %', v_due;
  end if;

  -- The whole day, hour by hour: exactly one processing run.
  select count(*) filter (where fired), min(ts) filter (where fired) into v_fires, v_first
    from (select g.ts, proof.run_at('30000000-0000-4000-8000-000000000001', g.ts) as fired
            from generate_series(timestamptz '2026-03-08 00:15:00+00',
                                 timestamptz '2026-03-09 12:15:00+00', interval '1 hour') g(ts)
           order by g.ts) s;
  if v_fires <> 1 then
    raise exception 'FAIL spring forward: expected exactly 1 run for the 02:00 league, got %', v_fires;
  end if;
  if v_first <> timestamptz '2026-03-08 07:15:00+00' then
    raise exception 'FAIL spring forward: expected the run at 2026-03-08 07:15+00 (03:15 EDT), got %', v_first;
  end if;

  -- Why this is the case an hour-equality gate gets wrong: on spring-forward
  -- day no hourly run has local hour 2 at all, so "process when the local hour
  -- equals waiver_process_time's hour" fires zero times and 17 production
  -- leagues would be skipped for the day.
  select count(*) into v_hits
    from generate_series(timestamptz '2026-03-08 00:15:00+00',
                         timestamptz '2026-03-08 23:15:00+00', interval '1 hour') g(ts)
   where extract(hour from (g.ts at time zone 'America/New_York')) = 2;
  if v_hits <> 0 then
    raise exception 'FAIL the contrast is not what it claims: an hour-equality gate had % chance(s) to fire', v_hits;
  end if;
  raise notice 'PASS spring forward: 02:00 league processed once, at 03:15 EDT; an hour-equality gate would have fired 0 times';

  ------------------------------------------------------------------- fall back
  select (timestamptz '2026-11-01 05:59:00+00' at time zone 'America/New_York')::text
      || ' -> ' || (timestamptz '2026-11-01 06:00:00+00' at time zone 'America/New_York')::text
    into v_local;
  if v_local <> '2026-11-01 01:59:00 -> 2026-11-01 01:00:00' then
    raise exception 'FAIL this runner has no 2026 fall-back transition where expected: %', v_local;
  end if;

  -- 02:00 is unambiguous on fall-back day: it happens once, in EST.
  v_due := proof.last_due_at('02:00:00'::time, timestamptz '2026-11-01 07:15:00+00');
  if v_due <> timestamptz '2026-11-01 07:00:00+00' then
    raise exception 'FAIL a 02:00 league on fall-back day resolved to %, expected 2026-11-01 07:00+00', v_due;
  end if;
  -- Through the repeated 01:xx hour the league is still on yesterday's slot,
  -- so the duplicated local hour cannot produce a second run.
  v_due := proof.last_due_at('02:00:00'::time, timestamptz '2026-11-01 05:15:00+00');  -- 01:15 EDT
  if v_due <> timestamptz '2026-10-31 06:00:00+00' then
    raise exception 'FAIL at the first 01:15 the last due moment should be 2026-10-31 06:00+00, got %', v_due;
  end if;
  v_due := proof.last_due_at('02:00:00'::time, timestamptz '2026-11-01 06:15:00+00');  -- 01:15 EST, the repeat
  if v_due <> timestamptz '2026-10-31 06:00:00+00' then
    raise exception 'FAIL at the repeated 01:15 the last due moment should still be 2026-10-31 06:00+00, got %', v_due;
  end if;

  select count(*) filter (where fired), min(ts) filter (where fired) into v_fires, v_first
    from (select g.ts, proof.run_at('30000000-0000-4000-8000-000000000002', g.ts) as fired
            from generate_series(timestamptz '2026-11-01 00:15:00+00',
                                 timestamptz '2026-11-02 12:15:00+00', interval '1 hour') g(ts)
           order by g.ts) s;
  if v_fires <> 1 then
    raise exception 'FAIL fall back: expected exactly 1 run for the 02:00 league across the 25-hour day, got %', v_fires;
  end if;
  if v_first <> timestamptz '2026-11-01 07:15:00+00' then
    raise exception 'FAIL fall back: expected the run at 2026-11-01 07:15+00 (02:15 EST), got %', v_first;
  end if;
  raise notice 'PASS fall back: 02:00 league processed once, at 02:15 EST, despite the duplicated 01:xx hour';

  ------------------------------------------- fall back, the ambiguous 01:00 case
  -- No production league is configured at 01:00 today, but the migration makes a
  -- claim about this case, so it is pinned here. PostgreSQL resolves an
  -- ambiguous local time to the standard-time reading, which for
  -- America/New_York is the SECOND 01:00 (06:00 UTC), not the first.
  v_due := proof.last_due_at('01:00:00'::time, timestamptz '2026-11-01 05:15:00+00');
  if v_due <> timestamptz '2026-11-01 06:00:00+00' then
    raise exception 'FAIL ambiguous 01:00 resolved to %, expected the standard-time reading 2026-11-01 06:00+00', v_due;
  end if;
  -- The observable behaviour is still one run per local day: the first 01:15
  -- fires (due_at is 45 minutes ahead of it, so created_at <= due_at holds and
  -- nothing has been processed since), and the repeated 01:15 is a no-op
  -- because the pending claims are gone.
  select count(*) filter (where fired), min(ts) filter (where fired) into v_fires, v_first
    from (select g.ts, proof.run_at('30000000-0000-4000-8000-000000000003', g.ts) as fired
            from generate_series(timestamptz '2026-11-01 00:15:00+00',
                                 timestamptz '2026-11-02 12:15:00+00', interval '1 hour') g(ts)
           order by g.ts) s;
  if v_fires <> 1 then
    raise exception 'FAIL fall back 01:00: expected exactly 1 run across the duplicated hour, got %', v_fires;
  end if;
  if v_first <> timestamptz '2026-11-01 05:15:00+00' then
    raise exception 'FAIL fall back 01:00: expected the first 01:15 EDT run (2026-11-01 05:15+00), got %', v_first;
  end if;

  -- WHICH GUARD actually suppresses the repeated hour. The migration's DST note
  -- used to name the wrong one; these three assertions pin the real mechanism.
  select max(processed_at) into v_stamp from public.waiver_claims
   where league_id = '30000000-0000-4000-8000-000000000003';
  v_due := proof.last_due_at('01:00:00'::time, timestamptz '2026-11-01 06:15:00+00');
  if v_stamp >= v_due then
    raise exception 'FAIL expected the first pass stamp (%) to sit BEFORE the ambiguous due moment (%), which is what makes the NOT EXISTS guard non-blocking here', v_stamp, v_due;
  end if;
  if exists (select 1 from public.waiver_claims
              where league_id = '30000000-0000-4000-8000-000000000003' and status = 'pending') then
    raise exception 'FAIL the first pass left a pending claim behind, so this test cannot isolate the guard';
  end if;
  raise notice 'NOTE  fall back 01:00: the repeated hour is suppressed by the pending-claim EXISTS, not by NOT EXISTS(processed_at >= due_at): stamp % < due_at %', v_stamp, v_due;
end $$;

-- ... and to show that positively: hand the league a fresh claim between the
-- two 01:15 passes and the second pass DOES pick it up. This is the behaviour
-- the corrected DST note in 20260903190000 describes.
insert into public.waiver_claims (league_id, team_id, player_id, status, created_at, updated_at, bid_amount)
select '30000000-0000-4000-8000-000000000003', t.id, 8999999, 'pending',
       timestamptz '2026-11-01 05:30:00+00', timestamptz '2026-11-01 05:30:00+00', 1
  from public.teams t where t.league_id = '30000000-0000-4000-8000-000000000003';
do $$
begin
  if proof.should_process_at('30000000-0000-4000-8000-000000000003', timestamptz '2026-11-01 06:15:00+00') is not true then
    raise exception 'FAIL a claim submitted between the two 01:15 passes should be processed on the second one';
  end if;
  raise notice 'PASS fall back 01:00: ambiguous time resolves to the standard-time (second) reading, one run per local day, and a claim arriving mid-hour is still picked up';
end $$;
delete from public.waiver_claims where player_id = 8999999;
SQL

echo "[11] CLAIM 5: should_process_waivers_now(uuid) is a real boolean, never NULL"
$P <<'SQL'
set time zone 'UTC';
do $$
declare v_b boolean; v_bad int; v_type text;
begin
  if pg_get_function_result('public.should_process_waivers_now(uuid)'::regprocedure) <> 'boolean' then
    raise exception 'FAIL the overload does not return boolean, it returns %',
      pg_get_function_result('public.should_process_waivers_now(uuid)'::regprocedure);
  end if;
  select pg_typeof(public.should_process_waivers_now('40000000-0000-4000-8000-000000000001'))::text into v_type;
  if v_type <> 'boolean' then raise exception 'FAIL runtime type is %', v_type; end if;

  -- Never NULL for any real league, whatever its configuration or claim state.
  select count(*) into v_bad from public.leagues l where public.should_process_waivers_now(l.id) is null;
  if v_bad <> 0 then raise exception 'FAIL % league(s) produced NULL', v_bad; end if;

  -- False, not NULL, for an id that does not exist.
  v_b := public.should_process_waivers_now('00000000-0000-0000-0000-000000000000'::uuid);
  if v_b is not false then raise exception 'FAIL unknown league id returned % instead of false', v_b; end if;

  -- False, not NULL, for a NULL argument: a caller that loses its league id
  -- must read as "not due", never as "due" and never as an error.
  v_b := public.should_process_waivers_now(null::uuid);
  if v_b is not false then raise exception 'FAIL a NULL league id returned % instead of false', v_b; end if;

  raise notice 'PASS boolean overload: never NULL over % league(s), false for unknown and NULL ids', (select count(*) from public.leagues);
end $$;
SQL

echo "[12] CLAIM 6: the 0-arg diagnostic keeps its shape, and the anon chain works"
$P <<'SQL'
set time zone 'UTC';
do $$
declare b record; v_shape text; v_names text[]; v_types text[]; v_sec boolean; v_vol "char"; v_cfg text[];
begin
  select * into b from proof.shape_before;
  select pg_get_function_result('public.should_process_waivers_now()'::regprocedure) into v_shape;
  select (select array_agg(x order by ord) from unnest(p.proargnames) with ordinality as t(x, ord)),
         (select array_agg(format_type(x, null) order by ord)
            from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as t(x, ord)),
         p.prosecdef, p.provolatile, p.proconfig
    into v_names, v_types, v_sec, v_vol, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='should_process_waivers_now' and p.pronargs = 0;

  -- Column NAMES and TYPES, compared against what the captured pre-change body
  -- declared, not against a string typed from memory.
  if v_shape <> b.result_shape then
    raise exception 'FAIL return shape drifted. before: % / after: %', b.result_shape, v_shape;
  end if;
  if v_names is distinct from b.argnames then
    raise exception 'FAIL output column names drifted: % -> %', b.argnames, v_names;
  end if;
  if v_types is distinct from b.argtypes then
    raise exception 'FAIL output column types drifted: % -> %', b.argtypes, v_types;
  end if;
  if not ('current_time_est' = any(v_names)) then
    raise exception 'FAIL current_time_est is gone from the output columns: %', v_names;
  end if;
  -- and it is still a time, not a text or a timestamptz
  if v_types[array_position(v_names, 'current_time_est')] <> 'time without time zone' then
    raise exception 'FAIL current_time_est changed type to %', v_types[array_position(v_names, 'current_time_est')];
  end if;
  if v_sec is distinct from b.prosecdef or v_sec <> false then
    raise exception 'FAIL the diagnostic must stay SECURITY INVOKER (prosecdef before %, after %)', b.prosecdef, v_sec;
  end if;
  if v_vol is distinct from b.provolatile then
    raise exception 'FAIL volatility drifted: % -> %', b.provolatile, v_vol;
  end if;
  if v_cfg is distinct from b.proconfig then
    raise exception 'FAIL search_path setting drifted: % -> %', b.proconfig, v_cfg;
  end if;
  raise notice 'PASS 0-arg return shape byte-identical to the captured body: %', v_shape;
end $$;

-- The diagnostic must agree with the overload it now delegates to, and must
-- report the wall clock it always reported. Both halves are evaluated in a
-- single statement so now() is the same for the function and for the check.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.should_process_waivers_now() d
   where d.should_process is distinct from public.should_process_waivers_now(d.league_id)
      or d.current_time_est is distinct from (now() at time zone public.waiver_processing_timezone())::time;
  if v_bad <> 0 then
    raise exception 'FAIL % diagnostic row(s) disagree with the overload or misreport current_time_est', v_bad;
  end if;
  -- and it still only reports leagues that have a configured time and a pending
  -- claim, which is the WHERE clause the capture had.
  select count(*) into v_bad from public.should_process_waivers_now() d
    join public.leagues l on l.id = d.league_id
   where l.waiver_process_time is null;
  if v_bad <> 0 then raise exception 'FAIL the diagnostic started reporting leagues with no configured time'; end if;
  raise notice 'PASS diagnostic rows agree with the overload and still carry the Eastern wall clock';
end $$;

-- Privilege chain, exercised rather than asserted: run the diagnostic AS anon.
-- This is the call that would raise "permission denied for function
-- should_process_waivers_now(uuid)" if the new overload were granted to
-- service_role only.
do $$
declare v_n int;
begin
  set local role anon;
  select count(*) into v_n from public.should_process_waivers_now();
  reset role;
  raise notice 'PASS the 0-arg diagnostic ran as anon end to end and returned % row(s)', v_n;
end $$;
SQL
$P <<'SQL'
set time zone 'UTC';
do $$
begin
  if not has_function_privilege('anon', 'public.should_process_waivers_now()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.should_process_waivers_now(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.waiver_last_due_at(time without time zone)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.waiver_processing_timezone()', 'EXECUTE') then
    raise exception 'FAIL anon cannot execute the whole chain the diagnostic reaches';
  end if;
  if not has_function_privilege('authenticated', 'public.should_process_waivers_now(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.should_process_waivers_now(uuid)', 'EXECUTE') then
    raise exception 'FAIL the overload is not granted to authenticated and service_role';
  end if;
  -- The orchestrator stays locked to service_role exactly as the live ACL has it.
  if has_function_privilege('anon', 'public.process_all_faab_waivers()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.process_all_faab_waivers()', 'EXECUTE') then
    raise exception 'FAIL process_all_faab_waivers() was exposed beyond service_role';
  end if;
  if not has_function_privilege('service_role', 'public.process_all_faab_waivers()', 'EXECUTE') then
    raise exception 'FAIL service_role lost EXECUTE on process_all_faab_waivers()';
  end if;
end $$;
SQL

# The grant on the new overload is load-bearing, not decorative: without it the
# existing anon-facing diagnostic starts failing. Prove that by taking it away.
$P -c "revoke execute on function public.should_process_waivers_now(uuid) from anon;" >/dev/null
if $P -c "set role anon; select count(*) from public.should_process_waivers_now();" >/dev/null 2>&1; then
  echo "FAIL: the diagnostic still worked for anon without EXECUTE on the uuid overload,"
  echo "      so this proof cannot show the grant is necessary."
  exit 1
fi
$P -c "grant execute on function public.should_process_waivers_now(uuid) to anon;" >/dev/null
$P -c "set role anon; select count(*) from public.should_process_waivers_now();" >/dev/null
echo "     ok anon chain fails without the overload grant and works with it"

echo "[13] end-to-end at the real clock: the orchestrator processes exactly the due faab leagues"
$P <<'SQL'
set time zone 'UTC';
-- Fixtures are placed RELATIVE to the real waiver_last_due_at, so this step is
-- as time-independent as the named-instant steps above.
insert into public.waiver_claims (league_id, team_id, player_id, status, created_at, updated_at, processed_at, bid_amount)
select l.id, t.id, v.player_id, v.status,
       public.waiver_last_due_at(l.waiver_process_time) + v.created_offset,
       public.waiver_last_due_at(l.waiver_process_time) + v.created_offset,
       case when v.processed_offset is null then null
            else public.waiver_last_due_at(l.waiver_process_time) + v.processed_offset end,
       9
  from (values
    ('40000000-0000-4000-8000-000000000001'::uuid, 8478402, 'pending',    -interval '1 hour', null::interval),
    ('40000000-0000-4000-8000-000000000002'::uuid, 8477934, 'pending',     interval '1 second', null::interval),
    ('40000000-0000-4000-8000-000000000003'::uuid, 8471675, 'pending',    -interval '1 hour', null::interval),
    ('40000000-0000-4000-8000-000000000003'::uuid, 8476945, 'successful', -interval '2 hours', interval '1 minute'),
    ('40000000-0000-4000-8000-000000000004'::uuid, 8480069, 'pending',    -interval '1 hour', null::interval)
  ) v(league_id, player_id, status, created_offset, processed_offset)
  join public.leagues l on l.id = v.league_id
  join public.teams   t on t.league_id = l.id;

create temporary table run_result as select * from public.process_all_faab_waivers();
do $$
declare v_hit boolean; v_n int; r record;
begin
  select exists(select 1 from run_result where league_id = '40000000-0000-4000-8000-000000000001') into v_hit;
  if not v_hit then raise exception 'FAIL rt-due (old pending claim, never processed) was not processed'; end if;
  select claims_processed into v_n from run_result where league_id = '40000000-0000-4000-8000-000000000001';
  if v_n <> 1 then raise exception 'FAIL rt-due reported % claims processed, expected 1', v_n; end if;

  select exists(select 1 from run_result where league_id = '40000000-0000-4000-8000-000000000002') into v_hit;
  if v_hit then raise exception 'FAIL rt-not-due (claim one second after due_at) was processed anyway'; end if;

  select exists(select 1 from run_result where league_id = '40000000-0000-4000-8000-000000000003') into v_hit;
  if v_hit then raise exception 'FAIL rt-processed (already processed after due_at) was processed again'; end if;

  select exists(select 1 from run_result where league_id = '40000000-0000-4000-8000-000000000004') into v_hit;
  if v_hit then raise exception 'FAIL rt-rolling was processed; the waiver_type = faab filter was lost'; end if;

  -- The claim really moved, and the ones that must not move did not.
  select count(*) into v_n from public.waiver_claims
   where league_id = '40000000-0000-4000-8000-000000000001' and status = 'successful' and processed_at is not null;
  if v_n <> 1 then raise exception 'FAIL rt-due claim was not resolved and stamped'; end if;
  select count(*) into v_n from public.waiver_claims
   where league_id in ('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000004')
     and status <> 'pending';
  if v_n <> 0 then raise exception 'FAIL % claim(s) in not-due leagues were resolved', v_n; end if;

  -- Every league it did return was one the boolean overload would also have
  -- called due a moment earlier; nothing snuck through by another route.
  for r in select * from run_result loop
    if (select waiver_type from public.leagues where id = r.league_id) <> 'faab' then
      raise exception 'FAIL the orchestrator returned non-faab league %', r.league_id;
    end if;
  end loop;
  raise notice 'PASS end-to-end: due league processed once, late claim skipped, already-processed skipped, non-faab untouched';
end $$;
SQL

echo "[14] the due-moment invariants hold at every hour of nine days, DST days included"
$P <<'SQL'
set time zone 'UTC';
-- A proof that only passes on some days is worthless, so the properties the
-- whole gate rests on are swept over every hourly run of nine named days: an
-- ordinary week in September, the spring-forward weekend, and the fall-back
-- weekend. 216 instants x 6 configured times = 1296 evaluations.
do $$
declare v_n int; v_bad int; r record;
begin
  create temporary table sweep as
  select g.ts, v.t,
         proof.last_due_at(v.t, g.ts) as due
    from (
      select generate_series(timestamptz '2026-09-02 00:15:00+00', timestamptz '2026-09-04 23:15:00+00', interval '1 hour') as ts
      union all
      select generate_series(timestamptz '2026-03-07 00:15:00+00', timestamptz '2026-03-09 23:15:00+00', interval '1 hour')
      union all
      select generate_series(timestamptz '2026-10-31 00:15:00+00', timestamptz '2026-11-02 23:15:00+00', interval '1 hour')
    ) g(ts)
    cross join (values ('00:00:00'::time),('01:00:00'::time),('02:00:00'::time),
                       ('03:00:00'::time),('04:00:00'::time),('12:00:00'::time)) v(t);

  select count(*) into v_n from sweep;
  if v_n < 1200 then raise exception 'CONTROL FAILED: the sweep only built % rows', v_n; end if;

  -- (A) a configured time always yields a real instant.
  select count(*) into v_bad from sweep where due is null;
  if v_bad <> 0 then raise exception 'FAIL % sweep row(s) produced a NULL due moment', v_bad; end if;

  -- (B) it never falls more than one local day behind, so no league is ever
  --     skipped for a day. 25 hours, not 24, because fall-back days are longer.
  select count(*) into v_bad from sweep where ts - due >= interval '25 hours';
  if v_bad <> 0 then
    select * into r from sweep where ts - due >= interval '25 hours' limit 1;
    raise exception 'FAIL the due moment fell % behind at % for a % league', r.ts - r.due, r.ts, r.t;
  end if;

  -- (C) it never runs ahead of the clock by more than the one ambiguous hour a
  --     fall-back day creates.
  select count(*) into v_bad from sweep where due - ts > interval '1 hour';
  if v_bad <> 0 then
    select * into r from sweep where due - ts > interval '1 hour' limit 1;
    raise exception 'FAIL the due moment ran % ahead at % for a % league', r.due - r.ts, r.ts, r.t;
  end if;

  -- (E) "most recent occurrence" is a fixed point: asked again standing exactly
  --     on the due moment, the answer is that same moment. This is what fails
  --     first when the day arithmetic or the zone handling is off by one, and
  --     it holds through the nonexistent hour and the duplicated hour alike.
  select count(*) into v_bad from sweep where proof.last_due_at(t, due) is distinct from due;
  if v_bad <> 0 then
    select * into r from sweep where proof.last_due_at(t, due) is distinct from due limit 1;
    raise exception 'FAIL not a fixed point: at % a % league is due at %, but asked again there it answers %',
      r.ts, r.t, r.due, proof.last_due_at(r.t, r.due);
  end if;

  raise notice 'PASS % due-moment evaluations across 9 days: never NULL, never more than 25h behind, never more than 1h ahead, always a fixed point', v_n;
end $$;
SQL

echo "[15] CLAIM 7: both migrations are idempotent"
$P <<'SQL'
set time zone 'UTC';
-- Fingerprint everything a second apply could plausibly disturb: the four
-- function definitions, their ACLs, security and volatility settings, their
-- declared return types, the cron job row, and the data.
create table proof.fingerprint_before as
select md5(string_agg(sig, '|' order by sig)) as fp
  from (
    select p.proname || '/' || pg_get_function_identity_arguments(p.oid)
           || '/' || pg_get_functiondef(p.oid)
           || '/' || pg_get_function_result(p.oid)
           || '/' || p.prosecdef::text || '/' || p.provolatile::text
           || '/' || coalesce(array_to_string(p.proconfig, ','), '')
           || '/' || coalesce(array_to_string(p.proacl::text[], ','), '') as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('process_all_faab_waivers','should_process_waivers_now',
                         'waiver_last_due_at','waiver_processing_timezone')
    union all
    select 'cron/' || jobid || '/' || jobname || '/' || schedule || '/' || command from cron.job
    union all
    select 'data/' || md5(string_agg(x, '|' order by x))
      from (select id::text || status || coalesce(processed_at::text,'-') || created_at::text
              from public.waiver_claims) w(x)
  ) s;
SQL
$P -f "$MIG1" >/dev/null
$P -f "$MIG2" >/dev/null
$P <<'SQL'
set time zone 'UTC';
do $$
declare v_before text; v_after text; v_n int;
begin
  select fp into v_before from proof.fingerprint_before;
  select md5(string_agg(sig, '|' order by sig)) into v_after
    from (
      select p.proname || '/' || pg_get_function_identity_arguments(p.oid)
             || '/' || pg_get_functiondef(p.oid)
             || '/' || pg_get_function_result(p.oid)
             || '/' || p.prosecdef::text || '/' || p.provolatile::text
             || '/' || coalesce(array_to_string(p.proconfig, ','), '')
             || '/' || coalesce(array_to_string(p.proacl::text[], ','), '') as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('process_all_faab_waivers','should_process_waivers_now',
                           'waiver_last_due_at','waiver_processing_timezone')
      union all
      select 'cron/' || jobid || '/' || jobname || '/' || schedule || '/' || command from cron.job
      union all
      select 'data/' || md5(string_agg(x, '|' order by x))
        from (select id::text || status || coalesce(processed_at::text,'-') || created_at::text
                from public.waiver_claims) w(x)
    ) s;
  if v_before <> v_after then
    raise exception 'FAIL a second apply changed something: fingerprint % -> %', v_before, v_after;
  end if;
  -- Belt and braces on the two things a re-apply is most likely to break.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='should_process_waivers_now';
  if v_n <> 2 then raise exception 'FAIL re-apply left % should_process_waivers_now overloads, expected 2', v_n; end if;
  select count(*) into v_n from cron.job;
  if v_n <> 1 then raise exception 'FAIL re-apply created a duplicate cron job (% rows)', v_n; end if;
  raise notice 'PASS both migrations re-applied with no change to definitions, grants, cron job or data';
end $$;
SQL

echo "ALL PASS"
