-- ============================================================================
-- VERIFICATION: Wednesday Recovery and Trigger Fix
-- ============================================================================
-- Checks:
-- 1. Wednesday (Jan 15) data is restored
-- 2. Auto-sync trigger is fixed (uses > not >=)
-- 3. No data loss pattern remains
-- ============================================================================

\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo 'VERIFICATION: Wednesday Recovery and Trigger Fix'
\echo '═══════════════════════════════════════════════════════════════'
\echo ''

-- ============================================================================
-- CHECK 1: Quick Count - Monday through Wednesday
-- ============================================================================
\echo '1️⃣ QUICK COUNT: Monday through Wednesday'
\echo ''

SELECT 
  roster_date,
  COUNT(*) as entries,
  COUNT(DISTINCT team_id) as teams,
  COUNT(DISTINCT player_id) as players,
  CASE 
    WHEN COUNT(*) = 0 THEN '❌ EMPTY!'
    WHEN COUNT(*) < 50 THEN '⚠️  LOW'
    ELSE '✅ GOOD'
  END as status
FROM fantasy_daily_rosters
WHERE roster_date >= '2026-01-13' AND roster_date <= '2026-01-15'
GROUP BY roster_date
ORDER BY roster_date;

\echo ''

-- ============================================================================
-- CHECK 2: Trigger Function Verification
-- ============================================================================
\echo '2️⃣ TRIGGER FUNCTION VERIFICATION'
\echo ''

-- Check if trigger exists
SELECT 
  'Trigger exists?' as check_name,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ YES'
    ELSE '❌ NO - PROBLEM!'
  END as result
FROM pg_trigger
WHERE tgname = 'trigger_auto_sync_roster_to_daily';

-- Check if function uses correct logic (> not >=)
DO $$
DECLARE
  v_function_source TEXT;
BEGIN
  -- Get the function source code
  SELECT pg_get_functiondef(oid)
  INTO v_function_source
  FROM pg_proc
  WHERE proname = 'auto_sync_team_lineup_to_daily_rosters';
  
  -- Check for the BUG pattern (>=)
  IF v_function_source LIKE '%roster_date >= v_today%' THEN
    RAISE WARNING '❌ BUG STILL EXISTS: Function uses roster_date >= v_today';
    RAISE WARNING 'This will continue to delete TODAY''s data!';
  ELSIF v_function_source LIKE '%roster_date > v_today%' THEN
    RAISE NOTICE '✅ FIXED: Function correctly uses roster_date > v_today';
    RAISE NOTICE 'Today''s data will be preserved.';
  ELSE
    RAISE WARNING '⚠️  Could not verify roster_date comparison in function';
  END IF;
END $$;

\echo ''

-- ============================================================================
-- CHECK 3: Data Quality - Wednesday Specific
-- ============================================================================
\echo '3️⃣ DATA QUALITY: Wednesday Jan 15'
\echo ''

-- Check Wednesday by team
SELECT 
  t.team_name,
  COUNT(*) as wednesday_entries,
  COUNT(DISTINCT CASE WHEN fdr.slot_type = 'active' THEN fdr.player_id END) as starters,
  COUNT(DISTINCT CASE WHEN fdr.slot_type = 'bench' THEN fdr.player_id END) as bench,
  COUNT(DISTINCT CASE WHEN fdr.slot_type = 'ir' THEN fdr.player_id END) as ir
FROM fantasy_daily_rosters fdr
JOIN teams t ON t.id = fdr.team_id
WHERE fdr.roster_date = '2026-01-15'::DATE
GROUP BY t.team_name
ORDER BY wednesday_entries DESC;

\echo ''

-- ============================================================================
-- CHECK 4: Compare to Source of Truth (team_lineups)
-- ============================================================================
\echo '4️⃣ SOURCE OF TRUTH COMPARISON'
\echo ''

-- Compare team_lineups (source) to fantasy_daily_rosters (synced)
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
  WHERE fdr.roster_date = '2026-01-15'::DATE
  GROUP BY fdr.team_id
)
SELECT 
  lc.team_name,
  lc.total_in_lineup as players_in_lineup,
  COALESCE(dc.total_in_daily, 0) as players_on_wednesday,
  lc.total_in_lineup - COALESCE(dc.total_in_daily, 0) as difference,
  CASE 
    WHEN lc.total_in_lineup = COALESCE(dc.total_in_daily, 0) THEN '✅ MATCH'
    WHEN lc.total_in_lineup > COALESCE(dc.total_in_daily, 0) THEN '⚠️  MISSING PLAYERS'
    ELSE '⚠️  EXTRA PLAYERS'
  END as status
FROM lineup_counts lc
LEFT JOIN daily_counts dc ON dc.team_id = lc.team_id
ORDER BY difference DESC, lc.team_name;

\echo ''

-- ============================================================================
-- CHECK 5: Verify No Future Deletions Will Happen
-- ============================================================================
\echo '5️⃣ FUTURE DELETION SAFETY CHECK'
\echo ''

-- Check if there are any suspicious DELETE patterns in active functions
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Count functions that might have the >= bug
  SELECT COUNT(*)
  INTO v_count
  FROM pg_proc
  WHERE prosrc LIKE '%DELETE%fantasy_daily_rosters%'
    AND prosrc LIKE '%roster_date >= %';
  
  IF v_count > 0 THEN
    RAISE WARNING '⚠️  Found % function(s) with potential >= bug pattern', v_count;
    RAISE WARNING 'Review all functions that DELETE from fantasy_daily_rosters';
  ELSE
    RAISE NOTICE '✅ No suspicious DELETE patterns found in functions';
  END IF;
END $$;

\echo ''

-- ============================================================================
-- SUMMARY
-- ============================================================================
\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo 'VERIFICATION SUMMARY'
\echo '═══════════════════════════════════════════════════════════════'
\echo ''
\echo 'Expected Results:'
\echo '  ✅ Wednesday (Jan 15) has data'
\echo '  ✅ Trigger function uses > (not >=)'
\echo '  ✅ All teams have matching counts'
\echo '  ✅ No suspicious DELETE patterns'
\echo ''
\echo 'If all checks pass:'
\echo '  🎉 Data loss bug is FIXED!'
\echo '  🎉 Wednesday data is RESTORED!'
\echo '  🎉 Future data loss is PREVENTED!'
\echo ''
\echo 'Next Steps:'
\echo '  1. Run: supabase db push (if not done yet)'
\echo '  2. Verify in UI: Check Matchup page for Wednesday data'
\echo '  3. Test: Edit a lineup and verify data persists'
\echo '═══════════════════════════════════════════════════════════════'
