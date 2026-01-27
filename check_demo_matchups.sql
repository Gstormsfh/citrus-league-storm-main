-- Quick check: Do matchups exist and are they accessible?
-- Run this as an anonymous user (or check in Supabase dashboard)

-- Check if matchups exist
SELECT 
  COUNT(*) as total_matchups,
  MIN(week_number) as min_week,
  MAX(week_number) as max_week,
  ARRAY_AGG(DISTINCT week_number ORDER BY week_number) as available_weeks
FROM matchups 
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

-- Sample matchup data
SELECT 
  week_number,
  status,
  team1_score,
  team2_score,
  week_start_date,
  week_end_date
FROM matchups 
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'
ORDER BY week_number
LIMIT 5;

-- Check RLS policy
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'matchups' 
AND policyname LIKE '%demo%';
