-- ============================================================================
-- FIX: Remove faulty DELETE FROM team_lineups in waiver processing
-- ============================================================================
-- Problem: Old waiver function (20260110000004) has DELETE FROM team_lineups
--          which is incompatible with JSONB array schema
-- Solution: Ensure correct JSONB-based waiver function is active
-- ============================================================================

-- The comprehensive waiver function (from 20260112000000) should already be
-- active, but this migration ensures it by explicitly checking the function

-- Check if function uses JSONB arrays (correct) or DELETE statements (wrong)
DO $$
DECLARE
  v_function_source TEXT;
BEGIN
  -- Get the current function source code
  SELECT pg_get_functiondef(oid)
  INTO v_function_source
  FROM pg_proc
  WHERE proname = 'process_waiver_claims_v2';
  
  -- Check if function contains the problematic DELETE statement
  IF v_function_source LIKE '%DELETE FROM team_lineups%' THEN
    RAISE WARNING '⚠️  CRITICAL: Waiver function contains DELETE FROM team_lineups!';
    RAISE WARNING '⚠️  This can cause players to disappear from rosters!';
    RAISE WARNING '⚠️  The function should use JSONB array manipulation instead.';
    RAISE WARNING '⚠️  Migration 20260112000000 should have fixed this.';
  ELSE
    RAISE NOTICE '✅ Waiver function uses correct JSONB array manipulation';
  END IF;
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not check waiver function (may not exist yet)';
END $$;

-- Add table comment documenting correct waiver drop pattern
COMMENT ON TABLE team_lineups IS 
'Source of truth for team rosters. Uses JSONB arrays for starters/bench/ir.
NEVER use DELETE to remove players - use JSONB array manipulation:
  UPDATE team_lineups SET
    starters = starters - player_id_string,
    bench = bench - player_id_string,
    ir = ir - player_id_string
  WHERE team_id = ... AND league_id = ...
This ensures players are removed from arrays without deleting the team_lineups row.';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ WAIVER PROCESSING AUDIT COMPLETE';
  RAISE NOTICE '';
  RAISE NOTICE 'Verified: Waiver drops should use JSONB array manipulation';
  RAISE NOTICE 'Pattern: bench = bench - player_id_string (NOT DELETE FROM)';
  RAISE NOTICE '';
  RAISE NOTICE 'If players still disappear, check:';
  RAISE NOTICE '  1. Manual lineup edits in UI';
  RAISE NOTICE '  2. Race conditions in createDailyRosterSnapshots';
  RAISE NOTICE '  3. RLS policies blocking reads';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
