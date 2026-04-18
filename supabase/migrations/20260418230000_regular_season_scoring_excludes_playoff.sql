CREATE OR REPLACE FUNCTION public.calculate_daily_matchup_scores(p_matchup_id uuid, p_team_id uuid, p_week_start date, p_week_end date)
 RETURNS TABLE(roster_date date, daily_score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_skater_ppp_weight NUMERIC(10, 3) := 1.0;      -- Power Play Points
  v_skater_shp_weight NUMERIC(10, 3) := 2.0;      -- Shorthanded Points
  v_skater_sog_weight NUMERIC(10, 3) := 0.4;
  v_skater_blocks_weight NUMERIC(10, 3) := 0.5;
  v_skater_hits_weight NUMERIC(10, 3) := 0.2;     -- Hits
  v_skater_pim_weight NUMERIC(10, 3) := 0.5;      -- Penalty Minutes
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
      v_skater_ppp_weight := COALESCE(
        (v_scoring_settings->'skater'->>'power_play_points')::numeric, 
        1.0
      );
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
      v_skater_hits_weight := COALESCE(
        (v_scoring_settings->'skater'->>'hits')::numeric, 
        0.2
      );
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
    -- *** CRITICAL FIX: Use get_nhl_season_year() instead of EXTRACT(YEAR FROM) ***
    SELECT COALESCE(SUM(
      CASE 
        WHEN pd.position_code = 'G' OR pd.is_goalie = true THEN
          -- Goalie scoring
          (COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) * v_goalie_wins_weight) + 
          (COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) * v_goalie_saves_weight) + 
          (COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) * v_goalie_shutouts_weight) + 
          (COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) * v_goalie_ga_weight)
        ELSE
          -- Skater scoring: Use ALL 8 league settings
          (COALESCE(pgs.nhl_goals, pgs.goals, 0) * v_skater_goals_weight) + 
          (COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0) * v_skater_assists_weight) + 
          (COALESCE(pgs.nhl_ppp, pgs.ppp, 0) * v_skater_ppp_weight) +
          (COALESCE(pgs.nhl_shp, pgs.shp, 0) * v_skater_shp_weight) +
          (COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0) * v_skater_sog_weight) + 
          (COALESCE(pgs.nhl_blocks, pgs.blocks, 0) * v_skater_blocks_weight) +
          (COALESCE(pgs.nhl_hits, pgs.hits, 0) * v_skater_hits_weight) +
          (COALESCE(pgs.nhl_pim, pgs.pim, 0) * v_skater_pim_weight)
      END
    ), 0) INTO v_score
    FROM fantasy_daily_rosters fdr
    INNER JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
      AND pgs.game_date = v_date
    -- CRITICAL: exclude playoff games from regular-season fantasy scoring.
    -- The scraper writes all game stats to player_game_stats; without this
    -- filter, playoff stats leak into season-long fantasy matchups.
    INNER JOIN nhl_games g_reg ON g_reg.game_id = pgs.game_id
      AND g_reg.game_type = 'regular'
    -- *** CRITICAL FIX: Use get_nhl_season_year() instead of EXTRACT(YEAR FROM) ***
    INNER JOIN player_directory pd ON fdr.player_id = pd.player_id 
      AND pd.season = get_nhl_season_year(v_date)
    WHERE fdr.matchup_id = p_matchup_id
      AND fdr.team_id = p_team_id
      AND fdr.roster_date = v_date
      AND fdr.slot_type = 'active';
    
    -- Always return a row for this date (even if score is 0)
    RETURN QUERY SELECT v_date, COALESCE(v_score, 0);
  END LOOP;
  
  RETURN;
END;
$function$

;
