CREATE OR REPLACE FUNCTION public.rebuild_goalie_gsax_primary(p_season integer DEFAULT NULL::integer)
 RETURNS TABLE(o_metric text, o_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_season int; r bigint; v_svpct numeric;
begin
  v_season := coalesce(p_season, (select max(season) from goalie_xg_season where game_type='regular'));

  select round((1 - sum(goals_allowed)::numeric / nullif(sum(sog_faced),0))::numeric, 4)
    into v_svpct
    from goalie_xg_season where season = v_season and game_type = 'regular';

  delete from goalie_gsax_primary;
  insert into goalie_gsax_primary
    (goalie_id, total_shots_faced, total_xga, total_ga, raw_gsax, regressed_gsax,
     league_sv_pct, calculated_at, updated_at, season)
  select g.goalie_id,
         sum(g.shots_faced)::int,
         round(sum(g.xg_faced)::numeric, 4),
         sum(g.goals_allowed)::int,
         round(sum(g.gsax)::numeric, 4),
         round((sum(g.gsax) * sum(g.shots_faced) / (sum(g.shots_faced) + 500.0))::numeric, 4),
         v_svpct, now(), now(), v_season
  from goalie_xg_season g
  where g.season = v_season and g.game_type = 'regular'
  group by g.goalie_id;
  get diagnostics r = row_count;
  o_metric := 'goalies_written'; o_count := r; return next;

  -- behavioural gate: the rebuilt table must reconcile to its source
  select count(*) into r from (
    select p.goalie_id
      from goalie_gsax_primary p
      join (select goalie_id, sum(goals_allowed) ga, sum(shots_faced) sf
              from goalie_xg_season where season = v_season and game_type='regular'
             group by goalie_id) s using (goalie_id)
     where p.total_ga <> s.ga or p.total_shots_faced <> s.sf) z;
  o_metric := 'rows_disagreeing_with_source'; o_count := r; return next;

  o_metric := 'season'; o_count := v_season; return next;
end $function$
