-- ============================================================================
-- DEBUG: Why is Wednesday empty?
-- ============================================================================

-- 1. Check if matchups exist for Jan 15
SELECT 
  'Matchups covering Jan 15?' as check_name,
  COUNT(*) as matchup_count,
  MIN(week_start_date) as earliest_start,
  MAX(week_end_date) as latest_end
FROM matchups
WHERE week_start_date <= '2026-01-15'::DATE 
  AND week_end_date >= '2026-01-15'::DATE
  AND status IN ('scheduled', 'in_progress', 'completed');

-- 2. Show specific matchups
SELECT 
  id,
  league_id,
  week_start_date,
  week_end_date,
  status,
  team1_id,
  team2_id
FROM matchups
WHERE week_start_date <= '2026-01-15'::DATE 
  AND week_end_date >= '2026-01-15'::DATE
ORDER BY week_start_date;

-- 3. Check team_lineups - do we have data to restore FROM?
SELECT 
  'Teams with lineups?' as check_name,
  COUNT(*) as team_count,
  SUM(jsonb_array_length(COALESCE(starters, '[]'::jsonb))) as total_starters,
  SUM(jsonb_array_length(COALESCE(bench, '[]'::jsonb))) as total_bench
FROM team_lineups;

-- 4. Check current state of Jan 15
SELECT 
  'Jan 15 current entries?' as check_name,
  COUNT(*) as entries
FROM fantasy_daily_rosters
WHERE roster_date = '2026-01-15'::DATE;

-- 5. Test the INSERT query - would it return data?
SELECT 
  'Would starters INSERT work?' as check_name,
  COUNT(*) as rows_that_would_insert
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-15'::DATE 
  AND m.week_end_date >= '2026-01-15'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0;

-- 6. Actually try to see what WOULD be inserted
SELECT 
  m.league_id,
  t.team_name,
  m.week_start_date,
  m.week_end_date,
  jsonb_array_length(tl.starters) as starter_count,
  jsonb_array_length(tl.bench) as bench_count
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-15'::DATE 
  AND m.week_end_date >= '2026-01-15'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
LIMIT 5;
