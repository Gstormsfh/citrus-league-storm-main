-- ============================================================================
-- DIAGNOSTIC: Find Connor McDavid
-- ============================================================================
-- This will help us figure out where McDavid went
-- ============================================================================

-- 1. Find McDavid's player ID (use this result for the other queries)
SELECT id, full_name, position, team
FROM players
WHERE LOWER(full_name) LIKE '%mcdavid%'
   OR LOWER(full_name) LIKE '%connor%mcdavid%';

-- 2. Check if he's in team_lineups (source of truth)
-- Note: Replace '8478402' with actual player ID from query 1
SELECT 
  tl.team_id,
  t.team_name,
  tl.league_id,
  l.name as league_name,
  CASE 
    WHEN tl.starters ? '8478402' THEN 'In Starters'
    WHEN tl.bench ? '8478402' THEN 'In Bench'
    WHEN tl.ir ? '8478402' THEN 'In IR'
    ELSE 'NOT FOUND'
  END as location
FROM team_lineups tl
JOIN teams t ON t.id = tl.team_id
JOIN leagues l ON l.id = tl.league_id
WHERE tl.starters ? '8478402' 
   OR tl.bench ? '8478402'
   OR tl.ir ? '8478402';

-- 3. Check if he's in draft_picks (ownership record)
-- Note: player_id in draft_picks is TEXT, so cast to text
SELECT 
  dp.team_id,
  t.team_name,
  dp.league_id,
  l.name as league_name,
  dp.round_number,
  dp.pick_number,
  dp.picked_at,
  dp.deleted_at
FROM draft_picks dp
JOIN teams t ON t.id = dp.team_id
JOIN leagues l ON l.id = dp.league_id
WHERE dp.player_id = '8478402'  -- TEXT type, so use string
  AND dp.deleted_at IS NULL;

-- 4. Check fantasy_daily_rosters (historical data)
-- Note: player_id here is INTEGER
SELECT 
  fdr.roster_date,
  fdr.team_id,
  t.team_name,
  fdr.slot_type,
  fdr.is_locked,
  COUNT(*) as entries
FROM fantasy_daily_rosters fdr
JOIN teams t ON t.id = fdr.team_id
WHERE fdr.player_id = 8478402  -- INTEGER type
GROUP BY fdr.roster_date, fdr.team_id, t.team_name, fdr.slot_type, fdr.is_locked
ORDER BY fdr.roster_date DESC, fdr.team_id;

-- 5. Check waiver_claims (was he dropped via waiver?)
-- Note: Check both player_id and drop_player_id types
SELECT 
  wc.id,
  wc.team_id,
  t.team_name,
  wc.player_id,
  wc.drop_player_id,
  wc.status,
  wc.created_at,
  wc.processed_at,
  wc.failure_reason
FROM waiver_claims wc
JOIN teams t ON t.id = wc.team_id
WHERE wc.drop_player_id::TEXT = '8478402'  -- Cast to text for comparison
   OR (wc.player_id::TEXT = '8478402' AND wc.status = 'successful')
ORDER BY wc.created_at DESC
LIMIT 10;

-- 6. Check if he's in free agency (not on any team)
SELECT 
  COUNT(*) as teams_with_mcdavid
FROM team_lineups
WHERE (starters ? '8478402' OR bench ? '8478402' OR ir ? '8478402');

-- If this returns 0, McDavid is in free agency
-- If this returns > 0, he's on a team (maybe wrong team?)

-- ============================================================================
-- QUICK CHECK: Is McDavid in YOUR team's lineup?
-- ============================================================================
-- Replace YOUR_TEAM_ID with your actual team ID
SELECT 
  CASE 
    WHEN starters ? '8478402' THEN '✅ In Starters'
    WHEN bench ? '8478402' THEN '✅ In Bench'
    WHEN ir ? '8478402' THEN '✅ In IR'
    ELSE '❌ NOT FOUND in team_lineups'
  END as mcdavid_status,
  jsonb_array_length(starters) as starter_count,
  jsonb_array_length(bench) as bench_count,
  jsonb_array_length(ir) as ir_count
FROM team_lineups
WHERE team_id = 'YOUR_TEAM_ID'::UUID;  -- Replace with your team ID
