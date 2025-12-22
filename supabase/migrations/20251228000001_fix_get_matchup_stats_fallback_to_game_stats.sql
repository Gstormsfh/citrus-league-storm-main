-- Fix get_matchup_stats RPC to use player_game_stats directly (like calculate_daily_matchup_scores)
-- This ensures stats are returned even if player_weekly_stats isn't populated
-- Uses NHL official stats (nhl_*) for all stats including goalies, matching calculate_daily_matchup_scores logic

DROP FUNCTION IF EXISTS public.get_matchup_stats(int[], date, date);

CREATE OR REPLACE FUNCTION public.get_matchup_stats(
  p_player_ids int[],
  p_start_date date,
  p_end_date date
)
RETURNS table (
  player_id int,
  goals bigint,
  assists bigint,
  points bigint,
  shots_on_goal bigint,
  hits bigint,
  blocks bigint,
  pim bigint,
  ppp bigint,
  shp bigint,
  plus_minus bigint,
  goalie_gp bigint,
  wins bigint,
  saves bigint,
  goals_against bigint,
  shots_faced bigint,
  shutouts bigint,
  x_goals numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Use NHL official stats from player_game_stats (nhl_* columns)
  -- CRITICAL FIXES:
  -- 1. Use CTE with LEFT JOIN to ensure ALL requested players are returned (even with 0 stats)
  -- 2. Pre-filter games by date range using subquery to ensure proper weekly totals
  -- 3. This prevents season totals AND ensures missing players (like goalies) are returned with 0s
  WITH player_list AS (
    SELECT unnest(p_player_ids) AS player_id
  ),
  filtered_games AS (
    SELECT game_id, game_date
    FROM public.nhl_games
    WHERE game_date >= p_start_date
      AND game_date <= p_end_date
  )
  SELECT
    pl.player_id,
    -- Skater stats: Use nhl_* columns with fallback to original columns
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_goals, pgs.goals, 0) ELSE 0 END), 0)::bigint as goals,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0) ELSE 0 END), 0)::bigint as assists,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_points, pgs.goals + pgs.primary_assists + pgs.secondary_assists, 0) ELSE 0 END), 0)::bigint as points,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0) ELSE 0 END), 0)::bigint as shots_on_goal,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_hits, pgs.hits, 0) ELSE 0 END), 0)::bigint as hits,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_blocks, pgs.blocks, 0) ELSE 0 END), 0)::bigint as blocks,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_pim, pgs.pim, 0) ELSE 0 END), 0)::bigint as pim,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_ppp, pgs.ppp, 0) ELSE 0 END), 0)::bigint as ppp,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_shp, pgs.shp, 0) ELSE 0 END), 0)::bigint as shp,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(pgs.nhl_plus_minus, pgs.plus_minus, 0) ELSE 0 END), 0)::bigint as plus_minus,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN pgs.goalie_gp ELSE 0 END), 0)::bigint as goalie_gp,
    -- GOALIE STATS: Use nhl_* columns with FALLBACK to original columns (saves, wins, etc.)
    -- This is critical because nhl_* columns may not be populated for all goalie games
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) ELSE 0 END), 0)::bigint as wins,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) ELSE 0 END), 0)::bigint as saves,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) ELSE 0 END), 0)::bigint as goals_against,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_shots_faced, 0), pgs.shots_faced, 0) ELSE 0 END), 0)::bigint as shots_faced,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) ELSE 0 END), 0)::bigint as shutouts,
    -- x_goals from raw_shots (our model data) - already properly filtered by date
    COALESCE((
      SELECT SUM(COALESCE(rs.shooting_talent_adjusted_xg, rs.flurry_adjusted_xg, rs.xg_value, 0))
      FROM public.raw_shots rs
      INNER JOIN filtered_games ng2 ON rs.game_id = ng2.game_id
      WHERE rs.player_id = pl.player_id
    ), 0)::numeric as x_goals
  FROM player_list pl
  LEFT JOIN public.player_game_stats pgs ON pl.player_id = pgs.player_id
  LEFT JOIN filtered_games ng ON pgs.game_id = ng.game_id
  GROUP BY pl.player_id;
$$;

REVOKE ALL ON FUNCTION public.get_matchup_stats(int[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_matchup_stats(int[], date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_matchup_stats IS 'Returns weekly stats by aggregating directly from player_game_stats (nhl_* columns) filtered by date range. Uses NHL official stats for all stats including goalies. Matches calculate_daily_matchup_scores logic exactly.';

