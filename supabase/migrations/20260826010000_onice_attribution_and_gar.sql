-- ─────────────────────────────────────────────────────────────────────────────
-- On-ice attribution, penalty events, and the five real GAR components.
--
-- Follows 20260825235000 (shift charts + strength timeline) and 20260826000000
-- (TOI by state + invariants). This is the layer that turns those into
-- something a fantasy user sees.
--
-- WHAT WAS THERE BEFORE
--   calculate_gar_components.py, 512 lines, produced two numbers. Its docstring
--   said why: "we'll use shooter's xG as a proxy for on-ice xGF. TODO: Enhance
--   with full on-ice tracking when shifts are available." Shifts were never
--   available, so the proxy stayed and three components stayed as literals:
--       component_rates['evd_rate_raw'] = 0.0
--       component_rates['ppd_rate_raw'] = 0.0
--       component_rates['penalty_component_raw'] = 0.0
--   Shooter-only xG scores every playmaker and every defenceman near zero.
--
-- WHAT IT LOOKS LIKE NOW, MEASURED ON 263 GAMES
--   players credited per goal          5.91   (five skaters and a goalie)
--   5v5 goals per 60 per team          2.479  (league is about 2.5)
--   power-play goals per 60            7.120  (league is about 7.3)
--   short-handed goals per 60          0.733
--   5v5 xGF vs xGA summed league-wide  0.021% apart
--   empty-net shooting percentage      53.2
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. WHAT HAPPENED WHILE A MAN WAS ON THE ICE
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.player_onice_xg (
  game_id     integer not null,
  player_id   integer not null,
  state       text    not null,
  xgf         numeric(9,4) not null default 0,
  xga         numeric(9,4) not null default 0,
  xgf_flurry  numeric(9,4) not null default 0,
  xga_flurry  numeric(9,4) not null default 0,
  cf          integer not null default 0,
  ca          integer not null default 0,
  gf          integer not null default 0,
  ga          integer not null default 0,
  team_id     integer,
  season      integer not null,
  built_at    timestamptz not null default now(),
  primary key (game_id, player_id, state)
);

create index if not exists poxg_player_season on public.player_onice_xg (player_id, season);
create index if not exists poxg_state on public.player_onice_xg (state);

comment on table public.player_onice_xg is
  'Shot events attributed to every player who was on the ice for them, split by strength state. Pair with player_toi_by_state for per-60 rates.';

-- THE BOUNDARY RULE, SETTLED BY MEASUREMENT
--   A player was on the ice for an event at t when  st < t  and  en >= t:
--   he was on before it happened and had not left when it did.
--
--   The obvious rule (st <= t < en) agrees with the NHL's own situationCode on
--   99.7% of non-goals but only 76.0% of GOALS, because the shift chart ends
--   every shift on the ice at the moment the puck goes in. The closed interval
--   is far worse -- 3.6%, averaging 19.22 players -- because the chart also
--   starts the next line at that same second and both lines get counted.
--   The rule above: 99.6% on non-goals, 99.5% on goals, 11.61 players against
--   an expected 11.61, with no special case for goals at all.
--
--   The visible symptom of getting it wrong was 40 overtime goals across 69
--   overtime games attributed to nobody, because a game-ending goal is by
--   definition the second every shift in that period ends.
--
-- STRENGTH COMES FROM THE EVENT, NOT THE TIMELINE
--   game_strength_intervals collapses runs of situationCode and keeps the last
--   code of any shared second -- correct for dividing up time, because
--   everything before it occupies zero seconds. But a power-play goal and the
--   faceoff after it share a second, and that faceoff already reads 5v5 because
--   the penalty ended on the goal. Looking a goal up in the timeline therefore
--   found even strength: 45 power-play goals across 263 games where the feed
--   itself says 545 goals came at unequal strength, power plays converting at
--   1.4% and penalty kills at 7.7%. The sport upside down.
--   Every shot carries its own situationCode. Use it; fall back to the timeline
--   only when it is missing.
create or replace function public.rebuild_onice_xg(p_games integer[])
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  n integer;
begin
  delete from public.player_onice_xg where game_id = any(p_games);

  with sh as (
    select s.game_id, s.period,
           (split_part(s.time_in_period, ':', 1))::int * 60
             + (split_part(s.time_in_period, ':', 2))::int as t,
           s.event_owner_team_id as shooting_team,
           coalesce(s.xg_value, 0)::numeric                        as xg,
           coalesce(s.flurry_adjusted_xg, s.xg_value, 0)::numeric  as xgfl,
           coalesce(s.is_goal, false)                              as is_goal,
           case when s.situation_code ~ '^[0-9]{4}$' then s.situation_code end as sc
    from public.raw_shots s
    where s.game_id = any(p_games)
      and s.time_in_period is not null
      and s.period is not null
      and s.event_owner_team_id is not null
      -- a shootout attempt did not happen on the ice
      and coalesce(s.period_type, 'REG') <> 'SO'
  ),
  coded as (
    select sh.*,
           coalesce(substr(sh.sc,1,1)::int, i.away_goalie)  as a_g,
           coalesce(substr(sh.sc,2,1)::int, i.away_skaters) as a_sk,
           coalesce(substr(sh.sc,3,1)::int, i.home_skaters) as h_sk,
           coalesce(substr(sh.sc,4,1)::int, i.home_goalie)  as h_g
    from sh
    left join public.game_strength_intervals i
      on i.game_id = sh.game_id and i.period = sh.period
     and i.start_s <= sh.t and i.end_s > sh.t
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period,
           min(st) as st, max(en) as en
    from (
      select *, sum(newgrp) over (partition by game_id, player_id, period
                                  order by st, en rows unbounded preceding) as g
      from (
        select game_id, player_id, team_id, period,
               shift_start_time_seconds as st, shift_end_time_seconds as en,
               case when shift_start_time_seconds > max(shift_end_time_seconds) over (
                      partition by game_id, player_id, period
                      order by shift_start_time_seconds, shift_end_time_seconds
                      rows between unbounded preceding and 1 preceding)
                    then 1 else 0 end as newgrp
        from public.player_shifts_official
        where game_id = any(p_games)
          and shift_end_time_seconds > shift_start_time_seconds
      ) a
    ) b
    group by game_id, player_id, period, g
  ),
  onice as (
    select c.*, m.player_id, m.team_id,
           (m.team_id = c.shooting_team) as is_for,
           case when m.team_id = t.home_id then c.h_sk else c.a_sk end as own_sk,
           case when m.team_id = t.home_id then c.a_sk else c.h_sk end as opp_sk,
           case when m.team_id = t.home_id then c.h_g  else c.a_g  end as own_g,
           case when m.team_id = t.home_id then c.a_g  else c.h_g  end as opp_g,
           t.season
    from coded c
    join merged m
      on m.game_id = c.game_id and m.period = c.period
     and m.st < c.t and m.en >= c.t
    join public.game_teams t on t.game_id = c.game_id
    where c.a_sk is not null and c.h_sk is not null
  )
  insert into public.player_onice_xg
        (game_id, player_id, state, xgf, xga, xgf_flurry, xga_flurry, cf, ca, gf, ga, team_id, season)
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
         coalesce(sum(xg)   filter (where is_for), 0),
         coalesce(sum(xg)   filter (where not is_for), 0),
         coalesce(sum(xgfl) filter (where is_for), 0),
         coalesce(sum(xgfl) filter (where not is_for), 0),
         count(*) filter (where is_for),
         count(*) filter (where not is_for),
         count(*) filter (where is_for and is_goal),
         count(*) filter (where not is_for and is_goal),
         min(team_id), min(season)
  from onice
  group by 1, 2, 3;

  get diagnostics n = row_count;
  return n;
end;
$fn$;

alter table public.strength_build_state add column if not exists onice_built_at timestamptz;

create or replace function public.citrus_build_onice_batch(p_batch integer default 100)
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
    select q.game_id from public.shift_ingest_quality q
    join public.strength_build_state s using (game_id)
    where q.verdict = 'good' and s.built_at is not null and s.onice_built_at is null
    order by q.game_id limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_onice_xg(games);
  update public.strength_build_state set onice_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.onice_built_at is null);
end;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. PENALTIES — THE FIFTH COMPONENT
-- ═══════════════════════════════════════════════════════════════════════════
-- Also a literal zero:  component_rates['penalty_component_raw'] = 0.0
--
-- The events were there the whole time. Every penalty in the play-by-play
-- carries who committed it, who drew it, how long and what class, for all
-- 11,870 stored games back to 2017-18. 87,836 of them, seven to eight per game,
-- ninety percent minors. No network needed.
--
-- Drawing penalties is a real repeatable skill and taking them is a real cost.
-- A GAR number that ignores it is missing one of the few components that
-- separates otherwise similar players.
create table if not exists public.player_penalty_events (
  game_id      integer  not null,
  event_id     integer  not null,
  period       smallint not null,
  period_s     smallint not null,
  committed_by integer,
  drawn_by     integer,
  duration_min smallint,
  type_code    text,
  desc_key     text,
  team_id      integer,
  season       integer  not null,
  primary key (game_id, event_id)
);

create index if not exists ppe_committed on public.player_penalty_events (committed_by, season);
create index if not exists ppe_drawn on public.player_penalty_events (drawn_by, season);

comment on table public.player_penalty_events is
  'One row per penalty from raw_nhl_data play-by-play. team_id is the event owner, which for a penalty is the team that committed it.';

create or replace function public.rebuild_penalty_events(p_games integer[])
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  n integer;
begin
  delete from public.player_penalty_events where game_id = any(p_games);

  insert into public.player_penalty_events
    (game_id, event_id, period, period_s, committed_by, drawn_by,
     duration_min, type_code, desc_key, team_id, season)
  select r.game_id,
         (p->>'eventId')::int,
         (p->'periodDescriptor'->>'number')::int,
         least(1200, (split_part(p->>'timeInPeriod', ':', 1))::int * 60
                   + (split_part(p->>'timeInPeriod', ':', 2))::int),
         nullif(p->'details'->>'committedByPlayerId', '')::int,
         nullif(p->'details'->>'drawnByPlayerId', '')::int,
         nullif(p->'details'->>'duration', '')::int,
         p->'details'->>'typeCode',
         p->'details'->>'descKey',
         nullif(p->'details'->>'eventOwnerTeamId', '')::int,
         r.game_id / 1000000
  from public.raw_nhl_data r,
       lateral jsonb_array_elements(r.raw_json->'plays') p
  where r.game_id = any(p_games)
    and p->>'typeDescKey' = 'penalty'
    and p->>'eventId' is not null
    and p->>'timeInPeriod' is not null
    and p->'periodDescriptor'->>'number' is not null
  on conflict (game_id, event_id) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$fn$;

alter table public.strength_build_state add column if not exists penalties_built_at timestamptz;

create or replace function public.citrus_build_penalties_batch(p_batch integer default 500)
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
    select r.game_id from public.raw_nhl_data r
    left join public.strength_build_state s using (game_id)
    where s.penalties_built_at is null
    order by r.game_id limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_penalty_events(games);

  insert into public.strength_build_state (game_id, penalties_built_at)
  select g, now() from unnest(games) g
  on conflict (game_id) do update set penalties_built_at = excluded.penalties_built_at;

  return query
    select cardinality(games),
           (select count(*) from public.raw_nhl_data r
             left join public.strength_build_state s using (game_id)
            where s.penalties_built_at is null);
end;
$fn$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. THE FIVE COMPONENTS
-- ═══════════════════════════════════════════════════════════════════════════
--   EVO  on-ice xGF per 60 at 5v5      -- what the team creates with him out there
--   EVD  on-ice xGA per 60 at 5v5      -- what it concedes; lower is better
--   PPO  on-ice xGF per 60 on the PP
--   PPD  on-ice xGA per 60 on the PK
--   PEN  minor penalties drawn minus taken, per 60 of all ice
--
-- Only minors count toward PEN. A fighting major is not a skill signal and a
-- ten-minute misconduct costs a team nothing on the ice.
--
-- Rates use flurry-adjusted xG by default -- one scramble in front should not
-- pay six separate dividends -- with the unadjusted figures beside them so the
-- choice can be audited rather than trusted.
--
-- KNOWN DEFECT, INHERITED: for season 2025 the xG model totals 0.786 of actual
-- goals, against 0.96-1.03 in every prior season. Every rate below is about a
-- fifth light for that season. It is upstream in raw_shots, not here, and
-- citrus_model_invariants() fails on it by design.
create or replace view public.player_gar_inputs as
with toi as (
  select player_id, season,
         sum(toi_seconds) filter (where state = '5v5') as s_5v5,
         sum(toi_seconds) filter (where state = 'PP')  as s_pp,
         sum(toi_seconds) filter (where state = 'PK')  as s_pk,
         sum(toi_seconds)                              as s_all,
         count(distinct game_id)                       as games
  from public.player_toi_by_state
  group by 1, 2
),
onice as (
  select player_id, season,
         sum(xgf_flurry) filter (where state = '5v5') as xgf_5v5,
         sum(xga_flurry) filter (where state = '5v5') as xga_5v5,
         sum(xgf_flurry) filter (where state = 'PP')  as xgf_pp,
         sum(xga_flurry) filter (where state = 'PK')  as xga_pk,
         sum(xgf)        filter (where state = '5v5') as xgf_5v5_unadj,
         sum(xga)        filter (where state = '5v5') as xga_5v5_unadj,
         sum(gf)         filter (where state = '5v5') as gf_5v5,
         sum(ga)         filter (where state = '5v5') as ga_5v5
  from public.player_onice_xg
  group by 1, 2
),
pen as (
  select player_id, season, sum(taken) as taken, sum(drawn) as drawn
  from (
    select committed_by as player_id, season, 1 as taken, 0 as drawn
    from public.player_penalty_events where duration_min = 2 and committed_by is not null
    union all
    select drawn_by, season, 0, 1
    from public.player_penalty_events where duration_min = 2 and drawn_by is not null
  ) z
  group by 1, 2
)
select
  t.player_id, t.season, t.games,
  round(t.s_5v5 / 60.0, 2)             as toi_5v5_minutes,
  round(coalesce(t.s_pp, 0) / 60.0, 2) as toi_pp_minutes,
  round(coalesce(t.s_pk, 0) / 60.0, 2) as toi_pk_minutes,
  round(t.s_all / 60.0, 2)             as toi_total_minutes,
  round((o.xgf_5v5 * 3600.0 / nullif(t.s_5v5, 0))::numeric, 4) as evo_xgf60,
  round((o.xga_5v5 * 3600.0 / nullif(t.s_5v5, 0))::numeric, 4) as evd_xga60,
  round((o.xgf_pp  * 3600.0 / nullif(t.s_pp,  0))::numeric, 4) as ppo_xgf60,
  round((o.xga_pk  * 3600.0 / nullif(t.s_pk,  0))::numeric, 4) as ppd_xga60,
  round(((coalesce(p.drawn, 0) - coalesce(p.taken, 0)) * 3600.0
         / nullif(t.s_all, 0))::numeric, 4)                    as pen_net60,
  coalesce(p.drawn, 0) as minors_drawn,
  coalesce(p.taken, 0) as minors_taken,
  round((o.xgf_5v5_unadj * 3600.0 / nullif(t.s_5v5, 0))::numeric, 4) as evo_xgf60_unadj,
  round((o.xga_5v5_unadj * 3600.0 / nullif(t.s_5v5, 0))::numeric, 4) as evd_xga60_unadj,
  o.gf_5v5, o.ga_5v5
from toi t
left join onice o using (player_id, season)
left join pen   p using (player_id, season)
where t.s_5v5 > 0;

comment on view public.player_gar_inputs is
  'Per player-season inputs for GAR: TOI by state, on-ice xGF/xGA per 60 in each state, and minor penalties drawn minus taken per 60. Replaces the shooter-proxy and the three hardcoded zeros in calculate_gar_components.py.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. INVARIANTS FOR THIS LAYER
-- ═══════════════════════════════════════════════════════════════════════════
-- Companion to citrus_data_invariants(). Same principle: facts about hockey,
-- not about timestamps. Every one of these would have caught a real defect
-- found while building this migration.
create or replace function public.citrus_model_invariants()
returns table(check_name text, status text, measured text, threshold text, detail text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
begin
  -- Six players are on the ice for a goal: five skaters and a goalie, fewer
  -- only when the net is empty. Well under six means goals landing on nobody.
  return query
  with a as (select sum(gf)::numeric g from public.player_onice_xg),
  r as (select count(*)::numeric g from public.raw_shots s
        join public.shift_ingest_quality q using (game_id)
        where q.verdict = 'good' and s.is_goal and coalesce(s.period_type,'REG') <> 'SO')
  select 'goal_attribution_completeness',
         case when r.g = 0 then 'info'
              when a.g / r.g between 5.5 and 6.05 then 'pass' else 'fail' end,
         case when r.g = 0 then 'no data' else round(a.g / r.g, 2)::text || ' players per goal' end,
         '5.50 - 6.05',
         'five skaters and a goalie, fewer with the net empty'
  from a, r;

  -- A power play scores about seven per sixty minutes of power play, a kill
  -- about three quarters of one. Near each other means strength is being read
  -- off the wrong event.
  return query
  with x as (
    select sum(o.gf) filter (where o.state = 'PP')::numeric pp_g,
           sum(o.gf) filter (where o.state = 'PK')::numeric pk_g
    from public.player_onice_xg o
  ),
  t as (
    select sum(toi_seconds) filter (where state = 'PP')::numeric pp_s,
           sum(toi_seconds) filter (where state = 'PK')::numeric pk_s
    from public.player_toi_by_state
  )
  select 'special_teams_goal_rates',
         case when coalesce(t.pp_s, 0) = 0 then 'info'
              when x.pp_g * 3600 / t.pp_s between 5.5 and 9.0
               and x.pk_g * 3600 / nullif(t.pk_s, 0) between 0.3 and 1.6 then 'pass'
              else 'fail' end,
         case when coalesce(t.pp_s, 0) = 0 then 'no data'
              else round(x.pp_g * 3600 / t.pp_s, 2)::text || ' PP, '
                || round(x.pk_g * 3600 / nullif(t.pk_s, 0), 2)::text || ' SH' end,
         'PP 5.5-9.0, SH 0.3-1.6',
         'goals per 60 minutes of that state'
  from x, t;

  -- At even strength both benches have the same number out there, so what one
  -- side generates the other concedes. Any gap is an attribution leak.
  return query
  with s as (select sum(xgf_flurry)::numeric f, sum(xga_flurry)::numeric a
             from public.player_onice_xg where state = '5v5')
  select 'even_strength_symmetry',
         case when coalesce(a, 0) = 0 then 'info'
              when abs(f - a) / greatest(f, a) < 0.01 then 'pass' else 'fail' end,
         case when coalesce(a, 0) = 0 then 'no data'
              else round(100 * abs(f - a) / greatest(f, a), 3)::text || '% apart' end,
         '< 1%',
         '5v5 xGF summed over everyone must equal 5v5 xGA summed over everyone'
  from s;

  -- An expected-goals model that does not add up to the goals that happened is
  -- not calibrated. Eight of nine seasons sit between 0.96 and 1.03; 2025-26
  -- sits at 0.786 and every rate built on it is a fifth light.
  return query
  with s as (
    select season, sum(xg_value)::numeric xg, count(*) filter (where is_goal)::numeric g
    from public.raw_shots
    where coalesce(period_type, 'REG') <> 'SO'
    group by 1
  ),
  bad as (select count(*) n, min(season) worst from s where g > 0 and (xg / g < 0.90 or xg / g > 1.10))
  select 'xg_model_calibration',
         case when (select count(*) from s) = 0 then 'info'
              when bad.n = 0 then 'pass' else 'fail' end,
         bad.n::text || ' seasons outside 0.90-1.10',
         '0 seasons',
         case when bad.n = 0 then 'total expected goals tracks total goals in every season'
              else 'first offending season: ' || bad.worst::text || ' at '
                   || (select round(xg / g, 3)::text from s where s.season = bad.worst) end
  from bad;
end;
$fn$;

comment on function public.citrus_model_invariants() is
  'Correctness invariants for the shot, xG and on-ice attribution layer. Companion to citrus_data_invariants().';
