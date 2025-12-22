-- Create RPC function to calculate daily matchup scores
-- Uses fantasy_daily_rosters to determine which players were active each day
-- Sums fantasy points from player_game_stats.nhl_* columns for active players only
-- Returns array of 7 daily scores (Mon-Sun)

CREATE OR REPLACE FUNCTION public.calculate_daily_matchup_scores(
  p_matchup_id UUID,
  p_team_id UUID,
  p_week_start DATE,
  p_week_end DATE
)
RETURNS TABLE (
  roster_date DATE,
  daily_score NUMERIC(10, 3)
) 
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE;
  v_score NUMERIC(10, 3);
BEGIN
  -- Generate all dates in the week (Mon-Sun) - always return 7 days
  FOR v_date IN 
    SELECT generate_series(p_week_start, p_week_end, '1 day'::interval)::DATE
  LOOP
    -- Calculate daily score for this date
    SELECT COALESCE(SUM(
      -- Skater scoring: Goals (3), Assists (2), SOG (0.4), Blocks (0.4)
      CASE 
        WHEN pgs.is_goalie = false THEN
          (pgs.nhl_goals * 3.0) + 
          (pgs.nhl_assists * 2.0) + 
          (pgs.nhl_shots_on_goal * 0.4) + 
          (pgs.nhl_blocks * 0.4)
        -- Goalie scoring: Wins (5), Saves (0.2), Shutouts (3), GA penalty (-1)
        ELSE
          (pgs.nhl_wins * 5.0) + 
          (pgs.nhl_saves * 0.2) + 
          (pgs.nhl_shutouts * 3.0) - 
          (pgs.nhl_goals_against * 1.0)
      END
    ), 0) INTO v_score
    FROM fantasy_daily_rosters fdr
    INNER JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    INNER JOIN nhl_games ng ON pgs.game_id = ng.game_id
    WHERE fdr.matchup_id = p_matchup_id
      AND fdr.team_id = p_team_id
      AND fdr.roster_date = v_date
      AND fdr.slot_type = 'active'
      AND ng.game_date = v_date;
    
    -- Always return a row for this date (even if score is 0)
    RETURN QUERY SELECT v_date, COALESCE(v_score, 0);
  END LOOP;
  
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_daily_matchup_scores(UUID, UUID, DATE, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.calculate_daily_matchup_scores(UUID, UUID, DATE, DATE) TO anon, authenticated;

COMMENT ON FUNCTION public.calculate_daily_matchup_scores IS 'Calculates daily fantasy scores for a matchup. Uses fantasy_daily_rosters to determine active players each day, then sums NHL official stats (nhl_* columns) for those players. Returns 7 daily scores (Mon-Sun).';
