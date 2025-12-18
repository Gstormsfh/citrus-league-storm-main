-- Comprehensive cleanup: See and delete ALL AI teams
-- This script helps you see everything and clean it up

-- STEP 1: See ALL teams across ALL leagues
-- This shows you everything that exists
SELECT 
  t.id,
  t.league_id,
  l.name as league_name,
  t.team_name,
  t.owner_id,
  CASE 
    WHEN t.owner_id IS NULL THEN 'AI Team'
    ELSE 'User Team'
  END as team_type,
  t.created_at
FROM public.teams t
LEFT JOIN public.leagues l ON l.id = t.league_id
ORDER BY 
  t.league_id,
  CASE WHEN t.owner_id IS NULL THEN 1 ELSE 0 END,
  t.created_at;

-- STEP 2: Count teams per league
-- See how many teams are in each league
SELECT 
  l.id as league_id,
  l.name as league_name,
  COUNT(*) as total_teams,
  COUNT(CASE WHEN t.owner_id IS NULL THEN 1 END) as ai_teams,
  COUNT(CASE WHEN t.owner_id IS NOT NULL THEN 1 END) as user_teams
FROM public.leagues l
LEFT JOIN public.teams t ON t.league_id = l.id
GROUP BY l.id, l.name
ORDER BY l.created_at DESC;

-- STEP 3: Delete ALL AI teams from a specific league
-- Replace YOUR_LEAGUE_ID with your actual league UUID
-- Uncomment and run after reviewing Step 1 and 2

/*
DELETE FROM public.teams
WHERE league_id = 'YOUR_LEAGUE_ID'::uuid
  AND owner_id IS NULL;
*/

-- STEP 4: Nuclear option - Delete ALL AI teams from ALL leagues
-- WARNING: This deletes ALL AI teams everywhere!
-- Only use this if you want to clean up everything
-- Uncomment to use:

/*
DELETE FROM public.teams
WHERE owner_id IS NULL;
*/

-- STEP 5: Verify cleanup
-- After deleting, run this to see what's left
/*
SELECT 
  t.id,
  t.league_id,
  l.name as league_name,
  t.team_name,
  t.owner_id,
  t.created_at
FROM public.teams t
LEFT JOIN public.leagues l ON l.id = t.league_id
ORDER BY t.league_id, t.created_at;
*/









