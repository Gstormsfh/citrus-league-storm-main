CREATE OR REPLACE FUNCTION public.rebuild_onice_xg(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
