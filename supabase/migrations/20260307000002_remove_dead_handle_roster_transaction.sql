-- ============================================================================
-- REMOVE DEAD CODE: handle_roster_transaction()
-- ============================================================================
-- This function was the original roster transaction handler (Dec 2025) that
-- used draft_picks as its source of truth. It was superseded by
-- process_roster_move() (Jan 2026) which uses roster_assignments as the
-- single source of truth with THE GOALIE constraint.
--
-- handle_roster_transaction() is not called from any application code.
-- It was kept alive only by the 12th audit migration which re-created it
-- with SET search_path (security hardening of dead code).
--
-- Removing it eliminates:
--   1. Confusion about which function to call
--   2. A SECURITY DEFINER function with draft_picks as source of truth
--      (conflicting with the roster_assignments engine)
--   3. Dead code maintenance burden
-- ============================================================================

-- Drop the function
DROP FUNCTION IF EXISTS public.handle_roster_transaction(UUID, UUID, TEXT, TEXT, TEXT);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  DEAD CODE REMOVED: handle_roster_transaction()';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  Dropped: handle_roster_transaction(UUID, UUID, TEXT, TEXT, TEXT)';
  RAISE NOTICE '  Reason:  Superseded by process_roster_move() (Jan 2026)';
  RAISE NOTICE '  Active:  process_roster_move() — roster_assignments engine';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
END $$;
