-- ============================================================================
-- DIAGNOSTIC: Check League Access for Specific User
-- ============================================================================
-- This script helps diagnose why a user can see leagues they shouldn't

-- STEP 1: Check which leagues are visible via RLS for current user
-- Run this while logged in as the problem user
SELECT 
  'Current User Can See These Leagues' as check_type,
  id,
  name,
  commissioner_id,
  created_at
FROM public.leagues
ORDER BY created_at DESC;

-- STEP 2: Check which teams the current user owns
SELECT 
  'Current User Owns These Teams' as check_type,
  t.id as team_id,
  t.team_name,
  t.league_id,
  l.name as league_name,
  t.owner_id,
  t.created_at
FROM public.teams t
LEFT JOIN public.leagues l ON l.id = t.league_id
WHERE t.owner_id = auth.uid()
ORDER BY t.created_at DESC;

-- STEP 3: Check Founders League specifically
-- Replace the UUID with the actual Founders League ID
SELECT 
  'Founders League Details' as check_type,
  id,
  name,
  commissioner_id,
  draft_status,
  created_at
FROM public.leagues
WHERE name = 'Founders League'
  OR id = 'e8a5cb1b-77b6-4512-ac16-6b74059631cf';

-- STEP 4: Check all teams in Founders League
SELECT 
  'All Teams in Founders League' as check_type,
  t.id as team_id,
  t.team_name,
  t.owner_id,
  u.email as owner_email,
  t.created_at
FROM public.teams t
LEFT JOIN auth.users u ON u.id = t.owner_id
WHERE t.league_id = 'e8a5cb1b-77b6-4512-ac16-6b74059631cf'
ORDER BY t.created_at;

-- STEP 5: Check if current user has ANY team in Founders League (this will show if policy is working)
SELECT 
  'Current User Teams in Founders League' as check_type,
  COUNT(*) as team_count,
  array_agg(t.id) as team_ids,
  array_agg(t.team_name) as team_names
FROM public.teams t
WHERE t.league_id = 'e8a5cb1b-77b6-4512-ac16-6b74059631cf'
  AND t.owner_id = auth.uid();

-- STEP 6: Test the helper function directly
SELECT 
  'Helper Function Test' as check_type,
  public.user_owns_team_in_league_simple('e8a5cb1b-77b6-4512-ac16-6b74059631cf') as owns_team,
  public.is_commissioner_of_league('e8a5cb1b-77b6-4512-ac16-6b74059631cf') as is_commissioner;

-- ============================================================================
-- CLEANUP: Remove orphaned teams (if needed)
-- ============================================================================
-- Uncomment and run if you find orphaned teams that shouldn't exist:
-- 
-- DELETE FROM public.teams
-- WHERE league_id = 'e8a5cb1b-77b6-4512-ac16-6b74059631cf'
--   AND owner_id = '<SPECIFIC_USER_ID_HERE>';
-- 
-- ============================================================================
