-- Compute NHL-style season +/- from our on-ice tracking tables
-- Rules:
-- - Count EV + SH goals only
-- - Exclude PP goals
-- - Exclude empty-net goals
-- - Exclude goalies from +/- entirely

create table if not exists public.player_season_plus_minus (
  season integer not null,
  player_id integer not null,
  plus_minus integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (season, player_id)
);

create index if not exists idx_player_season_plus_minus_season on public.player_season_plus_minus(season);

alter table public.player_season_plus_minus enable row level security;

drop policy if exists "Public can view player season plus minus" on public.player_season_plus_minus;
create policy "Public can view player season plus minus"
on public.player_season_plus_minus
for select
using (true);

-- Refresh function (intended to be run by service/admin tooling)
create or replace function public.refresh_player_season_plus_minus(p_season integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Clear existing season results
  delete from public.player_season_plus_minus where season = p_season;

  with goalies as (
    -- Any player who appears as a goalie in raw_shots is treated as a goalie (excluded from +/-)
    select distinct rs.goalie_id as player_id
    from public.raw_shots rs
    where rs.goalie_id is not null

    union

    select distinct rs.goalie_in_net_id as player_id
    from public.raw_shots rs
    where rs.goalie_in_net_id is not null
  ),
  goals as (
    select
      rs.game_id,
      rs.period,
      -- Period length: regulation=1200s, OT=300s (good enough for regular season fantasy)
      (case when rs.period <= 3 then 1200 else 300 end)::numeric as period_length_seconds,
      ((case when rs.period <= 3 then 1200 else 300 end) - rs.time_remaining_seconds)::numeric as time_elapsed_seconds,

      rs.is_home_team,
      rs.is_power_play,
      rs.is_empty_net,

      rs.home_skaters_on_ice,
      rs.away_skaters_on_ice,

      -- Prefer team IDs already stored on raw_shots; fall back to raw_nhl_data if missing
      coalesce(
        rs.home_team_id,
        (rnd.raw_json -> 'homeTeam' ->> 'id')::integer
      ) as home_team_id_final,
      coalesce(
        rs.away_team_id,
        (rnd.raw_json -> 'awayTeam' ->> 'id')::integer
      ) as away_team_id_final,

      -- Use is_home_team first; if missing, fall back to event_owner_team_id
      case
        when rs.is_home_team is true then coalesce(
          rs.home_team_id,
          (rnd.raw_json -> 'homeTeam' ->> 'id')::integer,
          rs.event_owner_team_id
        )
        when rs.is_home_team is false then coalesce(
          rs.away_team_id,
          (rnd.raw_json -> 'awayTeam' ->> 'id')::integer,
          rs.event_owner_team_id
        )
        else rs.event_owner_team_id
      end as scoring_team_id,

      -- Skater counts for PP detection (null-safe)
      case
        when rs.is_home_team is true then rs.home_skaters_on_ice
        when rs.is_home_team is false then rs.away_skaters_on_ice
        else null
      end as scoring_team_skaters,
      case
        when rs.is_home_team is true then rs.away_skaters_on_ice
        when rs.is_home_team is false then rs.home_skaters_on_ice
        else null
      end as defending_team_skaters
    from public.raw_shots rs
    left join public.raw_nhl_data rnd
      on rnd.game_id = rs.game_id
    where
      rs.is_goal is true
      and coalesce(rs.is_empty_net, false) is false
      and rs.period is not null
      and rs.time_remaining_seconds is not null
      and substring(rs.game_id::text, 1, 4)::integer = p_season
  ),
  eligible_goals as (
    select
      g.*
    from goals g
    where
      -- Exclude PP goals (prefer explicit flag, fall back to skater-count advantage)
      not (
        coalesce(g.is_power_play, false) is true
        or (
          g.scoring_team_skaters is not null
          and g.defending_team_skaters is not null
          and g.scoring_team_skaters > g.defending_team_skaters
        )
      )
  ),
  pm_events as (
    select
      s.player_id,
      case when s.team_id = eg.scoring_team_id then 1 else -1 end as pm
    from eligible_goals eg
    join public.player_shifts s
      on s.game_id = eg.game_id
      and s.period = eg.period
      and s.shift_start_time_seconds <= eg.time_elapsed_seconds
      and coalesce(s.shift_end_time_seconds, eg.period_length_seconds) >= eg.time_elapsed_seconds
    where
      eg.scoring_team_id is not null
      and s.player_id not in (select player_id from goalies)
  )
  insert into public.player_season_plus_minus (season, player_id, plus_minus, computed_at)
  select
    p_season as season,
    player_id,
    sum(pm)::integer as plus_minus,
    now() as computed_at
  from pm_events
  group by player_id;
end;
$$;

-- Don't expose refresh function to anon/authenticated via RPC
revoke all on function public.refresh_player_season_plus_minus(integer) from public;
grant execute on function public.refresh_player_season_plus_minus(integer) to postgres, service_role;


