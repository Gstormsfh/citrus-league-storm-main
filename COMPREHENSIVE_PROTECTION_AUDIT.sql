-- ============================================================================
-- COMPREHENSIVE PROTECTION AUDIT
-- ============================================================================
-- This verifies ALL protections are in place to prevent future data loss
-- ============================================================================

-- 1. VERIFY THE TRIGGER FIX
DO $$
DECLARE
  v_function_source TEXT;
  v_has_bug BOOLEAN := false;
  v_is_fixed BOOLEAN := false;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '1️⃣ CHECKING AUTO-SYNC TRIGGER';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  -- Get the current trigger function source
  SELECT pg_get_functiondef(oid)
  INTO v_function_source
  FROM pg_proc
  WHERE proname = 'auto_sync_team_lineup_to_daily_rosters';
  
  IF v_function_source IS NULL THEN
    RAISE WARNING '❌ CRITICAL: Trigger function does not exist!';
  ELSE
    -- Check for the BUG pattern
    IF v_function_source LIKE '%roster_date >= v_today%' AND 
       v_function_source LIKE '%DELETE FROM fantasy_daily_rosters%' THEN
      v_has_bug := true;
      RAISE WARNING '❌ CRITICAL BUG FOUND: Trigger uses roster_date >= v_today';
      RAISE WARNING '    This will DELETE TODAY''s data on every lineup update!';
      RAISE WARNING '    IMMEDIATE FIX REQUIRED: Run migration 20260115000002';
    END IF;
    
    -- Check for the FIX pattern
    IF v_function_source LIKE '%roster_date > v_today%' AND 
       v_function_source LIKE '%DELETE FROM fantasy_daily_rosters%' AND
       v_function_source NOT LIKE '%roster_date >= v_today%' THEN
      v_is_fixed := true;
      RAISE NOTICE '✅ TRIGGER IS FIXED: Uses roster_date > v_today (correct!)';
      RAISE NOTICE '    This will ONLY delete future dates, preserving TODAY.';
    END IF;
    
    IF NOT v_has_bug AND NOT v_is_fixed THEN
      RAISE WARNING '⚠️  Could not verify trigger logic - manual review needed';
    END IF;
  END IF;
  
  RAISE NOTICE '';
END $$;

-- 2. SCAN ALL FUNCTIONS FOR THE BUG PATTERN
DO $$
DECLARE
  v_func RECORD;
  v_bug_count INTEGER := 0;
BEGIN
  RAISE NOTICE '2️⃣ SCANNING ALL FUNCTIONS FOR >= BUG PATTERN';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  FOR v_func IN 
    SELECT 
      proname,
      pg_get_functiondef(oid) as source
    FROM pg_proc
    WHERE prosrc LIKE '%DELETE%fantasy_daily_rosters%'
      AND prosrc LIKE '%roster_date%'
  LOOP
    IF v_func.source LIKE '%roster_date >= %' AND 
       v_func.source LIKE '%DELETE FROM fantasy_daily_rosters%' THEN
      v_bug_count := v_bug_count + 1;
      RAISE WARNING '⚠️  Function "%" has potential >= bug', v_func.proname;
    END IF;
  END LOOP;
  
  IF v_bug_count = 0 THEN
    RAISE NOTICE '✅ No other functions have the >= bug pattern';
  ELSE
    RAISE WARNING '❌ Found % function(s) with potential >= bug!', v_bug_count;
  END IF;
  
  RAISE NOTICE '';
END $$;

-- 3. VERIFY DATA RECOVERY IS COMPLETE
DO $$
DECLARE
  v_mon_count INTEGER;
  v_tue_count INTEGER;
  v_wed_count INTEGER;
  v_thu_count INTEGER;
BEGIN
  RAISE NOTICE '3️⃣ VERIFYING DATA RECOVERY (Mon-Thu)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  SELECT COUNT(*) INTO v_mon_count FROM fantasy_daily_rosters WHERE roster_date = '2026-01-12'::DATE;
  SELECT COUNT(*) INTO v_tue_count FROM fantasy_daily_rosters WHERE roster_date = '2026-01-13'::DATE;
  SELECT COUNT(*) INTO v_wed_count FROM fantasy_daily_rosters WHERE roster_date = '2026-01-14'::DATE;
  SELECT COUNT(*) INTO v_thu_count FROM fantasy_daily_rosters WHERE roster_date = '2026-01-15'::DATE;
  
  RAISE NOTICE 'Monday Jan 12:    % entries %', v_mon_count, CASE WHEN v_mon_count > 0 THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'Tuesday Jan 13:   % entries %', v_tue_count, CASE WHEN v_tue_count > 0 THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'Wednesday Jan 14: % entries %', v_wed_count, CASE WHEN v_wed_count > 0 THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'Thursday Jan 15:  % entries %', v_thu_count, CASE WHEN v_thu_count > 0 THEN '✅' ELSE '❌' END;
  
  IF v_mon_count = 0 OR v_tue_count = 0 OR v_wed_count = 0 THEN
    RAISE WARNING '❌ Some historical days still have ZERO entries!';
  ELSE
    RAISE NOTICE '✅ All historical days have data';
  END IF;
  
  RAISE NOTICE '';
END $$;

-- 4. CHECK TEAM_LINEUPS VS FANTASY_DAILY_ROSTERS SYNC
DO $$
DECLARE
  v_mismatch_count INTEGER := 0;
  v_team RECORD;
BEGIN
  RAISE NOTICE '4️⃣ CHECKING SYNC BETWEEN team_lineups AND fantasy_daily_rosters';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  FOR v_team IN
    WITH lineup_counts AS (
      SELECT 
        tl.team_id,
        t.team_name,
        jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as total_in_lineup
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
    ),
    daily_counts AS (
      SELECT 
        fdr.team_id,
        COUNT(DISTINCT fdr.player_id) as total_in_daily
      FROM fantasy_daily_rosters fdr
      WHERE fdr.roster_date = CURRENT_DATE
      GROUP BY fdr.team_id
    )
    SELECT 
      lc.team_name,
      lc.total_in_lineup,
      COALESCE(dc.total_in_daily, 0) as total_in_daily,
      lc.total_in_lineup - COALESCE(dc.total_in_daily, 0) as difference
    FROM lineup_counts lc
    LEFT JOIN daily_counts dc ON dc.team_id = lc.team_id
    WHERE lc.total_in_lineup != COALESCE(dc.total_in_daily, 0)
  LOOP
    v_mismatch_count := v_mismatch_count + 1;
    RAISE WARNING '⚠️  % has mismatch: % in lineup vs % in daily (diff: %)', 
      v_team.team_name, v_team.total_in_lineup, v_team.total_in_daily, v_team.difference;
  END LOOP;
  
  IF v_mismatch_count = 0 THEN
    RAISE NOTICE '✅ All teams synced: team_lineups matches fantasy_daily_rosters';
  ELSE
    RAISE WARNING '❌ Found % team(s) with sync mismatches!', v_mismatch_count;
  END IF;
  
  RAISE NOTICE '';
END $$;

-- 5. VERIFY MIGRATIONS APPLIED
DO $$
BEGIN
  RAISE NOTICE '5️⃣ CHECKING APPLIED MIGRATIONS';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_migrations') THEN
    IF EXISTS (SELECT 1 FROM _migrations WHERE name LIKE '%20260115000002%') THEN
      RAISE NOTICE '✅ Trigger fix migration (20260115000002) applied';
    ELSE
      RAISE WARNING '❌ Trigger fix migration (20260115000002) NOT applied!';
    END IF;
    
    IF EXISTS (SELECT 1 FROM _migrations WHERE name LIKE '%20260115000004%') THEN
      RAISE NOTICE '✅ Wednesday recovery (20260115000004) applied';
    ELSE
      RAISE WARNING '⚠️  Wednesday recovery (20260115000004) not yet applied';
    END IF;
  ELSE
    RAISE NOTICE '⚠️  Cannot verify migrations (_migrations table not found)';
  END IF;
  
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'PROTECTION AUDIT COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Review the checks above. You are protected if:';
  RAISE NOTICE '  ✅ Trigger uses roster_date > v_today (NOT >=)';
  RAISE NOTICE '  ✅ No other functions have >= bug';
  RAISE NOTICE '  ✅ All days (Mon-Thu) have data';
  RAISE NOTICE '  ✅ team_lineups synced with fantasy_daily_rosters';
  RAISE NOTICE '  ✅ All migrations applied';
  RAISE NOTICE '';
  RAISE NOTICE 'If ALL checks pass:';
  RAISE NOTICE '  🎉 Data loss bug is ELIMINATED!';
  RAISE NOTICE '  🎉 Future data will be PROTECTED!';
  RAISE NOTICE '  🎉 No more overnight data loss!';
  RAISE NOTICE '';
  RAISE NOTICE 'If ANY check fails:';
  RAISE NOTICE '  ⚠️  Run: supabase db push (to apply remaining migrations)';
  RAISE NOTICE '  ⚠️  Or manually review the failed check';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
