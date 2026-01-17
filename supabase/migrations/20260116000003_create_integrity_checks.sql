-- ============================================================================
-- DATA INTEGRITY MONITORING SYSTEM
-- ============================================================================
-- Continuous monitoring for data anomalies and automatic alerting
-- Runs hourly to detect issues before they become critical
-- ============================================================================

-- Create integrity check results table
CREATE TABLE IF NOT EXISTS integrity_check_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  check_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'warning')),
  details TEXT,
  affected_teams TEXT[],
  auto_fixed BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_integrity_check_time 
  ON integrity_check_results(check_time DESC);

CREATE INDEX IF NOT EXISTS idx_integrity_check_status 
  ON integrity_check_results(status) WHERE status = 'fail';

-- ============================================================================
-- MAIN INTEGRITY CHECK FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION check_data_integrity()
RETURNS TABLE(
  check_name TEXT,
  status TEXT,
  details TEXT,
  affected_teams TEXT[]
) AS $$
DECLARE
  v_check_result RECORD;
  v_total_checks INTEGER := 0;
  v_passed_checks INTEGER := 0;
  v_failed_checks INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'DATA INTEGRITY CHECK - %', NOW();
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- ==========================================================================
  -- CHECK 1: team_lineups player count matches draft_picks
  -- ==========================================================================
  v_total_checks := v_total_checks + 1;
  
  FOR v_check_result IN
    WITH lineup_counts AS (
      SELECT 
        tl.team_id,
        t.team_name,
        jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as lineup_count
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
    ),
    draft_counts AS (
      SELECT 
        dp.team_id,
        COUNT(*) as draft_count
      FROM draft_picks dp
      WHERE dp.deleted_at IS NULL
      GROUP BY dp.team_id
    )
    SELECT 
      lc.team_name,
      lc.lineup_count,
      COALESCE(dc.draft_count, 0) as draft_count,
      CASE 
        WHEN lc.lineup_count = COALESCE(dc.draft_count, 0) THEN 'pass'
        ELSE 'fail'
      END as check_status,
      'team_lineups: ' || lc.lineup_count || ', draft_picks: ' || COALESCE(dc.draft_count, 0) as detail_text
    FROM lineup_counts lc
    LEFT JOIN draft_counts dc ON dc.team_id = lc.team_id
    WHERE lc.lineup_count != COALESCE(dc.draft_count, 0)
  LOOP
    v_failed_checks := v_failed_checks + 1;
    
    INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
    VALUES (
      'team_lineups_vs_draft_picks_count',
      v_check_result.check_status,
      v_check_result.detail_text,
      ARRAY[v_check_result.team_name]
    );
    
    RETURN QUERY
    SELECT 
      'team_lineups_vs_draft_picks_count'::TEXT,
      v_check_result.check_status::TEXT,
      v_check_result.team_name || ': ' || v_check_result.detail_text,
      ARRAY[v_check_result.team_name];
  END LOOP;
  
  IF v_failed_checks = 0 THEN
    v_passed_checks := v_passed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details)
    VALUES ('team_lineups_vs_draft_picks_count', 'pass', 'All teams match');
    
    RETURN QUERY
    SELECT 
      'team_lineups_vs_draft_picks_count'::TEXT,
      'pass'::TEXT,
      'All teams have matching player counts'::TEXT,
      ARRAY[]::TEXT[];
  END IF;
  
  -- ==========================================================================
  -- CHECK 2: fantasy_daily_rosters sync with team_lineups (TODAY)
  -- ==========================================================================
  v_total_checks := v_total_checks + 1;
  v_failed_checks := 0;
  
  FOR v_check_result IN
    WITH lineup_counts AS (
      SELECT 
        tl.team_id,
        t.team_name,
        jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as expected
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
    ),
    daily_counts AS (
      SELECT 
        fdr.team_id,
        COUNT(DISTINCT fdr.player_id) as actual
      FROM fantasy_daily_rosters fdr
      WHERE fdr.roster_date = CURRENT_DATE
      GROUP BY fdr.team_id
    )
    SELECT 
      lc.team_name,
      lc.expected,
      COALESCE(dc.actual, 0) as actual,
      CASE 
        WHEN lc.expected = COALESCE(dc.actual, 0) THEN 'pass'
        ELSE 'fail'
      END as check_status,
      'Expected: ' || lc.expected || ', Actual: ' || COALESCE(dc.actual, 0) as detail_text
    FROM lineup_counts lc
    LEFT JOIN daily_counts dc ON dc.team_id = lc.team_id
    WHERE lc.expected != COALESCE(dc.actual, 0)
  LOOP
    v_failed_checks := v_failed_checks + 1;
    
    INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
    VALUES (
      'fantasy_daily_rosters_sync_today',
      v_check_result.check_status,
      v_check_result.detail_text,
      ARRAY[v_check_result.team_name]
    );
    
    RETURN QUERY
    SELECT 
      'fantasy_daily_rosters_sync_today'::TEXT,
      v_check_result.check_status::TEXT,
      v_check_result.team_name || ': ' || v_check_result.detail_text,
      ARRAY[v_check_result.team_name];
  END LOOP;
  
  IF v_failed_checks = 0 THEN
    v_passed_checks := v_passed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details)
    VALUES ('fantasy_daily_rosters_sync_today', 'pass', 'All teams synced for today');
    
    RETURN QUERY
    SELECT 
      'fantasy_daily_rosters_sync_today'::TEXT,
      'pass'::TEXT,
      'All teams synced with fantasy_daily_rosters for today'::TEXT,
      ARRAY[]::TEXT[];
  END IF;
  
  -- ==========================================================================
  -- CHECK 3: No phantom players (in rosters but not in draft_picks)
  -- ==========================================================================
  v_total_checks := v_total_checks + 1;
  v_failed_checks := 0;
  
  FOR v_check_result IN
    WITH daily_players AS (
      SELECT DISTINCT
        fdr.team_id,
        fdr.player_id,
        t.team_name
      FROM fantasy_daily_rosters fdr
      JOIN teams t ON t.id = fdr.team_id
      WHERE fdr.roster_date = CURRENT_DATE
    )
    SELECT 
      dp.team_name,
      dp.player_id,
      'Phantom player in daily rosters, not in draft_picks' as detail_text
    FROM daily_players dp
    WHERE NOT EXISTS (
      SELECT 1 FROM draft_picks draft
      WHERE draft.team_id = dp.team_id
        AND draft.player_id = dp.player_id::TEXT
        AND draft.deleted_at IS NULL
    )
  LOOP
    v_failed_checks := v_failed_checks + 1;
    
    INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
    VALUES (
      'phantom_players_check',
      'warning',
      'Player ' || v_check_result.player_id || ' in rosters but not owned',
      ARRAY[v_check_result.team_name]
    );
    
    RETURN QUERY
    SELECT 
      'phantom_players_check'::TEXT,
      'warning'::TEXT,
      v_check_result.team_name || ': Player ' || v_check_result.player_id::TEXT,
      ARRAY[v_check_result.team_name];
  END LOOP;
  
  IF v_failed_checks = 0 THEN
    v_passed_checks := v_passed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details)
    VALUES ('phantom_players_check', 'pass', 'No phantom players found');
  END IF;
  
  -- ==========================================================================
  -- CHECK 4: No missing players (in draft_picks but not in team_lineups)
  -- ==========================================================================
  v_total_checks := v_total_checks + 1;
  v_failed_checks := 0;
  
  FOR v_check_result IN
    SELECT 
      t.team_name,
      dp.player_id,
      'Player owned but missing from team_lineups' as detail_text
    FROM draft_picks dp
    JOIN teams t ON t.id = dp.team_id
    JOIN team_lineups tl ON tl.team_id = t.id
    WHERE dp.deleted_at IS NULL
      AND NOT (
        tl.starters ? dp.player_id OR
        tl.bench ? dp.player_id OR
        tl.ir ? dp.player_id
      )
  LOOP
    v_failed_checks := v_failed_checks + 1;
    
    INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
    VALUES (
      'missing_players_check',
      'fail',
      'Player ' || v_check_result.player_id || ' owned but not in lineup',
      ARRAY[v_check_result.team_name]
    );
    
    RETURN QUERY
    SELECT 
      'missing_players_check'::TEXT,
      'fail'::TEXT,
      v_check_result.team_name || ': Player ' || v_check_result.player_id::TEXT,
      ARRAY[v_check_result.team_name];
  END LOOP;
  
  IF v_failed_checks = 0 THEN
    v_passed_checks := v_passed_checks + 1;
    INSERT INTO integrity_check_results (check_name, status, details)
    VALUES ('missing_players_check', 'pass', 'No missing players');
  END IF;
  
  -- ==========================================================================
  -- SUMMARY
  -- ==========================================================================
  RAISE NOTICE '';
  RAISE NOTICE 'Integrity check complete: % passed, % failed', v_passed_checks, v_total_checks - v_passed_checks;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_data_integrity IS 
'Runs comprehensive data integrity checks. Returns issues found.
Usage: SELECT * FROM check_data_integrity();';

-- ============================================================================
-- AUTO-FIX FUNCTION (Repairs detected issues)
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_fix_integrity_issues()
RETURNS TABLE(
  fix_applied TEXT,
  teams_affected INTEGER,
  players_restored INTEGER
) AS $$
DECLARE
  v_team_record RECORD;
  v_teams_fixed INTEGER := 0;
  v_players_fixed INTEGER := 0;
BEGIN
  RAISE NOTICE '[AUTO_FIX] Starting automatic integrity repairs...';
  
  -- Fix missing players (restore from draft_picks)
  FOR v_team_record IN
    SELECT DISTINCT
      t.id as team_id,
      t.team_name
    FROM draft_picks dp
    JOIN teams t ON t.id = dp.team_id
    JOIN team_lineups tl ON tl.team_id = t.id
    WHERE dp.deleted_at IS NULL
      AND NOT (
        tl.starters ? dp.player_id OR
        tl.bench ? dp.player_id OR
        tl.ir ? dp.player_id
      )
  LOOP
    -- Add missing players to bench
    UPDATE team_lineups
    SET bench = bench || jsonb_build_array(
      (SELECT jsonb_agg(dp.player_id::INTEGER)
       FROM draft_picks dp
       WHERE dp.team_id = v_team_record.team_id
         AND dp.deleted_at IS NULL
         AND NOT (
           team_lineups.starters ? dp.player_id OR
           team_lineups.bench ? dp.player_id OR
           team_lineups.ir ? dp.player_id
         ))
    )
    WHERE team_id = v_team_record.team_id;
    
    GET DIAGNOSTICS v_players_fixed = ROW_COUNT;
    v_teams_fixed := v_teams_fixed + 1;
    
    RAISE NOTICE '[AUTO_FIX] Fixed % : restored missing players', v_team_record.team_name;
  END LOOP;
  
  IF v_teams_fixed > 0 THEN
    RETURN QUERY
    SELECT 
      'restored_missing_players'::TEXT,
      v_teams_fixed,
      v_players_fixed;
  END IF;
  
  IF v_teams_fixed = 0 THEN
    RETURN QUERY
    SELECT 
      'no_issues_found'::TEXT,
      0,
      0;
  END IF;
  
  RAISE NOTICE '[AUTO_FIX] Complete: % teams fixed, % players restored', 
    v_teams_fixed, v_players_fixed;
  
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_fix_integrity_issues IS 
'Automatically repairs detected integrity issues.
Restores missing players from draft_picks to team_lineups.
Usage: SELECT * FROM auto_fix_integrity_issues();';

-- ============================================================================
-- SCHEDULED MONITORING (Optional - requires pg_cron extension)
-- ============================================================================
-- To enable hourly checks:
-- SELECT cron.schedule(
--   'hourly-integrity-check',
--   '0 * * * *', -- Every hour
--   $$ SELECT check_data_integrity() $$
-- );

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ INTEGRITY MONITORING SYSTEM INSTALLED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Available functions:';
  RAISE NOTICE '  - check_data_integrity() → Runs all integrity checks';
  RAISE NOTICE '  - auto_fix_integrity_issues() → Repairs detected issues';
  RAISE NOTICE '';
  RAISE NOTICE 'Checks performed:';
  RAISE NOTICE '  1. team_lineups player count vs draft_picks';
  RAISE NOTICE '  2. fantasy_daily_rosters sync status (today)';
  RAISE NOTICE '  3. Phantom players detection';
  RAISE NOTICE '  4. Missing players detection';
  RAISE NOTICE '';
  RAISE NOTICE 'Results logged to: integrity_check_results table';
  RAISE NOTICE '';
  RAISE NOTICE 'Run manually: SELECT * FROM check_data_integrity();';
  RAISE NOTICE 'Auto-fix: SELECT * FROM auto_fix_integrity_issues();';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
