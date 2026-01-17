-- ============================================================================
-- VERIFICATION: Check Tuesday Jan 13 Fix
-- ============================================================================
-- Run these queries to verify the restoration worked
-- ============================================================================

-- 1. COUNT CHECK: Daily roster counts for this week
SELECT 
  roster_date,
  COUNT(*) as total_entries,
  COUNT(DISTINCT team_id) as teams,
  COUNT(DISTINCT matchup_id) as matchups,
  COUNT(DISTINCT player_id) as unique_players,
  COUNT(CASE WHEN slot_type = 'active' THEN 1 END) as active_players,
  COUNT(CASE WHEN slot_type = 'bench' THEN 1 END) as bench_players,
  COUNT(CASE WHEN slot_type = 'ir' THEN 1 END) as ir_players
FROM fantasy_daily_rosters
WHERE roster_date >= '2026-01-12' AND roster_date <= '2026-01-14'
GROUP BY roster_date
ORDER BY roster_date;

-- Expected:
-- Jan 12 (Monday):   ~250-260 entries, ~4 teams
-- Jan 13 (Tuesday):  ~250-260 entries, ~4 teams ← SHOULD BE RESTORED NOW
-- Jan 14 (Wednesday): ~250-260 entries, ~4 teams

-- ============================================================================

-- 2. TEAM CHECK: Make sure all teams have data for Tuesday
SELECT 
  t.id as team_id,
  t.team_name,
  COUNT(CASE WHEN fdr.roster_date = '2026-01-12' THEN 1 END) as monday_count,
  COUNT(CASE WHEN fdr.roster_date = '2026-01-13' THEN 1 END) as tuesday_count,
  COUNT(CASE WHEN fdr.roster_date = '2026-01-14' THEN 1 END) as wednesday_count
FROM teams t
LEFT JOIN fantasy_daily_rosters fdr ON fdr.team_id = t.id 
  AND fdr.roster_date >= '2026-01-12' 
  AND fdr.roster_date <= '2026-01-14'
GROUP BY t.id, t.team_name
ORDER BY t.team_name;

-- Expected: Every team should have similar counts for all three days
-- If tuesday_count is 0 for any team, there's still a problem

-- ============================================================================

-- 3. DATA QUALITY CHECK: Look at actual Tuesday data
SELECT 
  fdr.team_id,
  t.team_name,
  fdr.slot_type,
  COUNT(*) as player_count,
  STRING_AGG(DISTINCT p.full_name, ', ' ORDER BY p.full_name) as sample_players
FROM fantasy_daily_rosters fdr
JOIN teams t ON t.id = fdr.team_id
JOIN players p ON p.id = fdr.player_id
WHERE fdr.roster_date = '2026-01-13'
GROUP BY fdr.team_id, t.team_name, fdr.slot_type
ORDER BY t.team_name, fdr.slot_type;

-- Expected: You should see actual player names for Tuesday
-- If this returns 0 rows, Tuesday is still empty

-- ============================================================================

-- 4. MATCHUP CHECK: Verify matchups exist for this week
SELECT 
  m.id,
  m.week_number,
  m.week_start_date,
  m.week_end_date,
  m.status,
  t1.team_name as team1,
  t2.team_name as team2
FROM matchups m
JOIN teams t1 ON t1.id = m.team1_id
JOIN teams t2 ON t2.id = m.team2_id
WHERE m.week_start_date <= '2026-01-14' 
  AND m.week_end_date >= '2026-01-12'
ORDER BY m.id;

-- Expected: Should show matchups for this week
-- If empty, that's the problem - no matchups = no rosters

-- ============================================================================

-- 5. SOURCE DATA CHECK: Verify team_lineups has data
SELECT 
  tl.team_id,
  t.team_name,
  jsonb_array_length(tl.starters) as starter_count,
  jsonb_array_length(tl.bench) as bench_count,
  jsonb_array_length(tl.ir) as ir_count,
  (jsonb_array_length(tl.starters) + 
   jsonb_array_length(tl.bench) + 
   COALESCE(jsonb_array_length(tl.ir), 0)) as total_players
FROM team_lineups tl
JOIN teams t ON t.id = tl.team_id
ORDER BY t.team_name;

-- Expected: Each team should have ~12 starters, ~8 bench, maybe some IR
-- If empty, team_lineups is the problem (source of truth is empty)

-- ============================================================================

-- 6. MIGRATION LOG CHECK: See what the migration reported
-- (This is just for your reference - check the migration output)

-- Expected output from migration:
-- ✅ TUESDAY JAN 13 RESTORATION COMPLETE
-- Monday Jan 12:    XXX entries (untouched)
-- Tuesday Jan 13:   XXX entries (RESTORED)
-- Wednesday Jan 14: XXX entries (current state)
-- ✅ SUCCESS: Tuesday Jan 13 has XXX entries!

-- ============================================================================
-- QUICK VERDICT:
-- ============================================================================

DO $$
DECLARE
  monday_count INTEGER;
  tuesday_count INTEGER;
  wednesday_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO monday_count FROM fantasy_daily_rosters WHERE roster_date = '2026-01-12';
  SELECT COUNT(*) INTO tuesday_count FROM fantasy_daily_rosters WHERE roster_date = '2026-01-13';
  SELECT COUNT(*) INTO wednesday_count FROM fantasy_daily_rosters WHERE roster_date = '2026-01-14';
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'QUICK VERDICT:';
  RAISE NOTICE '';
  RAISE NOTICE 'Monday (Jan 12):    % entries', monday_count;
  RAISE NOTICE 'Tuesday (Jan 13):   % entries', tuesday_count;
  RAISE NOTICE 'Wednesday (Jan 14): % entries', wednesday_count;
  RAISE NOTICE '';
  
  IF tuesday_count > 0 THEN
    RAISE NOTICE '✅ SUCCESS! Tuesday has data!';
  ELSE
    RAISE WARNING '❌ FAILURE! Tuesday is still empty!';
    RAISE WARNING 'Run the other queries above to diagnose the issue.';
  END IF;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
