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
FROM compared;
