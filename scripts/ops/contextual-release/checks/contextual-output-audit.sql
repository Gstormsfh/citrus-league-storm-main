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
FROM comparison;
