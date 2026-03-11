-- Fix calculate_daily_matchup_scores to include ALL 8 skater stats and correct weights
--
-- CRITICAL FIX: The previous version only scored 4 of 8 skater stats:
--   - MISSING: PPP (1.0), SHP (2.0), Hits (0.2), PIM (0.5)
--   - WRONG:   Blocks was 0.4, should be 0.5
--   - WRONG:   Goalie Wins was 5.0, should be 4.0
--
-- Now matches frontend DEFAULT_SCORING in src/utils/scoringUtils.ts:
--   Skater: Goals=3, Assists=2, PPP=1, SHP=2, SOG=0.4, Blocks=0.5, Hits=0.2, PIM=0.5
--   Goalie: Wins=4, Saves=0.2, Shutouts=3, GA=-1

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
    -- Calculate daily score for this date using ALL 8 skater stats
    SELECT COALESCE(SUM(
      CASE
        WHEN pgs.is_goalie = false THEN
          -- Skater scoring: ALL 8 categories
          (COALESCE(pgs.nhl_goals, 0) * 3.0) +           -- Goals: 3 pts
          (COALESCE(pgs.nhl_assists, 0) * 2.0) +          -- Assists: 2 pts
          (COALESCE(pgs.nhl_ppp, 0) * 1.0) +              -- PPP: 1 pt
          (COALESCE(pgs.nhl_shp, 0) * 2.0) +              -- SHP: 2 pts
          (COALESCE(pgs.nhl_shots_on_goal, 0) * 0.4) +    -- SOG: 0.4 pts
          (COALESCE(pgs.nhl_blocks, 0) * 0.5) +           -- Blocks: 0.5 pts
          (COALESCE(pgs.nhl_hits, 0) * 0.2) +             -- Hits: 0.2 pts
          (COALESCE(pgs.nhl_pim, 0) * 0.5)                -- PIM: 0.5 pts
        -- Goalie scoring: Wins (4), Saves (0.2), Shutouts (3), GA penalty (-1)
        ELSE
          (COALESCE(pgs.nhl_wins, 0) * 4.0) +             -- Wins: 4 pts
          (COALESCE(pgs.nhl_saves, 0) * 0.2) +            -- Saves: 0.2 pts
          (COALESCE(pgs.nhl_shutouts, 0) * 3.0) -         -- Shutouts: 3 pts
          (COALESCE(pgs.nhl_goals_against, 0) * 1.0)      -- GA penalty: -1 pt
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

COMMENT ON FUNCTION public.calculate_daily_matchup_scores IS 'Calculates daily fantasy scores for a matchup using ALL 8 skater stats + 4 goalie stats. Uses fantasy_daily_rosters to determine active players each day, then sums NHL official stats (nhl_* columns). Weights match frontend DEFAULT_SCORING in scoringUtils.ts.';
