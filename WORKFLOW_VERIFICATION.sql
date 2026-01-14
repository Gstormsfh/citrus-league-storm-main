-- ============================================================================
-- WORKFLOW VERIFICATION DIAGNOSTIC
-- ============================================================================
-- Run this in Supabase SQL Editor to verify all workflows are working correctly
-- ============================================================================

-- ============================================================================
-- CHECK 1: League Creation - Verify commissioner_id is set
-- ============================================================================
SELECT 
  'CHECK 1: League Commissioner Assignment' as check_name,
  COUNT(*) as total_leagues,
  COUNT(CASE WHEN commissioner_id IS NOT NULL THEN 1 END) as leagues_with_commissioner,
  COUNT(CASE WHEN commissioner_id IS NULL THEN 1 END) as leagues_missing_commissioner
FROM leagues
WHERE id != '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID; -- Exclude demo league

-- Expected: All leagues should have commissioner_id

-- ============================================================================
-- CHECK 2: League Settings - Verify teamsCount is stored
-- ============================================================================
SELECT 
  'CHECK 2: League Size Settings' as check_name,
  id,
  name,
  settings->>'teamsCount' as teams_count_setting,
  CASE 
    WHEN settings->>'teamsCount' IS NOT NULL THEN '✅ Has teamsCount'
    ELSE '❌ Missing teamsCount'
  END as status
FROM leagues
WHERE id != '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
ORDER BY created_at DESC
LIMIT 10;

-- Expected: Recent leagues should have teamsCount in settings

-- ============================================================================
-- CHECK 3: Team Count vs League Settings
-- ============================================================================
SELECT 
  'CHECK 3: Team Count vs League Settings' as check_name,
  l.id,
  l.name,
  (l.settings->>'teamsCount')::INT as max_teams,
  COUNT(t.id) as actual_teams,
  CASE 
    WHEN COUNT(t.id) <= COALESCE((l.settings->>'teamsCount')::INT, 12) THEN '✅ Within limit'
    ELSE '❌ OVER LIMIT'
  END as status
FROM leagues l
LEFT JOIN teams t ON t.league_id = l.id
WHERE l.id != '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
GROUP BY l.id, l.name, l.settings
ORDER BY l.created_at DESC
LIMIT 10;

-- Expected: All leagues should be within their max teams limit

-- ============================================================================
-- CHECK 4: New Leagues Start with Only Commissioner's Team
-- ============================================================================
SELECT 
  'CHECK 4: New League Team Count' as check_name,
  l.id,
  l.name,
  l.commissioner_id,
  COUNT(t.id) as team_count,
  COUNT(CASE WHEN t.owner_id = l.commissioner_id THEN 1 END) as commissioner_teams,
  COUNT(CASE WHEN t.owner_id IS NULL THEN 1 END) as ai_teams,
  CASE 
    WHEN COUNT(t.id) = 1 AND COUNT(CASE WHEN t.owner_id = l.commissioner_id THEN 1 END) = 1 THEN '✅ Correct (1 team: commissioner)'
    WHEN COUNT(t.id) > 1 AND l.created_at > NOW() - INTERVAL '1 hour' THEN '⚠️ Multiple teams (may be intentional)'
    ELSE '✅ OK'
  END as status
FROM leagues l
LEFT JOIN teams t ON t.league_id = l.id
WHERE l.id != '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
  AND l.created_at > NOW() - INTERVAL '24 hours' -- Check recent leagues
GROUP BY l.id, l.name, l.commissioner_id, l.created_at
ORDER BY l.created_at DESC;

-- Expected: Recent leagues should have 1 team (commissioner only)

-- ============================================================================
-- CHECK 5: Join Code Uniqueness
-- ============================================================================
SELECT 
  'CHECK 5: Join Code Uniqueness' as check_name,
  COUNT(*) as total_leagues,
  COUNT(DISTINCT join_code) as unique_join_codes,
  COUNT(*) - COUNT(DISTINCT join_code) as duplicate_join_codes,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT join_code) THEN '✅ All unique'
    ELSE '❌ DUPLICATES FOUND'
  END as status
FROM leagues
WHERE id != '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;

-- Expected: All join codes should be unique

-- ============================================================================
-- CHECK 6: RLS Policies - Verify fantasy_daily_rosters is secure
-- ============================================================================
SELECT 
  'CHECK 6: RLS Policy on fantasy_daily_rosters' as check_name,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'fantasy_daily_rosters'
ORDER BY policyname;

-- Expected: Should see "Users can update only their own team rosters" policy
-- Should NOT see "USING (true)" permissive policy

-- ============================================================================
-- CHECK 7: Join Code RLS Policy
-- ============================================================================
SELECT 
  'CHECK 7: Join Code RLS Policy' as check_name,
  schemaname,
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename = 'leagues'
  AND policyname LIKE '%join code%';

-- Expected: Should see "Authenticated users can find leagues by join code" policy

-- ============================================================================
-- CHECK 8: Waiver Concurrency Functions
-- ============================================================================
SELECT 
  'CHECK 8: Waiver Concurrency Protection' as check_name,
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'process_waiver_claims';

-- Expected: Function should exist

-- ============================================================================
-- CHECK 9: Draft Reservation Functions
-- ============================================================================
SELECT 
  'CHECK 9: Draft Reservation Functions' as check_name,
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('reserve_draft_pick', 'confirm_draft_pick', 'cleanup_expired_draft_reservations')
ORDER BY routine_name;

-- Expected: All 3 functions should exist

-- ============================================================================
-- CHECK 10: Draft Picks Reservation Columns
-- ============================================================================
SELECT 
  'CHECK 10: Draft Picks Reservation Columns' as check_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'draft_picks'
  AND column_name IN ('reserved_by', 'reserved_at', 'reservation_expires_at')
ORDER BY column_name;

-- Expected: All 3 columns should exist

-- ============================================================================
-- SUMMARY: All Checks
-- ============================================================================
SELECT 
  'SUMMARY' as check_name,
  'Run all checks above to verify workflows' as result,
  '✅ All checks should pass' as expected_status;
