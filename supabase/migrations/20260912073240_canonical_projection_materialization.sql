ALTER TABLE public.player_ros_projections ADD COLUMN projection_run_id uuid, ADD COLUMN projection_revision text;
ALTER TABLE public.player_projected_stats ADD COLUMN projection_run_id uuid, ADD COLUMN projection_revision text;
-- Canonical derivatives: one active revision supplies both horizons.
-- Numeric precision is intentionally unbounded; daily sums must retain fractional exposure.
ALTER TABLE public.player_ros_projections ALTER COLUMN games_remaining TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_goals TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_assists TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_sog TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_blocks TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_ppp TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_shp TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_hits TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_pim TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_wins_ros TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_saves_ros TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_shutouts_ros TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN projected_ga_ros TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN total_projected_points TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN avg_points_per_game TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN avg_goals_per_game TYPE numeric;
ALTER TABLE public.player_ros_projections ALTER COLUMN avg_assists_per_game TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_goals TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_assists TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_sog TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_blocks TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_ppp TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_shp TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_hits TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_pim TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_wins TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_saves TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_shutouts TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_goals_against TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN projected_gp TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN total_projected_points TYPE numeric;
ALTER TABLE public.player_projected_stats ALTER COLUMN base_ppg TYPE numeric;

-- Generated from packages/shared/src/constants/scoringDefaults.json; parity-tested.
CREATE FUNCTION public.canonical_default_points(p_counts jsonb,p_goalie boolean) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT CASE WHEN p_goalie THEN
coalesce((p_counts->>'wins')::numeric,0)*(5) + coalesce((p_counts->>'shutouts')::numeric,0)*(5) + coalesce((p_counts->>'saves')::numeric,0)*(0.6) + coalesce((p_counts->>'goals_against')::numeric,0)*(-3)
ELSE
coalesce((p_counts->>'goals')::numeric,0)*(6) + coalesce((p_counts->>'assists')::numeric,0)*(4) + coalesce((p_counts->>'power_play_points')::numeric,0)*(2) + coalesce((p_counts->>'short_handed_points')::numeric,0)*(0) + coalesce((p_counts->>'shots_on_goal')::numeric,0)*(0.9) + coalesce((p_counts->>'blocks')::numeric,0)*(1) + coalesce((p_counts->>'hits')::numeric,0)*(0) + coalesce((p_counts->>'penalty_minutes')::numeric,0)*(0) + coalesce((p_counts->>'plus_minus')::numeric,0)*(0)
END $$;

CREATE FUNCTION public.canonical_materialize_projection_run(p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.canonical_projection_runs; n_ros integer; n_daily integer;
BEGIN
 SELECT * INTO STRICT r FROM public.canonical_projection_runs WHERE id=p_run_id;
 PERFORM pg_advisory_xact_lock(724811,r.season);
 IF NOT EXISTS(SELECT 1 FROM public.canonical_projection_active WHERE season=r.season AND run_id=r.id) THEN RAISE EXCEPTION 'Run is not active'; END IF;
 IF EXISTS(SELECT 1 FROM (SELECT payload->>'team' team,sum(coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric)) exposure FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'status'='projected' AND (payload->>'is_goalie')::boolean GROUP BY 1) c
 WHERE abs(c.exposure-(SELECT count(*) FROM public.nhl_games g WHERE g.season=r.season AND g.game_type='regular' AND g.game_date>=current_date AND (g.home_team=c.team OR g.away_team=c.team)))>0.00001) THEN RAISE EXCEPTION 'Canonical snapshot horizon is stale; refresh required'; END IF;
 -- Compatibility table has player_id PRIMARY KEY, so it is a single-season cache, as in the legacy writer.
 DELETE FROM public.player_ros_projections;
 INSERT INTO public.player_ros_projections(projection_run_id,projection_revision,player_id,season,games_remaining,games_played,player_name,team_abbrev,position,is_goalie,
projected_goals,projected_assists,projected_sog,projected_blocks,projected_ppp,projected_shp,projected_hits,projected_pim,projected_wins_ros,projected_saves_ros,projected_shutouts_ros,projected_ga_ros,total_projected_points,avg_points_per_game,avg_goals_per_game,avg_assists_per_game,created_at,updated_at)
SELECT r.id,r.revision,(p->>'player_id')::integer,r.season,gp,CASE WHEN p ? 'remaining' THEN (p#>>'{remaining,actual_gp}')::integer ELSE 0 END,p->>'name',p->>'team',p->>'position',(p->>'is_goalie')::boolean,
coalesce((p->'counts'->>'goals')::numeric,0),coalesce((p->'counts'->>'assists')::numeric,0),coalesce((p->'counts'->>'shots_on_goal')::numeric,0),coalesce((p->'counts'->>'blocks')::numeric,0),coalesce((p->'counts'->>'power_play_points')::numeric,0),coalesce((p->'counts'->>'short_handed_points')::numeric,0),coalesce((p->'counts'->>'hits')::numeric,0),coalesce((p->'counts'->>'penalty_minutes')::numeric,0),coalesce((p->'counts'->>'wins')::numeric,0),coalesce((p->'counts'->>'saves')::numeric,0),coalesce((p->'counts'->>'shutouts')::numeric,0),coalesce((p->'counts'->>'goals_against')::numeric,0),
public.canonical_default_points(p->'counts',(p->>'is_goalie')::boolean),coalesce(public.canonical_default_points(p->'counts',(p->>'is_goalie')::boolean)/nullif(gp,0),0),coalesce((p->'counts'->>'goals')::numeric/nullif(gp,0),0),coalesce((p->'counts'->>'assists')::numeric/nullif(gp,0),0),now(),now()
FROM (SELECT payload p,coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric) gp FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'status'='projected') x;
GET DIAGNOSTICS n_ros=ROW_COUNT;
DELETE FROM public.player_projected_stats WHERE season=r.season AND projection_date>=current_date;
INSERT INTO public.player_projected_stats(projection_run_id,projection_revision,player_id,season,game_id,projection_date,is_goalie,projected_gp,projected_goals,projected_assists,projected_sog,projected_blocks,projected_ppp,projected_shp,projected_hits,projected_pim,projected_wins,projected_saves,projected_shutouts,projected_goals_against,total_projected_points,base_ppg,calculation_method,is_home_game,opponent_abbrev,opponent_team_id,created_at,updated_at)
SELECT r.id,r.revision,(p->>'player_id')::integer,r.season,g.game_id,g.game_date,(p->>'is_goalie')::boolean,gp/n,
coalesce((p->'counts'->>'goals')::numeric,0)/n,coalesce((p->'counts'->>'assists')::numeric,0)/n,coalesce((p->'counts'->>'shots_on_goal')::numeric,0)/n,coalesce((p->'counts'->>'blocks')::numeric,0)/n,coalesce((p->'counts'->>'power_play_points')::numeric,0)/n,coalesce((p->'counts'->>'short_handed_points')::numeric,0)/n,coalesce((p->'counts'->>'hits')::numeric,0)/n,coalesce((p->'counts'->>'penalty_minutes')::numeric,0)/n,coalesce((p->'counts'->>'wins')::numeric,0)/n,coalesce((p->'counts'->>'saves')::numeric,0)/n,coalesce((p->'counts'->>'shutouts')::numeric,0)/n,coalesce((p->'counts'->>'goals_against')::numeric,0)/n,
public.canonical_default_points(p->'counts',(p->>'is_goalie')::boolean)/n,coalesce(public.canonical_default_points(p->'counts',(p->>'is_goalie')::boolean)/nullif(gp,0),0),'canonical_expected_volume_v1',g.home_team=p->>'team',CASE WHEN g.home_team=p->>'team' THEN g.away_team ELSE g.home_team END,CASE WHEN g.home_team=p->>'team' THEN g.away_team_id ELSE g.home_team_id END,now(),now()
FROM (SELECT payload p,coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric) gp FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'status'='projected') x
JOIN LATERAL(SELECT count(*)::numeric n FROM public.nhl_games s WHERE s.season=r.season AND s.game_type='regular' AND s.game_date>=current_date AND (s.home_team=p->>'team' OR s.away_team=p->>'team')) t ON n>0
JOIN public.nhl_games g ON g.season=r.season AND g.game_type='regular' AND g.game_date>=current_date AND (g.home_team=p->>'team' OR g.away_team=p->>'team');
GET DIAGNOSTICS n_daily=ROW_COUNT;
RETURN jsonb_build_object('run_id',r.id,'revision',r.revision,'ros_rows',n_ros,'daily_rows',n_daily);
END $$;
REVOKE ALL ON FUNCTION public.canonical_materialize_projection_run(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_materialize_projection_run(uuid) TO service_role;

-- Some older installations still expose this typed RPC (absent in audited production).
-- Preserve its exact definition and grants while widening the return field as well.
DO $compat$
DECLARE fn oid; definition text; grants jsonb; g jsonb;
BEGIN
 fn:=to_regprocedure('public.get_ros_projections(integer[])');
 IF fn IS NOT NULL THEN
   definition:=pg_get_functiondef(fn);
   IF position('games_remaining integer' IN definition)>0 THEN
     SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee,'grantable',a.is_grantable)) INTO grants
     FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.privilege_type='EXECUTE';
     EXECUTE 'DROP FUNCTION public.get_ros_projections(integer[])';
     EXECUTE replace(definition,'games_remaining integer','games_remaining numeric');
     REVOKE ALL ON FUNCTION public.get_ros_projections(integer[]) FROM PUBLIC;
     FOR g IN SELECT value FROM jsonb_array_elements(grants) LOOP
       EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_ros_projections(integer[]) TO ' ||
       CASE WHEN (g->>'grantee')::oid=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid((g->>'grantee')::oid)) END ||
       CASE WHEN (g->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
     END LOOP;
   END IF;
 END IF;
END $compat$;
