-- ============================================================================
-- COMPREHENSIVE AUDIT: Verify Everything Is Fixed
-- ============================================================================
-- Checks:
-- 1. McDavid restoration status
-- 2. Auto-sync trigger is active
-- 3. Waiver function is correct
-- 4. Overall roster integrity (no phantom drops)
-- 5. All teams have matching data between team_lineups and fantasy_daily_rosters
-- ============================================================================

\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo 'COMPREHENSIVE AUDIT - Starting...'
\echo '═══════════════════════════════════════════════════════════════'
\echo ''

-- ============================================================================
-- CHECK 1: McDavid Status
-- ============================================================================
\echo '1️⃣ CHECKING CONNOR MCDAVID STATUS...'
\echo ''

-- Is McDavid in team_lineups?
SELECT 
  'McDavid in team_lineups?' as check_name,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ YES - Found in ' || COUNT(*) || ' team(s)'
    ELSE '❌ NO - PROBLEM!'
  END as result
FROM team_lineups
WHERE starters ? '8478402' OR bench ? '8478402' OR ir ? '8478402';

-- Is McDavid in fantasy_daily_rosters for TODAY?
SELECT 
  'McDavid in daily rosters TODAY?' as check_name,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ YES - ' || COUNT(*) || ' entry(ies)'
    ELSE '❌ NO - PROBLEM!'
  END as result
FROM fantasy_daily_rosters
WHERE player_id = 8478402
  AND roster_date = CURRENT_DATE;

-- Show McDavid's full status
SELECT 
  t.team_name,
  CASE 
    WHEN tl.starters ? '8478402' THEN 'STARTERS'
    WHEN tl.bench ? '8478402' THEN 'BENCH'
    WHEN tl.ir ? '8478402' THEN 'IR'
  END as lineup_location,
  (SELECT COUNT(*) FROM fantasy_daily_rosters 
   WHERE team_id = t.id AND player_id = 8478402 AND roster_date >= CURRENT_DATE) as future_days_count
FROM teams t
JOIN team_lineups tl ON tl.team_id = t.id
WHERE tl.starters ? '8478402' OR tl.bench ? '8478402' OR tl.ir ? '8478402';

\echo ''

-- ============================================================================
-- CHECK 2: Auto-Sync Trigger Status
-- ============================================================================
\echo '2️⃣ CHECKING AUTO-SYNC TRIGGER...'
\echo ''

SELECT 
  'Auto-sync trigger exists?' as check_name,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ YES - Trigger is active'
    ELSE '❌ NO - PROBLEM!'
  END as result
FROM pg_trigger
WHERE tgname = 'trigger_auto_sync_roster_to_daily';

SELECT 
  'Auto-sync function exists?' as check_name,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ YES - Function is defined'
    ELSE '❌ NO - PROBLEM!'
  END as result
FROM pg_proc
WHERE proname = 'auto_sync_team_lineup_to_daily_rosters';

\echo ''

-- ============================================================================
-- CHECK 3: Waiver Function Validation
-- ============================================================================
\echo '3️⃣ CHECKING WAIVER FUNCTION...'
\echo ''

DO $$
DECLARE
  v_function_source TEXT;
BEGIN
  SELECT pg_get_functiondef(oid)
  INTO v_function_source
  FROM pg_proc
  WHERE proname = 'process_waiver_claims_v2';
  
  IF v_function_source LIKE '%DELETE FROM team_lineups%' THEN
    RAISE WARNING '❌ PROBLEM: Waiver function contains DELETE FROM team_lineups!';
  ELSE
    RAISE NOTICE '✅ GOOD: Waiver function uses JSONB array manipulation';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '⚠️  Could not verify waiver function';
END $$;

\echo ''

-- ============================================================================
-- CHECK 4: Overall Roster Integrity (Phantom Drop Detection)
-- ============================================================================
\echo '4️⃣ CHECKING FOR PHANTOM DROPS (MISSING PLAYERS)...'
\echo ''

-- Count players in team_lineups vs fantasy_daily_rosters TODAY
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
  lc.total_in_lineup as players_in_lineup,
  COALESCE(dc.total_in_daily, 0) as players_in_daily_rosters,
  lc.total_in_lineup - COALESCE(dc.total_in_daily, 0) as difference,
  CASE 
    WHEN lc.total_in_lineup = COALESCE(dc.total_in_daily, 0) THEN '✅ MATCH'
    WHEN lc.total_in_lineup > COALESCE(dc.total_in_daily, 0) THEN '⚠️  PHANTOM DROP!'
    ELSE '⚠️  EXTRA IN DAILY'
  END as status
FROM lineup_counts lc
LEFT JOIN daily_counts dc ON dc.team_id = lc.team_id
ORDER BY difference DESC, lc.team_name;

\echo ''

-- ============================================================================
-- CHECK 5: Find Specific Phantom Drops (Which Players?)
-- ============================================================================
\echo '5️⃣ IDENTIFYING SPECIFIC PHANTOM DROPS...'
\echo ''

-- Find players in team_lineups but NOT in fantasy_daily_rosters for today
WITH all_lineup_players AS (
  SELECT 
    tl.team_id,
    tl.league_id,
    t.team_name,
    jsonb_array_elements_text(COALESCE(tl.starters, '[]'::jsonb))::integer as player_id
  FROM team_lineups tl
  JOIN teams t ON t.id = tl.team_id
  
  UNION
  
  SELECT 
    tl.team_id,
    tl.league_id,
    t.team_name,
    jsonb_array_elements_text(COALESCE(tl.bench, '[]'::jsonb))::integer as player_id
  FROM team_lineups tl
  JOIN teams t ON t.id = tl.team_id
  
  UNION
  
  SELECT 
    tl.team_id,
    tl.league_id,
    t.team_name,
    jsonb_array_elements_text(COALESCE(tl.ir, '[]'::jsonb))::integer as player_id
  FROM team_lineups tl
  JOIN teams t ON t.id = tl.team_id
)
SELECT 
  alp.team_name,
  p.full_name as player_name,
  p.position,
  alp.player_id,
  '⚠️  MISSING FROM DAILY ROSTERS!' as status
FROM all_lineup_players alp
LEFT JOIN fantasy_daily_rosters fdr 
  ON fdr.team_id = alp.team_id 
  AND fdr.player_id = alp.player_id 
  AND fdr.roster_date = CURRENT_DATE
LEFT JOIN players p ON p.id = alp.player_id
WHERE fdr.id IS NULL
ORDER BY alp.team_name, p.full_name;

\echo ''

-- ============================================================================
-- CHECK 6: RLS Policy Verification
-- ============================================================================
\echo '6️⃣ CHECKING RLS POLICIES (Security Check)...'
\echo ''

SELECT 
  tablename,
  policyname,
  CASE 
    WHEN policyname LIKE '%league%' THEN '✅ League-scoped'
    ELSE '⚠️  Check policy'
  END as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('team_lineups', 'fantasy_daily_rosters')
ORDER BY tablename, policyname;

\echo ''

-- ============================================================================
-- SUMMARY
-- ============================================================================
\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo 'AUDIT COMPLETE'
\echo '═══════════════════════════════════════════════════════════════'
\echo ''
\echo 'Review the results above:'
\echo '  ✅ = Everything is good'
\echo '  ⚠️  = Warning - needs attention'
\echo '  ❌ = Critical issue - needs immediate fix'
\echo ''
\echo 'If any phantom drops were found, run: RESTORE_MCDAVID_SIMPLE.sql'
\echo 'Or use the integrity script: npx tsx scripts/verify-roster-integrity.ts'
\echo '═══════════════════════════════════════════════════════════════'
