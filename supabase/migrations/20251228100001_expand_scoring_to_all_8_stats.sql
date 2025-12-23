-- ============================================================================
-- EXPAND SCORING TO ALL 8 STAT CATEGORIES
-- ============================================================================
-- Updates calculate_daily_matchup_scores to use ALL commissioner-configured stats:
--   Skater: goals, assists, ppp, shp, shots_on_goal, blocks, hits, pim
--   Goalie: wins, saves, shutouts, goals_against
--
-- This matches the scoring_settings JSONB structure in leagues table
-- ============================================================================

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
  v_league_id UUID;
  -- Goalie weights (defaults match leagues.scoring_settings)
  v_goalie_wins_weight NUMERIC(10, 3) := 4.0;
  v_goalie_saves_weight NUMERIC(10, 3) := 0.2;
  v_goalie_shutouts_weight NUMERIC(10, 3) := 3.0;
  v_goalie_ga_weight NUMERIC(10, 3) := -1.0;
  -- Skater weights - ALL 8 CATEGORIES (defaults match leagues.scoring_settings)
  v_skater_goals_weight NUMERIC(10, 3) := 3.0;
  v_skater_assists_weight NUMERIC(10, 3) := 2.0;
  v_skater_ppp_weight NUMERIC(10, 3) := 1.0;      -- NEW: Power Play Points
  v_skater_shp_weight NUMERIC(10, 3) := 2.0;      -- NEW: Shorthanded Points
  v_skater_sog_weight NUMERIC(10, 3) := 0.4;
  v_skater_blocks_weight NUMERIC(10, 3) := 0.5;
  v_skater_hits_weight NUMERIC(10, 3) := 0.2;     -- NEW: Hits
  v_skater_pim_weight NUMERIC(10, 3) := 0.5;      -- NEW: Penalty Minutes
  v_scoring_settings JSONB;
BEGIN
  -- Get league_id from matchup and fetch scoring_settings
  SELECT m.league_id, l.scoring_settings
  INTO v_league_id, v_scoring_settings
  FROM matchups m
  LEFT JOIN leagues l ON m.league_id = l.id
  WHERE m.id = p_matchup_id;
  
  -- Extract scoring weights from league settings (with defaults)
  IF v_scoring_settings IS NOT NULL THEN
    -- Goalie weights
    IF v_scoring_settings->'goalie' IS NOT NULL THEN
      v_goalie_wins_weight := COALESCE(
        (v_scoring_settings->'goalie'->>'wins')::numeric, 
        4.0
      );
      v_goalie_saves_weight := COALESCE(
        (v_scoring_settings->'goalie'->>'saves')::numeric, 
        0.2
      );
      v_goalie_shutouts_weight := COALESCE(
        (v_scoring_settings->'goalie'->>'shutouts')::numeric, 
        3.0
      );
      v_goalie_ga_weight := COALESCE(
        (v_scoring_settings->'goalie'->>'goals_against')::numeric, 
        -1.0
      );
    END IF;
    
    -- Skater weights - ALL 8 CATEGORIES
    IF v_scoring_settings->'skater' IS NOT NULL THEN
      v_skater_goals_weight := COALESCE(
        (v_scoring_settings->'skater'->>'goals')::numeric, 
        3.0
      );
      v_skater_assists_weight := COALESCE(
        (v_scoring_settings->'skater'->>'assists')::numeric, 
        2.0
      );
      -- NEW: Power Play Points (key is 'power_play_points' in scoring_settings)
      v_skater_ppp_weight := COALESCE(
        (v_scoring_settings->'skater'->>'power_play_points')::numeric, 
        1.0
      );
      -- NEW: Shorthanded Points (key is 'short_handed_points' in scoring_settings)
      v_skater_shp_weight := COALESCE(
        (v_scoring_settings->'skater'->>'short_handed_points')::numeric, 
        2.0
      );
      v_skater_sog_weight := COALESCE(
        (v_scoring_settings->'skater'->>'shots_on_goal')::numeric, 
        0.4
      );
      v_skater_blocks_weight := COALESCE(
        (v_scoring_settings->'skater'->>'blocks')::numeric, 
        0.5
      );
      -- NEW: Hits
      v_skater_hits_weight := COALESCE(
        (v_scoring_settings->'skater'->>'hits')::numeric, 
        0.2
      );
      -- NEW: Penalty Minutes
      v_skater_pim_weight := COALESCE(
        (v_scoring_settings->'skater'->>'penalty_minutes')::numeric, 
        0.5
      );
    END IF;
  END IF;
  
  -- Generate all dates in the week (Mon-Sun) - always return 7 days
  FOR v_date IN 
    SELECT generate_series(p_week_start, p_week_end, '1 day'::interval)::DATE
  LOOP
    -- Calculate daily score for this date using ALL league scoring settings
    -- HARD CHECK: Use player_directory.position_code for goalie detection (matches frontend)
    -- CRITICAL: Use fallback patterns matching get_matchup_stats RPC:
    --   - Skaters: COALESCE(nhl_*, original, 0)
    --   - Goalies: COALESCE(NULLIF(nhl_*, 0), original, 0) - NULLIF needed because nhl_* may be 0 (not NULL)
    SELECT COALESCE(SUM(
      CASE 
        WHEN pd.position_code = 'G' OR pd.is_goalie = true THEN
          -- Goalie scoring: Use NULLIF fallback pattern (nhl_* may be 0, need to check original column)
          (COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) * v_goalie_wins_weight) + 
          (COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) * v_goalie_saves_weight) + 
          (COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) * v_goalie_shutouts_weight) + 
          (COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) * v_goalie_ga_weight)
        ELSE
          -- Skater scoring: Use ALL 8 league settings with fallback to original columns
          (COALESCE(pgs.nhl_goals, pgs.goals, 0) * v_skater_goals_weight) + 
          (COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0) * v_skater_assists_weight) + 
          (COALESCE(pgs.nhl_ppp, pgs.ppp, 0) * v_skater_ppp_weight) +           -- NEW: PPP with fallback
          (COALESCE(pgs.nhl_shp, pgs.shp, 0) * v_skater_shp_weight) +           -- NEW: SHP with fallback
          (COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0) * v_skater_sog_weight) + 
          (COALESCE(pgs.nhl_blocks, pgs.blocks, 0) * v_skater_blocks_weight) +
          (COALESCE(pgs.nhl_hits, pgs.hits, 0) * v_skater_hits_weight) +         -- NEW: Hits with fallback
          (COALESCE(pgs.nhl_pim, pgs.pim, 0) * v_skater_pim_weight)             -- NEW: PIM with fallback
      END
    ), 0) INTO v_score
    FROM fantasy_daily_rosters fdr
    INNER JOIN matchups m ON fdr.matchup_id = m.id
    INNER JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    INNER JOIN nhl_games ng ON pgs.game_id = ng.game_id
    INNER JOIN player_directory pd ON fdr.player_id = pd.player_id 
      AND pd.season = EXTRACT(YEAR FROM v_date)
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

COMMENT ON FUNCTION public.calculate_daily_matchup_scores IS 'Calculates daily fantasy scores using ALL 8 stat categories from leagues.scoring_settings. Skater stats: goals, assists, ppp, shp, shots_on_goal, blocks, hits, pim. Goalie stats: wins, saves, shutouts, goals_against. Uses nhl_* columns with FALLBACK to original columns (COALESCE for skaters, NULLIF pattern for goalies) to ensure data completeness. Matches get_matchup_stats RPC fallback logic.';
