CREATE OR REPLACE FUNCTION public.refresh_xg_season_layer(p_season integer)
 RETURNS TABLE(o_layer text, o_rows bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r bigint;
begin
  drop table if exists _sides;
  create temp table _sides on commit drop as
  select g.game_id,
         max(g.team_id) filter (where g.is_home)     as home_team,
         max(g.team_id) filter (where not g.is_home) as away_team
  from nhl_shots g where g.season = p_season group by g.game_id;

  delete from player_xg_season where season = p_season;
  insert into player_xg_season
  select s.season, s.game_type, s.shooter_id, s.team_id,
    count(*), count(*) filter (where s.event_type in ('shot-on-goal','goal')), count(*) filter (where s.is_goal),
    sum(s.xg_sql), sum(s.is_goal::int) - sum(s.xg_sql),
    count(*) filter (where not s.is_power_play and not s.is_shorthanded and not s.is_empty_net),
    count(*) filter (where s.is_power_play), count(*) filter (where s.is_shorthanded),
    count(*) filter (where s.is_goal and not s.is_power_play and not s.is_shorthanded),
    count(*) filter (where s.is_goal and s.is_power_play),
    count(*) filter (where s.is_goal and s.is_shorthanded),
    coalesce(sum(s.xg_sql) filter (where not s.is_power_play and not s.is_shorthanded and not s.is_empty_net),0),
    coalesce(sum(s.xg_sql) filter (where s.is_power_play),0),
    coalesce(sum(s.xg_sql) filter (where s.is_shorthanded),0),
    count(*) filter (where s.is_goal and s.is_empty_net),
    coalesce(sum(s.xg_sql) filter (where s.is_empty_net),0),
    avg(s.distance_adj), avg(s.xg_sql),
    count(*) filter (where s.prev_event_type in ('shot-on-goal','missed-shot','blocked-shot') and s.seconds_since_prev <= 3),
    count(*) filter (where s.is_rush), now()
  from nhl_shots s
  where s.season = p_season and s.xg_sql is not null and s.shooter_id is not null
  group by 1,2,3,4;
  get diagnostics r = row_count; o_layer := 'player_xg_season'; o_rows := r; return next;

  delete from goalie_xg_season where season = p_season;
  insert into goalie_xg_season
  select s.season, s.game_type, s.goalie_id,
    max(case when s.is_home then a.away_team else a.home_team end),
    count(*), count(*) filter (where s.event_type in ('shot-on-goal','goal')), count(*) filter (where s.is_goal),
    sum(s.xg_sql), sum(s.xg_sql) - sum(s.is_goal::int),
    coalesce(sum(s.xg_sql) filter (where not s.is_power_play and not s.is_shorthanded),0),
    count(*) filter (where s.is_goal and not s.is_power_play and not s.is_shorthanded),
    coalesce(sum(s.xg_sql) filter (where s.is_power_play),0),
    count(*) filter (where s.is_goal and s.is_power_play),
    avg(s.distance_adj), now()
  from nhl_shots s join _sides a on a.game_id = s.game_id
  where s.season = p_season and s.xg_sql is not null and s.goalie_id is not null and not s.is_empty_net
  group by 1,2,3;
  get diagnostics r = row_count; o_layer := 'goalie_xg_season'; o_rows := r; return next;

  delete from team_xg_season where season = p_season;
  insert into team_xg_season
  select season, game_type, team_id, sum(sf), sum(gf), sum(xf), sum(sa), sum(ga), sum(xa), now()
  from (
    select s.season, s.game_type, s.team_id, count(*) sf, count(*) filter (where s.is_goal) gf, sum(s.xg_sql) xf,
           0 sa, 0 ga, 0::double precision xa
    from nhl_shots s where s.season = p_season and s.xg_sql is not null group by 1,2,3
    union all
    select s.season, s.game_type, case when s.is_home then a.away_team else a.home_team end,
           0,0,0::double precision, count(*), count(*) filter (where s.is_goal), sum(s.xg_sql)
    from nhl_shots s join _sides a on a.game_id = s.game_id
    where s.season = p_season and s.xg_sql is not null group by 1,2,3
  ) u where team_id is not null group by 1,2,3;
  get diagnostics r = row_count; o_layer := 'team_xg_season'; o_rows := r; return next;
end $function$
