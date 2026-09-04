#!/usr/bin/env bash
# CITRUS-CLASSIFICATION ----------------------------------------------------------
# CATEGORY: PROOF (scratch Postgres only; never points at a Supabase project)
# Purpose:     Prove 20260903230000_playoff_bracket_season_and_seeding.sql,
#              20260903231000_playoff_advance_requires_completed_series.sql and
#              20260903232000_trade_vote_and_commissioner_authorization.sql
#              against prod-shaped tables.
#                P1  the OLD reset_playoff_bracket cannot find a bracket the
#                    generators stamped; the NEW one finds it, and finds one
#                    stamped under any other season too.
#                P2  the OLD generate_playoff_bracket books every unplayed week
#                    as a TIE and will seed a bracket from a league where
#                    nothing has been played; the NEW one applies the shared
#                    FINAL + PLAYED gates and refuses to seed from nothing.
#                P3  the OLD advance_playoff_round crowns the AWAY team champion
#                    off a 0-0 week and off no games at all, and bumps the round
#                    when it advanced nothing; the NEW one refuses to decide an
#                    unplayed series, breaks a genuine tie on seed, and only
#                    moves the round when the round is finished.
#                T3  the OLD submit_trade_vote lets one manager vote as another
#                    manager's team and overwrite that manager's vote, bypassing
#                    the trade_votes_insert policy that would have stopped a
#                    direct INSERT; the NEW one refuses.
#                T2  the OLD execute_trade refuses the commissioner approving a
#                    trade; the NEW one admits the commissioner of THAT league
#                    and still refuses everyone else.
#              All three migrations re-apply as no-ops. Exit 0 = PASS.
# Last active: 2026-09-03
# Invoked:     PGHOST=/tmp PGPORT=54329 PGUSER=postgres bash scripts/proof/playoff-advance-and-trade-auth.proof.sh
# Reads:       supabase/migrations/20260903230000_playoff_bracket_season_and_seeding.sql
#              supabase/migrations/20260903231000_playoff_advance_requires_completed_series.sql
#              supabase/migrations/20260903232000_trade_vote_and_commissioner_authorization.sql
#              supabase/migrations/captures/2026-09-03_pre_reset_playoff_bracket.sql
#              supabase/migrations/captures/2026-09-03_pre_generate_playoff_bracket.sql
#              supabase/migrations/captures/2026-09-03_pre_auto_generate_playoff_bracket.sql
#              supabase/migrations/captures/2026-09-03_pre_advance_playoff_round.sql
#              supabase/migrations/captures/2026-09-03_pre_submit_trade_vote.sql
#              supabase/migrations/captures/2026-09-03_pre_execute_trade.sql
# Writes:      scratch database playoff_trade_proof (dropped and recreated)
# ----------------------------------------------------------------------------
# Column types, defaults, enums, CHECKs, UNIQUEs and FKs were harvested from
# production information_schema.columns, pg_enum and pg_constraint on
# 2026-09-03, not composed (INS-16). The ones that carry the proof:
#   matchups.status              enum matchup_status (scheduled|in_progress|
#                                completed) NOT NULL DEFAULT 'scheduled'
#   matchups.team1_score/2       numeric NOT NULL DEFAULT 0
#   matchups.week_end_date       date NOT NULL
#   playoff_series.home_seed     integer NULL   <- the whole of P3
#   playoff_seeds UNIQUE         (bracket_id, seed_number)  <- why the tie rule
#                                                              is total
#   playoff_brackets UNIQUE      (league_id, season)
#   playoff_brackets.season      DEFAULT EXTRACT(year FROM now()) - the fourth
#                                writer that disagreed with the other three
#   trade_votes UNIQUE           (trade_offer_id, voter_team_id) <- the ON
#                                CONFLICT DO UPDATE that overwrites a vote
#   trade_offers_status_check    the nine statuses, so 'under_review' and
#                                'vetoed' are writable here
#
# get_nhl_season_year and get_current_season are the live production bodies, not
# stubs. auth.uid() is a real function over request.jwt.claim.sub, so the
# SECURITY DEFINER / RLS interaction is the real one: the trade_votes_insert
# policy is created here exactly as production carries it, and step 12 shows a
# direct INSERT refused by it and the same write waved through by the RPC.
#
# All fixture dates are relative to CURRENT_DATE so the proof is stable on any
# runner clock, and the P1 defect is reproduced against a bracket stamped
# season = EXTRACT(YEAR FROM NOW()) - 1, which is what the generators stamp for
# nine months of the year and exactly what production holds today (one bracket,
# season 2025, while EXTRACT(YEAR FROM NOW()) is 2026). The month-dependent half
# of the old rule is reported as a NOTICE rather than asserted.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG1="$ROOT/supabase/migrations/20260903230000_playoff_bracket_season_and_seeding.sql"
MIG2="$ROOT/supabase/migrations/20260903231000_playoff_advance_requires_completed_series.sql"
MIG3="$ROOT/supabase/migrations/20260903232000_trade_vote_and_commissioner_authorization.sql"
CAPDIR="$ROOT/supabase/migrations/captures"
P0="psql -v ON_ERROR_STOP=1 -qX"
$P0 -c "drop database if exists playoff_trade_proof;"
$P0 -c "create database playoff_trade_proof;"
P="$P0 -d playoff_trade_proof"

# pg_get_functiondef output has no trailing semicolon, so the capture files do
# not either. Append one rather than relying on how psql treats a file whose
# last statement is unterminated.
loadcap() { { cat "$CAPDIR/$1"; echo ';'; } | $P >/dev/null; }

echo "[0] the captures are the bodies that were live on production 2026-09-03"
# md5(pg_get_functiondef(...)) read from project iezwazccqqrhrjupxzvf on
# 2026-09-03. If a capture drifts, every "the old body did X" claim below is
# about something that was never deployed, so this check comes first.
verify_cap() {
  local want="$1" file="$2" got
  got="$(md5sum "$CAPDIR/$file" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    echo "FAIL capture $file is $got, production was $want" >&2
    exit 1
  fi
}
verify_cap f46c613c95c787bf7900ec9b9ffd1a16 2026-09-03_pre_reset_playoff_bracket.sql
verify_cap 6182e6e6beedd3a61c3fb21b1128df82 2026-09-03_pre_generate_playoff_bracket.sql
verify_cap b753f177e749b19fa8dddca63f795c91 2026-09-03_pre_auto_generate_playoff_bracket.sql
verify_cap 5173b0b2b3e5b2065e7d2096ecb8f8ca 2026-09-03_pre_advance_playoff_round.sql
verify_cap f8959251e88ff55d3941267016a8d3cb 2026-09-03_pre_submit_trade_vote.sql
verify_cap c4c470298e84c20c2c0d69e691849188 2026-09-03_pre_execute_trade.sql
echo "    six captures match production md5"

echo "[1] build prod-shaped tables, the auth stub and the live season helpers"
$P <<'SQL'
-- Supabase ships these roles; a scratch cluster does not. The migrations
-- REVOKE/GRANT against authenticated and service_role, and step 12 needs
-- authenticated to be a role we can SET ROLE into.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin;  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin;          end if;
end $$;
grant usage on schema public to authenticated, anon, service_role;

-- The real auth.uid(): NULL for the service role, a uuid for a JWT. Every gate
-- in these functions branches on it, so it must be settable per session and
-- must be genuinely NULL when unset.
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;
grant usage on schema auth to authenticated, anon, service_role;

create table public.profiles (id uuid primary key);

create type public.draft_status   as enum ('not_started', 'queued', 'in_progress', 'completed');
create type public.matchup_status as enum ('scheduled', 'in_progress', 'completed');

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  commissioner_id uuid not null references public.profiles(id) on delete cascade,
  draft_status public.draft_status not null default 'not_started',
  roster_size integer not null default 21,
  settings jsonb default '{}'::jsonb,
  trade_review_type text default 'none',
  trade_review_period_hours integer default 48,
  trade_veto_threshold numeric default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leagues_trade_review_type_check
    check (trade_review_type = any (array['none'::text, 'commissioner'::text, 'league_vote'::text])),
  constraint leagues_trade_veto_threshold_check
    check (trade_veto_threshold > 0::numeric and trade_veto_threshold <= 1::numeric));

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  team_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_league_id_owner_id_key unique (league_id, owner_id));

create table public.matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  week_number integer not null,
  team1_id uuid not null references public.teams(id) on delete cascade,
  team2_id uuid references public.teams(id) on delete cascade,
  team1_score numeric not null default 0,
  team2_score numeric not null default 0,
  status public.matchup_status not null default 'scheduled',
  week_start_date date not null,
  week_end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matchups_check check ((team1_id <> team2_id) or (team2_id is null)),
  constraint matchups_league_id_week_number_team1_id_key unique (league_id, week_number, team1_id),
  constraint matchups_league_id_week_number_team2_id_key unique (league_id, week_number, team2_id));

-- season DEFAULT is production's: the raw calendar year, which is the fourth
-- writer that disagreed with the three functions. Migration 1 changes it.
create table public.playoff_brackets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  season integer not null default extract(year from now()),
  bracket_size integer not null,
  status text not null default 'pending',
  current_round integer not null default 0,
  total_rounds integer not null,
  seeding_method text not null default 'standings',
  reseed_each_round boolean not null default false,
  consolation_enabled boolean not null default false,
  two_week_matchups boolean not null default false,
  champion_team_id uuid references public.teams(id) on delete set null,
  runner_up_team_id uuid references public.teams(id) on delete set null,
  third_place_team_id uuid references public.teams(id) on delete set null,
  generated_by uuid references auth.users(id) on delete set null,
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playoff_brackets_bracket_size_check check (bracket_size = any (array[4, 6, 8])),
  constraint playoff_brackets_status_check check (status = any (array['pending'::text, 'active'::text, 'completed'::text])),
  constraint playoff_brackets_seeding_method_check check (seeding_method = any (array['standings'::text, 'manual'::text])),
  constraint playoff_brackets_league_id_season_key unique (league_id, season));

-- UNIQUE (bracket_id, seed_number) is what makes the new tie rule total.
create table public.playoff_seeds (
  id uuid primary key default gen_random_uuid(),
  bracket_id uuid not null references public.playoff_brackets(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  seed_number integer not null,
  regular_season_wins integer not null default 0,
  regular_season_losses integer not null default 0,
  regular_season_ties integer not null default 0,
  regular_season_points_for numeric not null default 0,
  source text not null default 'standings',
  created_at timestamptz not null default now(),
  constraint playoff_seeds_seed_number_check check (seed_number >= 1 and seed_number <= 16),
  constraint playoff_seeds_source_check check (source = any (array['standings'::text, 'commissioner_override'::text])),
  constraint playoff_seeds_bracket_id_seed_number_key unique (bracket_id, seed_number),
  constraint playoff_seeds_bracket_id_team_id_key unique (bracket_id, team_id));

-- home_seed and away_seed are NULLABLE. That is the entire defect P3.
create table public.playoff_series (
  id uuid primary key default gen_random_uuid(),
  bracket_id uuid not null references public.playoff_brackets(id) on delete cascade,
  round_number integer not null,
  match_number integer not null,
  bracket_position text not null default 'winners',
  home_seed integer, away_seed integer,
  home_team_id uuid references public.teams(id) on delete set null,
  away_team_id uuid references public.teams(id) on delete set null,
  home_score numeric not null default 0,
  away_score numeric not null default 0,
  winner_team_id uuid references public.teams(id) on delete set null,
  loser_team_id uuid references public.teams(id) on delete set null,
  status text not null default 'pending',
  matchup_week_1 integer, matchup_week_2 integer,
  winner_advances_to uuid references public.playoff_series(id) on delete set null,
  winner_slot text, loser_drops_to uuid references public.playoff_series(id) on delete set null,
  loser_slot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playoff_series_round_number_check check (round_number >= 1),
  constraint playoff_series_match_number_check check (match_number >= 1),
  constraint playoff_series_status_check check (status = any (array['pending'::text, 'bye'::text, 'active'::text, 'completed'::text])),
  constraint playoff_series_winner_slot_check check (winner_slot = any (array['home'::text, 'away'::text])),
  constraint playoff_series_loser_slot_check check (loser_slot = any (array['home'::text, 'away'::text])),
  constraint playoff_series_bracket_id_round_number_match_number_bracket_key
    unique (bracket_id, round_number, match_number, bracket_position));

create table public.roster_assignments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id text not null,
  acquired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_player_per_league unique (league_id, player_id));

create table public.transaction_ledger (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  team_id uuid not null references public.teams(id) on delete cascade,
  type text not null, player_id text not null, source text,
  created_at timestamptz not null default now(),
  constraint transaction_ledger_type_check
    check (type = any (array['ADD'::text, 'DROP'::text, 'TRADE'::text, 'DRAFT'::text])));

create table public.trade_offers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  from_team_id uuid not null references public.teams(id) on delete cascade,
  to_team_id uuid not null references public.teams(id) on delete cascade,
  offered_player_ids integer[] not null,
  requested_player_ids integer[] not null,
  status text not null, message text,
  created_at timestamptz not null default now(),
  expires_at timestamptz, processed_at timestamptz,
  counter_offer_id uuid references public.trade_offers(id) on delete set null,
  review_started_at timestamptz, review_ends_at timestamptz, vetoed_at timestamptz,
  updated_at timestamptz not null default now(),
  review_type text not null default 'none',
  constraint different_teams check (from_team_id <> to_team_id),
  constraint has_players check (array_length(offered_player_ids, 1) > 0 and array_length(requested_player_ids, 1) > 0),
  constraint trade_offers_status_check check (status = any (array['pending'::text, 'accepted'::text,
    'rejected'::text, 'countered'::text, 'cancelled'::text, 'expired'::text, 'under_review'::text,
    'vetoed'::text, 'failed'::text])));

-- UNIQUE (trade_offer_id, voter_team_id) is what the RPC's ON CONFLICT DO
-- UPDATE targets, and therefore what lets a spoofed vote OVERWRITE a real one.
create table public.trade_votes (
  id uuid primary key default gen_random_uuid(),
  trade_offer_id uuid not null references public.trade_offers(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  voter_team_id uuid not null references public.teams(id) on delete cascade,
  vote text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_votes_vote_check check (vote = any (array['approve'::text, 'veto'::text])),
  constraint trade_votes_trade_offer_id_voter_team_id_key unique (trade_offer_id, voter_team_id));

create table public.trade_history (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  trade_offer_id uuid not null references public.trade_offers(id) on delete cascade,
  team1_id uuid not null references public.teams(id) on delete cascade,
  team2_id uuid not null references public.teams(id) on delete cascade,
  team1_players integer[] not null, team2_players integer[] not null,
  executed_at timestamptz not null default now());

create table public.nhl_games (
  id uuid primary key default gen_random_uuid(),
  game_id integer not null,
  game_date date not null,
  home_team text not null, away_team text not null,
  home_score integer default 0, away_score integer default 0,
  status text default 'scheduled',
  season integer not null,
  game_type text default 'regular',
  created_at timestamptz not null default now(),
  constraint nhl_games_game_id_key unique (game_id));
create index on public.nhl_games (season, game_type, game_date);

-- The real trade_votes policies, verbatim from production pg_policies. The
-- INSERT policy is the one that would have stopped T3 and that SECURITY DEFINER
-- walks straight past.
alter table public.trade_votes enable row level security;
create policy trade_votes_select on public.trade_votes for select
  using (league_id in (select teams.league_id from teams where teams.owner_id = (select auth.uid())));
create policy trade_votes_insert on public.trade_votes for insert
  with check (voter_team_id in (select teams.id from teams where teams.owner_id = (select auth.uid())));
grant select, insert on public.trade_votes to authenticated;
grant select on public.teams, public.trade_offers, public.leagues to authenticated;

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

-- Called by execute_trade. Stubs: the proof is about authorization, not about
-- what these two do, and both are no-ops for a team with no lineup rows.
CREATE OR REPLACE FUNCTION public.trade_move_player_lineup(
  p_league_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_player_id text, p_now timestamptz)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$ BEGIN RETURN; END $function$;

CREATE OR REPLACE FUNCTION public.log_function_error(
  p_fn text, p_sqlstate text, p_sqlerrm text, p_note text, p_ctx jsonb)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$ BEGIN RETURN; END $function$;
SQL

echo "[2] fixtures: the season world, and five leagues"
$P <<'SQL'
-- One regular season, already finished, keyed EXTRACT(YEAR FROM NOW()) - 1.
-- That is production's exact shape today: get_current_season() = 2025 while
-- EXTRACT(YEAR FROM NOW()) = 2026. It holds on any runner clock because the
-- season number is assigned here, not derived from the calendar.
insert into public.nhl_games (game_id, game_date, home_team, away_team, status, season, game_type)
select 100000 + gs, current_date - 330 + (gs * 2), 'TOR', 'MTL', 'final',
       extract(year from now())::int - 1, 'regular'
  from generate_series(0, 94) gs;

do $$ declare v int; begin
  select public.get_current_season() into v;
  if v <> extract(year from now())::int - 1 then
    raise exception 'FIXTURE: get_current_season() is %, expected %', v, extract(year from now())::int - 1;
  end if;
  if v = extract(year from now())::int then
    raise exception 'FIXTURE: the two season rules must differ for P1 to reproduce';
  end if;
end $$;

insert into public.profiles (id) values
  ('c0000000-0000-4000-8000-000000000001'), -- LG1 commissioner
  ('c0000000-0000-4000-8000-000000000002'), -- LG2 commissioner
  ('c0000000-0000-4000-8000-000000000003'), -- LG3 commissioner
  ('c0000000-0000-4000-8000-000000000004'), -- LG4 commissioner
  ('c0000000-0000-4000-8000-000000000005'), -- LG5 commissioner
  ('d0000000-0000-4000-8000-000000000043'), -- LG4 manager, owns T43
  ('d0000000-0000-4000-8000-000000000044'), -- LG4 manager, owns T44
  ('d0000000-0000-4000-8000-000000000051'), -- LG5 manager, owns T51
  ('d0000000-0000-4000-8000-000000000052'); -- LG5 manager, owns T52
insert into auth.users (id) select id from public.profiles;

-- LG1: six teams, six weeks. Weeks 1 and 2 were played; weeks 3-6 are
-- 'completed' at 0-0, which is the shape 6 production matchup rows carry and
-- 62 more reach by week_end_date.
insert into public.leagues (id, name, commissioner_id, draft_status, settings)
values ('11111111-1111-1111-1111-111111111111', 'Seeding League',
        'c0000000-0000-4000-8000-000000000001', 'completed',
        '{"leagueType":"fantasy","regularSeasonWeeks":6,"playoffTeams":6}'::jsonb);
insert into public.teams (id, league_id, team_name) values
  ('a1111111-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alpha'),
  ('a1111111-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Bravo'),
  ('a1111111-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'Charlie'),
  ('a1111111-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', 'Delta'),
  ('a1111111-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111', 'Echo'),
  ('a1111111-0000-4000-8000-000000000006', '11111111-1111-1111-1111-111111111111', 'Foxtrot');

-- Every week has already ended, so every row is FINAL by the standings rule.
insert into public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
select '11111111-1111-1111-1111-111111111111', w, p.t1, p.t2,
       case when w = 1 then p.s1 when w = 2 then p.s1 + 10 else 0 end,
       case when w = 1 then p.s2 when w = 2 then p.s2 + 5  else 0 end,
       'completed',
       current_date - (7 * (7 - w)) - 6, current_date - (7 * (7 - w))
  from generate_series(1, 6) w
  cross join (values
    ('a1111111-0000-4000-8000-000000000001'::uuid, 'a1111111-0000-4000-8000-000000000002'::uuid, 100, 90),
    ('a1111111-0000-4000-8000-000000000003'::uuid, 'a1111111-0000-4000-8000-000000000004'::uuid,  80, 70),
    ('a1111111-0000-4000-8000-000000000005'::uuid, 'a1111111-0000-4000-8000-000000000006'::uuid,  60, 50)
  ) p(t1, t2, s1, s2);

-- LG2: four teams, four weeks, nothing ever played. 10 of the 12 production
-- leagues that have matchups are in exactly this state.
insert into public.leagues (id, name, commissioner_id, draft_status, settings)
values ('22222222-2222-2222-2222-222222222222', 'Nothing Played League',
        'c0000000-0000-4000-8000-000000000002', 'completed',
        '{"leagueType":"fantasy","regularSeasonWeeks":4,"playoffTeams":4}'::jsonb);
insert into public.teams (id, league_id, team_name) values
  ('a2222222-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'Golf'),
  ('a2222222-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222', 'Hotel'),
  ('a2222222-0000-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', 'India'),
  ('a2222222-0000-4000-8000-000000000004', '22222222-2222-2222-2222-222222222222', 'Juliet');
insert into public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
select '22222222-2222-2222-2222-222222222222', w, p.t1, p.t2, 0, 0, 'completed',
       current_date - (7 * (5 - w)) - 6, current_date - (7 * (5 - w))
  from generate_series(1, 4) w
  cross join (values
    ('a2222222-0000-4000-8000-000000000001'::uuid, 'a2222222-0000-4000-8000-000000000002'::uuid),
    ('a2222222-0000-4000-8000-000000000003'::uuid, 'a2222222-0000-4000-8000-000000000004'::uuid)
  ) p(t1, t2);
SQL

echo "[3] load the OLD bodies (the six captures)"
loadcap 2026-09-03_pre_reset_playoff_bracket.sql
loadcap 2026-09-03_pre_generate_playoff_bracket.sql
loadcap 2026-09-03_pre_auto_generate_playoff_bracket.sql
loadcap 2026-09-03_pre_advance_playoff_round.sql
loadcap 2026-09-03_pre_submit_trade_vote.sql
loadcap 2026-09-03_pre_execute_trade.sql

LG1='11111111-1111-1111-1111-111111111111'
LG2='22222222-2222-2222-2222-222222222222'
LG3='33333333-3333-3333-3333-333333333333'
LG4='44444444-4444-4444-4444-444444444444'
LG5='55555555-5555-5555-5555-555555555555'
C1='c0000000-0000-4000-8000-000000000001'
C3='c0000000-0000-4000-8000-000000000003'
C4='c0000000-0000-4000-8000-000000000004'
C5='c0000000-0000-4000-8000-000000000005'
U43='d0000000-0000-4000-8000-000000000043'
U44='d0000000-0000-4000-8000-000000000044'
U51='d0000000-0000-4000-8000-000000000051'

echo "[4] DEFECT P1: the OLD reset cannot find a bracket the generators stamped"
$P <<SQL
-- A bracket keyed the way the generators key it from January to September, and
-- the way production's only bracket is keyed right now.
insert into public.playoff_brackets (league_id, season, bracket_size, status, current_round, total_rounds)
values ('$LG1', extract(year from now())::int - 1, 6, 'active', 1, 3);

select set_config('request.jwt.claim.sub', '$C1', false);

do \$\$ declare v_res json; v_msg text; c int; begin
  select public.reset_playoff_bracket('$LG1') into v_res;
  v_msg := v_res ->> 'error';
  if v_msg is distinct from 'No bracket found for this season' then
    raise exception 'UNEXPECTED: old reset returned % (capture may not be the live body)', v_res;
  end if;
  select count(*) into c from public.playoff_brackets where league_id = '$LG1';
  if c <> 1 then raise exception 'UNEXPECTED: the bracket should still be there, found %', c; end if;
  raise notice 'PASS defect reproduced: bracket is season %, reset looked up season %, answer was "%" - and generate refuses while that bracket exists, so the league is stuck',
    extract(year from now())::int - 1, extract(year from now())::int, v_msg;
end \$\$;

-- The month-dependent half, reported not asserted: in October, November and
-- December the two rules coincide and the defect hides.
do \$\$ begin
  raise notice 'today the OLD generators would stamp season % (month %), the OLD reset looks up %',
    case when extract(month from now()) >= 10 then extract(year from now())::int
         else extract(year from now())::int - 1 end,
    extract(month from now())::int, extract(year from now())::int;
end \$\$;

delete from public.playoff_brackets where league_id = '$LG1';
SQL

echo "[5] DEFECT P2: the OLD seeding books every unplayed week as a TIE"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C1', false);
select public.generate_playoff_bracket('$LG1', false, false, false, 'standings');
SQL
$P <<SQL
do \$\$ declare v_ties int; v_rows int; v_min int; begin
  select count(*), min(regular_season_ties), sum(regular_season_ties)
    into v_rows, v_min, v_ties
    from public.playoff_seeds s
    join public.playoff_brackets b on b.id = s.bracket_id
   where b.league_id = '$LG1';
  if v_rows <> 6 then raise exception 'UNEXPECTED: % seeds, expected 6', v_rows; end if;
  if v_min <> 4 then
    raise exception 'UNEXPECTED: the old body recorded a minimum of % ties, expected 4 (weeks 3-6, never played)', v_min;
  end if;
  raise notice 'PASS defect reproduced: every one of the 6 seeds carries 4 phantom ties (% in total) for four weeks that were never scored; the standings page reports 0 for the same league', v_ties;
end \$\$;
delete from public.playoff_brackets where league_id = '$LG1';
SQL

echo "[6] DEFECT P2 (second half): the OLD seeding will seed a league that has played nothing"
$P <<SQL
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', false);
select public.generate_playoff_bracket('$LG2', false, false, false, 'standings');
SQL
$P <<SQL
do \$\$ declare v_rows int; v_nonzero int; begin
  select count(*), count(*) filter (where regular_season_wins <> 0 or regular_season_points_for <> 0)
    into v_rows, v_nonzero
    from public.playoff_seeds s join public.playoff_brackets b on b.id = s.bracket_id
   where b.league_id = '$LG2';
  if v_rows <> 4 then raise exception 'UNEXPECTED: % seeds, expected 4', v_rows; end if;
  if v_nonzero <> 0 then raise exception 'UNEXPECTED: % seeds carry a record, expected all zero', v_nonzero; end if;
  raise notice 'PASS defect reproduced: a full 4-team bracket was seeded 1..4 from four weeks nobody played - the seed order is whatever order Postgres returned rows in';
end \$\$;
delete from public.playoff_brackets where league_id = '$LG2';
SQL

echo "[7] DEFECT: auto_generate_playoff_bracket raises 42883 on LOWER(matchup_status)"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C1', false);
do \$\$ declare v json; begin
  begin
    select public.auto_generate_playoff_bracket('$LG1') into v;
    raise exception 'UNEXPECTED: auto_generate returned % instead of raising 42883', v;
  exception when undefined_function then
    raise notice 'PASS defect reproduced: auto_generate_playoff_bracket raises 42883 (%), and PlayoffService.getBracket swallows it in a bare try/catch - auto-generation has never run', sqlerrm;
  end;
end \$\$;
SQL

echo "[8] apply migration 1"
$P -f "$MIG1"

echo "[9] NEW reset: finds the bracket the generators stamp, and any that blocks generation"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C1', false);

do \$\$ declare v_res json; c int; v_season int; begin
  v_season := public.league_bracket_season();
  if v_season <> extract(year from now())::int - 1 then
    raise exception 'FAIL league_bracket_season() is %, expected %', v_season, extract(year from now())::int - 1;
  end if;

  -- (i) the ordinary case: the bracket for the current season
  insert into public.playoff_brackets (league_id, season, bracket_size, status, current_round, total_rounds)
  values ('$LG1', v_season, 6, 'active', 1, 3);
  select public.reset_playoff_bracket('$LG1') into v_res;
  if (v_res ->> 'success') is distinct from 'true' then
    raise exception 'FAIL new reset returned %', v_res;
  end if;
  select count(*) into c from public.playoff_brackets where league_id = '$LG1';
  if c <> 0 then raise exception 'FAIL bracket survived reset'; end if;

  -- (ii) the invariant: a bracket stamped under ANY other season still blocks
  -- generation, so reset has to be able to clear it.
  insert into public.playoff_brackets (league_id, season, bracket_size, status, current_round, total_rounds)
  values ('$LG1', v_season - 5, 6, 'active', 1, 3);
  select public.reset_playoff_bracket('$LG1') into v_res;
  if (v_res ->> 'success') is distinct from 'true' then
    raise exception 'FAIL new reset could not clear a bracket stamped season %: %', v_season - 5, v_res;
  end if;
  select count(*) into c from public.playoff_brackets where league_id = '$LG1';
  if c <> 0 then raise exception 'FAIL off-season bracket survived reset'; end if;

  -- (iii) and it still says so when there is genuinely nothing
  select public.reset_playoff_bracket('$LG1') into v_res;
  if (v_res ->> 'error') is distinct from 'No bracket found for this league' then
    raise exception 'FAIL empty-league reset returned %', v_res;
  end if;

  raise notice 'PASS reset finds the current-season bracket, finds one stamped under any other season, and reports honestly when there is none';
end \$\$;

-- and a non-commissioner still cannot reset
select set_config('request.jwt.claim.sub', '$C3', false);
do \$\$ declare v_res json; begin
  select public.reset_playoff_bracket('$LG1') into v_res;
  if (v_res ->> 'error') is distinct from 'Only the commissioner can reset playoff brackets' then
    raise exception 'FAIL the commissioner gate was lost: %', v_res;
  end if;
  raise notice 'PASS the commissioner gate on reset is intact';
end \$\$;
SQL

echo "[10] NEW generate: the standings gates, and the three functions agree on one season"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C1', false);
select public.generate_playoff_bracket('$LG1', false, false, false, 'standings');
SQL
$P <<SQL
do \$\$
declare
  r record; v_season int; v_res json; c int;
begin
  select season into v_season from public.playoff_brackets where league_id = '$LG1';
  if v_season <> public.league_bracket_season() then
    raise exception 'FAIL bracket stamped season %, league_bracket_season() says %', v_season, public.league_bracket_season();
  end if;

  -- Zero ties, and the W/L/PF the standings rule produces from the two weeks
  -- that were actually played.
  for r in
    select s.seed_number, t.team_name, s.regular_season_wins w, s.regular_season_losses l,
           s.regular_season_ties ti, s.regular_season_points_for pf
      from public.playoff_seeds s
      join public.playoff_brackets b on b.id = s.bracket_id
      join public.teams t on t.id = s.team_id
     where b.league_id = '$LG1' order by s.seed_number
  loop
    if r.ti <> 0 then
      raise exception 'FAIL seed % (%) still carries % ties', r.seed_number, r.team_name, r.ti;
    end if;
    if r.w + r.l <> 2 then
      raise exception 'FAIL seed % (%) has % games on record, expected the 2 played weeks', r.seed_number, r.team_name, r.w + r.l;
    end if;
  end loop;

  -- The exact seeding the played weeks imply: wins DESC, points_for DESC.
  raise notice 'seed order: %', (select string_agg(t.team_name || '(' || s.regular_season_wins || '-' || s.regular_season_losses || '-' || s.regular_season_ties || ' ' || s.regular_season_points_for || ')', ' ' order by s.seed_number)
    from public.playoff_seeds s join public.playoff_brackets b on b.id = s.bracket_id
    join public.teams t on t.id = s.team_id where b.league_id = '$LG1');

  if (select t.team_name from public.playoff_seeds s join public.playoff_brackets b on b.id = s.bracket_id
        join public.teams t on t.id = s.team_id where b.league_id = '$LG1' and s.seed_number = 1) <> 'Alpha' then
    raise exception 'FAIL the 1 seed is not the team that won both its weeks by the most points';
  end if;

  -- Generate now refuses the bracket it used to build out of nothing, and
  -- leaves no half-built bracket behind.
  select public.generate_playoff_bracket('$LG2', false, false, false, 'standings') into v_res;
  if (v_res ->> 'error') not like 'No regular-season week has been played%' then
    raise exception 'FAIL generate did not refuse the never-played league: %', v_res;
  end if;
  select count(*) into c from public.playoff_brackets where league_id = '$LG2';
  if c <> 0 then raise exception 'FAIL generate left % bracket rows behind after refusing', c; end if;

  raise notice 'PASS zero phantom ties, records taken only from played weeks, and a league that played nothing gets no bracket at all';
end \$\$;
SQL

echo "[11] NEW auto_generate: same season rule, and it can actually run"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C1', false);
do \$\$ declare v json; begin
  -- LG1 already has a bracket for the resolved season.
  select public.auto_generate_playoff_bracket('$LG1') into v;
  if (v ->> 'skipped') is distinct from 'bracket_already_exists' then
    raise exception 'FAIL auto_generate says %, expected bracket_already_exists (proves it resolves the SAME season the generator stamped)', v;
  end if;

  -- LG2 has an unfinished regular season: the gate that used to raise 42883.
  update public.matchups set status = 'scheduled' where league_id = '$LG2' and week_number = 4;
  select public.auto_generate_playoff_bracket('$LG2') into v;
  if (v ->> 'skipped') is distinct from 'regular_season_in_progress' then
    raise exception 'FAIL auto_generate says %, expected regular_season_in_progress', v;
  end if;
  update public.matchups set status = 'completed' where league_id = '$LG2' and week_number = 4;

  raise notice 'PASS auto_generate resolves the same season as generate and reset, and its regular-season gate runs instead of raising 42883';
end \$\$;
SQL

echo "[12] fixture: a 4-team bracket in its finals, shaped like production's"
$P <<SQL
insert into public.leagues (id, name, commissioner_id, draft_status, settings)
values ('$LG3', 'Advance League', '$C3', 'completed',
        '{"leagueType":"fantasy","regularSeasonWeeks":4,"playoffTeams":4}'::jsonb);
insert into public.teams (id, league_id, team_name) values
  ('a3333333-0000-4000-8000-000000000001', '$LG3', 'Kilo'),
  ('a3333333-0000-4000-8000-000000000002', '$LG3', 'Lima'),
  ('a3333333-0000-4000-8000-000000000003', '$LG3', 'Mike'),
  ('a3333333-0000-4000-8000-000000000004', '$LG3', 'November');

insert into public.playoff_brackets (id, league_id, season, bracket_size, status, current_round, total_rounds)
values ('b3333333-0000-4000-8000-000000000001', '$LG3', public.league_bracket_season(), 4, 'active', 2, 2);

insert into public.playoff_seeds (bracket_id, team_id, seed_number, regular_season_wins, regular_season_losses, regular_season_points_for) values
  ('b3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000001', 1, 4, 0, 500),
  ('b3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000002', 2, 3, 1, 450),
  ('b3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000003', 3, 2, 2, 400),
  ('b3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000004', 4, 1, 3, 350);

-- Round 1, already decided. home_seed / away_seed ARE set here, which is the
-- only place generate_playoff_bracket ever sets them for a 4-team bracket.
insert into public.playoff_series (id, bracket_id, round_number, match_number, bracket_position,
  home_seed, away_seed, home_team_id, away_team_id, home_score, away_score,
  winner_team_id, loser_team_id, status, matchup_week_1) values
  ('c3333333-0000-4000-8000-000000000001', 'b3333333-0000-4000-8000-000000000001', 1, 1, 'winners',
   1, 4, 'a3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000004', 120, 80,
   'a3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000004', 'completed', 5),
  ('c3333333-0000-4000-8000-000000000002', 'b3333333-0000-4000-8000-000000000001', 1, 2, 'winners',
   2, 3, 'a3333333-0000-4000-8000-000000000002', 'a3333333-0000-4000-8000-000000000003', 115, 90,
   'a3333333-0000-4000-8000-000000000002', 'a3333333-0000-4000-8000-000000000003', 'completed', 5);

-- The finals. BOTH seed columns are NULL, exactly as production's round-3
-- series carries them, because generate_playoff_bracket never writes them past
-- round 1. Kilo is the 1 seed and is at home; Lima is the 2 seed and is away.
insert into public.playoff_series (id, bracket_id, round_number, match_number, bracket_position,
  home_seed, away_seed, home_team_id, away_team_id, status, matchup_week_1) values
  ('c3333333-0000-4000-8000-000000000009', 'b3333333-0000-4000-8000-000000000001', 2, 1, 'winners',
   NULL, NULL, 'a3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000002', 'active', 6);

insert into public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date) values
  ('$LG3', 5, 'a3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000004', 120, 80, 'completed', current_date - 20, current_date - 14),
  ('$LG3', 5, 'a3333333-0000-4000-8000-000000000002', 'a3333333-0000-4000-8000-000000000003', 115, 90, 'completed', current_date - 20, current_date - 14);

-- Put the finals back to "about to be decided", with or without a scored week.
create or replace function public.proof_restore_finals(p_s1 numeric, p_s2 numeric, p_include_row boolean, p_status public.matchup_status default 'completed')
returns void language plpgsql as \$fn\$
begin
  update public.playoff_brackets
     set status = 'active', current_round = 2, champion_team_id = null,
         runner_up_team_id = null, third_place_team_id = null, completed_at = null
   where id = 'b3333333-0000-4000-8000-000000000001';
  update public.playoff_series
     set status = 'active', winner_team_id = null, loser_team_id = null, home_score = 0, away_score = 0
   where id = 'c3333333-0000-4000-8000-000000000009';
  update public.playoff_series set status = 'completed'
   where bracket_id = 'b3333333-0000-4000-8000-000000000001' and round_number = 1;
  delete from public.matchups where league_id = '$LG3' and week_number = 6;
  if p_include_row then
    insert into public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
    values ('$LG3', 6, 'a3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000002',
            p_s1, p_s2, p_status, current_date - 13, current_date - 7);
  end if;
end \$fn\$;
SQL

echo "[13] DEFECT P3: the OLD advance crowns the AWAY team off a 0-0 week"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(0, 0, true);
select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001');
SQL
$P <<SQL
do \$\$ declare v_champ text; v_status text; begin
  select t.team_name, b.status into v_champ, v_status
    from public.playoff_brackets b left join public.teams t on t.id = b.champion_team_id
   where b.id = 'b3333333-0000-4000-8000-000000000001';
  if v_champ is distinct from 'Lima' then
    raise exception 'UNEXPECTED: the old body crowned % (capture may not be the live body)', v_champ;
  end if;
  if v_status <> 'completed' then raise exception 'UNEXPECTED: bracket status is %', v_status; end if;
  raise notice 'PASS defect reproduced: the finals matchup read 0.000-0.000, both per-series seeds are NULL, so the ELSE branch fired and % (the 2 seed, away) is champion over Kilo (the 1 seed, home)', v_champ;
end \$\$;
SQL

echo "[14] DEFECT P3: it does not even need a matchup row"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(0, 0, false);
select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001');
SQL
$P <<SQL
do \$\$ declare v_champ text; c int; begin
  select count(*) into c from public.matchups where league_id = '$LG3' and week_number = 6;
  if c <> 0 then raise exception 'FIXTURE: expected no matchup row for the finals week, found %', c; end if;
  select t.team_name into v_champ from public.playoff_brackets b
    join public.teams t on t.id = b.champion_team_id where b.id = 'b3333333-0000-4000-8000-000000000001';
  if v_champ is distinct from 'Lima' then
    raise exception 'UNEXPECTED: the old body crowned % with zero games on record', v_champ;
  end if;
  raise notice 'PASS defect reproduced: with NO matchup row at all the old body still crowned %', v_champ;
end \$\$;
SQL

echo "[15] DEFECT P3: advancing nothing still bumps the round"
# set_config and the RPC must share one psql session: auth.uid() reads a session
# GUC, and in a fresh session it is NULL and the commissioner gate answers first.
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(0, 0, true);
update public.playoff_brackets set current_round = 1 where id = 'b3333333-0000-4000-8000-000000000001';
update public.playoff_series set status = 'pending'
 where bracket_id = 'b3333333-0000-4000-8000-000000000001' and round_number = 1;

do \$\$ declare v json; v_round int; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FIXTURE: advance refused the call: %', v; end if;
  if (v ->> 'advanced_count')::int <> 0 then
    raise exception 'FIXTURE: expected 0 series advanced, got %', v ->> 'advanced_count';
  end if;
  select current_round into v_round from public.playoff_brackets where id = 'b3333333-0000-4000-8000-000000000001';
  if v_round <> 2 then
    raise exception 'UNEXPECTED: round is % after advancing nothing, expected the old body to have bumped it to 2', v_round;
  end if;
  raise notice 'PASS defect reproduced: advanced_count = 0 and the bracket still moved from round 1 to round 2';
end \$\$;
SQL

echo "[16] apply migration 2"
$P -f "$MIG2"

echo "[17] NEW advance: refuses a series that was never scored, and says why"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(0, 0, true);

do \$\$ declare v json; r record; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FAIL advance refused the call: %', v; end if;
  if (v ->> 'advanced_count')::int <> 0 then raise exception 'FAIL advanced % series off a 0-0 week', v ->> 'advanced_count'; end if;
  if (v ->> 'skipped_count')::int <> 1 then raise exception 'FAIL skipped_count is %, expected 1', v ->> 'skipped_count'; end if;
  if (v -> 'skipped' -> 0 ->> 'reason') not like '%never scored%' then
    raise exception 'FAIL skip reason is %', v -> 'skipped' -> 0 ->> 'reason';
  end if;
  if (v ->> 'round_advanced')::boolean then raise exception 'FAIL the round moved anyway'; end if;

  select b.status, b.current_round, b.champion_team_id, s.status series_status
    into r from public.playoff_brackets b
    join public.playoff_series s on s.id = 'c3333333-0000-4000-8000-000000000009'
   where b.id = 'b3333333-0000-4000-8000-000000000001';
  if r.status <> 'active' or r.champion_team_id is not null then
    raise exception 'FAIL bracket is % with champion %', r.status, r.champion_team_id;
  end if;
  if r.current_round <> 2 then raise exception 'FAIL round moved to %', r.current_round; end if;
  if r.series_status <> 'active' then raise exception 'FAIL the finals series is now %', r.series_status; end if;
  raise notice 'PASS the unplayed finals is left alone: no champion, no round change, series still active, reason "%"', v -> 'skipped' -> 0 ->> 'reason';
end \$\$;
SQL

echo "[18] NEW advance: no matchup row, and an unfinished week, are both refused"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(0, 0, false);
do \$\$ declare v json; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FAIL advance refused the call: %', v; end if;
  if (v -> 'skipped' -> 0 ->> 'reason') not like 'no matchup row%' then
    raise exception 'FAIL reason for a series with no games is %', v -> 'skipped' -> 0 ->> 'reason';
  end if;
end \$\$;

-- A week that HAS been scored but has not finished: status in_progress and the
-- week has not ended. FINAL fails, PLAYED passes.
select public.proof_restore_finals(60, 55, true, 'in_progress');
update public.matchups set week_end_date = current_date + 3, week_start_date = current_date - 3
 where league_id = '$LG3' and week_number = 6;
do \$\$ declare v json; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FAIL advance refused the call: %', v; end if;
  if (v ->> 'advanced_count')::int <> 0 then raise exception 'FAIL decided a week that is still being played'; end if;
  if (v -> 'skipped' -> 0 ->> 'reason') not like '%have not finished%' then
    raise exception 'FAIL reason for an unfinished week is %', v -> 'skipped' -> 0 ->> 'reason';
  end if;
  raise notice 'PASS both halves of the gate hold: no games at all, and games in progress, are refused separately';
end \$\$;
SQL

echo "[19] NEW advance: a series that WAS played is decided, on its scores"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(120.5, 98.2, true);
do \$\$ declare v json; v_champ text; v_runner text; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FAIL advance refused the call: %', v; end if;
  if (v ->> 'advanced_count')::int <> 1 then raise exception 'FAIL advanced %, expected 1', v ->> 'advanced_count'; end if;
  if (v ->> 'skipped_count')::int <> 0 then raise exception 'FAIL skipped %, expected 0', v ->> 'skipped_count'; end if;
  select ch.team_name, ru.team_name into v_champ, v_runner
    from public.playoff_brackets b
    left join public.teams ch on ch.id = b.champion_team_id
    left join public.teams ru on ru.id = b.runner_up_team_id
   where b.id = 'b3333333-0000-4000-8000-000000000001';
  if v_champ <> 'Kilo' or v_runner <> 'Lima' then
    raise exception 'FAIL champion % runner-up %, expected Kilo over Lima', v_champ, v_runner;
  end if;
  raise notice 'PASS a played finals is decided on its own scores: % beat % 120.5 to 98.2', v_champ, v_runner;
end \$\$;
SQL

echo "[20] NEW advance: the tie rule - the higher seed wins, in a round with no seed columns"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(110, 110, true);
do \$\$ declare v json; v_champ text; hs int; aws int; begin
  select home_seed, away_seed into hs, aws from public.playoff_series where id = 'c3333333-0000-4000-8000-000000000009';
  if hs is not null or aws is not null then raise exception 'FIXTURE: the finals must carry NULL seed columns'; end if;

  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FAIL advance refused the call: %', v; end if;
  if (v ->> 'advanced_count')::int <> 1 then raise exception 'FAIL a genuine tie was not decided: %', v; end if;
  select t.team_name into v_champ from public.playoff_brackets b join public.teams t on t.id = b.champion_team_id
   where b.id = 'b3333333-0000-4000-8000-000000000001';
  if v_champ <> 'Kilo' then
    raise exception 'FAIL a 110-110 finals went to %, expected Kilo (seed 1) over Lima (seed 2)', v_champ;
  end if;
  raise notice 'PASS 110.0-110.0 goes to Kilo, the 1 seed, read from playoff_seeds by team - this is the exact case where the old body handed it to Lima';
end \$\$;
SQL

echo "[21] NEW advance: a tie it cannot separate is refused, not guessed"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(110, 110, true);
-- A team deleted and re-added mid-playoffs loses its seed row. Every seeding
-- fact for that team goes with it, so there is nothing honest left to compare.
delete from public.playoff_seeds
 where bracket_id = 'b3333333-0000-4000-8000-000000000001'
   and team_id = 'a3333333-0000-4000-8000-000000000001';
do \$\$ declare v json; r record; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FAIL advance refused the call: %', v; end if;
  if (v ->> 'advanced_count')::int <> 0 then raise exception 'FAIL it invented a winner: %', v; end if;
  if (v -> 'skipped' -> 0 ->> 'reason') not like '%tied on points%' then
    raise exception 'FAIL reason is %', v -> 'skipped' -> 0 ->> 'reason';
  end if;
  select b.status, b.current_round, b.champion_team_id, s.status series_status into r
    from public.playoff_brackets b join public.playoff_series s on s.id = 'c3333333-0000-4000-8000-000000000009'
   where b.id = 'b3333333-0000-4000-8000-000000000001';
  if r.status <> 'active' or r.champion_team_id is not null or r.series_status <> 'active' or r.current_round <> 2 then
    raise exception 'FAIL the bracket moved anyway: status % round % champion % series %',
      r.status, r.current_round, r.champion_team_id, r.series_status;
  end if;
  raise notice 'PASS an unseparable tie leaves the series active and the round where it was, and names the series for the commissioner';
end \$\$;
insert into public.playoff_seeds (bracket_id, team_id, seed_number, regular_season_wins, regular_season_losses, regular_season_points_for)
values ('b3333333-0000-4000-8000-000000000001', 'a3333333-0000-4000-8000-000000000001', 1, 4, 0, 500);
SQL

echo "[22] NEW advance: a half-played round decides what it can and does NOT move on"
$P <<SQL
select set_config('request.jwt.claim.sub', '$C3', false);
select public.proof_restore_finals(0, 0, false);
update public.playoff_brackets set current_round = 1 where id = 'b3333333-0000-4000-8000-000000000001';
update public.playoff_series set status = 'active', winner_team_id = null, loser_team_id = null
 where bracket_id = 'b3333333-0000-4000-8000-000000000001' and round_number = 1;
-- match 1's week was played; match 2's was not.
update public.matchups set team1_score = 0, team2_score = 0
 where league_id = '$LG3' and week_number = 5
   and team1_id = 'a3333333-0000-4000-8000-000000000002';
do \$\$ declare v json; v_round int; c int; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FAIL advance refused the call: %', v; end if;
  if (v ->> 'advanced_count')::int <> 1 then raise exception 'FAIL advanced %, expected 1', v ->> 'advanced_count'; end if;
  if (v ->> 'skipped_count')::int <> 1 then raise exception 'FAIL skipped %, expected 1', v ->> 'skipped_count'; end if;
  select current_round into v_round from public.playoff_brackets where id = 'b3333333-0000-4000-8000-000000000001';
  if v_round <> 1 then
    raise exception 'FAIL the round moved to % while one of its series was still undecided - that series would never be looked at again', v_round;
  end if;
  select count(*) into c from public.playoff_series
   where bracket_id = 'b3333333-0000-4000-8000-000000000001' and round_number = 1 and status = 'active';
  if c <> 1 then raise exception 'FAIL % round-1 series still active, expected 1', c; end if;
  raise notice 'PASS one series decided, one left active, and the round stayed at 1 so the undecided series is still reachable';
end \$\$;

-- Score the second week and the round finishes and moves on.
update public.matchups set team1_score = 115, team2_score = 90
 where league_id = '$LG3' and week_number = 5
   and team1_id = 'a3333333-0000-4000-8000-000000000002';
do \$\$ declare v json; v_round int; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if v ->> 'error' is not null then raise exception 'FAIL advance refused the call: %', v; end if;
  if (v ->> 'advanced_count')::int <> 1 then raise exception 'FAIL advanced %, expected 1', v ->> 'advanced_count'; end if;
  if not (v ->> 'round_advanced')::boolean then raise exception 'FAIL the finished round did not move on'; end if;
  select current_round into v_round from public.playoff_brackets where id = 'b3333333-0000-4000-8000-000000000001';
  if v_round <> 2 then raise exception 'FAIL round is %, expected 2', v_round; end if;
  raise notice 'PASS once the last week is scored the round completes and the bracket moves to round 2';
end \$\$;

-- and the commissioner gate is intact
select set_config('request.jwt.claim.sub', '$C1', false);
do \$\$ declare v json; begin
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if (v ->> 'error') is distinct from 'Only the commissioner can advance rounds' then
    raise exception 'FAIL the commissioner gate on advance was lost: %', v;
  end if;
  raise notice 'PASS the commissioner gate on advance is intact';
end \$\$;
SQL

echo "[23] fixture: a league_vote league mid-review, and a commissioner-review league"
$P <<SQL
-- LG4: four teams, so eligible_voters = 4 - 2 = 2. threshold 1.0 means CEIL(2 *
-- 1.0) = 2 vetoes are needed - so one manager cannot veto on their own vote
-- alone, and has to forge somebody else's to do it.
insert into public.leagues (id, name, commissioner_id, draft_status, settings, trade_review_type, trade_veto_threshold)
values ('$LG4', 'Vote League', '$C4', 'completed', '{"leagueType":"fantasy"}'::jsonb, 'league_vote', 1.0);
insert into public.teams (id, league_id, owner_id, team_name) values
  ('a4444444-0000-4000-8000-000000000041', '$LG4', null,   'Papa'),
  ('a4444444-0000-4000-8000-000000000042', '$LG4', null,   'Quebec'),
  ('a4444444-0000-4000-8000-000000000043', '$LG4', '$U43', 'Romeo'),
  ('a4444444-0000-4000-8000-000000000044', '$LG4', '$U44', 'Sierra');
insert into public.trade_offers (id, league_id, from_team_id, to_team_id, offered_player_ids, requested_player_ids, status, review_type, review_started_at, review_ends_at)
values ('f4444444-0000-4000-8000-000000000001', '$LG4',
        'a4444444-0000-4000-8000-000000000041', 'a4444444-0000-4000-8000-000000000042',
        array[100], array[200], 'under_review', 'league_vote', now(), now() + interval '1 day');

-- LG5: the commissioner owns no team, which is the normal case (55 of 166
-- production team rows have owner_id NULL).
insert into public.leagues (id, name, commissioner_id, draft_status, settings, trade_review_type)
values ('$LG5', 'Commissioner Review League', '$C5', 'completed', '{"leagueType":"fantasy"}'::jsonb, 'commissioner');
insert into public.teams (id, league_id, owner_id, team_name) values
  ('a5555555-0000-4000-8000-000000000051', '$LG5', '$U51', 'Tango'),
  ('a5555555-0000-4000-8000-000000000052', '$LG5', 'd0000000-0000-4000-8000-000000000052', 'Uniform');
insert into public.trade_offers (id, league_id, from_team_id, to_team_id, offered_player_ids, requested_player_ids, status)
values ('f5555555-0000-4000-8000-000000000001', '$LG5',
        'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
        array[100], array[200], 'pending');

create or replace function public.proof_reset_lg5_rosters() returns void language plpgsql as \$fn\$
begin
  delete from public.roster_assignments where league_id = '$LG5';
  delete from public.transaction_ledger where league_id = '$LG5';
  delete from public.trade_history where league_id = '$LG5';
  insert into public.roster_assignments (league_id, team_id, player_id) values
    ('$LG5', 'a5555555-0000-4000-8000-000000000051', '100'),
    ('$LG5', 'a5555555-0000-4000-8000-000000000052', '200');
end \$fn\$;
select public.proof_reset_lg5_rosters();
SQL

echo "[24] the trade_votes_insert policy DOES stop a direct write, so it is a real control"
$P <<SQL
select set_config('request.jwt.claim.sub', '$U43', false);
set role authenticated;
do \$\$ begin
  begin
    insert into public.trade_votes (trade_offer_id, league_id, voter_team_id, vote)
    values ('f4444444-0000-4000-8000-000000000001', '$LG4', 'a4444444-0000-4000-8000-000000000044', 'veto');
    raise exception 'UNEXPECTED: the RLS policy let a manager insert a vote for a team they do not own';
  exception when insufficient_privilege then
    raise notice 'PASS a direct INSERT of a forged vote is refused by trade_votes_insert (%)', sqlerrm;
  end;
end \$\$;
reset role;
SQL

echo "[25] DEFECT T3: the SECURITY DEFINER RPC walks straight past that policy"
$P <<SQL
-- Sierra's owner casts an honest approve.
select set_config('request.jwt.claim.sub', '$U44', false);
set role authenticated;
select * from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a4444444-0000-4000-8000-000000000044', 'approve');
reset role;

-- Romeo's owner casts an honest veto. One veto, two needed: nothing happens.
select set_config('request.jwt.claim.sub', '$U43', false);
set role authenticated;
select * from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a4444444-0000-4000-8000-000000000043', 'veto');
reset role;

do \$\$ declare v_status text; begin
  select status into v_status from public.trade_offers where id = 'f4444444-0000-4000-8000-000000000001';
  if v_status <> 'under_review' then raise exception 'FIXTURE: one veto should not be enough, status is %', v_status; end if;
end \$\$;
SQL
$P <<SQL
-- Now Romeo's owner votes AS SIERRA, the team Sierra's owner already voted with.
select set_config('request.jwt.claim.sub', '$U43', false);
set role authenticated;
select * from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a4444444-0000-4000-8000-000000000044', 'veto');
reset role;

do \$\$ declare v_vote text; v_status text; v_votes int; begin
  select vote into v_vote from public.trade_votes
   where trade_offer_id = 'f4444444-0000-4000-8000-000000000001'
     and voter_team_id = 'a4444444-0000-4000-8000-000000000044';
  select status into v_status from public.trade_offers where id = 'f4444444-0000-4000-8000-000000000001';
  select count(*) into v_votes from public.trade_votes where trade_offer_id = 'f4444444-0000-4000-8000-000000000001';
  if v_vote is distinct from 'veto' then
    raise exception 'UNEXPECTED: Sierra''s vote is % (capture may not be the live body)', v_vote;
  end if;
  if v_status <> 'vetoed' then raise exception 'UNEXPECTED: trade status is %, expected vetoed', v_status; end if;
  raise notice 'PASS defect reproduced: one manager cast a vote as another manager''s team, ON CONFLICT DO UPDATE overwrote that manager''s "approve" with "veto", and % votes from 1 human vetoed the trade single-handed', v_votes;
end \$\$;
SQL

echo "[26] DEFECT T2: the OLD execute_trade refuses the commissioner"
$P <<SQL
select public.proof_reset_lg5_rosters();
select set_config('request.jwt.claim.sub', '$C5', false);
do \$\$ declare v jsonb; c int; begin
  select public.execute_trade('f5555555-0000-4000-8000-000000000001', '$LG5',
    'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
    array['100'], array['200']) into v;
  if (v ->> 'success')::boolean then raise exception 'UNEXPECTED: the old body let the commissioner through: %', v; end if;
  if (v ->> 'error') not like 'Unauthorized: you are not an owner of either team%' then
    raise exception 'UNEXPECTED: error is %', v ->> 'error';
  end if;
  select count(*) into c from public.roster_assignments
   where league_id = '$LG5' and team_id = 'a5555555-0000-4000-8000-000000000051' and player_id = '100';
  if c <> 1 then raise exception 'UNEXPECTED: rosters moved anyway'; end if;
  raise notice 'PASS defect reproduced: the commissioner of the league gets "%" - while the service-role cron path, where auth.uid() is NULL, executes the same trade fine', v ->> 'error';
end \$\$;

-- and it does execute for the service role, which is the asymmetry
select set_config('request.jwt.claim.sub', '', false);
do \$\$ declare v jsonb; begin
  select public.execute_trade('f5555555-0000-4000-8000-000000000001', '$LG5',
    'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
    array['100'], array['200']) into v;
  if not (v ->> 'success')::boolean then raise exception 'FIXTURE: the service-role path should work: %', v; end if;
  raise notice 'PASS the same trade, same arguments, executes for auth.uid() = NULL - only the human decision path was blocked';
end \$\$;
SQL

echo "[27] apply migration 3"
$P -f "$MIG3"

echo "[28] NEW submit_trade_vote: you vote as your own team, or not at all"
$P <<SQL
delete from public.trade_votes where trade_offer_id = 'f4444444-0000-4000-8000-000000000001';
update public.trade_offers set status = 'under_review', vetoed_at = null, processed_at = null
 where id = 'f4444444-0000-4000-8000-000000000001';

-- Sierra's owner votes as Sierra: allowed.
select set_config('request.jwt.claim.sub', '$U44', false);
set role authenticated;
do \$\$ declare r record; begin
  select * into r from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a4444444-0000-4000-8000-000000000044', 'approve');
  if not r.success then raise exception 'FAIL an honest vote was refused: %', r.message; end if;
end \$\$;
reset role;

-- Romeo's owner votes as Sierra: refused, and Sierra's approve is untouched.
select set_config('request.jwt.claim.sub', '$U43', false);
set role authenticated;
do \$\$ declare r record; v_vote text; v_status text; v_veto int; v_needed int; begin
  select * into r from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a4444444-0000-4000-8000-000000000044', 'veto');
  if r.success then raise exception 'FAIL the spoofed vote was accepted'; end if;
  if r.message <> 'You can only vote as a team you own' then raise exception 'FAIL message is %', r.message; end if;
  select vote into v_vote from public.trade_votes
   where trade_offer_id = 'f4444444-0000-4000-8000-000000000001' and voter_team_id = 'a4444444-0000-4000-8000-000000000044';
  if v_vote <> 'approve' then raise exception 'FAIL Sierra''s vote was overwritten to %', v_vote; end if;
  select status into v_status from public.trade_offers where id = 'f4444444-0000-4000-8000-000000000001';
  if v_status <> 'under_review' then raise exception 'FAIL the trade was moved to %', v_status; end if;

  -- and their own vote still works
  select * into r from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a4444444-0000-4000-8000-000000000043', 'veto');
  if not r.success then raise exception 'FAIL Romeo could not vote as Romeo: %', r.message; end if;
  if r.veto_count <> 1 or r.votes_needed <> 2 then raise exception 'FAIL counts are % of %', r.veto_count, r.votes_needed; end if;
  v_veto := r.veto_count; v_needed := r.votes_needed;

  -- a team from another league is refused too
  select * into r from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a5555555-0000-4000-8000-000000000051', 'veto');
  if r.success then raise exception 'FAIL a team from another league was allowed to vote'; end if;
  if r.message <> 'Voting team is not in this league' then raise exception 'FAIL message is %', r.message; end if;

  raise notice 'PASS the spoof is refused, the forged team keeps its own vote, the trade stays under review, and the honest vote still records (% of % vetoes)', v_veto, v_needed;
end \$\$;
reset role;

-- The service role is still allowed (auth.uid() NULL), but the league check
-- holds for every caller.
select set_config('request.jwt.claim.sub', '', false);
do \$\$ declare r record; begin
  select * into r from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a4444444-0000-4000-8000-000000000044', 'approve');
  if not r.success then raise exception 'FAIL the service role was blocked: %', r.message; end if;
  select * into r from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a5555555-0000-4000-8000-000000000051', 'approve');
  if r.success then raise exception 'FAIL the service role voted with a team from another league'; end if;
  raise notice 'PASS auth.uid() = NULL keeps the service-role path working, and the league check still applies to it';
end \$\$;
SQL

echo "[29] NEW execute_trade: the commissioner of THIS league is let through, nobody else"
$P <<SQL
select public.proof_reset_lg5_rosters();
select set_config('request.jwt.claim.sub', '$C5', false);
do \$\$ declare v jsonb; v_team text; c int; begin
  select public.execute_trade('f5555555-0000-4000-8000-000000000001', '$LG5',
    'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
    array['100'], array['200']) into v;
  if not (v ->> 'success')::boolean then raise exception 'FAIL the commissioner is still blocked: %', v; end if;

  select t.team_name into v_team from public.roster_assignments r join public.teams t on t.id = r.team_id
   where r.league_id = '$LG5' and r.player_id = '100';
  if v_team <> 'Uniform' then raise exception 'FAIL player 100 is on %, expected Uniform', v_team; end if;
  select t.team_name into v_team from public.roster_assignments r join public.teams t on t.id = r.team_id
   where r.league_id = '$LG5' and r.player_id = '200';
  if v_team <> 'Tango' then raise exception 'FAIL player 200 is on %, expected Tango', v_team; end if;

  select count(*) into c from public.transaction_ledger where league_id = '$LG5';
  if c <> 4 then raise exception 'FAIL % ledger rows, expected 4', c; end if;
  select count(*) into c from public.trade_history where league_id = '$LG5';
  if c <> 1 then raise exception 'FAIL % trade_history rows, expected 1', c; end if;
  raise notice 'PASS the commissioner approve path executes: both players moved, 4 ledger rows, 1 trade_history row';
end \$\$;
SQL
$P <<SQL
select public.proof_reset_lg5_rosters();
do \$\$ declare v jsonb; c int; begin
  -- a manager who owns neither team is still refused
  perform set_config('request.jwt.claim.sub', '$U43', false);
  select public.execute_trade('f5555555-0000-4000-8000-000000000001', '$LG5',
    'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
    array['100'], array['200']) into v;
  if (v ->> 'success')::boolean then raise exception 'FAIL an unrelated manager executed the trade'; end if;

  -- and so is the commissioner of a DIFFERENT league
  perform set_config('request.jwt.claim.sub', '$C4', false);
  select public.execute_trade('f5555555-0000-4000-8000-000000000001', '$LG5',
    'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
    array['100'], array['200']) into v;
  if (v ->> 'success')::boolean then raise exception 'FAIL the commissioner of another league executed the trade'; end if;

  select count(*) into c from public.roster_assignments
   where league_id = '$LG5' and team_id = 'a5555555-0000-4000-8000-000000000051' and player_id = '100';
  if c <> 1 then raise exception 'FAIL rosters moved for a caller that should have been refused'; end if;

  -- the ordinary accept path is untouched
  perform set_config('request.jwt.claim.sub', '$U51', false);
  select public.execute_trade('f5555555-0000-4000-8000-000000000001', '$LG5',
    'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
    array['100'], array['200']) into v;
  if not (v ->> 'success')::boolean then raise exception 'FAIL the team owner path broke: %', v; end if;

  raise notice 'PASS the gate widened by exactly one principal: the commissioner of THIS league. An unrelated manager and the commissioner of another league are still refused, and the owner path still works';
end \$\$;
SQL

echo "[30] T4 is a service-layer guard: execute_trade has no view of trade status"
$P <<SQL
select public.proof_reset_lg5_rosters();
update public.trade_offers set status = 'rejected' where id = 'f5555555-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '$C5', false);
do \$\$ declare v jsonb; begin
  select public.execute_trade('f5555555-0000-4000-8000-000000000001', '$LG5',
    'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
    array['100'], array['200']) into v;
  if not (v ->> 'success')::boolean then
    raise exception 'UNEXPECTED: execute_trade now reads trade_offers.status; this proof step needs rewriting';
  end if;
  raise notice 'NOTE execute_trade takes the trade payload as arguments and never reads trade_offers.status, so it will happily move rosters for a REJECTED trade. That is exactly why the T4 guard lives in TradeService.commissionerDecision (statuses pending / under_review only), covered by server/src/__tests__/TradeService.test.ts';
end \$\$;
update public.trade_offers set status = 'pending' where id = 'f5555555-0000-4000-8000-000000000001';
select public.proof_reset_lg5_rosters();
SQL

echo "[31] all three migrations re-apply as no-ops"
$P -f "$MIG1" >/dev/null
$P -f "$MIG2" >/dev/null
$P -f "$MIG3" >/dev/null
$P <<SQL
select set_config('request.jwt.claim.sub', '$C1', false);
do \$\$ declare c int; v_ties int; v json; vb jsonb; r record; v_champ text; begin
  -- migration 1: one column default, one helper, no duplicated seeds
  select count(*) into c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_bracket_season';
  if c <> 1 then raise exception 'FAIL re-apply left % league_bracket_season functions', c; end if;
  select count(*), coalesce(sum(regular_season_ties), 0) into c, v_ties
    from public.playoff_seeds s join public.playoff_brackets b on b.id = s.bracket_id
   where b.league_id = '$LG1';
  if c <> 6 or v_ties <> 0 then raise exception 'FAIL re-apply changed LG1 seeding: % seeds, % ties', c, v_ties; end if;

  -- migration 2: the finals still refuses an unplayed series
  perform set_config('request.jwt.claim.sub', '$C3', false);
  perform public.proof_restore_finals(0, 0, true);
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  if (v ->> 'advanced_count')::int <> 0 or (v ->> 'skipped_count')::int <> 1 then
    raise exception 'FAIL re-apply changed advance behaviour: %', v;
  end if;
  perform public.proof_restore_finals(110, 110, true);
  select public.advance_playoff_round('b3333333-0000-4000-8000-000000000001') into v;
  select t.team_name into v_champ from public.playoff_brackets b join public.teams t on t.id = b.champion_team_id
   where b.id = 'b3333333-0000-4000-8000-000000000001';
  if v_champ <> 'Kilo' then raise exception 'FAIL re-apply changed the tie rule: champion is %', v_champ; end if;

  -- migration 3: the spoof is still refused
  perform set_config('request.jwt.claim.sub', '$U43', false);
  select * into r from public.submit_trade_vote('f4444444-0000-4000-8000-000000000001', 'a4444444-0000-4000-8000-000000000044', 'veto');
  if r.success then raise exception 'FAIL re-apply reopened the vote spoof'; end if;

  perform set_config('request.jwt.claim.sub', '$C5', false);
  select public.execute_trade('f5555555-0000-4000-8000-000000000001', '$LG5',
    'a5555555-0000-4000-8000-000000000051', 'a5555555-0000-4000-8000-000000000052',
    array['100'], array['200']) into vb;
  if not (vb ->> 'success')::boolean then raise exception 'FAIL re-apply broke the commissioner path: %', vb; end if;

  raise notice 'PASS all three migrations re-applied cleanly; seeding, the advance gate, the tie rule, the vote refusal and the commissioner path are all unchanged';
end \$\$;
SQL

echo "ALL PASS"
