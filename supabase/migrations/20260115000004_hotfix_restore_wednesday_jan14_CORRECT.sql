-- ============================================================================
-- FOCUSED FIX: Restore ONLY Wednesday January 14, 2026 (CORRECT DATE!)
-- ============================================================================
-- Issue: Jan 14 (WEDNESDAY - yesterday) is empty
-- TODAY is Thursday Jan 15
-- Solution: DELETE then INSERT to force restoration of ONLY Jan 14
-- ============================================================================

-- First, DELETE any existing entries for Jan 14 ONLY
DELETE FROM fantasy_daily_rosters 
WHERE roster_date = '2026-01-14'::DATE;

-- ============================================================================
-- RESTORE WEDNESDAY JANUARY 14, 2026
-- ============================================================================

-- Restore active players for Wednesday January 14th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.starters)::integer) AS player_id,
  '2026-01-14'::DATE AS roster_date,
  'active' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.starters)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-14'::DATE 
  AND m.week_end_date >= '2026-01-14'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0;

-- Restore bench players for Wednesday January 14th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.bench)::integer) AS player_id,
  '2026-01-14'::DATE AS roster_date,
  'bench' AS slot_type,
  NULL AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-14'::DATE 
  AND m.week_end_date >= '2026-01-14'::DATE
  AND m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.bench IS NOT NULL
  AND jsonb_array_length(tl.bench) > 0;

-- Restore IR players for Wednesday January 14th
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.ir)::integer) AS player_id,
  '2026-01-14'::DATE AS roster_date,
  'ir' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.ir)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
WHERE m.week_start_date <= '2026-01-14'::DATE 
  AND m.week_end_date >= '2026-01-14'::DATE
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
  
  -- Count Wednesday (what we just restored)
  SELECT COUNT(*) INTO jan14_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-14'::DATE;
  
  -- Count Thursday (today)
  SELECT COUNT(*) INTO jan15_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-15'::DATE;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ WEDNESDAY JAN 14 RESTORATION COMPLETE (CORRECT DATE!)';
  RAISE NOTICE '';
  RAISE NOTICE 'Tuesday Jan 13:    % entries (previous restoration)', jan13_count;
  RAISE NOTICE 'Wednesday Jan 14:  % entries (JUST RESTORED - YESTERDAY)', jan14_count;
  RAISE NOTICE 'Thursday Jan 15:   % entries (today)', jan15_count;
  RAISE NOTICE '';
  
  IF jan14_count = 0 THEN
    RAISE WARNING '⚠️  Jan 14 STILL has ZERO entries! Check team_lineups and matchups.';
  ELSIF jan14_count > 0 THEN
    RAISE NOTICE '✅ SUCCESS: Wednesday Jan 14 has % entries!', jan14_count;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Today is Thursday Jan 15. We just restored Wednesday Jan 14 (yesterday).';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
