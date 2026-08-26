-- ─────────────────────────────────────────────────────────────────────────────
-- TOI by strength state, and the invariants that keep it honest.
--
-- Follows 20260825235000_shift_and_strength_rebuild.sql, which built the
-- strength timeline and the shift-chart backfill. This file turns those two
-- into per-player time on ice, and adds the correctness checks that the old
-- chain never had.
--
-- MEASURED, on the 263 games whose shift charts reconcile:
--   TOI split totals exactly to the shift chart      99.98% of player-games
--   TOI split exactly equals the official game log   99.67% of player-games
--   within 30 seconds of it                          99.94%
--   split ever exceeding its own source                   0 player-games
-- The table this replaces landed within 30 seconds 4.2% of the time.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. WHICH SIDE OF THE SHEET
-- ═══════════════════════════════════════════════════════════════════════════
-- Needed to turn a strength interval ("away 5, home 4") into a fact about a
-- player ("he was killing"). Read once instead of a jsonb lookup inside every
-- join.
create table if not exists public.game_teams (
  game_id   integer primary key,
  home_id   integer  not null,
  away_id   integer  not null,
  season    integer  not null,
  game_type smallint not null
);

insert into public.game_teams (game_id, home_id, away_id, season, game_type)
select r.game_id,
       (r.raw_json->'homeTeam'->>'id')::int,
       (r.raw_json->'awayTeam'->>'id')::int,
       r.game_id / 1000000,
       ((r.game_id / 10000) % 100)::smallint
from public.raw_nhl_data r
where r.raw_json->'homeTeam'->>'id' is not null
  and r.raw_json->'awayTeam'->>'id' is not null
on conflict (game_id) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE SPLIT
-- ═══════════════════════════════════════════════════════════════════════════
-- Two independent NHL feeds intersected: the shift chart says who was out
-- there, the strength timeline says what the ice looked like. A shift that
-- begins at 5v5 and ends on a power play is charged to both in the right
-- proportions -- which the old one-tag-per-shift model could not express at all.
create table if not exists public.player_toi_by_state (
  game_id     integer not null,
  player_id   integer not null,
  state       text    not null,
  toi_seconds integer not null,
  team_id     integer,
  season      integer not null,
  built_at    timestamptz not null default now(),
  primary key (game_id, player_id, state)
);

create index if not exists ptbs_player_season on public.player_toi_by_state (player_id, season);
create index if not exists ptbs_state on public.player_toi_by_state (state);

comment on table public.player_toi_by_state is
  'TOI per player per game per strength state, from the player''s own perspective: 5v5, 4v4, 3v3, PP, PK, EN_FOR (own goalie pulled), EN_AGAINST (theirs pulled), OTHER.';

create or replace function public.rebuild_toi_by_state(p_games integer[])
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  n integer;
begin
  delete from public.player_toi_by_state where game_id = any(p_games);

  with s0 as (
    select game_id, player_id, team_id, period,
           shift_start_time_seconds as st, shift_end_time_seconds as en
    from public.player_shifts_official
    where game_id = any(p_games)
      and shift_end_time_seconds > shift_start_time_seconds
  ),
  -- Merge a player's overlapping shift rows first. Two goalies out of 9,722
  -- player-games came out 734 and 469 seconds over their own chart total: five
  -- chart rows for a three-period game, two of them overlapping, so the
  -- intersection charged the same ice twice. Merging also makes the split
  -- immune to exact duplicate rows -- which is what 4.8% of player_shifts
  -- turned out to be. A sum that can exceed its own source is a sum nobody
  -- should trust.
  marked as (
    select *,
           case when st > max(en) over (partition by game_id, player_id, period
                                        order by st, en
                                        rows between unbounded preceding and 1 preceding)
                then 1 else 0 end as newgrp
    from s0
  ),
  grouped as (
    select *, sum(newgrp) over (partition by game_id, player_id, period
                                order by st, en rows unbounded preceding) as g
    from marked
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period,
           min(st) as st, max(en) as en
    from grouped group by game_id, player_id, period, g
  ),
  parts as (
    select m.game_id, m.player_id, m.team_id,
           case when m.team_id = t.home_id then i.home_skaters else i.away_skaters end as own_sk,
           case when m.team_id = t.home_id then i.away_skaters else i.home_skaters end as opp_sk,
           case when m.team_id = t.home_id then i.home_goalie  else i.away_goalie  end as own_g,
           case when m.team_id = t.home_id then i.away_goalie  else i.home_goalie  end as opp_g,
           least(m.en, i.end_s) - greatest(m.st, i.start_s) as secs,
           t.season
    from merged m
    join public.game_teams t on t.game_id = m.game_id
    join public.game_strength_intervals i
      on i.game_id = m.game_id and i.period = m.period
     and i.start_s < m.en and i.end_s > m.st
  )
  insert into public.player_toi_by_state (game_id, player_id, state, toi_seconds, team_id, season)
  select game_id, player_id,
         case
           when own_g = 0 then 'EN_FOR'
           when opp_g = 0 then 'EN_AGAINST'
           when own_sk =  opp_sk and own_sk = 5 then '5v5'
           when own_sk =  opp_sk and own_sk = 4 then '4v4'
           when own_sk =  opp_sk and own_sk = 3 then '3v3'
           when own_sk >  opp_sk then 'PP'
           when own_sk <  opp_sk then 'PK'
           else 'OTHER'
         end as state,
         sum(secs)::int, min(team_id), min(season)
  from parts
  where secs > 0
  group by 1, 2, 3
  having sum(secs) > 0;

  get diagnostics n = row_count;
  return n;
end;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. COMPATIBILITY
-- ═══════════════════════════════════════════════════════════════════════════
-- player_toi_by_situation keeps its existing three-value contract so
-- calculate_gar_components.py and the freshness matrix keep working unchanged.
-- It is now a projection of player_toi_by_state rather than an independent
-- calculation, so the two can no longer disagree.
--
-- It deliberately does NOT sum to a player's total ice time: 4v4, 3v3 and
-- empty-net time have never been in this table, and adding them now would
-- change the meaning of a column other code already reads. Use
-- player_toi_by_state for anything that needs the whole sheet.
create or replace function public.rebuild_toi_by_situation(p_games integer[])
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  n integer;
begin
  delete from public.player_toi_by_situation where game_id = any(p_games);

  insert into public.player_toi_by_situation
        (player_id, game_id, situation, toi_seconds, season, created_at, updated_at)
  select player_id, game_id, state, toi_seconds, season, now(), now()
  from public.player_toi_by_state
  where game_id = any(p_games) and state in ('5v5', 'PP', 'PK');

  get diagnostics n = row_count;
  return n;
end;
$fn$;

comment on function public.rebuild_toi_by_situation(integer[]) is
  'Project player_toi_by_state down to the legacy three-situation contract. Not a separate calculation -- do not compute this table any other way.';

alter table public.strength_build_state add column if not exists toi_built_at timestamptz;

-- One bounded batch per call. Only games whose shift chart actually reconciled
-- are eligible: a game that failed its own quality check has no business
-- feeding GAR.
create or replace function public.citrus_build_toi_batch(p_batch integer default 100)
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
    select q.game_id
    from public.shift_ingest_quality q
    join public.strength_build_state s using (game_id)
    where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null
    order by q.game_id
    limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_toi_by_state(games);
  perform public.rebuild_toi_by_situation(games);

  update public.strength_build_state set toi_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null);
end;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. THE INVARIANTS
-- ═══════════════════════════════════════════════════════════════════════════
-- Freshness was already watched, and it was already firing. freshness_sla.py
-- covers all three shift tables, the hourly workflow runs, and
-- freshness_player_shifts = warning has gone into integrity_check_results every
-- hour since 4 January 2026 -- forty-two rows in the last forty-eight hours
-- alone. Nobody saw one: WARN routes to Slack through an AlertManager whose
-- webhook is unset, and the workflow correctly refuses to fail on WARN because
-- in the offseason seventeen tables are legitimately stale.
--
-- It would not have mattered. player_shifts was FRESH and WRONG from its first
-- row. A timestamp cannot see a ten-minute shift.
--
-- These are facts about hockey and about arithmetic, checked against stored
-- data. Each would have failed in 2017, and none of them can cry wolf in July
-- -- which is why the workflow that runs them is allowed to fail the build.
create or replace function public.citrus_data_invariants()
returns table(check_name text, status text, measured text, threshold text, detail text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
declare
  cur_season integer;
begin
  select max(game_id / 1000000) into cur_season from public.raw_nhl_data;

  -- 1. A game played more than three days ago with no usable shift chart is a
  --    pipeline that has stopped. This would have fired on 7 January 2026.
  return query
  with late as (
    select r.game_id
    from public.raw_nhl_data r
    left join public.shift_ingest_quality q using (game_id)
    where r.game_id / 1000000 = cur_season
      and r.game_date < current_date - 3
      and (q.game_id is null or q.verdict <> 'good')
  )
  select 'shift_coverage_current_season',
         case when count(*) = 0 then 'pass' else 'fail' end,
         count(*)::text || ' games', '0 games',
         case when count(*) = 0 then 'every game older than three days has a reconciled shift chart'
              else 'oldest without one: ' || coalesce((select min(game_id)::text from late), '-') end
  from late;

  -- 2. The one query that separates a real shift chart (94-99%) from an
  --    inference (4.0%).
  return query
  with o as (select game_id, player_id, sum(duration_seconds)::numeric toi
             from public.player_shifts_official group by 1, 2),
  j as (select o.toi, g.nhl_toi_seconds::numeric truth
        from o join public.player_game_stats g using (game_id, player_id)
        where g.nhl_toi_seconds > 0)
  select 'shift_toi_reconciliation',
         case when count(*) = 0 then 'info'
              when 100.0 * count(*) filter (where abs(toi - truth) <= 30) / count(*) >= 95 then 'pass'
              else 'fail' end,
         case when count(*) = 0 then 'no data'
              else round(100.0 * count(*) filter (where abs(toi - truth) <= 30) / count(*), 2)::text || '%' end,
         '>= 95%',
         count(*)::text || ' player-games checked against nhl_toi_seconds'
  from j;

  -- 3. A shift is thirty to sixty seconds. Anything routinely longer is not a
  --    shift, it is the gap between two things somebody was seen doing.
  return query
  with s as (
    select o.duration_seconds d
    from public.player_shifts_official o
    left join public.player_game_stats g
      on g.game_id = o.game_id and g.player_id = o.player_id
    where coalesce(g.is_goalie, false) = false
  )
  select 'shift_length_sanity',
         case when count(*) = 0 then 'info'
              when 100.0 * count(*) filter (where d > 180) / count(*) < 0.5 then 'pass'
              else 'fail' end,
         case when count(*) = 0 then 'no data'
              else round(100.0 * count(*) filter (where d > 180) / count(*), 3)::text || '% over 180s' end,
         '< 0.5%',
         count(*) filter (where d > 300)::text || ' skater shifts longer than five minutes'
  from s;

  -- 4. Every power play is somebody's penalty kill. Six on the ice with the
  --    advantage, five killing, so the player-second ratio is pinned near 1.20
  --    by the rules of the sport. The inferred table read 0.55.
  return query
  with t as (
    select sum(toi_seconds) filter (where state = 'PP')::numeric pp,
           sum(toi_seconds) filter (where state = 'PK')::numeric pk
    from public.player_toi_by_state
  )
  select 'pp_pk_player_second_ratio',
         case when coalesce(pk, 0) = 0 then 'info'
              when pp / pk between 1.10 and 1.35 then 'pass' else 'fail' end,
         case when coalesce(pk, 0) = 0 then 'no data' else round(pp / pk, 3)::text end,
         '1.10 - 1.35',
         'six on the ice attacking, five killing'
  from t;

  -- 5. A split cannot exceed what it was split from.
  return query
  with st as (select game_id, player_id, sum(toi_seconds)::numeric split
              from public.player_toi_by_state group by 1, 2),
  sh as (select game_id, player_id, sum(duration_seconds)::numeric chart
         from public.player_shifts_official group by 1, 2)
  select 'toi_split_conservation',
         case when count(*) filter (where split > chart) = 0 then 'pass' else 'fail' end,
         count(*) filter (where split > chart)::text || ' player-games',
         '0 player-games',
         'TOI by state must never total more than the shift chart it came from'
  from st join sh using (game_id, player_id);

  -- 6. The timeline must tile each period exactly, and regulation is 1200s.
  return query
  with x as (
    select game_id, period, start_s, end_s,
           lag(end_s) over (partition by game_id, period order by start_s) prev_end
    from public.game_strength_intervals
  ),
  bad as (
    select (select count(*) from x where prev_end is not null and prev_end <> start_s) gaps,
           (select count(*) from (select game_id, period, sum(end_s - start_s) t
                                  from public.game_strength_intervals
                                  where period <= 3 group by 1, 2) z where t <> 1200) short
  )
  select 'strength_timeline_integrity',
         case when gaps + short = 0 then 'pass' else 'fail' end,
         gaps::text || ' discontinuities, ' || short::text || ' bad periods',
         '0 and 0',
         'every period tiled end to end; regulation is exactly 1200s'
  from bad;

  -- 7. The same shift stored twice puts a man on the ice twice at once.
  return query
  with d as (
    select count(*) - 1 extra
    from public.player_shifts_official
    group by game_id, player_id, period, shift_start_time_seconds, shift_end_time_seconds
    having count(*) > 1
  )
  select 'duplicate_shift_intervals',
         case when coalesce(sum(extra), 0) = 0 then 'pass' else 'fail' end,
         coalesce(sum(extra), 0)::text || ' surplus rows',
         '0 surplus rows',
         'identical (game, player, period, start, end) stored more than once'
  from d;

  -- 8. Historical completeness, reported not enforced: a nine-season backfill
  --    is a project, not an alarm.
  return query
  select 'historical_shift_coverage', 'info',
         (select count(*)::text from public.raw_nhl_data r
           where not exists (select 1 from public.shift_ingest_quality q
                             where q.game_id = r.game_id and q.verdict = 'good'))
           || ' of ' || (select count(*)::text from public.raw_nhl_data) || ' games',
         'informational',
         'games with no reconciled shift chart, all seasons';
end;
$fn$;

comment on function public.citrus_data_invariants() is
  'Correctness invariants for the shift / TOI / GAR chain. Each would have failed in 2017. Unlike freshness these cannot cry wolf in the offseason, so a fail should fail the build.';
