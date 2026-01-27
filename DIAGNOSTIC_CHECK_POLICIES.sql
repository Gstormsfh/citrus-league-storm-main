-- ============================================================================
-- DIAGNOSTIC: CHECK CURRENT RLS POLICIES ON LEAGUES TABLE
-- ============================================================================
-- This will show exactly what policies exist right now
-- ============================================================================

-- Check if RLS is enabled on leagues
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'leagues';

-- List all current policies on leagues table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as policy_definition
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename = 'leagues'
ORDER BY policyname;

-- Check if the helper function exists
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('is_commissioner_of_league', 'user_owns_team_in_league_simple')
ORDER BY routine_name;
