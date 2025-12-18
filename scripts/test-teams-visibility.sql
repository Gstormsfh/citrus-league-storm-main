-- Test script to check if teams are visible to commissioners
-- Run this in Supabase SQL Editor to debug RLS issues

-- First, check if teams exist
SELECT id, league_id, team_name, owner_id, created_at 
FROM public.teams 
ORDER BY created_at DESC 
LIMIT 20;

-- Check if the commissioner policy function works
-- Replace 'YOUR_LEAGUE_ID' and 'YOUR_USER_ID' with actual values
SELECT public.is_commissioner_of_league('YOUR_LEAGUE_ID'::uuid) as is_commissioner;

-- Test the policy directly
-- This should return teams if you're the commissioner
SELECT id, team_name, owner_id 
FROM public.teams 
WHERE league_id = 'YOUR_LEAGUE_ID'::uuid;









