-- Simple script to clean up duplicate AI teams
-- This will keep only ONE team per unique team name, deleting the rest
-- Run this in Supabase SQL Editor

-- STEP 1: First, see what duplicates exist (replace YOUR_LEAGUE_ID with your actual league UUID)
-- Run this first to see what will be deleted
SELECT 
  league_id,
  team_name,
  COUNT(*) as duplicate_count,
  array_agg(id ORDER BY created_at) as team_ids,
  array_agg(created_at ORDER BY created_at) as created_dates
FROM public.teams
WHERE team_name LIKE 'AI Team %'
GROUP BY league_id, team_name
HAVING COUNT(*) > 1
ORDER BY league_id, team_name;

-- STEP 2: Delete duplicates, keeping only the FIRST (oldest) team of each name
-- This will delete all duplicates, keeping the oldest team for each unique name
-- WARNING: This permanently deletes duplicate teams!
-- Replace YOUR_LEAGUE_ID with your actual league UUID before running

WITH duplicates_to_delete AS (
  SELECT 
    id,
    league_id,
    team_name,
    ROW_NUMBER() OVER (PARTITION BY league_id, team_name ORDER BY created_at ASC) as rn
  FROM public.teams
  WHERE team_name LIKE 'AI Team %'
)
DELETE FROM public.teams
WHERE id IN (
  SELECT id 
  FROM duplicates_to_delete 
  WHERE rn > 1  -- Keep the first one (rn = 1), delete the rest
)
RETURNING id, league_id, team_name, created_at;

-- STEP 3: Verify cleanup - should show no duplicates
SELECT 
  league_id,
  team_name,
  COUNT(*) as count
FROM public.teams
WHERE team_name LIKE 'AI Team %'
GROUP BY league_id, team_name
HAVING COUNT(*) > 1;

-- If the above returns no rows, all duplicates have been removed!









