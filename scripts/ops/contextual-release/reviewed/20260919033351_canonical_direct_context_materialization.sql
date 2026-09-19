-- Write reviewed contextual skaters once. Previously a flat row was inserted,
-- deleted and replaced within this same transaction. Keep ROS, goalie paths,
-- source validation, write guards and all final numerical expressions intact.
DO $preflight$
BEGIN
 IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.canonical_materialize_projection_run(uuid)'::regprocedure)
    IS DISTINCT FROM 'citrus_canonical_projection_writer'
 OR has_schema_privilege('citrus_canonical_projection_writer','public','CREATE') THEN
  RAISE EXCEPTION 'Protected materializer boundary changed';
 END IF;
END $preflight$;
GRANT citrus_canonical_projection_writer TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA public TO citrus_canonical_projection_writer;
SET LOCAL ROLE citrus_canonical_projection_writer;
DO $migration$
DECLARE body text; start_at integer; end_at integer;
 marker text:=' AND payload->>''status''=''projected'') INSERT INTO public.player_projected_stats';
BEGIN
 IF has_function_privilege('anon','canonical_materialize_projection_run(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','canonical_materialize_projection_run(uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','canonical_materialize_projection_run(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Worker-only materializer required';
 END IF;
 SELECT pg_get_functiondef('canonical_materialize_projection_run(uuid)'::regprocedure) INTO STRICT body;
 start_at:=position('IF r.payload ? ''daily_context'' THEN' IN body);
 end_at:=position('RETURN jsonb_build_object(''run_id'',r.id,''revision'',r.revision,''ros_rows'',n_ros,''daily_rows'',n_daily);' IN body);
 IF start_at=0 OR end_at<=start_at OR position('canonical_validate_daily_context(p_run_id)' IN body)=0
 OR (length(body)-length(replace(body,marker,'')))/length(marker)<>1
 OR (length(body)-length(replace(body,'n_daily integer;','')))/length('n_daily integer;')<>1 THEN
  RAISE EXCEPTION 'Context materializer shape changed';
 END IF;
 body:=left(body,start_at-1)||$direct$
IF r.payload ? 'daily_context' THEN
 WITH projection_input AS MATERIALIZED (
  SELECT payload||'{}'::jsonb p,
   coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric) gp,
   public.canonical_default_points(payload->'counts',(payload->>'is_goalie')::boolean) default_points,
   (SELECT count(*)::numeric FROM public.nhl_games s WHERE s.season=r.season
    AND s.game_type='regular' AND s.game_date>=current_date
    AND (s.home_team=payload->>'team' OR s.away_team=payload->>'team')) n
  FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'status'='projected'
   AND (payload->>'is_goalie')::boolean=false
 )
 INSERT INTO public.player_projected_stats(
  projection_run_id,projection_revision,player_id,season,game_id,projection_date,is_goalie,
  projected_gp,projected_goals,projected_assists,projected_sog,projected_blocks,
  projected_ppp,projected_shp,projected_hits,projected_pim,projected_plus_minus,
  projected_wins,projected_saves,projected_shutouts,projected_goals_against,
  total_projected_points,base_ppg,calculation_method,is_home_game,opponent_abbrev,
  opponent_team_id,created_at,updated_at,opponent_adjustment,
  projection_mean,projection_std_dev,projection_ci_lower,projection_ci_upper,
  projection_ci_50_lower,projection_ci_50_upper,projection_median,projection_skewness,
  upside_probability,floor_probability,dynamic_confidence,likely_low,likely_high,confidence_label)
 SELECT r.id,r.revision,(p->>'player_id')::integer,r.season,g.game_id,g.game_date,false,
  (x->>'projected_gp')::numeric,(x#>>'{counts,goals}')::numeric,(x#>>'{counts,assists}')::numeric,
  (x#>>'{counts,shots_on_goal}')::numeric,(x#>>'{counts,blocks}')::numeric,
  (x#>>'{counts,power_play_points}')::numeric,(x#>>'{counts,short_handed_points}')::numeric,
  (x#>>'{counts,hits}')::numeric,(x#>>'{counts,penalty_minutes}')::numeric,(x#>>'{counts,plus_minus}')::numeric,
  coalesce((p#>>'{counts,wins}')::numeric,0)/n,coalesce((p#>>'{counts,saves}')::numeric,0)/n,
  coalesce((p#>>'{counts,shutouts}')::numeric,0)/n,coalesce((p#>>'{counts,goals_against}')::numeric,0)/n,
  public.canonical_default_points(x->'counts',false),
  coalesce(default_points/nullif(gp,0),0),
  'canonical_contextual_v1',g.home_team=p->>'team',
  CASE WHEN g.home_team=p->>'team' THEN g.away_team ELSE g.home_team END,
  CASE WHEN g.home_team=p->>'team' THEN g.away_team_id ELSE g.home_team_id END,
  now(),now(),(x->>'opponent_adjustment')::numeric,
  (x#>>'{uncertainty,projection_mean}')::numeric,(x#>>'{uncertainty,projection_std_dev}')::numeric,
  (x#>>'{uncertainty,projection_ci_lower}')::numeric,(x#>>'{uncertainty,projection_ci_upper}')::numeric,
  (x#>>'{uncertainty,projection_ci_50_lower}')::numeric,(x#>>'{uncertainty,projection_ci_50_upper}')::numeric,
  (x#>>'{uncertainty,projection_median}')::numeric,(x#>>'{uncertainty,projection_skewness}')::numeric,
  (x#>>'{uncertainty,upside_probability}')::numeric,(x#>>'{uncertainty,floor_probability}')::numeric,
  (x#>>'{uncertainty,dynamic_confidence}')::numeric,(x#>>'{uncertainty,likely_low}')::numeric,
  (x#>>'{uncertainty,likely_high}')::numeric,x#>>'{uncertainty,confidence_label}'
 FROM projection_input input
 JOIN public.canonical_context_rows(r.id) x ON x->>'player_id'=p->>'player_id'
 JOIN public.nhl_games g ON g.game_id=(x->>'game_id')::bigint AND g.season=r.season
  AND g.game_type='regular' AND g.game_date>=current_date AND (g.home_team=p->>'team' OR g.away_team=p->>'team')
 WHERE n>0;
 GET DIAGNOSTICS n_context=ROW_COUNT;
 n_daily:=n_daily+n_context;
END IF;

$direct$||substr(body,end_at);
 body:=replace(body,'n_daily integer;','n_daily integer; n_context integer;');
 body:=replace(body,marker,' AND payload->>''status''=''projected'' AND (NOT(r.payload ? ''daily_context'') OR (payload->>''is_goalie'')::boolean)) INSERT INTO public.player_projected_stats');
 EXECUTE body;
END $migration$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM citrus_canonical_projection_writer;
GRANT citrus_canonical_projection_writer TO postgres WITH INHERIT FALSE, SET FALSE;
NOTIFY pgrst,'reload schema';
