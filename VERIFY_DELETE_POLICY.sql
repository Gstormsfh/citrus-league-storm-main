-- ============================================================================
-- VERIFY DELETE POLICY EXISTS
-- ============================================================================
-- Run this in Supabase SQL Editor to check if the DELETE policy was created
-- ============================================================================

-- Check if the policy exists
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'teams'
  AND cmd = 'DELETE';

-- Expected result: Should show one row with policy name
-- "Commissioners can delete teams in their leagues"

-- ============================================================================
-- TEST THE POLICY FUNCTION
-- ============================================================================
-- Check if is_commissioner_of_league function exists and works
SELECT 
  routine_name,
  routine_type,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'is_commissioner_of_league';

-- ============================================================================
-- CHECK CURRENT USER AND LEAGUE
-- ============================================================================
-- Replace 'YOUR_LEAGUE_ID' with an actual league ID to test
-- SELECT 
--   auth.uid() as current_user_id,
--   l.id as league_id,
--   l.commissioner_id,
--   l.name as league_name,
--   public.is_commissioner_of_league(l.id) as is_commissioner
-- FROM public.leagues l
-- WHERE l.id = 'YOUR_LEAGUE_ID';
