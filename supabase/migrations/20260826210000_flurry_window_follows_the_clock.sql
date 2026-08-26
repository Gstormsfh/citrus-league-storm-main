-- =====================================================================
-- Citrus Fantasy Sports - 2026-08-26 (second pass)
--
-- The flurry adjustment and the rebound rule were measuring the same thing
-- with two different rulers. rebuild_onice_xg started a new flurry sequence
-- whenever more than THREE seconds had passed since the same team's previous
-- shot -- a literal 3, hardcoded -- while citrus_derive_rebounds_batch had
-- just moved onto the measured per-era window in rebound_window_era.
--
-- That matters because the NHL's goal-event timestamp shift lands exactly on
-- the boundary. Goals sitting at a gap of 4 seconds from the same team's
-- previous shot, regular season, per season:
--
--     old clock 2017-2022    112 goals    12.2 xG
--     new clock 2023-2025    164 goals    24.7 xG
--
-- and the controls do not move. Goals at gap 5: 97, 105, 102, 75, 134, 129 |
-- 94, 97, 107. Non-goals at gap 4: 1877, 1814, 1272, 905, 1743, 1896 | 1897,
-- 1777, 1792. Both flat across the same boundary. Only goals moved, because
-- only goal events were re-stamped.
--
-- So from 2023-24 roughly fifty rebound goals a season were being split out of
-- the scramble that produced them and keeping their full, uncompressed xG.
-- Flurry compression by season, before:
--
--     2017 1.65%  2018 1.56%  2019 1.49%  2020 1.56%  2021 1.50%  2022 1.44%
--     2023 1.34%  2024 1.33%  2025 1.40%
--
-- and after:
--
--     2023 1.39%  2024 1.35%  2025 1.44%
--
-- The step at the era boundary drops from -0.105 points to -0.049, which is
-- the same size as the ordinary year-over-year drift inside the old era.
--
-- The fix is surgical rather than blanket: the window widens to four seconds
-- ONLY for goal events in the new-clock era, because the goal event's clock is
-- the only one that moved. A non-goal shot at a gap of four means the same
-- thing in both eras and stays outside the sequence in both. One source of
-- truth for the boundary: rebound_window_era.
-- =====================================================================

create or replace function public.rebuild_onice_xg(p_games integer[])
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare n integer;
begin
  delete from public.player_onice_xg where game_id = any(p_games);

  with sh as (
    select s.game_id, s.period,
           (split_part(s.time_in_period,':',1))::int*60
             + (split_part(s.time_in_period,':',2))::int as t,
           s.event_owner_team_id as shooting_team,
           coalesce(s.xg_v5, 0)::numeric as xg,
           coalesce(s.is_goal,false) as is_goal,
           case when s.situation_code ~ '^[0-9]{4}$' then s.situation_code end as sc,
           -- the sequence window for THIS event: the measured era window when the
           -- event is a goal (its clock moved), three seconds otherwise
           case when coalesce(s.is_goal,false)
                then public.citrus_rebound_window((s.game_id / 1000000)::integer)
                else 3 end as win
    from public.raw_shots s
    where s.game_id = any(p_games) and s.time_in_period is not null
      and s.period is not null and s.event_owner_team_id is not null
      and coalesce(s.period_type,'REG') <> 'SO'
  ),
  marked as (
    select sh.*,
           case when sh.t - lag(sh.t) over (partition by sh.game_id, sh.period,
                                                         sh.shooting_team order by sh.t) <= sh.win
                then 0 else 1 end as newseq
    from sh
  ),
  seq as (
    select m.*,
           sum(m.newseq) over (partition by m.game_id, m.period, m.shooting_team
                               order by m.t rows unbounded preceding) as fgrp
    from marked m
  ),
  flurried as (
    select z.*,
           case when z.cnt <= 1 or z.tot <= 0 then z.xg
                else z.xg * (z.combined / z.tot) end as xg_fl
    from (
      select s.*,
             count(*)  over w as cnt,
             sum(s.xg) over w as tot,
             -- 1 - prod(1 - xg) computed in logs, clamped so a 0.99 shot
             -- cannot produce ln(0)
             1 - exp(sum(ln(greatest(0.000001, 1 - least(0.999999, s.xg)))) over w) as combined
      from seq s
      window w as (partition by s.game_id, s.period, s.shooting_team, s.fgrp)
    ) z
  ),
  coded as (
    select f.*,
           coalesce(substr(f.sc,1,1)::int, i.away_goalie)  as a_g,
           coalesce(substr(f.sc,2,1)::int, i.away_skaters) as a_sk,
           coalesce(substr(f.sc,3,1)::int, i.home_skaters) as h_sk,
           coalesce(substr(f.sc,4,1)::int, i.home_goalie)  as h_g
    from flurried f left join public.game_strength_intervals i
      on i.game_id = f.game_id and i.period = f.period
     and i.start_s <= f.t and i.end_s > f.t
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period, min(st) as st, max(en) as en
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
        where game_id = any(p_games) and shift_end_time_seconds > shift_start_time_seconds
      ) a
    ) b group by game_id, player_id, period, g
  ),
  onice as (
    select c.*, m.player_id, m.team_id, (m.team_id = c.shooting_team) as is_for,
           case when m.team_id = t.home_id then c.h_sk else c.a_sk end as own_sk,
           case when m.team_id = t.home_id then c.a_sk else c.h_sk end as opp_sk,
           case when m.team_id = t.home_id then c.h_g  else c.a_g  end as own_g,
           case when m.team_id = t.home_id then c.a_g  else c.h_g  end as opp_g,
           t.season
    from coded c
    join merged m on m.game_id = c.game_id and m.period = c.period
                 and m.st < c.t and m.en >= c.t
    join public.game_teams t on t.game_id = c.game_id
    where c.a_sk is not null and c.h_sk is not null
  )
  insert into public.player_onice_xg
        (game_id, player_id, state, xgf, xga, xgf_flurry, xga_flurry, cf, ca, gf, ga, team_id, season)
  select game_id, player_id,
         case when own_g = 0 then 'EN_FOR' when opp_g = 0 then 'EN_AGAINST'
              when own_sk = opp_sk and own_sk = 5 then '5v5'
              when own_sk = opp_sk and own_sk = 4 then '4v4'
              when own_sk = opp_sk and own_sk = 3 then '3v3'
              when own_sk > opp_sk then 'PP' when own_sk < opp_sk then 'PK'
              else 'OTHER' end,
         coalesce(sum(xg)    filter (where is_for), 0),
         coalesce(sum(xg)    filter (where not is_for), 0),
         coalesce(sum(xg_fl) filter (where is_for), 0),
         coalesce(sum(xg_fl) filter (where not is_for), 0),
         count(*) filter (where is_for), count(*) filter (where not is_for),
         count(*) filter (where is_for and is_goal), count(*) filter (where not is_for and is_goal),
         min(team_id), min(season)
  from onice group by 1,2,3;

  get diagnostics n = row_count;
  return n;
end;
$fn$;


-- Guards the thing that actually went wrong, not its downstream shadow.
--
-- If the flurry window is right for an era, the goals sitting just OUTSIDE it
-- should be a small and comparable share of the goals sitting inside it. When
-- the NHL re-stamped goal events and the window did not follow, that share
-- jumped: 16.1% in the new-clock era against 10.8% in the old one.
--
-- Measuring the compression rate instead would be a weaker test - it drifts
-- slowly for real reasons (play spreading out year over year), so a clock
-- problem hides inside the trend. This measures the boundary directly.

create or replace function public.citrus_flurry_invariant()
returns table(check_name text, status text, measured text, threshold text, detail text)
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $fn$
declare v_ratio numeric; v_old numeric; v_new numeric;
begin
  select sum(xgf_flurry) / nullif(sum(xgf), 0) into v_ratio from public.player_onice_xg;

  return query select
    'flurry_adjustment_applied'::text,
    case when v_ratio is null then 'warn'
         when v_ratio between 0.90 and 0.995 then 'pass' else 'fail' end::text,
    'adjusted / raw = ' || round(coalesce(v_ratio, 0), 4)::text,
    '0.90 - 0.995, and never above raw'::text,
    'The flurry adjustment removes the double-count inside a scramble, so the adjusted total is always a little below the raw one. Equal to it means the columns are copies again, which is what they were until 2026-08-26.'::text;

  with sh as (
    select (s.game_id / 1000000)::int as season, s.game_id, s.period,
           s.event_owner_team_id as tm, coalesce(s.is_goal, false) as is_goal,
           (split_part(s.time_in_period,':',1))::int * 60
             + (split_part(s.time_in_period,':',2))::int as t
    from public.raw_shots s
    where s.game_id >= 2017020001 and ((s.game_id / 10000) % 100) = 2
      and s.time_in_period is not null and s.period is not null
      and s.event_owner_team_id is not null
      and coalesce(s.period_type,'REG') <> 'SO'
  ),
  g as (
    select season, is_goal,
           public.citrus_rebound_window(season) as win,
           t - lag(t) over (partition by game_id, period, tm order by t) as gap
    from sh
  )
  select round(100.0 * count(*) filter (where gap = win + 1)
               / nullif(count(*) filter (where gap between 0 and win), 0), 2)
    into v_old
  from g where is_goal and gap is not null and season <= 2022;

  with sh as (
    select (s.game_id / 1000000)::int as season, s.game_id, s.period,
           s.event_owner_team_id as tm, coalesce(s.is_goal, false) as is_goal,
           (split_part(s.time_in_period,':',1))::int * 60
             + (split_part(s.time_in_period,':',2))::int as t
    from public.raw_shots s
    where s.game_id >= 2017020001 and ((s.game_id / 10000) % 100) = 2
      and s.time_in_period is not null and s.period is not null
      and s.event_owner_team_id is not null
      and coalesce(s.period_type,'REG') <> 'SO'
  ),
  g as (
    select season, is_goal,
           public.citrus_rebound_window(season) as win,
           t - lag(t) over (partition by game_id, period, tm order by t) as gap
    from sh
  )
  select round(100.0 * count(*) filter (where gap = win + 1)
               / nullif(count(*) filter (where gap between 0 and win), 0), 2)
    into v_new
  from g where is_goal and gap is not null and season >= 2023;

  return query select
    'flurry_window_matches_the_clock'::text,
    case when v_old is null or v_new is null then 'warn'
         when abs(v_new - v_old) <= 4.0 then 'pass'
         when abs(v_new - v_old) <= 6.0 then 'warn' else 'fail' end::text,
    'goals just outside the window: ' || v_old::text || '% old clock, '
      || v_new::text || '% new clock (gap ' || round(abs(v_new - v_old), 2)::text || ' pts)',
    'under 4 points apart'::text,
    'rebuild_onice_xg and citrus_derive_rebounds_batch must read the same boundary out of rebound_window_era. When the flurry window was hardcoded to 3 and the NHL re-stamped goal events, this read 16.1% against 10.8% - about fifty rebound goals a season keeping xG the scramble had already spent.'::text;
end;
$fn$;
