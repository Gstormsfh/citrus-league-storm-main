-- ============================================================================
-- VERIFICATION: Demo League Complete Setup
-- ============================================================================
-- Run this to confirm everything was created successfully
-- ============================================================================

SELECT 
  '✅ Demo League' as check_item,
  COUNT(*) as count,
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END as status
FROM leagues 
WHERE id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

SELECT 
  '✅ Teams' as check_item,
  COUNT(*) as count,
  CASE WHEN COUNT(*) = 10 THEN 'PASS' ELSE 'FAIL' END as status
FROM teams 
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

SELECT 
  '✅ Draft Picks' as check_item,
  COUNT(*) as count,
  CASE WHEN COUNT(*) = 210 THEN 'PASS' ELSE 'FAIL' END as status
FROM draft_picks 
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9' 
AND deleted_at IS NULL;

SELECT 
  '✅ Team Lineups' as check_item,
  COUNT(*) as count,
  CASE WHEN COUNT(*) = 10 THEN 'PASS' ELSE 'FAIL' END as status
FROM team_lineups 
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

SELECT 
  '✅ Matchups' as check_item,
  COUNT(*) as count,
  CASE WHEN COUNT(*) = 20 THEN 'PASS' ELSE 'FAIL' END as status
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
