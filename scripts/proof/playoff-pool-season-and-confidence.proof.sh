#!/usr/bin/env bash
# CITRUS-CLASSIFICATION ----------------------------------------------------------
# CATEGORY: PROOF (scratch Postgres only; never points at a Supabase project)
# Purpose:     Prove 20260903220000_playoff_pool_season_scope.sql and
#              20260903221000_confidence_week_game_scope.sql against prod-shaped
#              tables: the OLD playoff scorer recomputes every standing to zero
#              the moment the regular season flips, the NEW one holds its pool to
#              the playoff run it belongs to and refuses to write when there is
#              nothing to score; the OLD confidence scorer credits a pick that
#              names a finished game from another week, the NEW one refuses it
#              and still scores the honest pick beside it. Both migrations
#              re-apply as no-ops. Exit 0 = PASS.
# Last active: 2026-09-03
# Invoked:     PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash scripts/proof/playoff-pool-season-and-confidence.proof.sh
# Reads:       supabase/migrations/20260903220000_playoff_pool_season_scope.sql
#              supabase/migrations/20260903221000_confidence_week_game_scope.sql
#              supabase/migrations/captures/2026-09-03_pre_playoff_pool_season_scope.sql
#              supabase/migrations/captures/2026-09-03_pre_confidence_week_game_scope.sql
# Writes:      scratch database pool_season_proof (dropped and recreated)
# ----------------------------------------------------------------------------
# Column types, defaults and constraints were harvested from production
# information_schema.columns and pg_constraint on 2026-09-03, not composed
# (INS-16). In particular: player_game_stats.nhl_* are NOT NULL DEFAULT 0, which
# is why the fixture writes nhl_goals and not goals - the scorer reads
# COALESCE(COALESCE(pg.nhl_goals, pg.goals), 0) and a NOT NULL zero wins.
#
# get_current_season, get_nhl_season_year, get_pool_week_dates and
# get_current_pool_week are the live production bodies, not stubs. The season
# flip is therefore produced the way production will produce it - by loading the
# 2026-27 regular schedule - rather than by faking a return value.
#
# All fixture dates are relative to CURRENT_DATE so the proof is stable on any
# runner clock. The only absolute dates are in step 8, which exercises the
# calendar fallback and needs fixed months to assert against.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG1="$ROOT/supabase/migrations/20260903220000_playoff_pool_season_scope.sql"
MIG2="$ROOT/supabase/migrations/20260903221000_confidence_week_game_scope.sql"
CAP1="$ROOT/supabase/migrations/captures/2026-09-03_pre_playoff_pool_season_scope.sql"
CAP2="$ROOT/supabase/migrations/captures/2026-09-03_pre_confidence_week_game_scope.sql"
P0="psql -v ON_ERROR_STOP=1 -qX"
$P0 -c "drop database if exists pool_season_proof;"
$P0 -c "create database pool_season_proof;"
P="$P0 -d pool_season_proof"

echo "[1] build prod-shaped tables and the live season/week helper functions"
$P <<'SQL'
-- Supabase ships these roles; a scratch cluster does not. The migrations
-- REVOKE/GRANT against service_role.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin;  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin;          end if;
end $$;

-- leagues: only the columns these scorers touch. playoff_season is deliberately
-- ABSENT so migration 1's ADD COLUMN does real work.
create table public.leagues (
  id uuid primary key, name text not null, roster_size int not null default 21,
  settings jsonb default '{}'::jsonb, scoring_settings jsonb,
  created_at timestamptz not null default now());

create table public.nhl_games (
  id uuid primary key default gen_random_uuid(),
  game_id integer not null,
  game_date date not null,
  game_time timestamptz,
  home_team text not null, away_team text not null,
  home_score integer default 0, away_score integer default 0,
  status text default 'scheduled',
  period text,
  season integer not null,
  game_type text default 'regular',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nhl_games_game_id_key unique (game_id));
create index on public.nhl_games (season, game_type, game_date);

-- NOT NULL DEFAULT 0 on every stat column, exactly as production has it.
create table public.player_game_stats (
  season integer not null,
  game_id integer not null,
  player_id integer not null,
  is_goalie boolean not null default false,
  goals integer not null default 0,
  primary_assists integer not null default 0,
  secondary_assists integer not null default 0,
  shots_on_goal integer not null default 0,
  hits integer not null default 0,
  blocks integer not null default 0,
  pim integer not null default 0,
  ppp integer not null default 0,
  shp integer not null default 0,
  plus_minus integer not null default 0,
  wins integer not null default 0,
  saves integer not null default 0,
  goals_against integer not null default 0,
  shutouts integer not null default 0,
  nhl_goals integer not null default 0,
  nhl_assists integer not null default 0,
  nhl_shots_on_goal integer not null default 0,
  nhl_hits integer not null default 0,
  nhl_blocks integer not null default 0,
  nhl_pim integer not null default 0,
  nhl_ppp integer not null default 0,
  nhl_shp integer not null default 0,
  nhl_plus_minus integer not null default 0,
  nhl_wins integer not null default 0,
  nhl_saves integer not null default 0,
  nhl_goals_against integer not null default 0,
  nhl_shutouts integer not null default 0,
  primary key (game_id, player_id));

create table public.playoff_roster_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null,
  player_id integer not null,
  position_slot text not null,
  locked_at timestamptz,
  created_at timestamptz default now(),
  constraint playoff_roster_picks_league_id_user_id_player_id_key
    unique (league_id, user_id, player_id));

-- PRIMARY KEY (league_id, user_id) is what the scorer's ON CONFLICT targets.
-- Six columns, no history table: this is the whole record.
create table public.playoff_pool_standings (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null,
  total_points numeric not null default 0,
  correct_picks integer not null default 0,
  current_rank integer,
  last_updated timestamptz default now(),
  constraint playoff_pool_standings_pkey primary key (league_id, user_id));

create table public.confidence_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null,
  week_number integer not null,
  game_id text not null,
  picked_team text not null,
  confidence_points integer not null,
  is_correct boolean,
  points_earned integer not null default 0,
  created_at timestamptz not null default now(),
  constraint confidence_picks_week_number_check check ((week_number > 0)),
  constraint confidence_picks_confidence_points_check check ((confidence_points > 0)),
  constraint confidence_picks_league_id_user_id_week_number_game_id_key
    unique (league_id, user_id, week_number, game_id),
  constraint confidence_points_unique_per_user_week
    unique (league_id, user_id, week_number, confidence_points));

-- ---- live production function bodies (pg_get_functiondef, 2026-09-03) ----
CREATE OR REPLACE FUNCTION public.get_nhl_season_year(p_date date)
 RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE v_year INTEGER; v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date);
  v_month := EXTRACT(MONTH FROM p_date);
  IF v_month >= 10 THEN RETURN v_year; ELSE RETURN v_year - 1; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_season(p_on date DEFAULT CURRENT_DATE)
 RETURNS integer LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT g.season FROM nhl_games g WHERE g.game_type = 'regular'
      GROUP BY g.season
     HAVING min(g.game_date) <= p_on AND max(g.game_date) >= p_on
      ORDER BY g.season DESC LIMIT 1),
    (SELECT max(g.season) FROM nhl_games g
      WHERE g.game_type = 'regular' AND g.game_date <= p_on),
    public.get_nhl_season_year(p_on)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_pool_week_dates(p_week_number integer, p_season integer DEFAULT NULL::integer)
 RETURNS TABLE(week_start date, week_end date)
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE v_season INT; v_first_game DATE; v_week1_sunday DATE;
BEGIN
  v_season := COALESCE(p_season, public.get_current_season());
  SELECT MIN(g.game_date) INTO v_first_game FROM nhl_games g WHERE g.season = v_season;
  IF v_first_game IS NULL THEN
    RAISE EXCEPTION 'get_pool_week_dates: no schedule loaded for season %', v_season;
  END IF;
  v_week1_sunday := v_first_game - (EXTRACT(DOW FROM v_first_game)::INT || ' days')::INTERVAL;
  week_start := v_week1_sunday + ((p_week_number - 1) * 7 || ' days')::INTERVAL;
  week_end   := week_start + INTERVAL '6 days';
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.get_current_pool_week(p_on date DEFAULT CURRENT_DATE, p_season integer DEFAULT NULL::integer)
 RETURNS integer LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE v_season INT; v_first DATE; v_w1 DATE;
BEGIN
  v_season := COALESCE(p_season, public.get_current_season(p_on));
  SELECT MIN(g.game_date) INTO v_first FROM nhl_games g WHERE g.season = v_season;
  IF v_first IS NULL THEN RETURN NULL; END IF;
  v_w1 := v_first - (EXTRACT(DOW FROM v_first)::INT || ' days')::INTERVAL;
  RETURN GREATEST(1, FLOOR((p_on - v_w1) / 7.0)::INT + 1);
END $function$;
SQL

# Fixture identities.
LGA='11111111-1111-1111-1111-111111111111'   # pool A, the 2025-26 playoff run
LGB='22222222-2222-2222-2222-222222222222'   # pool B, a NEW pool for the 2026-27 run
LGC='33333333-3333-3333-3333-333333333333'   # pool C, derives 2026 with no explicit key
LGD='44444444-4444-4444-4444-444444444444'   # confidence pool
U1='aaaaaaaa-0000-4000-8000-000000000001'
U2='aaaaaaaa-0000-4000-8000-000000000002'

echo "[2] load the 2025-26 world and score pool A with the OLD body (the capture)"
$P <<SQL
-- Season 2025: regular D0-330..D0-140, playoffs D0-130..D0-100. Relative to
-- CURRENT_DATE so get_current_season() answers 2025 on any runner clock:
-- no regular season spans today, and 2025 is the newest that has begun.
insert into public.nhl_games (game_id, game_date, home_team, away_team, home_score, away_score, status, season, game_type)
select 100000 + gs, current_date - 330 + (gs * 2), 'TOR', 'MTL', 3, 2, 'final', 2025, 'regular'
  from generate_series(0, 94) gs;
insert into public.nhl_games (game_id, game_date, home_team, away_team, home_score, away_score, status, season, game_type)
select 200000 + gs, current_date - 130 + gs, 'BOS', 'NYR', 4, 1, 'final', 2025, 'playoff'
  from generate_series(0, 30) gs;

-- Two managers, one skater each. nhl_goals is what the scorer reads.
insert into public.player_game_stats (season, game_id, player_id, nhl_goals)
values (2025, 200000, 8478402, 2),   -- U1's skater: 2 goals -> 6.00 at the default 3/goal
       (2025, 200001, 8477934, 1);   -- U2's skater: 1 goal  -> 3.00

insert into public.leagues (id, name, settings, created_at)
values ('$LGA', 'Pool A 2025 run',
        '{"leagueType":"playoff-roster-pool"}'::jsonb, current_date - 131);

-- created_at must be on or before the first scored game: the scorer floors each
-- pick at GREATEST(rp.created_at::date, playoffScoringStartDate).
insert into public.playoff_roster_picks (league_id, user_id, player_id, position_slot, created_at)
values ('$LGA', '$U1', 8478402, 'F', (current_date - 130)::timestamptz),
       ('$LGA', '$U2', 8477934, 'F', (current_date - 130)::timestamptz);
SQL

$P -f "$CAP1" >/dev/null
$P -c "select public.score_playoff_roster_pool('$LGA');" >/dev/null
$P <<SQL
create table public.expected_standings as
  select user_id, total_points, current_rank from public.playoff_pool_standings where league_id = '$LGA';

do \$\$ declare v_season int; v_p1 numeric; v_p2 numeric; v_r1 int; c int; begin
  select public.get_current_season() into v_season;
  if v_season <> 2025 then raise exception 'FIXTURE: get_current_season() is % before the flip, expected 2025', v_season; end if;

  select count(*) into c from public.playoff_pool_standings where league_id = '$LGA';
  if c <> 2 then raise exception 'UNEXPECTED: capture wrote % standings rows, expected 2', c; end if;

  select total_points, current_rank into v_p1, v_r1 from public.playoff_pool_standings where user_id = '$U1';
  select total_points into v_p2 from public.playoff_pool_standings where user_id = '$U2';
  if v_p1 <> 6.00 or v_p2 <> 3.00 then
    raise exception 'UNEXPECTED: capture scored % / %, expected 6.00 / 3.00; the capture may not be the live body', v_p1, v_p2;
  end if;
  if v_r1 <> 1 then raise exception 'UNEXPECTED: leader rank is %, expected 1', v_r1; end if;
  raise notice 'old body, before the flip: U1 6.00 rank 1, U2 3.00 rank 2 (correct)';
end \$\$;
SQL

echo "[3] DEFECT: open the 2026-27 regular season and the OLD body zeroes the pool"
$P <<SQL
-- This is the only change. No pick moves, no game result changes, no setting
-- changes. The 2026-27 schedule loads - which is what happens on 2026-09-29.
insert into public.nhl_games (game_id, game_date, home_team, away_team, status, season, game_type)
select 300000 + gs, current_date - 3 + gs, 'EDM', 'CGY', 'scheduled', 2026, 'regular'
  from generate_series(0, 200) gs;

do \$\$ declare v_season int; c int; begin
  select public.get_current_season() into v_season;
  if v_season <> 2026 then raise exception 'FIXTURE: get_current_season() is % after loading 2026, expected 2026', v_season; end if;
  select count(*) into c from public.nhl_games where game_type = 'playoff' and season = 2026;
  if c <> 0 then raise exception 'FIXTURE: season 2026 should have no playoff game yet, has %', c; end if;
end \$\$;
SQL

$P -c "select public.score_playoff_roster_pool('$LGA');" >/dev/null
$P <<SQL
do \$\$ declare v_nonzero int; v_rank1 int; v_max numeric; begin
  select count(*) into v_nonzero from public.playoff_pool_standings where league_id = '$LGA' and total_points <> 0;
  select count(*) into v_rank1   from public.playoff_pool_standings where league_id = '$LGA' and current_rank = 1;
  select max(total_points) into v_max from public.playoff_pool_standings where league_id = '$LGA';
  if v_nonzero <> 0 then
    raise exception 'UNEXPECTED: the old body did NOT zero the pool (% non-zero rows); the capture may not be the live body', v_nonzero;
  end if;
  if v_rank1 <> 2 then
    raise exception 'UNEXPECTED: expected RANK() to tie both users at 1, got % rows at rank 1', v_rank1;
  end if;
  raise notice 'PASS defect reproduced: both standings recomputed to 0.00 (max %), both tied at rank 1, unattended and unrecoverable', v_max;
end \$\$;
SQL

echo "[4] apply migration 1"
$P -f "$MIG1"

echo "[5] NEW body: pool A keeps scoring its own playoff run across the flip"
$P -c "select public.score_playoff_roster_pool('$LGA');" >/dev/null
$P <<SQL
do \$\$ declare v_season int; v_resolved int; c int; begin
  select public.get_current_season() into v_season;
  if v_season <> 2026 then raise exception 'FIXTURE: the flip must still be in effect, got %', v_season; end if;

  select public.pool_playoff_season('$LGA') into v_resolved;
  if v_resolved <> 2025 then raise exception 'FAIL pool A resolves to season %, expected 2025', v_resolved; end if;

  select count(*) into c
    from public.playoff_pool_standings s
    join public.expected_standings e
      on e.user_id = s.user_id
     and e.total_points = s.total_points
     and e.current_rank = s.current_rank
   where s.league_id = '$LGA';
  if c <> 2 then
    raise exception 'FAIL restored standings do not match the pre-flip values (% of 2 rows match)', c;
  end if;
  raise notice 'PASS with the clock reading season 2026, pool A still resolves to its own run (2025) and scores U1 6.00 rank 1, U2 3.00 rank 2';
end \$\$;
SQL

echo "[6] NEW body: a pool whose run has nothing scoreable is left alone, not zeroed"
$P <<SQL
-- Pool B is created for the 2026-27 playoffs. Its schedule does not exist yet.
-- The old failure mode was exactly this shape: resolve to a season with no
-- games, then write zeros. It must write nothing at all.
insert into public.leagues (id, name, settings, playoff_season, created_at)
values ('$LGB', 'Pool B 2026 run', '{"leagueType":"playoff-roster-pool"}'::jsonb, 2026, current_date);
insert into public.playoff_roster_picks (league_id, user_id, player_id, position_slot, created_at)
values ('$LGB', '$U1', 8478402, 'F', now()),
       ('$LGB', '$U2', 8477934, 'F', now());
SQL
$P <<SQL
do \$\$ declare v_ret int; c int; v_resolved int; begin
  select public.pool_playoff_season('$LGB') into v_resolved;
  if v_resolved <> 2026 then raise exception 'FAIL explicit playoff_season ignored: got %', v_resolved; end if;

  select public.score_playoff_roster_pool('$LGB') into v_ret;
  if v_ret <> 0 then raise exception 'FAIL expected 0 rows written, got %', v_ret; end if;

  select count(*) into c from public.playoff_pool_standings where league_id = '$LGB';
  if c <> 0 then raise exception 'FAIL the guard wrote % standings rows from an empty game set', c; end if;

  -- and pool A must be untouched by pool B's run
  select count(*) into c from public.playoff_pool_standings where league_id = '$LGA' and total_points <> 0;
  if c <> 2 then raise exception 'FAIL pool A was disturbed'; end if;
  raise notice 'PASS a pool with no scoreable game writes nothing and returns 0; no standing is zeroed';
end \$\$;
SQL

echo "[7] NEW body: the 2026-27 pools score once their playoff games exist"
$P <<SQL
insert into public.nhl_games (game_id, game_date, home_team, away_team, home_score, away_score, status, season, game_type)
select 400000 + gs, current_date + 210 + gs, 'VAN', 'SEA', 5, 2, 'final', 2026, 'playoff'
  from generate_series(0, 20) gs;
insert into public.player_game_stats (season, game_id, player_id, nhl_goals)
values (2026, 400000, 8478402, 4),   -- U1: 4 goals -> 12.00
       (2026, 400001, 8477934, 1);   -- U2: 1 goal  ->  3.00

-- Pool C carries NO explicit key. It must derive 2026 from its own anchor:
-- the earliest playoff game on or after its first roster pick.
insert into public.leagues (id, name, settings, created_at)
values ('$LGC', 'Pool C 2026 run, derived', '{"leagueType":"playoff-roster-pool"}'::jsonb, current_date + 205);
insert into public.playoff_roster_picks (league_id, user_id, player_id, position_slot, created_at)
values ('$LGC', '$U1', 8478402, 'F', (current_date + 210)::timestamptz);
SQL
$P <<SQL
do \$\$ declare v_resolved int; v_p numeric; v_a numeric; begin
  select public.score_playoff_roster_pool('$LGB') into v_resolved;
  select total_points into v_p from public.playoff_pool_standings where league_id = '$LGB' and user_id = '$U1';
  if v_p <> 12.00 then raise exception 'FAIL pool B scored % from the 2026 run, expected 12.00', v_p; end if;

  select public.pool_playoff_season('$LGC') into v_resolved;
  if v_resolved <> 2026 then raise exception 'FAIL pool C derived season %, expected 2026', v_resolved; end if;
  perform public.score_playoff_roster_pool('$LGC');
  select total_points into v_p from public.playoff_pool_standings where league_id = '$LGC' and user_id = '$U1';
  if v_p <> 12.00 then raise exception 'FAIL pool C scored %, expected 12.00', v_p; end if;

  -- The whole point: a NEW run existing must not move an OLD pool.
  if public.pool_playoff_season('$LGA') <> 2025 then
    raise exception 'FAIL pool A drifted to a newer run once 2026 playoff games loaded';
  end if;
  perform public.score_playoff_roster_pool('$LGA');
  select total_points into v_a from public.playoff_pool_standings where league_id = '$LGA' and user_id = '$U1';
  if v_a <> 6.00 then raise exception 'FAIL pool A now scores %, expected 6.00', v_a; end if;
  raise notice 'PASS a pool created for the 2026-27 run scores it (explicitly keyed and derived), and pool A is still on 2025';
end \$\$;
SQL

echo "[8] NEW body: the calendar fallback keys a pool whose run is not loaded at all"
$P <<SQL
-- Fixed dates: no playoff game exists on or after either anchor, so resolution
-- reaches rule (iv), and (iv) needs a known month to assert against.
-- Playoffs of season S are played April-June of S+1: May 2099 belongs to the
-- 2098-99 run, August 2099 to the upcoming 2099-2100 run.
insert into public.leagues (id, name, settings, created_at) values
  ('55555555-5555-5555-5555-555555555555', 'spring pool', '{"leagueType":"playoff-roster-pool"}'::jsonb, '2099-05-15'::timestamptz),
  ('66666666-6666-6666-6666-666666666666', 'autumn pool', '{"leagueType":"playoff-roster-pool"}'::jsonb, '2099-08-15'::timestamptz);
SQL
$P <<'SQL'
do $$ declare v_spring int; v_autumn int; begin
  select public.pool_playoff_season('55555555-5555-5555-5555-555555555555') into v_spring;
  select public.pool_playoff_season('66666666-6666-6666-6666-666666666666') into v_autumn;
  if v_spring <> 2098 then raise exception 'FAIL May 2099 pool resolved to %, expected 2098', v_spring; end if;
  if v_autumn <> 2099 then raise exception 'FAIL Aug 2099 pool resolved to %, expected 2099', v_autumn; end if;
  raise notice 'PASS calendar fallback: May 2099 -> 2098 run, Aug 2099 -> 2099 run (not get_nhl_season_year, which returns 2098 for both)';
end $$;
SQL

echo "[9] DEFECT: the OLD confidence scorer credits a finished game from another week"
$P <<SQL
insert into public.leagues (id, name, settings, created_at)
values ('$LGD', 'Confidence pool', '{"leagueType":"confidence-pool"}'::jsonb, current_date - 331);

-- Both dates sit on or after season 2025's first game, so neither shifts the
-- week-1 anchor. Offset 0 is always week 1; offset 28 is always week 5.
insert into public.nhl_games (game_id, game_date, home_team, away_team, home_score, away_score, status, season, game_type)
select 500001, min(g.game_date), 'TOR', 'MTL', 5, 1, 'final', 2025, 'regular' from public.nhl_games g where g.season = 2025;
insert into public.nhl_games (game_id, game_date, home_team, away_team, home_score, away_score, status, season, game_type)
select 500002, min(g.game_date) + 28, 'BOS', 'NYR', 2, 6, 'final', 2025, 'regular' from public.nhl_games g where g.season = 2025;

do \$\$ declare w1 int; w5 int; begin
  select public.get_current_pool_week(game_date, season) into w1 from public.nhl_games where game_id = 500001;
  select public.get_current_pool_week(game_date, season) into w5 from public.nhl_games where game_id = 500002;
  if w1 <> 1 or w5 <> 5 then raise exception 'FIXTURE: expected weeks 1 and 5, got % and %', w1, w5; end if;
end \$\$;

-- U1 submits week 1: one honest pick on the week-1 game, and one laundered pick
-- naming the week-5 game, which is already final and whose winner (NYR) is
-- known. The client filter that should have refused it is the leading
-- '!game ||' in submitConfidencePicks.
insert into public.confidence_picks (league_id, user_id, week_number, game_id, picked_team, confidence_points)
select '$LGD', '$U1', 1, id::text, 'TOR', 1 from public.nhl_games where game_id = 500001;
insert into public.confidence_picks (league_id, user_id, week_number, game_id, picked_team, confidence_points)
select '$LGD', '$U1', 1, id::text, 'NYR', 2 from public.nhl_games where game_id = 500002;
SQL

$P -f "$CAP2" >/dev/null
$P -c "select count(*) from public.score_confidence_week('$LGD', 1);" >/dev/null
$P <<SQL
do \$\$ declare v_ok boolean; v_pts int; v_total int; begin
  select cp.is_correct, cp.points_earned into v_ok, v_pts
    from public.confidence_picks cp
    join public.nhl_games g on g.id::text = cp.game_id
   where cp.league_id = '$LGD' and g.game_id = 500002;
  if v_ok is not true or v_pts <> 2 then
    raise exception 'UNEXPECTED: the old body did NOT credit the out-of-week game (is_correct=%, points=%); the capture may not be the live body', v_ok, v_pts;
  end if;
  select sum(points_earned) into v_total from public.confidence_picks where league_id = '$LGD';
  raise notice 'PASS defect reproduced: a week-1 submission banked % guaranteed points on a week-5 game that was already final (league total %)', v_pts, v_total;
end \$\$;
SQL

echo "[10] apply migration 2"
$P -f "$MIG2"

echo "[11] NEW body: the out-of-week pick is refused, the honest pick beside it is scored"
$P <<SQL
-- Reset both picks to unscored and re-run. Nothing else changes.
update public.confidence_picks set is_correct = null, points_earned = 0 where league_id = '$LGD';
SQL
$P -c "select count(*) from public.score_confidence_week('$LGD', 1);" >/dev/null
$P <<SQL
do \$\$ declare v_ok boolean; v_pts int; v_total int; begin
  select cp.is_correct, cp.points_earned into v_ok, v_pts
    from public.confidence_picks cp
    join public.nhl_games g on g.id::text = cp.game_id
   where cp.league_id = '$LGD' and g.game_id = 500002;
  if v_ok is not null then raise exception 'FAIL out-of-week pick was graded: is_correct=%', v_ok; end if;
  if v_pts <> 0 then raise exception 'FAIL out-of-week pick earned % points', v_pts; end if;

  select cp.is_correct, cp.points_earned into v_ok, v_pts
    from public.confidence_picks cp
    join public.nhl_games g on g.id::text = cp.game_id
   where cp.league_id = '$LGD' and g.game_id = 500001;
  if v_ok is not true or v_pts <> 1 then
    raise exception 'FAIL the honest week-1 pick was not scored: is_correct=%, points=%', v_ok, v_pts;
  end if;

  select sum(points_earned) into v_total from public.confidence_picks where league_id = '$LGD';
  if v_total <> 1 then raise exception 'FAIL league total is %, expected 1', v_total; end if;
  raise notice 'PASS out-of-week pick left unscored at 0 points, in-week pick scored normally; total 2 -> 1';
end \$\$;
SQL

echo "[12] both migrations re-apply as no-ops"
$P -f "$MIG1" >/dev/null
$P -f "$MIG2" >/dev/null
$P <<SQL
do \$\$ declare v_a numeric; v_b numeric; v_total int; v_ok boolean; c int; begin
  select total_points into v_a from public.playoff_pool_standings where league_id = '$LGA' and user_id = '$U1';
  select total_points into v_b from public.playoff_pool_standings where league_id = '$LGB' and user_id = '$U1';
  if v_a <> 6.00 or v_b <> 12.00 then raise exception 'FAIL re-apply changed standings: A=% B=%', v_a, v_b; end if;

  select count(*) into c from information_schema.columns
   where table_schema = 'public' and table_name = 'leagues' and column_name = 'playoff_season';
  if c <> 1 then raise exception 'FAIL re-apply duplicated or dropped leagues.playoff_season (% columns)', c; end if;

  select sum(points_earned) into v_total from public.confidence_picks where league_id = '$LGD';
  if v_total <> 1 then raise exception 'FAIL re-apply changed confidence points: %', v_total; end if;

  -- and the scorers still behave after a second apply
  perform public.score_playoff_roster_pool('$LGA');
  select total_points into v_a from public.playoff_pool_standings where league_id = '$LGA' and user_id = '$U1';
  if v_a <> 6.00 then raise exception 'FAIL post-re-apply rescore gave %', v_a; end if;

  update public.confidence_picks set is_correct = null, points_earned = 0 where league_id = '$LGD';
  perform 1 from public.score_confidence_week('$LGD', 1);
  select cp.is_correct into v_ok from public.confidence_picks cp
    join public.nhl_games g on g.id::text = cp.game_id
   where cp.league_id = '$LGD' and g.game_id = 500002;
  if v_ok is not null then raise exception 'FAIL post-re-apply the out-of-week pick was graded again'; end if;

  raise notice 'PASS both migrations re-applied cleanly; standings, column and refusal all unchanged';
end \$\$;
SQL

echo "ALL PASS"
