-- Service-only operational reads. No caller identity or league data is accepted.
-- No public grants, mutation, scoring, source changes or notification delivery.
CREATE SCHEMA citrus_projection_ops;
REVOKE ALL ON SCHEMA citrus_projection_ops FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA citrus_projection_ops TO service_role;
CREATE FUNCTION citrus_projection_ops.contextual_dependencies() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='10s' AS $function$
SELECT jsonb_build_object(
 'checked_at',clock_timestamp(),
 'jobs',(SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'active',active) ORDER BY jobid)
   FROM cron.job WHERE jobid IN(19,20,22,31,32,33,34)),
 'runs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY jobid,start_time DESC) FROM (
   SELECT jobid,runid,status,start_time,end_time FROM cron.job_run_details
   WHERE jobid IN(19,20,22,31,32,33,34) AND start_time>=now()-interval '48 hours') x),
 'draftBlockers',(SELECT count(*) FROM public.draft_freeze_blockers(4,6)),
 'active',(SELECT jsonb_build_object('run_id',r.id,'revision',r.revision,'source_revision',s.revision,
   'last_refresh_at',a.last_refresh_at,'last_refresh_status',a.last_refresh_status)
   FROM public.canonical_projection_active a JOIN public.canonical_projection_runs r ON r.id=a.run_id
   JOIN public.canonical_projection_runs s ON s.id=a.source_run_id WHERE a.season=2026)
);
$function$;
REVOKE ALL ON FUNCTION citrus_projection_ops.contextual_dependencies() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION citrus_projection_ops.contextual_dependencies() TO service_role;
CREATE FUNCTION citrus_projection_ops.contextual_output_health() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='15s' AS $function$
SELECT jsonb_build_object('skaters',(SELECT to_jsonb(audit) FROM (
-- Read-only, full-population check after the identified staging rehearsal.
-- Season 2026 only. No writes, no projection changes, no accuracy assertion.
WITH totals AS (
 SELECT player_id,count(*) games,count(distinct projected_goals) goal_shapes,
  sum(projected_gp) gp,sum(projected_goals) goals,sum(projected_assists) assists,
  sum(projected_sog) sog,sum(projected_blocks) blocks,sum(projected_ppp) ppp,
  sum(projected_shp) shp,sum(projected_hits) hits,sum(projected_pim) pim,
  sum(projected_plus_minus) plus_minus,
  bool_and(calculation_method='canonical_contextual_v1') contextual,
  bool_and(projection_mean IS NOT NULL AND projection_std_dev IS NOT NULL
    AND projection_ci_lower IS NOT NULL AND projection_ci_upper IS NOT NULL) uncertainty,
  bool_and(projected_gp IS NOT NULL AND projected_goals IS NOT NULL
    AND projected_assists IS NOT NULL AND projected_sog IS NOT NULL
    AND projected_blocks IS NOT NULL AND projected_ppp IS NOT NULL
    AND projected_shp IS NOT NULL AND projected_hits IS NOT NULL
    AND projected_pim IS NOT NULL) stats_present,
  count(projected_plus_minus) known_plus_minus_games,
  count(distinct projection_revision) revisions,min(projection_revision) revision
 FROM public.player_projected_stats
 WHERE season=2026 AND is_goalie=false GROUP BY player_id
), comparison AS (
 SELECT t.*,r.player_id ros_player_id,
  t.player_id IS NOT NULL AND r.player_id IS NOT NULL matching_outputs,
  r.projection_revision=revision same_revision,
  r.projected_goals IS NOT NULL AND r.projected_assists IS NOT NULL
   AND r.projected_sog IS NOT NULL AND r.projected_blocks IS NOT NULL
   AND r.projected_ppp IS NOT NULL AND r.projected_shp IS NOT NULL
   AND r.projected_hits IS NOT NULL AND r.projected_pim IS NOT NULL
   AND r.games_remaining IS NOT NULL ros_stats_present,
  CASE WHEN r.projected_plus_minus IS NULL THEN known_plus_minus_games=0
       ELSE known_plus_minus_games=games END optional_plus_minus_coverage_matches,
  abs(t.gp-r.games_remaining) gp_error,
  greatest(abs(t.goals-r.projected_goals),abs(t.assists-r.projected_assists),
   abs(t.sog-r.projected_sog),abs(t.blocks-r.projected_blocks),abs(t.ppp-r.projected_ppp),
   abs(t.shp-r.projected_shp),abs(t.hits-r.projected_hits),abs(t.pim-r.projected_pim),
   abs(t.plus_minus-r.projected_plus_minus)) count_error
 FROM totals t FULL JOIN
  (SELECT * FROM public.player_ros_projections WHERE season=2026 AND is_goalie=false) r
 ON r.player_id=t.player_id
)
SELECT count(*) skaters,sum(games) daily_rows,
 count(*) FILTER(WHERE goal_shapes>1) skaters_with_varying_goals,
 coalesce(bool_and(coalesce(contextual,false)),false) all_contextual,
 coalesce(bool_and(coalesce(uncertainty,false)),false) all_uncertainty,
 coalesce(bool_and(coalesce(stats_present,false)),false) all_required_daily_stats_present,
 coalesce(bool_and(ros_stats_present),false) all_required_ros_stats_present,
 coalesce(bool_and(matching_outputs),false) matching_output_players,
 count(*) FILTER(WHERE known_plus_minus_games>0) skaters_with_supplied_plus_minus,
 coalesce(bool_and(coalesce(optional_plus_minus_coverage_matches,false)),false) optional_plus_minus_coverage_matches,
 coalesce(bool_and(coalesce(revisions=1 AND same_revision,false)),false) daily_ros_revision_matches,
 coalesce(bool_and(coalesce(revision=(SELECT p.revision FROM public.canonical_projection_active a
  JOIN public.canonical_projection_runs p ON p.id=a.run_id WHERE a.season=2026),false)),false) active_revision_matches,
 count(distinct revision) distinct_revisions,
 max(count_error) maximum_daily_ros_count_error,max(gp_error) maximum_gp_error
FROM comparison
) audit),'goalies',(SELECT to_jsonb(audit) FROM (
-- Read-only complete goalie daily/ROS identity and count conservation check.
-- This tests transport consistency, not goalie forecasting calibration.
WITH totals AS (
 SELECT player_id,count(*) daily_games,sum(projected_gp) starts,
  sum(projected_wins) wins,sum(projected_saves) saves,
  sum(projected_goals_against) ga,sum(projected_shutouts) shutouts,
  count(distinct projection_revision) revisions,min(projection_revision) revision,
  bool_and(projected_gp IS NOT NULL AND projected_wins IS NOT NULL
   AND projected_saves IS NOT NULL AND projected_goals_against IS NOT NULL
   AND projected_shutouts IS NOT NULL) all_required_stats
 FROM public.player_projected_stats WHERE season=2026 AND is_goalie=true
 GROUP BY player_id
), compared AS (
 SELECT coalesce(t.player_id,r.player_id) player_id,t.daily_games,t.all_required_stats,
  t.revisions=1 AND t.revision=r.projection_revision same_revision,
  t.player_id IS NOT NULL AND r.player_id IS NOT NULL matching_outputs,
  r.games_remaining IS NOT NULL AND r.projected_wins_ros IS NOT NULL
   AND r.projected_saves_ros IS NOT NULL AND r.projected_ga_ros IS NOT NULL
   AND r.projected_shutouts_ros IS NOT NULL all_required_ros_stats,
  t.revision,
  abs(t.starts-r.games_remaining) starts_error,
  greatest(abs(t.wins-r.projected_wins_ros),abs(t.saves-r.projected_saves_ros),
   abs(t.ga-r.projected_ga_ros),abs(t.shutouts-r.projected_shutouts_ros)) count_error
 FROM totals t FULL JOIN
  (SELECT * FROM public.player_ros_projections WHERE season=2026 AND is_goalie=true) r
 ON r.player_id=t.player_id
)
SELECT count(*) goalies,sum(daily_games) daily_rows,
 coalesce(bool_and(coalesce(all_required_stats,false)),false) all_required_daily_stats,
 coalesce(bool_and(all_required_ros_stats),false) all_required_ros_stats,
 coalesce(bool_and(coalesce(same_revision,false)),false) daily_ros_revision_matches,
 coalesce(bool_and(matching_outputs),false) matching_output_players,
 coalesce(bool_and(coalesce(revision=(SELECT p.revision FROM public.canonical_projection_active a
  JOIN public.canonical_projection_runs p ON p.id=a.run_id WHERE a.season=2026),false)),false) active_revision_matches,
 count(distinct revision) distinct_revisions,
 max(starts_error) maximum_daily_ros_starts_error,
 max(count_error) maximum_daily_ros_count_error
FROM compared
) audit));
$function$;
REVOKE ALL ON FUNCTION citrus_projection_ops.contextual_output_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION citrus_projection_ops.contextual_output_health() TO service_role;
CREATE FUNCTION public.canonical_contextual_dependencies() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT citrus_projection_ops.contextual_dependencies() $$;
CREATE FUNCTION public.canonical_contextual_output_health() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT citrus_projection_ops.contextual_output_health() $$;
REVOKE ALL ON FUNCTION public.canonical_contextual_dependencies(),public.canonical_contextual_output_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_contextual_dependencies(),public.canonical_contextual_output_health() TO service_role;
NOTIFY pgrst,'reload schema';
