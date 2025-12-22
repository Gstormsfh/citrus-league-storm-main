-- Update calculate_daily_matchup_scores to use league scoring_settings
-- This ensures goalie scoring uses commissioner-defined weights instead of hardcoded values
-- Supports per-league customization and matches frontend logic

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
  v_goalie_wins_weight NUMERIC(10, 3) := 4.0;
  v_goalie_saves_weight NUMERIC(10, 3) := 0.2;
  v_goalie_shutouts_weight NUMERIC(10, 3) := 3.0;
  v_goalie_ga_weight NUMERIC(10, 3) := -1.0;
  v_skater_goals_weight NUMERIC(10, 3) := 3.0;
  v_skater_assists_weight NUMERIC(10, 3) := 2.0;
  v_skater_sog_weight NUMERIC(10, 3) := 0.4;
  v_skater_blocks_weight NUMERIC(10, 3) := 0.4;
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
    
    -- Skater weights (for consistency, even though they're already correct)
    IF v_scoring_settings->'skater' IS NOT NULL THEN
      v_skater_goals_weight := COALESCE(
        (v_scoring_settings->'skater'->>'goals')::numeric, 
        3.0
      );
      v_skater_assists_weight := COALESCE(
        (v_scoring_settings->'skater'->>'assists')::numeric, 
        2.0
      );
      v_skater_sog_weight := COALESCE(
        (v_scoring_settings->'skater'->>'shots_on_goal')::numeric, 
        0.4
      );
      v_skater_blocks_weight := COALESCE(
        (v_scoring_settings->'skater'->>'blocks')::numeric, 
        0.4
      );
    END IF;
  END IF;
  
  -- Generate all dates in the week (Mon-Sun) - always return 7 days
  FOR v_date IN 
    SELECT generate_series(p_week_start, p_week_end, '1 day'::interval)::DATE
  LOOP
    -- Calculate daily score for this date using league scoring settings
    -- HARD CHECK: Use player_directory.position_code for goalie detection (matches frontend)
    SELECT COALESCE(SUM(
      CASE 
        WHEN pd.position_code = 'G' OR pd.is_goalie = true THEN
          -- Goalie scoring: Use league settings (defaults: Wins=4, Saves=0.2, Shutouts=3, GA=-1)
          (COALESCE(pgs.nhl_wins, 0) * v_goalie_wins_weight) + 
          (COALESCE(pgs.nhl_saves, 0) * v_goalie_saves_weight) + 
          (COALESCE(pgs.nhl_shutouts, 0) * v_goalie_shutouts_weight) + 
          (COALESCE(pgs.nhl_goals_against, 0) * v_goalie_ga_weight)  -- Already negative, so add
        ELSE
          -- Skater scoring: Use league settings (defaults: Goals=3, Assists=2, SOG=0.4, Blocks=0.4)
          (COALESCE(pgs.nhl_goals, 0) * v_skater_goals_weight) + 
          (COALESCE(pgs.nhl_assists, 0) * v_skater_assists_weight) + 
          (COALESCE(pgs.nhl_shots_on_goal, 0) * v_skater_sog_weight) + 
          (COALESCE(pgs.nhl_blocks, 0) * v_skater_blocks_weight)
      END
    ), 0) INTO v_score
    FROM fantasy_daily_rosters fdr
    INNER JOIN matchups m ON fdr.matchup_id = m.id
    INNER JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    INNER JOIN nhl_games ng ON pgs.game_id = ng.game_id
    INNER JOIN player_directory pd ON fdr.player_id = pd.player_id 
      AND pd.season = EXTRACT(YEAR FROM v_date) -- Match season for accurate position
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

COMMENT ON FUNCTION public.calculate_daily_matchup_scores IS 'Calculates daily fantasy scores for a matchup using league scoring_settings. Uses fantasy_daily_rosters to determine active players each day, then sums NHL official stats (nhl_* columns) for those players. Uses HARD CHECK (player_directory.position_code) for goalie detection. Supports per-league customization via leagues.scoring_settings JSONB. Returns 7 daily scores (Mon-Sun).';

