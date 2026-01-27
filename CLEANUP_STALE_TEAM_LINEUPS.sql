-- ============================================================================
-- CLEANUP STALE TEAM_LINEUPS DATA
-- ============================================================================
-- Removes player IDs from team_lineups that don't exist in roster_assignments
-- This fixes the issue where dropped players remain in team_lineups causing
-- "frozen roster" and wrong player display bugs
-- ============================================================================

-- Show affected teams before cleanup
DO $$
DECLARE
  v_team RECORD;
  v_stale_count INTEGER := 0;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'PRE-CLEANUP DIAGNOSTIC';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  FOR v_team IN
    WITH stale_players AS (
      SELECT 
        tl.team_id,
        t.team_name,
        l.name as league_name,
        jsonb_array_length(tl.starters) + 
        jsonb_array_length(tl.bench) + 
        jsonb_array_length(tl.ir) as total_in_lineup,
        (
          SELECT COUNT(*)
          FROM roster_assignments ra
          WHERE ra.team_id = tl.team_id
        ) as total_in_roster,
        jsonb_array_length(tl.starters) + 
        jsonb_array_length(tl.bench) + 
        jsonb_array_length(tl.ir) - 
        (
          SELECT COUNT(*)
          FROM roster_assignments ra
          WHERE ra.team_id = tl.team_id
        ) as stale_count
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
      JOIN leagues l ON l.id = tl.league_id
    )
    SELECT * FROM stale_players WHERE stale_count > 0
  LOOP
    v_stale_count := v_stale_count + 1;
    RAISE NOTICE '[%] %: % in lineup, % in roster, % STALE', 
      v_team.league_name,
      v_team.team_name,
      v_team.total_in_lineup,
      v_team.total_in_roster,
      v_team.stale_count;
  END LOOP;
  
  IF v_stale_count = 0 THEN
    RAISE NOTICE '✅ No stale data found - all team_lineups are clean';
  ELSE
    RAISE NOTICE '⚠️  Found % team(s) with stale data', v_stale_count;
  END IF;
  
  RAISE NOTICE '';
END $$;

-- Perform the cleanup
UPDATE team_lineups tl
SET 
  starters = (
    SELECT COALESCE(jsonb_agg(player_id), '[]'::jsonb)
    FROM jsonb_array_elements_text(tl.starters) player_id
    WHERE EXISTS (
      SELECT 1 FROM roster_assignments ra 
      WHERE ra.player_id = player_id AND ra.team_id = tl.team_id
    )
  ),
  bench = (
    SELECT COALESCE(jsonb_agg(player_id), '[]'::jsonb)
    FROM jsonb_array_elements_text(tl.bench) player_id
    WHERE EXISTS (
      SELECT 1 FROM roster_assignments ra 
      WHERE ra.player_id = player_id AND ra.team_id = tl.team_id
    )
  ),
  ir = (
    SELECT COALESCE(jsonb_agg(player_id), '[]'::jsonb)
    FROM jsonb_array_elements_text(tl.ir) player_id
    WHERE EXISTS (
      SELECT 1 FROM roster_assignments ra 
      WHERE ra.player_id = player_id AND ra.team_id = tl.team_id
    )
  ),
  updated_at = NOW();

-- Verify the cleanup
DO $$
DECLARE
  v_team RECORD;
  v_mismatch_count INTEGER := 0;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'POST-CLEANUP VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  FOR v_team IN
    WITH lineup_counts AS (
      SELECT 
        tl.team_id,
        t.team_name,
        l.name as league_name,
        jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) +
        jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as total_in_lineup,
        (
          SELECT COUNT(*)
          FROM roster_assignments ra
          WHERE ra.team_id = tl.team_id
        ) as total_in_roster
      FROM team_lineups tl
      JOIN teams t ON t.id = tl.team_id
      JOIN leagues l ON l.id = tl.league_id
    )
    SELECT * FROM lineup_counts WHERE total_in_lineup != total_in_roster
  LOOP
    v_mismatch_count := v_mismatch_count + 1;
    RAISE WARNING '⚠️  [%] %: % in lineup vs % in roster (STILL MISMATCH!)', 
      v_team.league_name,
      v_team.team_name,
      v_team.total_in_lineup,
      v_team.total_in_roster;
  END LOOP;
  
  IF v_mismatch_count = 0 THEN
    RAISE NOTICE '✅ SUCCESS: All team_lineups now match roster_assignments';
    RAISE NOTICE '✅ No stale player IDs remain';
  ELSE
    RAISE WARNING '❌ Found % team(s) still with mismatches after cleanup!', v_mismatch_count;
  END IF;
  
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'CLEANUP COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Hard refresh your browser (Ctrl+Shift+R)';
  RAISE NOTICE '  2. Check that roster displays correctly';
  RAISE NOTICE '  3. Verify no "frozen roster" appears after drops';
  RAISE NOTICE '';
END $$;
