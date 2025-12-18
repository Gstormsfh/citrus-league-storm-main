-- Script to clean up duplicate AI teams
-- Run this in Supabase SQL Editor
-- Replace 'YOUR_LEAGUE_ID' with your actual league UUID

-- First, see what duplicates exist
SELECT 
  league_id,
  team_name,
  COUNT(*) as count,
  array_agg(id ORDER BY created_at) as team_ids
FROM public.teams
WHERE league_id = 'YOUR_LEAGUE_ID'::uuid
  AND team_name LIKE 'AI Team %'
GROUP BY league_id, team_name
HAVING COUNT(*) > 1
ORDER BY team_name;

-- Delete duplicates, keeping only the first one (oldest)
-- WARNING: This will delete duplicate teams. Make sure you want to do this!
-- Uncomment the DELETE statement below after reviewing the SELECT results above

/*
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (PARTITION BY league_id, team_name ORDER BY created_at) as rn
  FROM public.teams
  WHERE league_id = 'YOUR_LEAGUE_ID'::uuid
    AND team_name LIKE 'AI Team %'
)
DELETE FROM public.teams
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);
*/









