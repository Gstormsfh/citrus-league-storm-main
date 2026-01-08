-- ============================================================================
-- FIX: NHL Season Year Calculation for RPC Joins
-- ============================================================================
-- Problem: RPCs use EXTRACT(YEAR FROM date) which returns 2026 for dates like
-- 2026-01-07, but player_directory stores season = 2025 for the 2025-2026
-- NHL season. This causes INNER JOINs to fail, returning 0 players.
--
-- Solution: Create get_nhl_season_year() function that correctly determines
-- the NHL season year:
--   - October-December (months 10-12): season = current year (e.g., Oct 2025 → 2025)
--   - January-September (months 1-9): season = previous year (e.g., Jan 2026 → 2025)
--
-- This is world-class and scalable - works for any NHL season without changes.
-- ============================================================================


-- =============================================================================
-- STEP 1: Create the get_nhl_season_year function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_nhl_season_year(p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_year INTEGER;
  v_month INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date);
  v_month := EXTRACT(MONTH FROM p_date);
  
  -- NHL seasons run from October to June of the following year
  -- October-December (months 10-12): season year = current year
  -- January-September (months 1-9): season year = previous year
  IF v_month >= 10 THEN
    RETURN v_year;  -- Oct, Nov, Dec → current year (e.g., Oct 2025 → 2025)
  ELSE
    RETURN v_year - 1;  -- Jan-Sep → previous year (e.g., Jan 2026 → 2025)
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_nhl_season_year IS 
'Determines the NHL season year for a given date. NHL seasons run Oct-Jun, so dates in Oct-Dec use current year, dates in Jan-Sep use previous year. Example: 2026-01-07 → 2025 (2025-2026 season). IMMUTABLE for query optimization.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_nhl_season_year(DATE) TO anon, authenticated;


-- =============================================================================
-- STEP 2: Update get_daily_lineup RPC to use get_nhl_season_year()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_daily_lineup(
  p_team_id UUID,
  p_matchup_id UUID,
  p_date DATE
)
RETURNS TABLE (
  player_id INTEGER,
  player_name TEXT,
  player_position TEXT,
  nhl_team TEXT,
  headshot_url TEXT,
  slot_type TEXT,
  slot_id TEXT,
  is_locked BOOLEAN,
  -- Daily stats
  daily_points NUMERIC(10, 3),
  goals INTEGER,
  assists INTEGER,
  shots_on_goal INTEGER,
  blocks INTEGER,
  hits INTEGER,
  pim INTEGER,
  ppp INTEGER,
  shp INTEGER,
  -- Goalie stats
  wins INTEGER,
  saves INTEGER,
  goals_against INTEGER,
  shutouts INTEGER,
  is_goalie BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID;
  -- Scoring weights
  v_goalie_wins_weight NUMERIC(10, 3) := 4.0;
  v_goalie_saves_weight NUMERIC(10, 3) := 0.2;
  v_goalie_shutouts_weight NUMERIC(10, 3) := 3.0;
  v_goalie_ga_weight NUMERIC(10, 3) := -1.0;
  v_skater_goals_weight NUMERIC(10, 3) := 3.0;
  v_skater_assists_weight NUMERIC(10, 3) := 2.0;
  v_skater_ppp_weight NUMERIC(10, 3) := 1.0;
  v_skater_shp_weight NUMERIC(10, 3) := 2.0;
  v_skater_sog_weight NUMERIC(10, 3) := 0.4;
  v_skater_blocks_weight NUMERIC(10, 3) := 0.5;
  v_skater_hits_weight NUMERIC(10, 3) := 0.2;
  v_skater_pim_weight NUMERIC(10, 3) := 0.5;
  v_scoring_settings JSONB;
BEGIN
  -- Get league scoring settings
  SELECT m.league_id, l.scoring_settings
  INTO v_league_id, v_scoring_settings
  FROM matchups m
  LEFT JOIN leagues l ON m.league_id = l.id
  WHERE m.id = p_matchup_id;
  
  -- Extract scoring weights from league settings (with defaults)
  IF v_scoring_settings IS NOT NULL THEN
    IF v_scoring_settings->'goalie' IS NOT NULL THEN
      v_goalie_wins_weight := COALESCE((v_scoring_settings->'goalie'->>'wins')::numeric, 4.0);
      v_goalie_saves_weight := COALESCE((v_scoring_settings->'goalie'->>'saves')::numeric, 0.2);
      v_goalie_shutouts_weight := COALESCE((v_scoring_settings->'goalie'->>'shutouts')::numeric, 3.0);
      v_goalie_ga_weight := COALESCE((v_scoring_settings->'goalie'->>'goals_against')::numeric, -1.0);
    END IF;
    
    IF v_scoring_settings->'skater' IS NOT NULL THEN
      v_skater_goals_weight := COALESCE((v_scoring_settings->'skater'->>'goals')::numeric, 3.0);
      v_skater_assists_weight := COALESCE((v_scoring_settings->'skater'->>'assists')::numeric, 2.0);
      v_skater_ppp_weight := COALESCE((v_scoring_settings->'skater'->>'power_play_points')::numeric, 1.0);
      v_skater_shp_weight := COALESCE((v_scoring_settings->'skater'->>'short_handed_points')::numeric, 2.0);
      v_skater_sog_weight := COALESCE((v_scoring_settings->'skater'->>'shots_on_goal')::numeric, 0.4);
      v_skater_blocks_weight := COALESCE((v_scoring_settings->'skater'->>'blocks')::numeric, 0.5);
      v_skater_hits_weight := COALESCE((v_scoring_settings->'skater'->>'hits')::numeric, 0.2);
      v_skater_pim_weight := COALESCE((v_scoring_settings->'skater'->>'penalty_minutes')::numeric, 0.5);
    END IF;
  END IF;

  RETURN QUERY
  SELECT 
    fdr.player_id,
    pd.full_name AS player_name,
    pd.position_code AS player_position,
    pd.team_abbrev AS nhl_team,
    pd.headshot_url,
    fdr.slot_type,
    fdr.slot_id,
    fdr.is_locked,
    -- Calculate daily fantasy points
    COALESCE(
      CASE 
        WHEN pd.position_code = 'G' OR pd.is_goalie = true THEN
          (COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0) * v_goalie_wins_weight) + 
          (COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0) * v_goalie_saves_weight) + 
          (COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0) * v_goalie_shutouts_weight) + 
          (COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0) * v_goalie_ga_weight)
        ELSE
          (COALESCE(pgs.nhl_goals, pgs.goals, 0) * v_skater_goals_weight) + 
          (COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0) * v_skater_assists_weight) + 
          (COALESCE(pgs.nhl_ppp, pgs.ppp, 0) * v_skater_ppp_weight) +
          (COALESCE(pgs.nhl_shp, pgs.shp, 0) * v_skater_shp_weight) +
          (COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0) * v_skater_sog_weight) + 
          (COALESCE(pgs.nhl_blocks, pgs.blocks, 0) * v_skater_blocks_weight) +
          (COALESCE(pgs.nhl_hits, pgs.hits, 0) * v_skater_hits_weight) +
          (COALESCE(pgs.nhl_pim, pgs.pim, 0) * v_skater_pim_weight)
      END
    , 0)::NUMERIC(10, 3) AS daily_points,
    -- Skater stats
    COALESCE(pgs.nhl_goals, pgs.goals, 0)::INTEGER AS goals,
    COALESCE(pgs.nhl_assists, pgs.primary_assists + pgs.secondary_assists, 0)::INTEGER AS assists,
    COALESCE(pgs.nhl_shots_on_goal, pgs.shots_on_goal, 0)::INTEGER AS shots_on_goal,
    COALESCE(pgs.nhl_blocks, pgs.blocks, 0)::INTEGER AS blocks,
    COALESCE(pgs.nhl_hits, pgs.hits, 0)::INTEGER AS hits,
    COALESCE(pgs.nhl_pim, pgs.pim, 0)::INTEGER AS pim,
    COALESCE(pgs.nhl_ppp, pgs.ppp, 0)::INTEGER AS ppp,
    COALESCE(pgs.nhl_shp, pgs.shp, 0)::INTEGER AS shp,
    -- Goalie stats
    COALESCE(NULLIF(pgs.nhl_wins, 0), pgs.wins, 0)::INTEGER AS wins,
    COALESCE(NULLIF(pgs.nhl_saves, 0), pgs.saves, 0)::INTEGER AS saves,
    COALESCE(NULLIF(pgs.nhl_goals_against, 0), pgs.goals_against, 0)::INTEGER AS goals_against,
    COALESCE(NULLIF(pgs.nhl_shutouts, 0), pgs.shutouts, 0)::INTEGER AS shutouts,
    COALESCE(pd.is_goalie, pd.position_code = 'G') AS is_goalie
  FROM fantasy_daily_rosters fdr
  -- *** CRITICAL FIX: Use get_nhl_season_year() instead of EXTRACT(YEAR FROM) ***
  INNER JOIN player_directory pd ON fdr.player_id = pd.player_id 
    AND pd.season = get_nhl_season_year(p_date)
  LEFT JOIN player_game_stats pgs ON fdr.player_id = pgs.player_id
    AND pgs.game_date = p_date
  WHERE fdr.team_id = p_team_id
    AND fdr.matchup_id = p_matchup_id
    AND fdr.roster_date = p_date
  ORDER BY 
    CASE fdr.slot_type 
      WHEN 'active' THEN 1 
      WHEN 'bench' THEN 2 
      WHEN 'ir' THEN 3 
    END,
    fdr.slot_id;
END;
$$;

COMMENT ON FUNCTION public.get_daily_lineup IS 
'Returns complete daily lineup with player data for display. FIXED: Now uses get_nhl_season_year() to correctly join with player_directory for any NHL season (works for 2025-2026, 2026-2027, etc.).';


-- =============================================================================
-- STEP 3: Update calculate_daily_matchup_scores RPC to use get_nhl_season_year()
-- =============================================================================

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
$$;

COMMENT ON FUNCTION public.calculate_daily_matchup_scores IS 
'Calculates daily fantasy scores using ALL 8 stat categories. FIXED: Now uses get_nhl_season_year() to correctly join with player_directory for any NHL season (works for 2025-2026, 2026-2027, etc.).';


-- =============================================================================
-- STEP 4: Verification test (run manually to confirm fix works)
-- =============================================================================

-- Test the new function:
-- SELECT get_nhl_season_year('2026-01-07'::DATE);  -- Should return 2025
-- SELECT get_nhl_season_year('2025-10-15'::DATE);  -- Should return 2025
-- SELECT get_nhl_season_year('2025-09-15'::DATE);  -- Should return 2024 (preseason)
-- SELECT get_nhl_season_year('2026-06-30'::DATE);  -- Should return 2025 (playoffs)

-- Confirm player_directory has 2025 season data:
-- SELECT COUNT(*), season FROM player_directory GROUP BY season;


