-- ============================================================================
-- FOCUSED FIX: Restore ONLY Wednesday January 15, 2026
-- ============================================================================
-- Issue: Jan 15 (Wednesday) is empty - THIRD DAY IN A ROW of data loss
-- Root Cause: Auto-sync trigger bug (roster_date >= instead of >)
-- Solution: DELETE then INSERT to force restoration of ONLY Jan 15
-- ============================================================================

-- First, DELETE any existing entries for Jan 15 ONLY (leave other days alone!)
DELETE FROM fantasy_daily_rosters 
WHERE roster_date = '2026-01-15'::DATE;

-- ============================================================================
-- RESTORE WEDNESDAY JANUARY 15, 2026
-- ============================================================================

-- Restore active players for Wednesday January 15th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.starters)::integer) AS player_id,
  '2026-01-15'::DATE AS roster_date,
  'active' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.starters)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-15'::DATE 
  AND m.week_end_date >= '2026-01-15'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0;

-- Restore bench players for Wednesday January 15th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.bench)::integer) AS player_id,
  '2026-01-15'::DATE AS roster_date,
  'bench' AS slot_type,
  NULL AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-15'::DATE 
  AND m.week_end_date >= '2026-01-15'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.bench IS NOT NULL
  AND jsonb_array_length(tl.bench) > 0;

-- Restore IR players for Wednesday January 15th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.ir)::integer) AS player_id,
  '2026-01-15'::DATE AS roster_date,
  'ir' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.ir)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-15'::DATE 
  AND m.week_end_date >= '2026-01-15'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.ir IS NOT NULL
  AND jsonb_array_length(tl.ir) > 0;

-- ============================================================================
-- VERIFICATION & LOGGING
-- ============================================================================
DO $$
DECLARE
  jan13_count INTEGER;
  jan14_count INTEGER;
  jan15_count INTEGER;
BEGIN
  -- Count Tuesday (should be good)
  SELECT COUNT(*) INTO jan13_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-13'::DATE;
  
  -- Count Wednesday (should be good)
  SELECT COUNT(*) INTO jan14_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-14'::DATE;
  
  -- Count Thursday (today - what we just restored)
  SELECT COUNT(*) INTO jan15_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-15'::DATE;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ WEDNESDAY JAN 15 RESTORATION COMPLETE';
  RAISE NOTICE '';
  RAISE NOTICE 'Tuesday Jan 13:   % entries (previous restoration)', jan13_count;
  RAISE NOTICE 'Wednesday Jan 14: % entries (previous restoration)', jan14_count;
  RAISE NOTICE 'Thursday Jan 15:  % entries (JUST RESTORED)', jan15_count;
  RAISE NOTICE '';
  
  IF jan15_count = 0 THEN
    RAISE WARNING '⚠️  Jan 15 STILL has ZERO entries! Check team_lineups and matchups.';
  ELSIF jan15_count > 0 THEN
    RAISE NOTICE '✅ SUCCESS: Wednesday Jan 15 has % entries!', jan15_count;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'This was the THIRD DAY IN A ROW of data loss:';
  RAISE NOTICE '  - Monday Jan 13: Faulty cleanup migration (>= bug)';
  RAISE NOTICE '  - Tuesday Jan 14: Same migration (>= bug)';
  RAISE NOTICE '  - Wednesday Jan 15: Auto-sync trigger (>= bug)';
  RAISE NOTICE '';
  RAISE NOTICE 'Root cause: Using >= instead of > with CURRENT_DATE in DELETE';
  RAISE NOTICE 'Fix applied: Migration 20260115000002 fixes the trigger';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  THIS SHOULD NEVER HAPPEN AGAIN - trigger is now fixed!';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
