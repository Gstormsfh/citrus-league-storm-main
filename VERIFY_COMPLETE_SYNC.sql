-- ============================================================================
-- VERIFY COMPLETE SYNC: Diagnostic queries to validate roster sync
-- ============================================================================
-- This script verifies that fantasy_daily_rosters is completely synced
-- with team_lineups across ALL teams and ALL dates
-- ============================================================================

-- 1. OVERVIEW: Total counts and date coverage
DO $$
DECLARE
  v_total_rosters INTEGER;
  v_total_teams INTEGER;
  v_earliest_date DATE;
  v_latest_date DATE;
  v_dates_with_data INTEGER;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '1️⃣ OVERVIEW: fantasy_daily_rosters Coverage';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  SELECT COUNT(*) INTO v_total_rosters FROM fantasy_daily_rosters;
  SELECT COUNT(DISTINCT team_id) INTO v_total_teams FROM fantasy_daily_rosters;
  SELECT MIN(roster_date) INTO v_earliest_date FROM fantasy_daily_rosters;
  SELECT MAX(roster_date) INTO v_latest_date FROM fantasy_daily_rosters;
  SELECT COUNT(DISTINCT roster_date) INTO v_dates_with_data FROM fantasy_daily_rosters;
  
  RAISE NOTICE 'Total roster entries: %', v_total_rosters;
  RAISE NOTICE 'Teams with data: %', v_total_teams;
  RAISE NOTICE 'Date range: % to %', v_earliest_date, v_latest_date;
  RAISE NOTICE 'Days with data: %', v_dates_with_data;
  RAISE NOTICE '';
END $$;

-- 2. COMPLETENESS CHECK: Compare team_lineups vs fantasy_daily_rosters
DO $$
DECLARE
  v_team_record RECORD;
  v_mismatch_count INTEGER := 0;
BEGIN
  RAISE NOTICE '2️⃣ COMPLETENESS: team_lineups vs fantasy_daily_rosters (TODAY)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  FOR v_team_record IN
    WITH lineup_counts AS (
      SELECT 
        tl.team_id,
        t.team_name,
        l.name as league_name,
        jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) as starters,
        jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) as bench,
        jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as ir,
        jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as total_expected
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
      JOIN leagues l ON l.id = tl.league_id
    ),
    daily_counts AS (
      SELECT 
        fdr.team_id,
        COUNT(DISTINCT CASE WHEN fdr.slot_type = 'active' THEN fdr.player_id END) as starters,
        COUNT(DISTINCT CASE WHEN fdr.slot_type = 'bench' THEN fdr.player_id END) as bench,
        COUNT(DISTINCT CASE WHEN fdr.slot_type = 'ir' THEN fdr.player_id END) as ir,
        COUNT(DISTINCT fdr.player_id) as total_actual
      FROM fantasy_daily_rosters fdr
      WHERE fdr.roster_date = CURRENT_DATE
      GROUP BY fdr.team_id
    )
    SELECT 
      lc.team_name,
      lc.league_name,
      lc.starters as expected_starters,
      COALESCE(dc.starters, 0) as actual_starters,
      lc.bench as expected_bench,
      COALESCE(dc.bench, 0) as actual_bench,
      lc.ir as expected_ir,
      COALESCE(dc.ir, 0) as actual_ir,
      lc.total_expected,
      COALESCE(dc.total_actual, 0) as total_actual,
      lc.total_expected - COALESCE(dc.total_actual, 0) as difference
    FROM lineup_counts lc
    LEFT JOIN daily_counts dc ON dc.team_id = lc.team_id
    ORDER BY lc.league_name, lc.team_name
  LOOP
    IF v_team_record.difference = 0 THEN
      RAISE NOTICE '✅ [%] % : % total (S:% B:% IR:%)',
        v_team_record.league_name,
        v_team_record.team_name,
        v_team_record.total_expected,
        v_team_record.actual_starters,
        v_team_record.actual_bench,
        v_team_record.actual_ir;
    ELSE
      v_mismatch_count := v_mismatch_count + 1;
      RAISE WARNING '❌ [%] % : Expected % but got % (diff: %) - S:% vs %, B:% vs %, IR:% vs %',
        v_team_record.league_name,
        v_team_record.team_name,
        v_team_record.total_expected,
        v_team_record.total_actual,
        v_team_record.difference,
        v_team_record.expected_starters,
        v_team_record.actual_starters,
        v_team_record.expected_bench,
        v_team_record.actual_bench,
        v_team_record.expected_ir,
        v_team_record.actual_ir;
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
  IF v_mismatch_count = 0 THEN
    RAISE NOTICE '✅ ALL TEAMS IN SYNC!';
  ELSE
    RAISE WARNING '⚠️  % team(s) have mismatches!', v_mismatch_count;
  END IF;
  RAISE NOTICE '';
END $$;

-- 3. DATE COVERAGE: Entries per date (last 14 days)
DO $$
DECLARE
  v_date_record RECORD;
BEGIN
  RAISE NOTICE '3️⃣ DATE COVERAGE: Entries per date (last 14 days)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  FOR v_date_record IN
    SELECT 
      roster_date,
      COUNT(*) as total_entries,
      COUNT(DISTINCT team_id) as teams,
      COUNT(DISTINCT CASE WHEN slot_type = 'active' THEN player_id END) as starters,
      COUNT(DISTINCT CASE WHEN slot_type = 'bench' THEN player_id END) as bench,
      COUNT(DISTINCT CASE WHEN slot_type = 'ir' THEN player_id END) as ir,
      COUNT(*) FILTER (WHERE is_locked = true) as locked_entries,
      CASE 
        WHEN roster_date < CURRENT_DATE THEN '(past)'
        WHEN roster_date = CURRENT_DATE THEN '(TODAY)'
        ELSE '(future)'
      END as date_label
    FROM fantasy_daily_rosters
    WHERE roster_date >= CURRENT_DATE - INTERVAL '7 days'
      AND roster_date <= CURRENT_DATE + INTERVAL '7 days'
    GROUP BY roster_date
    ORDER BY roster_date
  LOOP
    RAISE NOTICE '% % : % entries (% teams, S:% B:% IR:%, locked:%)',
      v_date_record.roster_date,
      v_date_record.date_label,
      v_date_record.total_entries,
      v_date_record.teams,
      v_date_record.starters,
      v_date_record.bench,
      v_date_record.ir,
      v_date_record.locked_entries;
  END LOOP;
  
  RAISE NOTICE '';
END $$;

-- 4. MISSING PLAYERS: Find players in team_lineups but NOT in fantasy_daily_rosters (today)
DO $$
DECLARE
  v_missing_record RECORD;
  v_missing_count INTEGER := 0;
BEGIN
  RAISE NOTICE '4️⃣ MISSING PLAYERS: In team_lineups but NOT in fantasy_daily_rosters (TODAY)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  FOR v_missing_record IN
    WITH lineup_players AS (
      SELECT 
        tl.team_id,
        t.team_name,
        l.name as league_name,
        jsonb_array_elements_text(tl.starters)::integer as player_id,
        'starters' as source
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
      JOIN leagues l ON l.id = tl.league_id
      WHERE tl.starters IS NOT NULL
      
      UNION ALL
      
      SELECT 
        tl.team_id,
        t.team_name,
        l.name as league_name,
        jsonb_array_elements_text(tl.bench)::integer as player_id,
        'bench' as source
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
      JOIN leagues l ON l.id = tl.league_id
      WHERE tl.bench IS NOT NULL
      
      UNION ALL
      
      SELECT 
        tl.team_id,
        t.team_name,
        l.name as league_name,
        jsonb_array_elements_text(tl.ir)::integer as player_id,
        'ir' as source
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
      JOIN leagues l ON l.id = tl.league_id
      WHERE tl.ir IS NOT NULL
    )
    SELECT 
      lp.league_name,
      lp.team_name,
      lp.player_id,
      p.full_name,
      lp.source
    FROM lineup_players lp
    LEFT JOIN players p ON p.id = lp.player_id
    WHERE NOT EXISTS (
      SELECT 1 
      FROM fantasy_daily_rosters fdr 
      WHERE fdr.team_id = lp.team_id 
        AND fdr.player_id = lp.player_id 
        AND fdr.roster_date = CURRENT_DATE
    )
    ORDER BY lp.league_name, lp.team_name, lp.source, p.full_name
  LOOP
    v_missing_count := v_missing_count + 1;
    RAISE WARNING '❌ [%] % : Missing player % (%) from %',
      v_missing_record.league_name,
      v_missing_record.team_name,
      v_missing_record.full_name,
      v_missing_record.player_id,
      v_missing_record.source;
  END LOOP;
  
  IF v_missing_count = 0 THEN
    RAISE NOTICE '✅ No missing players! All team_lineups synced to fantasy_daily_rosters.';
  ELSE
    RAISE WARNING '⚠️  Found % missing player(s)!', v_missing_count;
  END IF;
  
  RAISE NOTICE '';
END $$;

-- 5. PHANTOM PLAYERS: Find players in fantasy_daily_rosters but NOT in team_lineups (today)
DO $$
DECLARE
  v_phantom_record RECORD;
  v_phantom_count INTEGER := 0;
BEGIN
  RAISE NOTICE '5️⃣ PHANTOM PLAYERS: In fantasy_daily_rosters but NOT in team_lineups (TODAY)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  FOR v_phantom_record IN
    WITH daily_players AS (
      SELECT DISTINCT
        fdr.team_id,
        fdr.player_id,
        fdr.slot_type,
        t.team_name,
        l.name as league_name,
        p.full_name
      FROM fantasy_daily_rosters fdr
      JOIN teams t ON t.id = fdr.team_id
      JOIN leagues l ON l.id = t.league_id
      LEFT JOIN players p ON p.id = fdr.player_id
      WHERE fdr.roster_date = CURRENT_DATE
    )
    SELECT 
      dp.league_name,
      dp.team_name,
      dp.player_id,
      dp.full_name,
      dp.slot_type
    FROM daily_players dp
    JOIN team_lineups tl ON tl.team_id = dp.team_id
    WHERE NOT (
      (tl.starters ? dp.player_id::text) OR
      (tl.bench ? dp.player_id::text) OR
      (tl.ir ? dp.player_id::text)
    )
    ORDER BY dp.league_name, dp.team_name, dp.full_name
  LOOP
    v_phantom_count := v_phantom_count + 1;
    RAISE WARNING '⚠️  [%] % : Phantom player % (%) in %',
      v_phantom_record.league_name,
      v_phantom_record.team_name,
      v_phantom_record.full_name,
      v_phantom_record.player_id,
      v_phantom_record.slot_type;
  END LOOP;
  
  IF v_phantom_count = 0 THEN
    RAISE NOTICE '✅ No phantom players! fantasy_daily_rosters matches team_lineups.';
  ELSE
    RAISE WARNING '⚠️  Found % phantom player(s) - these are in daily rosters but not in team lineups!', v_phantom_count;
  END IF;
  
  RAISE NOTICE '';
END $$;

-- 6. TRIGGER STATUS: Verify auto-sync trigger is enabled and correct
DO $$
DECLARE
  v_trigger_exists BOOLEAN;
  v_function_source TEXT;
BEGIN
  RAISE NOTICE '6️⃣ TRIGGER STATUS: Auto-sync trigger verification';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  -- Check if trigger exists
  SELECT EXISTS (
    SELECT 1 
    FROM pg_trigger 
    WHERE tgname = 'trigger_auto_sync_roster_to_daily'
  ) INTO v_trigger_exists;
  
  IF v_trigger_exists THEN
    RAISE NOTICE '✅ Trigger exists: trigger_auto_sync_roster_to_daily';
    
    -- Check function source for the bug
    SELECT pg_get_functiondef(oid)
    INTO v_function_source
    FROM pg_proc
    WHERE proname = 'auto_sync_team_lineup_to_daily_rosters';
    
    IF v_function_source LIKE '%roster_date > v_today%' AND 
       v_function_source NOT LIKE '%roster_date >= v_today%' THEN
      RAISE NOTICE '✅ Trigger function is FIXED (uses roster_date > v_today)';
    ELSIF v_function_source LIKE '%roster_date >= v_today%' THEN
      RAISE WARNING '❌ Trigger function has BUG (uses roster_date >= v_today)!';
      RAISE WARNING '   Run migration 20260115000002 to fix!';
    ELSE
      RAISE NOTICE '⚠️  Could not verify trigger logic - manual review needed';
    END IF;
  ELSE
    RAISE WARNING '❌ Trigger does NOT exist!';
    RAISE WARNING '   Run migration 20260115000001 (or 20260115000002) to create it';
  END IF;
  
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '📋 VERIFICATION COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Review the checks above. You are synced if:';
  RAISE NOTICE '  ✅ All teams show matching counts (check #2)';
  RAISE NOTICE '  ✅ All dates have data (check #3)';
  RAISE NOTICE '  ✅ No missing players (check #4)';
  RAISE NOTICE '  ✅ No phantom players (check #5)';
  RAISE NOTICE '  ✅ Trigger is enabled and fixed (check #6)';
  RAISE NOTICE '';
  RAISE NOTICE 'If ALL checks pass:';
  RAISE NOTICE '  🎉 Roster sync is COMPLETE!';
  RAISE NOTICE '  🎉 Matchup tab should show complete rosters!';
  RAISE NOTICE '  🎉 All dates (past, today, future) should work!';
  RAISE NOTICE '';
  RAISE NOTICE 'If ANY check fails:';
  RAISE NOTICE '  ⚠️  Review the warnings above';
  RAISE NOTICE '  ⚠️  Run: supabase db push (to apply remaining migrations)';
  RAISE NOTICE '  ⚠️  Consider running AUTO_FIX_PHANTOM_DROPS.sql if needed';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
