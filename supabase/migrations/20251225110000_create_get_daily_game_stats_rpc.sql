-- ============================================================================
-- GET DAILY GAME STATS RPC
-- ============================================================================
-- Returns comprehensive per-game stats from player_game_stats for fantasy scoring.
-- Supports all expanded stat categories for league-weighted scoring.
--
-- Use this for DAILY matchup views (single-day stats).
-- Use get_matchup_stats for WEEKLY aggregate views.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_daily_game_stats(int[], date);

CREATE OR REPLACE FUNCTION public.get_daily_game_stats(
  p_player_ids int[],
  p_game_date date
)
RETURNS TABLE (
  -- Player identification
  player_id int,
  game_id bigint,
  is_goalie boolean,
  
  -- CORE SKATER STATS
  goals int,
  assists int,
  points int,
  shots_on_goal int,
  pim int,
  plus_minus int,
  toi_seconds int,
  
  -- PHYSICAL STATS
  hits int,
  blocks int,
  
  -- FACEOFF STATS
  faceoff_wins int,
  faceoff_losses int,
  faceoff_taken int,
  
  -- POSSESSION STATS
  takeaways int,
  giveaways int,
  
  -- POWER PLAY BREAKDOWN
  ppp int,
  ppg int,
  ppa int,
  
  -- SHORTHANDED BREAKDOWN
  shp int,
  shg int,
  sha int,
  
  -- SHOT METRICS (CORSI COMPONENTS)
  shots_missed int,
  shots_blocked int,
  shot_attempts int,
  
  -- GAME CONTEXT
  gwg int,
  otg int,
  shifts int,
  
  -- GOALIE STATS
  wins int,
  losses int,
  ot_losses int,
  saves int,
  shots_faced int,
  goals_against int,
  shutouts int,
  save_pct numeric(5,3),
  
  -- GOALIE SITUATION SPLITS
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
    
    -- Core stats (use nhl_* columns with fallback to regular columns - like goalies)
    COALESCE(pgs.nhl_goals, 0) as goals,
    COALESCE(pgs.nhl_assists, 0) as assists,
    COALESCE(pgs.nhl_points, 0) as points,
    -- SOG: fallback to regular shots_on_goal if nhl_* is NULL or 0
    COALESCE(NULLIF(pgs.nhl_shots_on_goal, 0), pgs.shots_on_goal, 0) as shots_on_goal,
    -- PIM: fallback to regular pim if nhl_* is NULL or 0
    COALESCE(NULLIF(pgs.nhl_pim, 0), pgs.pim, 0) as pim,
    COALESCE(pgs.nhl_plus_minus, 0) as plus_minus,
    COALESCE(pgs.nhl_toi_seconds, 0) as toi_seconds,
    
    -- Physical stats: fallback to regular columns if nhl_* is NULL or 0
    COALESCE(NULLIF(pgs.nhl_hits, 0), pgs.hits, 0) as hits,
    COALESCE(NULLIF(pgs.nhl_blocks, 0), pgs.blocks, 0) as blocks,
    
    -- Faceoffs
    COALESCE(pgs.nhl_faceoff_wins, 0) as faceoff_wins,
    COALESCE(pgs.nhl_faceoff_losses, 0) as faceoff_losses,
    COALESCE(pgs.nhl_faceoff_taken, 0) as faceoff_taken,
    
    -- Possession
    COALESCE(pgs.nhl_takeaways, 0) as takeaways,
    COALESCE(pgs.nhl_giveaways, 0) as giveaways,
    
    -- Power Play: fallback to regular columns if nhl_* is NULL or 0
    -- Note: Only ppp has a regular column; ppg/ppa are nhl_* only
    COALESCE(NULLIF(pgs.nhl_ppp, 0), pgs.ppp, 0) as ppp,
    COALESCE(pgs.nhl_ppg, 0) as ppg,
    COALESCE(pgs.nhl_ppa, 0) as ppa,
    
    -- Shorthanded: fallback to regular columns if nhl_* is NULL or 0
    -- Note: Only shp has a regular column; shg/sha are nhl_* only
    COALESCE(NULLIF(pgs.nhl_shp, 0), pgs.shp, 0) as shp,
    COALESCE(pgs.nhl_shg, 0) as shg,
    COALESCE(pgs.nhl_sha, 0) as sha,
    
    -- Shot metrics
    COALESCE(pgs.nhl_shots_missed, 0) as shots_missed,
    COALESCE(pgs.nhl_shots_blocked, 0) as shots_blocked,
    COALESCE(pgs.nhl_shot_attempts, 0) as shot_attempts,
    
    -- Game context
    COALESCE(pgs.nhl_gwg, 0) as gwg,
    COALESCE(pgs.nhl_otg, 0) as otg,
    COALESCE(pgs.nhl_shifts, 0) as shifts,
    
    -- Goalie core - USE FALLBACK: nhl_* columns may not be populated for all goalie games
    COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) as wins,
    COALESCE(pgs.nhl_losses, 0) as losses,
    COALESCE(pgs.nhl_ot_losses, 0) as ot_losses,
    COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) as saves,
    COALESCE(NULLIF(pgs.nhl_shots_faced, 0), pgs.shots_faced, 0) as shots_faced,
    COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) as goals_against,
    COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) as shutouts,
    COALESCE(pgs.nhl_save_pct, 0.000) as save_pct,
    
    -- Goalie situation splits
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

COMMENT ON FUNCTION public.get_daily_game_stats IS 'Returns comprehensive per-game stats from player_game_stats for a specific date. Includes all fantasy-relevant categories: faceoffs, possession, PP/SH breakdown, shot metrics, goalie splits. Use for daily matchup views.';
