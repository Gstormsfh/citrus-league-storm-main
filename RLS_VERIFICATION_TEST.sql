-- ============================================================================
-- SIMPLIFIED RLS VERIFICATION
-- ============================================================================
-- Run this while logged in as the problem user

-- Test 1: Can you see Founders League at all?
SELECT 
  'TEST 1: Direct League Query' as test_name,
  COUNT(*) as can_see_founders_league
FROM public.leagues
WHERE id = 'e8a5cb1b-77b6-4512-ac16-6b74059631cf';
-- Expected: 0 (if RLS is working and user is not a member)
-- Actual: ??? (probably 1, meaning RLS is not blocking)

-- Test 2: What is the current user ID?
SELECT 
  'TEST 2: Current User' as test_name,
  auth.uid() as current_user_id;

-- Test 3: Is RLS actually enabled on leagues table?
SELECT 
  'TEST 3: RLS Status' as test_name,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename = 'leagues';
-- Expected: rls_enabled = true

-- Test 4: What RLS policies exist on leagues table?
SELECT 
  'TEST 4: Active Policies' as test_name,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as policy_definition
FROM pg_policies
WHERE tablename = 'leagues'
ORDER BY policyname;

-- Test 5: Do you own any teams in Founders League?
SELECT 
  'TEST 5: Your Teams in Founders' as test_name,
  COUNT(*) as team_count
FROM public.teams
WHERE league_id = 'e8a5cb1b-77b6-4512-ac16-6b74059631cf'
  AND owner_id = auth.uid();
-- Expected: 0

-- Test 6: Who is the commissioner of Founders League?
SELECT 
  'TEST 6: Founders Commissioner' as test_name,
  commissioner_id,
  CASE 
    WHEN commissioner_id = auth.uid() THEN 'YOU ARE COMMISSIONER'
    ELSE 'Someone else is commissioner'
  END as commissioner_status
FROM public.leagues
WHERE id = 'e8a5cb1b-77b6-4512-ac16-6b74059631cf';
