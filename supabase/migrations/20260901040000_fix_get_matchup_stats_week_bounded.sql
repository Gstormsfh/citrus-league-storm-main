-- PERF (2026-09-01): get_matchup_stats joined player_game_stats on
-- player_id ALONE, so every call aggregated each roster player's ENTIRE
-- career and zeroed the rows outside the week via CASE — plus a
-- correlated nhl_shots subquery per player. Measured on prod: 4,107ms
-- for a 168-player league; the Matchup page's 15s budget died here
-- ("Loading took too long", 2026-09-01 iPhone sim).
--
-- The rewrite materializes the WEEK first (games in window -> the
-- week's stat rows and shots), then aggregates and left-joins to the
-- player list. MATERIALIZED is load-bearing: with a parameterized
-- p_player_ids the planner otherwise drives from the player_id index
-- and re-reads full careers (measured 1,018ms); pinning the week slice
-- makes that plan impossible. Proven row-identical to the old function
-- on a live game week (168 players, 18 columns, 0 mismatches) and
-- measured at 29-57ms in-season / ~2ms on a week with no games.
--
-- Applied to prod 2026-09-01 via MCP migration
-- fix_get_matchup_stats_week_bounded; this file is the repo's copy.
CREATE OR REPLACE FUNCTION public.get_matchup_stats(p_player_ids integer[], p_start_date date, p_end_date date)
 RETURNS TABLE(player_id integer, goals bigint, assists bigint, points bigint, shots_on_goal bigint, hits bigint, blocks bigint, pim bigint, ppp bigint, shp bigint, plus_minus bigint, goalie_gp bigint, wins bigint, saves bigint, goals_against bigint, shots_faced bigint, shutouts bigint, x_goals numeric)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH player_list AS (SELECT unnest(p_player_ids) AS player_id),
  filtered_games AS MATERIALIZED (
    SELECT game_id FROM public.nhl_games
     WHERE game_date >= p_start_date AND game_date <= p_end_date AND game_type = 'regular'
  ),
  week_rows AS MATERIALIZED (
    SELECT pgs.* FROM public.player_game_stats pgs
    JOIN filtered_games ng ON pgs.game_id = ng.game_id
  ),
  window_stats AS (
    SELECT wr.player_id,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_goals, 0) ELSE 0 END)::bigint AS goals,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_assists, 0) ELSE 0 END)::bigint AS assists,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_points, 0) ELSE 0 END)::bigint AS points,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_shots_on_goal, 0) ELSE 0 END)::bigint AS shots_on_goal,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_hits, 0) ELSE 0 END)::bigint AS hits,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_blocks, 0) ELSE 0 END)::bigint AS blocks,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_pim, 0) ELSE 0 END)::bigint AS pim,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(NULLIF(wr.nhl_ppp, 0), (COALESCE(wr.nhl_ppg, 0) + COALESCE(wr.nhl_ppa, 0))) ELSE 0 END)::bigint AS ppp,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(NULLIF(wr.nhl_shp, 0), (COALESCE(wr.nhl_shg, 0) + COALESCE(wr.nhl_sha, 0))) ELSE 0 END)::bigint AS shp,
      SUM(CASE WHEN (wr.is_goalie = false OR wr.is_goalie IS NULL) THEN COALESCE(wr.nhl_plus_minus, 0) ELSE 0 END)::bigint AS plus_minus,
      SUM(CASE WHEN wr.is_goalie = true THEN wr.goalie_gp ELSE 0 END)::bigint AS goalie_gp,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_wins, 0), wr.wins, 0) ELSE 0 END)::bigint AS wins,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_saves, 0), wr.saves, 0) ELSE 0 END)::bigint AS saves,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_goals_against, 0), wr.goals_against, 0) ELSE 0 END)::bigint AS goals_against,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_shots_faced, 0), wr.shots_faced, 0) ELSE 0 END)::bigint AS shots_faced,
      SUM(CASE WHEN wr.is_goalie = true THEN COALESCE(NULLIF(wr.nhl_shutouts, 0), wr.shutouts, 0) ELSE 0 END)::bigint AS shutouts
    FROM week_rows wr
    GROUP BY wr.player_id
  ),
  week_shots AS MATERIALIZED (
    SELECT s.shooter_id, s.xg_sql FROM public.nhl_shots s
    JOIN filtered_games ng ON s.game_id = ng.game_id
  ),
  xg AS (
    SELECT ws.shooter_id AS player_id, SUM(ws.xg_sql)::numeric AS x_goals
    FROM week_shots ws GROUP BY ws.shooter_id
  )
  SELECT pl.player_id,
    COALESCE(ws.goals, 0)::bigint, COALESCE(ws.assists, 0)::bigint, COALESCE(ws.points, 0)::bigint,
    COALESCE(ws.shots_on_goal, 0)::bigint, COALESCE(ws.hits, 0)::bigint, COALESCE(ws.blocks, 0)::bigint,
    COALESCE(ws.pim, 0)::bigint, COALESCE(ws.ppp, 0)::bigint, COALESCE(ws.shp, 0)::bigint,
    COALESCE(ws.plus_minus, 0)::bigint, COALESCE(ws.goalie_gp, 0)::bigint, COALESCE(ws.wins, 0)::bigint,
    COALESCE(ws.saves, 0)::bigint, COALESCE(ws.goals_against, 0)::bigint, COALESCE(ws.shots_faced, 0)::bigint,
    COALESCE(ws.shutouts, 0)::bigint, COALESCE(x.x_goals, 0)::numeric
  FROM player_list pl
  LEFT JOIN window_stats ws ON ws.player_id = pl.player_id
  LEFT JOIN xg x ON x.player_id = pl.player_id;
$function$;
