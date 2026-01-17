-- ============================================================================
-- SIMPLE DIAGNOSTIC: Find Connor McDavid (No Type Errors!)
-- ============================================================================

-- 1. Find McDavid's player ID
SELECT id, full_name, position, team
FROM players
WHERE full_name ILIKE '%mcdavid%';

-- 2. Check ALL team_lineups to see who has him
SELECT 
  tl.team_id,
  t.team_name,
  tl.league_id,
  jsonb_array_length(tl.starters) as starter_count,
  jsonb_array_length(tl.bench) as bench_count,
  jsonb_array_length(tl.ir) as ir_count,
  CASE 
    WHEN tl.starters ? '8478402' THEN 'STARTERS'
    WHEN tl.bench ? '8478402' THEN 'BENCH'
    WHEN tl.ir ? '8478402' THEN 'IR'
    ELSE 'NOT FOUND'
  END as mcdavid_location
FROM team_lineups tl
JOIN teams t ON t.id = tl.team_id;

-- 3. Check fantasy_daily_rosters by date
SELECT 
  fdr.roster_date,
  t.team_name,
  fdr.slot_type,
  COUNT(*) as entries
FROM fantasy_daily_rosters fdr
JOIN teams t ON t.id = fdr.team_id
WHERE fdr.player_id = 8478402
GROUP BY fdr.roster_date, t.team_name, fdr.slot_type
ORDER BY fdr.roster_date DESC;

-- 4. Check draft_picks (ownership)
SELECT 
  t.team_name,
  dp.round_number,
  dp.pick_number,
  dp.picked_at,
  dp.deleted_at
FROM draft_picks dp
JOIN teams t ON t.id = dp.team_id
WHERE dp.player_id = '8478402'
ORDER BY dp.picked_at DESC;

-- 5. Summary: Where is McDavid TODAY?
SELECT 
  'IN team_lineups?' as check_name,
  CASE 
    WHEN COUNT(*) > 0 THEN 'YES'
    ELSE 'NO - THIS IS THE PROBLEM'
  END as result
FROM team_lineups
WHERE starters ? '8478402' OR bench ? '8478402' OR ir ? '8478402'

UNION ALL

SELECT 
  'IN fantasy_daily_rosters TODAY?' as check_name,
  CASE 
    WHEN COUNT(*) > 0 THEN 'YES'
    ELSE 'NO - MISSING FROM TODAY'
  END as result
FROM fantasy_daily_rosters
WHERE player_id = 8478402
  AND roster_date = CURRENT_DATE;
