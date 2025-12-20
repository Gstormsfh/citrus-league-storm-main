-- Create RPC function to get daily projections for frontend queries
-- Returns projection data for specified players on a target date
-- Used by MatchupService to fetch projections for player cards

CREATE OR REPLACE FUNCTION public.get_daily_projections(
  p_player_ids INTEGER[],
  p_target_date DATE
)
RETURNS TABLE (
  player_id INTEGER,
  game_id INTEGER,
  projection_date DATE,
  projected_goals NUMERIC,
  projected_assists NUMERIC,
  projected_sog NUMERIC,
  projected_blocks NUMERIC,
  projected_xg NUMERIC,
  total_projected_points NUMERIC,
  base_ppg NUMERIC,
  shrinkage_weight NUMERIC,
  finishing_multiplier NUMERIC,
  opponent_adjustment NUMERIC,
  b2b_penalty NUMERIC,
  home_away_adjustment NUMERIC,
  confidence_score NUMERIC,
  calculation_method TEXT
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
    pps.projected_goals,
    pps.projected_assists,
    pps.projected_sog,
    pps.projected_blocks,
    pps.projected_xg,
    pps.total_projected_points,
    pps.base_ppg,
    pps.shrinkage_weight,
    pps.finishing_multiplier,
    pps.opponent_adjustment,
    pps.b2b_penalty,
    pps.home_away_adjustment,
    pps.confidence_score,
    pps.calculation_method
  FROM public.player_projected_stats pps
  WHERE pps.player_id = ANY(p_player_ids)
    AND pps.projection_date = p_target_date
  ORDER BY pps.player_id, pps.game_id;
END;
$$;

-- Add comment for function
COMMENT ON FUNCTION public.get_daily_projections IS 'Returns daily fantasy point projections for specified players on a target date. Used by frontend to display projections in player cards with full model transparency for tooltips.';
