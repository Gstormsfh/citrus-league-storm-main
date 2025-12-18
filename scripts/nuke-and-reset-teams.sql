-- Nuclear option: Delete ALL AI teams from a league, keep user teams
-- This will clean up everything so you can start fresh
-- Replace YOUR_LEAGUE_ID with your actual league UUID

-- STEP 1: See what teams exist (replace YOUR_LEAGUE_ID)
SELECT 
  id,
  team_name,
  owner_id,
  CASE 
    WHEN owner_id IS NULL THEN 'AI Team (will be deleted)'
    ELSE 'User Team (will be kept)'
  END as team_type,
  created_at
FROM public.teams
WHERE league_id = 'YOUR_LEAGUE_ID'::uuid
ORDER BY 
  CASE WHEN owner_id IS NULL THEN 1 ELSE 0 END,  -- AI teams first
  created_at;

-- STEP 2: Delete ALL AI teams (teams with no owner)
-- This keeps your team and any other user teams
-- WARNING: This permanently deletes all AI teams!
-- Replace YOUR_LEAGUE_ID with your actual league UUID, then uncomment and run:

/*
DELETE FROM public.teams
WHERE league_id = 'YOUR_LEAGUE_ID'::uuid
  AND owner_id IS NULL;
*/

-- STEP 3: Verify - should only show user teams now
-- After running the DELETE, run this to confirm:
/*
SELECT 
  id,
  team_name,
  owner_id,
  created_at
FROM public.teams
WHERE league_id = 'YOUR_LEAGUE_ID'::uuid
ORDER BY created_at;
*/

-- After this, go back to your league dashboard and click "Fill to 12 teams"
-- It will create fresh AI teams properly without duplicates!









