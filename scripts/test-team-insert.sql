-- Test script to diagnose team INSERT issues
-- Run this in Supabase SQL Editor after applying the migration

-- 1. Check what policies exist on teams table
SELECT 
  policyname, 
  cmd, 
  qual, 
  with_check
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename = 'teams'
ORDER BY cmd, policyname;

-- 2. Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'teams';

-- 3. Check if the trigger exists
SELECT 
  trigger_name, 
  event_manipulation, 
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'teams'
AND event_object_schema = 'public';

-- 4. Check if the function exists
SELECT 
  routine_name, 
  routine_type,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'validate_team_insert';

-- 5. Test the function directly (replace with your league ID and user ID)
-- SELECT public.validate_team_insert() FROM (SELECT 'YOUR_LEAGUE_ID'::uuid as league_id, 'YOUR_USER_ID'::uuid as owner_id, 'Test Team' as team_name) as new;









