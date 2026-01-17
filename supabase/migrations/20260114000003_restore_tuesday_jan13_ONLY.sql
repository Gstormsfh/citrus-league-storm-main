-- ============================================================================
-- FOCUSED FIX: Restore ONLY Tuesday January 13, 2026
-- ============================================================================
-- Issue: Jan 13 (Tuesday) is empty, but Monday data is fine
-- Solution: DELETE then INSERT to force restoration of ONLY Jan 13
-- ============================================================================

-- First, DELETE any existing entries for Jan 13 ONLY (leave Monday alone!)
DELETE FROM fantasy_daily_rosters 
WHERE roster_date = '2026-01-13'::DATE;

-- ============================================================================
-- RESTORE TUESDAY JANUARY 13, 2026
-- ============================================================================

-- Restore active players for Tuesday January 13th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.starters)::integer) AS player_id,
  '2026-01-13'::DATE AS roster_date,
  'active' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.starters)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-13'::DATE 
  AND m.week_end_date >= '2026-01-13'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0;

-- Restore bench players for Tuesday January 13th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.bench)::integer) AS player_id,
  '2026-01-13'::DATE AS roster_date,
  'bench' AS slot_type,
  NULL AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-13'::DATE 
  AND m.week_end_date >= '2026-01-13'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.bench IS NOT NULL
  AND jsonb_array_length(tl.bench) > 0;

-- Restore IR players for Tuesday January 13th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.ir)::integer) AS player_id,
  '2026-01-13'::DATE AS roster_date,
  'ir' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.ir)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-13'::DATE 
  AND m.week_end_date >= '2026-01-13'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.ir IS NOT NULL
  AND jsonb_array_length(tl.ir) > 0;

-- ============================================================================
-- VERIFICATION & LOGGING
-- ============================================================================
DO $$
DECLARE
  jan13_count INTEGER;
  monday_count INTEGER;
  wednesday_count INTEGER;
BEGIN
  -- Count Tuesday (what we just restored)
  SELECT COUNT(*) INTO jan13_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-13'::DATE;
  
  -- Count Monday (should be untouched)
  SELECT COUNT(*) INTO monday_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-12'::DATE;
  
  -- Count Wednesday (today)
  SELECT COUNT(*) INTO wednesday_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-14'::DATE;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TUESDAY JAN 13 RESTORATION COMPLETE';
  RAISE NOTICE '';
  RAISE NOTICE 'Monday Jan 12:    % entries (untouched)', monday_count;
  RAISE NOTICE 'Tuesday Jan 13:   % entries (RESTORED)', jan13_count;
  RAISE NOTICE 'Wednesday Jan 14: % entries (current state)', wednesday_count;
  RAISE NOTICE '';
  
  IF jan13_count = 0 THEN
    RAISE WARNING '⚠️  Jan 13 STILL has ZERO entries! Check team_lineups and matchups.';
  ELSIF jan13_count > 0 THEN
    RAISE NOTICE '✅ SUCCESS: Tuesday Jan 13 has % entries!', jan13_count;
  END IF;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
