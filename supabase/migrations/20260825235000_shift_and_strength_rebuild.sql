-- ─────────────────────────────────────────────────────────────────────────────
-- Shift and strength rebuild — consolidated
--
-- WHAT THIS IS FOR
--   player_shifts is not shift data. calculate_player_toi.py builds it by
--   inferring intervals from the events a player happens to appear in, and its
--   own docstring says so: "Infers shifts from player participation in events."
--   Reconciled against player_game_stats.nhl_toi_seconds -- the official
--   game-log TOI already stored beside it -- that table lands within 30 seconds
--   of the truth for 4.0% of player-games, with a spread from 25% to 251%. It
--   holds 19,688 "shifts" longer than five minutes. A real shift is 35 to 50
--   seconds. It also only ever covered 656 games of one season; the 9,076 games
--   from 2017-18 through 2024-25 have no shift data of any kind.
--
--   The NHL publishes the real charts and ingest_shiftcharts.py already read
--   them into player_shifts_official. The same reconciliation on that table:
--   94.3% exact to the second, 95.0% within 30 seconds, across 10,327
--   player-games. It stopped at 271 games because --limit defaulted to 200.
--
--   So the fix is a change of source, not a repair of a derivation:
--     player_shifts_official   who was on the ice and when   (NHL shift charts)
--     game_strength_intervals  what the strength was and when (stored PBP)
--     the two intersected      TOI by situation, and then GAR
--
-- APPLYING THIS
--   Production already carries every object below, applied as eleven
--   incremental migrations on 2026-08-25 (versions 20260825232547 through
--   20260825234237). Every statement here is idempotent, so applying this file
--   to production is a no-op and applying it to staging builds the lot.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. THE STRENGTH TIMELINE
-- ═══════════════════════════════════════════════════════════════════════════
-- The on-ice strength of every second of every game, built from data already
-- stored. No network.
--
-- SOURCE
--   raw_nhl_data.raw_json->'plays'[].situationCode -- the NHL's own four-digit
--   on-ice count, present on every game back to 2017-18:
--       [away goalie][away skaters][home skaters][home goalie]
--       "1551" = 5v5     "1541" = home killing     "1560" = home net empty
--   This is a count, not an inference. We never guess who was on the ice; we
--   read how many there were and when it changed.
--
-- WHY IT IS SEPARATE FROM THE SHIFTS
--   The old player_toi_by_situation tagged each inferred shift with a single
--   situation. A shift that starts at 5v5 and ends on a power play cannot be
--   described by one tag. The strength timeline is player-independent and gets
--   intersected with the shifts afterwards, so a shift can span two states and
--   be charged to both correctly.
--
-- BOUNDARY RULE, AND ITS KNOWN RESIDUAL
--   A code holds from the event carrying it until the event that changes it.
--   A penalty STARTING is stamped by the penalty event, so that boundary is
--   exact. A penalty EXPIRING happens on the run clock with nothing to mark it,
--   so the new code first appears on whatever play happens next.
--
--   Measured over 271 games: 2,188 such transitions, 51,843 seconds of
--   ambiguity in total (5.22% of game time), average window 23.7 s, worst 174 s.
--   Roughly half of that -- on the order of 2.6% of game time -- is currently
--   charged to the stronger side. See section 5 for why it is not yet fixed.
--
-- Shootouts are excluded (periodType 'SO'): no ice time is charged there.

create table if not exists public.game_strength_intervals (
  game_id       integer  not null,
  period        smallint not null,
  start_s       smallint not null,
  end_s         smallint not null,
  away_goalie   smallint not null,
  away_skaters  smallint not null,
  home_skaters  smallint not null,
  home_goalie   smallint not null,
  built_at      timestamptz not null default now(),
  primary key (game_id, period, start_s),
  constraint gsi_ordered check (end_s >= start_s)
);

create index if not exists gsi_game on public.game_strength_intervals (game_id);

comment on table public.game_strength_intervals is
  'Per-game strength timeline derived from raw_nhl_data situationCode. Independent of players; intersect with player_shifts_official for TOI splits.';

create or replace function public.rebuild_strength_intervals(p_games integer[])
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  n integer;
begin
  delete from public.game_strength_intervals where game_id = any(p_games);

  with ev as (
    select r.game_id,
           (p->'periodDescriptor'->>'number')::int as period,
           (split_part(p->>'timeInPeriod', ':', 1))::int * 60
             + (split_part(p->>'timeInPeriod', ':', 2))::int as t,
           nullif(p->>'situationCode', '') as sc,
           coalesce((p->>'sortOrder')::int, 0) as so
    from public.raw_nhl_data r,
         lateral jsonb_array_elements(r.raw_json->'plays') p
    where r.game_id = any(p_games)
      and p->>'timeInPeriod' is not null
      and p->'periodDescriptor'->>'number' is not null
      and coalesce(p->'periodDescriptor'->>'periodType', 'REG') <> 'SO'
  ),
  -- A handful of events (period-start, stoppage) carry no code. They inherit
  -- the last one seen, which is what was on the ice.
  filled as (
    select game_id, period, t, so,
           max(sc) over (partition by game_id, period, grp) as sc
    from (
      select *, count(sc) over (partition by game_id, period
                                order by t, so rows unbounded preceding) as grp
      from ev
    ) z
  ),
  valid as (
    select * from filled where sc ~ '^[0-9]{4}$'
  ),
  marked as (
    select *, case when sc is distinct from lag(sc) over w then 1 else 0 end as nb
    from valid
    window w as (partition by game_id, period order by t, so)
  ),
  grouped as (
    select *, sum(nb) over (partition by game_id, period order by t, so
                            rows unbounded preceding) as g
    from marked
  ),
  runs0 as (
    select game_id, period, g, min(t) as start_s, min(sc) as sc
    from grouped group by 1, 2, 3
  ),
  -- Several codes can share one second: a penalty and the faceoff that follows
  -- it are both stamped at, say, 17:48. Every run but the last of that second
  -- occupies zero time, so the last one is the one that describes the ice.
  runs as (
    select game_id, period, start_s, sc, g
    from (select *, row_number() over (partition by game_id, period, start_s
                                       order by g desc) rn from runs0) z
    where rn = 1
  ),
  -- A regulation period is twenty minutes. Four periods across 2019-20 had
  -- their last recorded event before the buzzer, so reading the length off the
  -- last event left the final seconds of ice belonging to nobody. Overtime is
  -- the opposite: it genuinely ends when it ends.
  bounds as (
    select game_id, period,
           case when period <= 3 then 1200 else max(t) end as period_end
    from valid group by 1, 2
  ),
  iv as (
    select r.game_id, r.period,
           -- A code read at the opening faceoff describes the ice from the
           -- drop, not from the moment the event was stamped.
           case when row_number() over (partition by r.game_id, r.period order by r.start_s) = 1
                then 0 else r.start_s end as start_s,
           coalesce(lead(r.start_s) over (partition by r.game_id, r.period order by r.start_s),
                    b.period_end) as end_s,
           r.sc
    from runs r join bounds b using (game_id, period)
  )
  insert into public.game_strength_intervals
        (game_id, period, start_s, end_s, away_goalie, away_skaters, home_skaters, home_goalie)
  select game_id, period, start_s, greatest(end_s, start_s),
         substr(sc,1,1)::smallint, substr(sc,2,1)::smallint,
         substr(sc,3,1)::smallint, substr(sc,4,1)::smallint
  from iv;

  get diagnostics n = row_count;
  return n;
end;
$fn$;

comment on function public.rebuild_strength_intervals(integer[]) is
  'Rebuild the strength timeline for the given games from raw_nhl_data. Idempotent.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RESUMABLE PROGRESS
-- ═══════════════════════════════════════════════════════════════════════════
-- Eleven thousand games do not fit in one statement timeout, and a job that
-- cannot be resumed gets abandoned half-done -- which is how the shift table
-- came to cover one season.

create table if not exists public.strength_build_state (
  game_id     integer primary key,
  built_at    timestamptz,
  refined_at  timestamptz,
  n_intervals integer
);

comment on table public.strength_build_state is
  'Per-game progress for game_strength_intervals.';
comment on column public.strength_build_state.refined_at is
  'Reserved. Set when a game''s boundaries have been snapped to the shift chart. Nothing sets it yet -- see section 5.';

create table if not exists public.strength_refine_log (
  id                 bigserial primary key,
  ran_at             timestamptz not null default now(),
  games              integer not null,
  boundaries_moved   integer not null,
  seconds_reassigned integer not null
);

-- One call does one bounded batch, atomically, and says how much is left.
-- Deliberately NOT a procedure with COMMIT: that only works from a client that
-- gives it its own transaction. psql does, PostgREST does not, and a job that
-- runs one way and not the other is a job that will be run the way that breaks.
create or replace function public.citrus_build_strength_batch(p_batch integer default 50)
returns table(processed integer, remaining bigint)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  games integer[];
begin
  select array_agg(game_id) into games
  from (
    select r.game_id
    from public.raw_nhl_data r
    left join public.strength_build_state s using (game_id)
    where s.built_at is null
    order by r.game_id
    limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_strength_intervals(games);

  insert into public.strength_build_state (game_id, built_at, n_intervals)
  select g, now(), (select count(*) from public.game_strength_intervals i where i.game_id = g)
  from unnest(games) g
  on conflict (game_id) do update
    set built_at = excluded.built_at, n_intervals = excluded.n_intervals;

  return query
    select cardinality(games),
           (select count(*) from public.raw_nhl_data r
             left join public.strength_build_state s using (game_id)
            where s.built_at is null);
end;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. PROOF, PER GAME, AT INGEST TIME
-- ═══════════════════════════════════════════════════════════════════════════
-- Every one of the 11,870 stored games has player_game_stats.nhl_toi_seconds,
-- so every game can be checked against a source it did not come from. There is
-- no game we have to take on faith, and no reason to wait for a health report
-- to find out a game landed wrong.

create table if not exists public.shift_ingest_quality (
  game_id        integer primary key,
  fetched_at     timestamptz not null default now(),
  n_shifts       integer not null,
  n_players      integer not null,
  n_checked      integer not null,   -- players with a game-log TOI to compare to
  n_within_30s   integer not null,
  n_exact        integer not null,
  worst_diff_s   integer,
  pct_within_30s numeric(5,1),
  verdict        text not null       -- 'good' | 'suspect' | 'empty'
);

create index if not exists siq_verdict on public.shift_ingest_quality (verdict);

comment on table public.shift_ingest_quality is
  'Reconciliation of player_shifts_official against player_game_stats.nhl_toi_seconds, one row per ingested game. verdict=good means at least 85 percent of that game''s players are within 30 seconds of the official game log.';

create or replace function public.record_shift_quality(p_game_id integer)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v record;
begin
  with o as (
    select player_id, sum(duration_seconds)::numeric toi, count(*) n
    from public.player_shifts_official where game_id = p_game_id group by 1
  ),
  j as (
    select o.player_id, o.toi, g.nhl_toi_seconds::numeric truth
    from o left join public.player_game_stats g
      on g.game_id = p_game_id and g.player_id = o.player_id and g.nhl_toi_seconds > 0
  )
  select
    (select count(*) from public.player_shifts_official where game_id = p_game_id) as n_shifts,
    (select count(*) from o)                                             as n_players,
    count(*) filter (where truth is not null)                            as n_checked,
    count(*) filter (where truth is not null and abs(toi - truth) <= 30) as n_within,
    count(*) filter (where truth is not null and toi = truth)            as n_exact,
    max(abs(toi - truth)) filter (where truth is not null)               as worst
  into v from j;

  insert into public.shift_ingest_quality
    (game_id, fetched_at, n_shifts, n_players, n_checked, n_within_30s, n_exact,
     worst_diff_s, pct_within_30s, verdict)
  values (
    p_game_id, now(), coalesce(v.n_shifts,0), coalesce(v.n_players,0),
    coalesce(v.n_checked,0), coalesce(v.n_within,0), coalesce(v.n_exact,0),
    v.worst::integer,
    case when coalesce(v.n_checked,0) = 0 then null
         else round(100.0 * v.n_within / v.n_checked, 1) end,
    case when coalesce(v.n_shifts,0) = 0 then 'empty'
         when coalesce(v.n_checked,0) = 0 then 'suspect'
         when 100.0 * v.n_within / v.n_checked >= 85 then 'good'
         else 'suspect' end
  )
  on conflict (game_id) do update set
    fetched_at = excluded.fetched_at, n_shifts = excluded.n_shifts,
    n_players = excluded.n_players, n_checked = excluded.n_checked,
    n_within_30s = excluded.n_within_30s, n_exact = excluded.n_exact,
    worst_diff_s = excluded.worst_diff_s, pct_within_30s = excluded.pct_within_30s,
    verdict = excluded.verdict;

  return (select verdict from public.shift_ingest_quality where game_id = p_game_id);
end;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. THE WORK LIST
-- ═══════════════════════════════════════════════════════════════════════════
-- A game with SOME shifts is not a game with its shifts.
--
-- The old ingest skipped any game that had at least one row, so a run killed
-- part-way through a game left it permanently half-loaded and permanently
-- skipped. Sixteen of the 271 games already stored are in exactly that state:
-- 438 shifts on average where a whole game carries 753, and only 35.5% of their
-- players reconciling. Those must be REPLACED, not topped up.

create or replace function public.games_needing_shifts(p_season integer default null)
returns table(game_id integer, reason text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.game_id,
         case when q.game_id is null and not exists
                   (select 1 from public.player_shifts_official o where o.game_id = r.game_id)
                then 'missing'
              when q.verdict = 'empty'   then 'empty'
              when q.verdict = 'suspect' then 'partial'
              else 'unchecked' end as reason
  from public.raw_nhl_data r
  left join public.shift_ingest_quality q using (game_id)
  where (p_season is null or r.game_id / 1000000 = p_season)
    and (q.game_id is null or q.verdict <> 'good')
  order by r.game_id
$$;

comment on function public.games_needing_shifts(integer) is
  'Work list for the shift backfill: games with no shift chart, plus games whose stored chart does not reconcile with the game log.';

-- A count to check that work list against.
--
-- PostgREST can be configured with db-max-rows, and a client that asks for
-- eleven thousand rows and quietly receives a thousand will do a thousand games
-- and report success. supabase_rest.py already carries a truncation guard for
-- exactly this class of bug on select(); RPC has none, so the caller brings its
-- own: fetch the list, ask for the count, refuse to start if they disagree.
create or replace function public.games_needing_shifts_count(p_season integer default null)
returns bigint
language sql
stable
security invoker
set search_path = public, pg_temp
as $cnt$
  select count(*) from public.games_needing_shifts(p_season)
$cnt$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. THE BOUNDARY REFINEMENT IS PARKED, NOT SHIPPED
-- ═══════════════════════════════════════════════════════════════════════════
-- A function that runs, reports success and changes nothing is worse than an
-- absent one, so the broken version is dropped rather than left to no-op.
--
-- Two candidate snaps were built and both were rejected on measurement:
--
--   1. Penalty-clock arithmetic (expiry = penalty time + duration). Explained
--      only 8.8% of the transitions, and the matches it did make averaged a
--      110-second move with a worst case of 1,103 s. It was matching unrelated
--      penalties, not the one that expired.
--
--   2. Snapping to the shift chart's own skater count. Correct in principle --
--      two independent NHL feeds agree on the count at 95.7% of sampled moments
--      -- but line changes make the count flicker for a second or two at almost
--      every boundary, so an exact-match rule found a mismatch right up against
--      the old boundary and moved nothing. Worse, when it did move a boundary
--      it failed to update the neighbouring interval whose start had also
--      moved, leaving overlapping intervals behind.
--
-- The right shape is a sustained-count rule at one-second resolution, run as a
-- batch job. Until it exists the timeline is honest about what it is: the NHL's
-- own strength state, with boundaries at the first event that reported them.

drop function if exists public.refine_strength_boundaries(integer[]);
drop function if exists public.citrus_refine_strength_batch(integer);
drop procedure if exists public.citrus_build_strength(integer, integer);
drop procedure if exists public.citrus_refine_strength(integer, integer);
