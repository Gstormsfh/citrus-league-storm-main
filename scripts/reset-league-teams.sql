-- Nuclear option: Delete ALL AI teams from a league and start fresh
-- Use this if you want to completely reset the teams in a league
-- Replace YOUR_LEAGUE_ID with your actual league UUID

-- STEP 1: See what will be deleted
SELECT 
  id,
  team_name,
  owner_id,
  created_at
FROM public.teams
WHERE league_id = 'YOUR_LEAGUE_ID'::uuid
  AND owner_id IS NULL  -- Only AI teams (no owner)
ORDER BY created_at;

-- STEP 2: Delete all AI teams (keeps teams with owners)
-- WARNING: This permanently deletes all AI teams!
-- Uncomment the DELETE below after reviewing the SELECT results

/*
DELETE FROM public.teams
WHERE league_id = 'YOUR_LEAGUE_ID'::uuid
  AND owner_id IS NULL;
*/

-- After running this, you can use "Fill to 12 teams" again to create fresh teams









