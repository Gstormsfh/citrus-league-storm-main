-- ============================================================================
-- BULLETPROOF GOALIE STATS FIX
-- ============================================================================
-- This migration ensures BOTH weekly and daily goalie stats work correctly by
-- adding fallback to original columns (saves, wins, etc.) when nhl_* columns
-- are empty/zero.
--
-- ROOT CAUSE: The nhl_* columns were added later and aren't populated for all
-- goalie games. The original columns (saves, wins, goals_against, etc.) have
-- the data.
-- ============================================================================

-- ============================================================================
-- PART 1: FIX WEEKLY STATS RPC (get_matchup_stats)
-- ============================================================================
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
  -- Aggregate stats from player_game_stats for games in date range
  -- Uses CTE to ensure ALL requested players are returned (even with 0 stats)
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
    -- SKATER STATS: nhl_* with fallback to original columns
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
    -- GOALIE STATS: CRITICAL - Use NULLIF to detect empty nhl_* columns and fallback
    -- Pattern: COALESCE(NULLIF(nhl_column, 0), original_column, 0)
    -- This picks nhl_* if non-zero, otherwise falls back to original column
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) ELSE 0 END), 0)::bigint as wins,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) ELSE 0 END), 0)::bigint as saves,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) ELSE 0 END), 0)::bigint as goals_against,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_shots_faced, 0), pgs.shots_faced, 0) ELSE 0 END), 0)::bigint as shots_faced,
    COALESCE(SUM(CASE WHEN ng.game_id IS NOT NULL THEN COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) ELSE 0 END), 0)::bigint as shutouts,
    -- x_goals from raw_shots
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

COMMENT ON FUNCTION public.get_matchup_stats IS 'Returns weekly aggregated stats from player_game_stats. Uses nhl_* columns with FALLBACK to original columns for goalies (nhl_* may not be populated for all goalie games).';

-- ============================================================================
-- PART 2: FIX DAILY STATS RPC (get_daily_game_stats)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_daily_game_stats(int[], date);

CREATE OR REPLACE FUNCTION public.get_daily_game_stats(
  p_player_ids int[],
  p_game_date date
)
RETURNS TABLE (
  player_id int,
  game_id bigint,
  is_goalie boolean,
  goals int,
  assists int,
  points int,
  shots_on_goal int,
  pim int,
  plus_minus int,
  toi_seconds int,
  hits int,
  blocks int,
  faceoff_wins int,
  faceoff_losses int,
  faceoff_taken int,
  takeaways int,
  giveaways int,
  ppp int,
  ppg int,
  ppa int,
  shp int,
  shg int,
  sha int,
  shots_missed int,
  shots_blocked int,
  shot_attempts int,
  gwg int,
  otg int,
  shifts int,
  wins int,
  losses int,
  ot_losses int,
  saves int,
  shots_faced int,
  goals_against int,
  shutouts int,
  save_pct numeric(5,3),
  even_saves int,
  even_shots_against int,
  pp_saves int,
  pp_shots_against int,
  sh_saves int,
  sh_shots_against int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pgs.player_id,
    pgs.game_id,
    pgs.is_goalie,
    -- Skater stats (use nhl_* with fallback)
    COALESCE(pgs.nhl_goals, pgs.goals, 0) as goals,
    COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0) as assists,
    COALESCE(pgs.nhl_points, pgs.goals + pgs.primary_assists + pgs.secondary_assists, 0) as points,
    COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0) as shots_on_goal,
    COALESCE(pgs.nhl_pim, pgs.pim, 0) as pim,
    COALESCE(pgs.nhl_plus_minus, pgs.plus_minus, 0) as plus_minus,
    COALESCE(pgs.nhl_toi_seconds, pgs.icetime_seconds, 0) as toi_seconds,
    COALESCE(pgs.nhl_hits, pgs.hits, 0) as hits,
    COALESCE(pgs.nhl_blocks, pgs.blocks, 0) as blocks,
    COALESCE(pgs.nhl_faceoff_wins, 0) as faceoff_wins,
    COALESCE(pgs.nhl_faceoff_losses, 0) as faceoff_losses,
    COALESCE(pgs.nhl_faceoff_taken, 0) as faceoff_taken,
    COALESCE(pgs.nhl_takeaways, 0) as takeaways,
    COALESCE(pgs.nhl_giveaways, 0) as giveaways,
    COALESCE(pgs.nhl_ppp, pgs.ppp, 0) as ppp,
    COALESCE(pgs.nhl_ppg, 0) as ppg,
    COALESCE(pgs.nhl_ppa, 0) as ppa,
    COALESCE(pgs.nhl_shp, pgs.shp, 0) as shp,
    COALESCE(pgs.nhl_shg, 0) as shg,
    COALESCE(pgs.nhl_sha, 0) as sha,
    COALESCE(pgs.nhl_shots_missed, 0) as shots_missed,
    COALESCE(pgs.nhl_shots_blocked, 0) as shots_blocked,
    COALESCE(pgs.nhl_shot_attempts, 0) as shot_attempts,
    COALESCE(pgs.nhl_gwg, 0) as gwg,
    COALESCE(pgs.nhl_otg, 0) as otg,
    COALESCE(pgs.nhl_shifts, 0) as shifts,
    -- GOALIE STATS: CRITICAL - Use NULLIF fallback pattern
    -- Note: 'losses' column doesn't exist in original schema, only nhl_losses
    COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) as wins,
    COALESCE(pgs.nhl_losses, 0) as losses,
    COALESCE(pgs.nhl_ot_losses, 0) as ot_losses,
    COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) as saves,
    COALESCE(NULLIF(pgs.nhl_shots_faced, 0), pgs.shots_faced, 0) as shots_faced,
    COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) as goals_against,
    COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) as shutouts,
    COALESCE(pgs.nhl_save_pct, 0.000) as save_pct,
    COALESCE(pgs.nhl_even_saves, 0) as even_saves,
    COALESCE(pgs.nhl_even_shots_against, 0) as even_shots_against,
    COALESCE(pgs.nhl_pp_saves, 0) as pp_saves,
    COALESCE(pgs.nhl_pp_shots_against, 0) as pp_shots_against,
    COALESCE(pgs.nhl_sh_saves, 0) as sh_saves,
    COALESCE(pgs.nhl_sh_shots_against, 0) as sh_shots_against
  FROM public.player_game_stats pgs
  INNER JOIN public.nhl_games ng ON pgs.game_id = ng.game_id
  WHERE pgs.player_id = ANY(p_player_ids)
    AND ng.game_date = p_game_date;
$$;

REVOKE ALL ON FUNCTION public.get_daily_game_stats(int[], date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_daily_game_stats(int[], date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_daily_game_stats IS 'Returns per-game stats for a specific date. Uses nhl_* columns with FALLBACK to original columns for goalies. Use for daily matchup views.';

-- ============================================================================
-- VERIFICATION: Ensure both functions exist with correct signatures
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_matchup_stats'
  ) THEN
    RAISE EXCEPTION 'CRITICAL: get_matchup_stats function does not exist!';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_daily_game_stats'
  ) THEN
    RAISE EXCEPTION 'CRITICAL: get_daily_game_stats function does not exist!';
  END IF;
  
  RAISE NOTICE '✅ Both get_matchup_stats and get_daily_game_stats functions verified!';
END $$;

