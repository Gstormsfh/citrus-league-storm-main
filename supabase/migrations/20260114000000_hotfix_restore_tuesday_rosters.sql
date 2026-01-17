-- ============================================================================
-- HOTFIX: Restore Tuesday January 14th rosters
-- Issue: cleanup_stale_frozen_rosters deleted today's rosters (AGAIN)
-- Solution: Regenerate from current team_lineups (source of truth)
-- ============================================================================
-- PATTERN: Same issue as Jan 13 (hotfix_restore_monday_rosters.sql)
-- ROOT CAUSE: Faulty cleanup migration uses >= instead of >
-- ============================================================================

-- Restore active players for Tuesday January 14th
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
  AND jsonb_array_length(tl.starters) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Restore bench players for Tuesday January 14th
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
  AND jsonb_array_length(tl.bench) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Restore IR players for Tuesday January 14th
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
  AND jsonb_array_length(tl.ir) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Log restoration
DO $$
DECLARE
  restored_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO restored_count 
  FROM fantasy_daily_rosters 
  WHERE roster_date = '2026-01-14'::DATE;
  
  RAISE NOTICE '✅ Restored Tuesday Jan 14 rosters: % entries', restored_count;
  RAISE NOTICE '⚠️  THIS IS THE SECOND DAY IN A ROW. ROOT CAUSE MUST BE FIXED!';
  RAISE NOTICE '🔧 Check migration 20260111000000_cleanup_stale_frozen_rosters.sql';
  RAISE NOTICE '🔧 It likely has: DELETE FROM fantasy_daily_rosters WHERE roster_date >= CURRENT_DATE';
  RAISE NOTICE '🔧 Should be: DELETE FROM fantasy_daily_rosters WHERE roster_date > CURRENT_DATE';
END $$;
