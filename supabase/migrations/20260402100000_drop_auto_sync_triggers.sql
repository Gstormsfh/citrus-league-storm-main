-- ============================================================================
-- DROP AUTO-SYNC TRIGGERS ON team_lineups
-- ============================================================================
-- These AFTER INSERT/UPDATE triggers propagated team_lineups changes to
-- ALL dates in fantasy_daily_rosters, defeating per-day lineup isolation.
--
-- With the new architecture:
--   team_lineups    = base/default lineup (fallback for dates without overrides)
--   fantasy_daily_rosters = per-day overrides (written only when user edits a specific date)
--
-- The auto-sync behavior is incompatible with day-by-day isolation because
-- any update to team_lineups would wipe all per-day customizations.
-- ============================================================================

-- Drop all auto-sync trigger variants
DROP TRIGGER IF EXISTS trigger_bulletproof_auto_sync_roster_to_daily ON team_lineups;
DROP TRIGGER IF EXISTS trigger_auto_sync_roster_to_daily_on_insert ON team_lineups;
DROP TRIGGER IF EXISTS trigger_auto_sync_roster_to_daily ON team_lineups;

-- Drop the associated functions (no longer needed)
DROP FUNCTION IF EXISTS bulletproof_auto_sync_team_lineup_to_daily_rosters();
DROP FUNCTION IF EXISTS auto_sync_team_lineup_to_daily_rosters();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid = 'team_lineups'::regclass
    AND tgname LIKE '%auto_sync%';

  IF v_count = 0 THEN
    RAISE NOTICE 'Auto-sync triggers successfully removed from team_lineups';
  ELSE
    RAISE EXCEPTION 'Failed to remove auto-sync triggers! % still exist', v_count;
  END IF;

  -- Confirm integrity trigger is still present
  SELECT COUNT(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid = 'team_lineups'::regclass
    AND tgname = 'trigger_validate_team_lineups_integrity';

  IF v_count = 1 THEN
    RAISE NOTICE 'Integrity trigger still active (good)';
  ELSE
    RAISE WARNING 'Integrity trigger missing!';
  END IF;
END $$;
