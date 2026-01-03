-- Expand get_daily_projections RPC to return all 8 skater projection stats
-- Adds projected_ppp, projected_shp, projected_hits, projected_pim to the return table
-- This migration ensures the RPC matches the expanded player_projected_stats schema

-- Drop existing function first (required when changing return type)
DROP FUNCTION IF EXISTS public.get_daily_projections(integer[], date);

CREATE OR REPLACE FUNCTION public.get_daily_projections(
  p_player_ids INTEGER[],
  p_target_date DATE
)
RETURNS TABLE (
  -- Common fields
  player_id INTEGER,
  game_id INTEGER,
  projection_date DATE,
  total_projected_points NUMERIC,
  confidence_score NUMERIC,
  calculation_method TEXT,
  is_goalie BOOLEAN,
  
  -- Skater fields (NULL for goalies) - ALL 8 STATS
  projected_goals NUMERIC,
  projected_assists NUMERIC,
  projected_sog NUMERIC,
  projected_blocks NUMERIC,
  projected_ppp NUMERIC,
  projected_shp NUMERIC,
  projected_hits NUMERIC,
  projected_pim NUMERIC,
  projected_xg NUMERIC,
  base_ppg NUMERIC,
  shrinkage_weight NUMERIC,
  finishing_multiplier NUMERIC,
  opponent_adjustment NUMERIC,
  b2b_penalty NUMERIC,
  home_away_adjustment NUMERIC,
  
  -- Goalie fields (NULL for skaters)
  projected_wins NUMERIC,
  projected_saves NUMERIC,
  projected_shutouts NUMERIC,
  projected_goals_against NUMERIC,
  projected_gaa NUMERIC,
  projected_save_pct NUMERIC,
  projected_gp NUMERIC,
  starter_confirmed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pps.player_id,
    pps.game_id,
    pps.projection_date,
    pps.total_projected_points,
    pps.confidence_score,
    pps.calculation_method,
    pps.is_goalie,
    
    -- Skater fields - ALL 8 STATS
    CASE WHEN NOT pps.is_goalie THEN pps.projected_goals ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.projected_assists ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.projected_sog ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.projected_blocks ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN COALESCE(pps.projected_ppp, 0) ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN COALESCE(pps.projected_shp, 0) ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN COALESCE(pps.projected_hits, 0) ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN COALESCE(pps.projected_pim, 0) ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.projected_xg ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.base_ppg ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.shrinkage_weight ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.finishing_multiplier ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.opponent_adjustment ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.b2b_penalty ELSE NULL END,
    CASE WHEN NOT pps.is_goalie THEN pps.home_away_adjustment ELSE NULL END,
    
    -- Goalie fields
    CASE WHEN pps.is_goalie THEN pps.projected_wins ELSE NULL END,
    CASE WHEN pps.is_goalie THEN pps.projected_saves ELSE NULL END,
    CASE WHEN pps.is_goalie THEN pps.projected_shutouts ELSE NULL END,
    CASE WHEN pps.is_goalie THEN pps.projected_goals_against ELSE NULL END,
    CASE WHEN pps.is_goalie THEN pps.projected_gaa ELSE NULL END,
    CASE WHEN pps.is_goalie THEN pps.projected_save_pct ELSE NULL END,
    CASE WHEN pps.is_goalie THEN pps.projected_gp ELSE NULL END,
    CASE WHEN pps.is_goalie THEN pps.starter_confirmed ELSE NULL END
  FROM public.player_projected_stats pps
  WHERE pps.player_id = ANY(p_player_ids)
    AND pps.projection_date = p_target_date
  ORDER BY pps.player_id, pps.game_id;
END;
$$;

-- Update comment for function
COMMENT ON FUNCTION public.get_daily_projections IS 'Returns daily fantasy point projections for specified players on a target date. Returns all 8 skater stats (goals, assists, SOG, blocks, PPP, SHP, hits, PIM) for skaters and goalie fields for goalies based on is_goalie flag. Used by frontend to display projections in player cards.';




