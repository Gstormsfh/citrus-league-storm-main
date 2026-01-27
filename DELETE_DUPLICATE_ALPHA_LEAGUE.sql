-- ============================================================================
-- Delete Duplicate "The Alpha League" - Keep the Most Recent One
-- ============================================================================
-- This script will:
-- 1. Show both Alpha Leagues
-- 2. Delete the OLDER one (keep the most recent)
-- ============================================================================

-- STEP 1: Show both Alpha Leagues to confirm
SELECT 
  l.id,
  l.name,
  l.commissioner_id,
  p.username as commissioner_username,
  l.created_at,
  (SELECT COUNT(*) FROM teams WHERE league_id = l.id) as team_count,
  l.draft_status,
  l.join_code
FROM leagues l
LEFT JOIN profiles p ON l.commissioner_id = p.id
WHERE l.name = 'The Alpha League'
ORDER BY l.created_at DESC;

-- STEP 2: Show teams in each league
SELECT 
  t.id as team_id,
  t.team_name,
  t.league_id,
  l.name as league_name,
  l.created_at as league_created,
  t.owner_id,
  p.username as owner_username,
  t.created_at as team_created
FROM teams t
JOIN leagues l ON t.league_id = l.id
LEFT JOIN profiles p ON t.owner_id = p.id
WHERE l.name = 'The Alpha League'
ORDER BY l.created_at DESC, t.created_at ASC;

-- STEP 3: Delete the OLDER league (keeping the one with both users)
-- Based on the CSV data:
-- - OLDER league: 39f67e2a-a7f1-4bd2-aa23-c336c45df92c (created 17:26:42, only has Gstorms)
-- - NEWER league: 3900cc0b-87c2-4e16-848f-8d9718cb49ee (created 18:14:29, has both Gstorms and Stormsy)
-- This will CASCADE delete all teams, matchups, draft picks, etc. for that league
DELETE FROM public.leagues
WHERE id = '39f67e2a-a7f1-4bd2-aa23-c336c45df92c'  -- Delete the older duplicate
RETURNING id, name, created_at;

-- STEP 4: Verify - should only show one Alpha League now
SELECT 
  'REMAINING ALPHA LEAGUE' as status,
  l.id,
  l.name,
  l.commissioner_id,
  p.username as commissioner_username,
  l.created_at,
  (SELECT COUNT(*) FROM teams WHERE league_id = l.id) as team_count
FROM leagues l
LEFT JOIN profiles p ON l.commissioner_id = p.id
WHERE l.name = 'The Alpha League';
