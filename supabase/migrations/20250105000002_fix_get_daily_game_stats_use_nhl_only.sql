-- Fix get_daily_game_stats RPC to use NHL.com stats exclusively (no PBP fallback)
-- This ensures daily matchup stats match NHL.com exactly

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
  
  -- CORE SKATER STATS (NHL.com official only)
  goals int,
  assists int,
  points int,
  shots_on_goal int,
  pim int,
  plus_minus int,
  toi_seconds int,
  
  -- PHYSICAL STATS (NHL.com official only)
  hits int,
  blocks int,
  
  -- FACEOFF STATS
  faceoff_wins int,
  faceoff_losses int,
  faceoff_taken int,
  
  -- POSSESSION STATS
  takeaways int,
  giveaways int,
  
  -- POWER PLAY BREAKDOWN (NHL.com official only)
  ppp int,
  ppg int,
  ppa int,
  
  -- SHORTHANDED BREAKDOWN (NHL.com official only)
  shp int,
  shg int,
  sha int,
  
  -- SHOT METRICS
  shots_missed int,
  shots_blocked int,
  shot_attempts int,
  
  -- GAME CONTEXT
  gwg int,
  otg int,
  shifts int,
  
  -- GOALIE STATS (NHL.com official only)
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
    
    -- CRITICAL: Use NHL.com official stats exclusively (no PBP fallback)
    COALESCE(pgs.nhl_goals, 0) as goals,
    COALESCE(pgs.nhl_assists, 0) as assists,
    COALESCE(pgs.nhl_goals, 0) + COALESCE(pgs.nhl_assists, 0) as points,
    COALESCE(pgs.nhl_shots_on_goal, 0) as shots_on_goal,
    COALESCE(pgs.nhl_pim, 0) as pim,
    COALESCE(pgs.nhl_plus_minus, 0) as plus_minus,
    COALESCE(pgs.nhl_toi_seconds, 0) as toi_seconds,
    
    -- Physical stats: NHL.com official only (StatsAPI source)
    COALESCE(pgs.nhl_hits, 0) as hits,
    COALESCE(pgs.nhl_blocks, 0) as blocks,
    
    -- Faceoffs
    COALESCE(pgs.nhl_faceoff_wins, 0) as faceoff_wins,
    COALESCE(pgs.nhl_faceoff_losses, 0) as faceoff_losses,
    COALESCE(pgs.nhl_faceoff_taken, 0) as faceoff_taken,
    
    -- Possession
    COALESCE(pgs.nhl_takeaways, 0) as takeaways,
    COALESCE(pgs.nhl_giveaways, 0) as giveaways,
    
    -- Power Play: NHL.com official only (no PBP fallback)
    COALESCE(pgs.nhl_ppp, 0) as ppp,
    COALESCE(pgs.nhl_ppg, 0) as ppg,
    COALESCE(pgs.nhl_ppa, 0) as ppa,
    
    -- Shorthanded: NHL.com official only (no PBP fallback)
    COALESCE(pgs.nhl_shp, 0) as shp,
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
    
    -- Goalie stats: NHL.com official only
    COALESCE(pgs.nhl_wins, 0) as wins,
    COALESCE(pgs.nhl_losses, 0) as losses,
    COALESCE(pgs.nhl_ot_losses, 0) as ot_losses,
    COALESCE(pgs.nhl_saves, 0) as saves,
    COALESCE(pgs.nhl_shots_faced, 0) as shots_faced,
    COALESCE(pgs.nhl_goals_against, 0) as goals_against,
    COALESCE(pgs.nhl_shutouts, 0) as shutouts,
    COALESCE(pgs.nhl_save_pct, 0.000) as save_pct,
    
    -- Goalie situation splits
    COALESCE(pgs.nhl_even_saves, 0) as even_saves,
    COALESCE(pgs.nhl_even_shots_against, 0) as even_shots_against,
    COALESCE(pgs.nhl_pp_saves, 0) as pp_saves,
    COALESCE(pgs.nhl_pp_shots_against, 0) as pp_shots_against,
    COALESCE(pgs.nhl_sh_saves, 0) as sh_saves,
    COALESCE(pgs.nhl_sh_shots_against, 0) as sh_shots_against
  FROM public.player_game_stats pgs
  WHERE
    pgs.player_id = ANY(p_player_ids)
    AND pgs.game_date = p_game_date;
$$;

REVOKE ALL ON FUNCTION public.get_daily_game_stats(int[], date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_daily_game_stats(int[], date) TO anon, authenticated;

