-- ============================================================================
-- EMERGENCY: DISABLE AUTO-SYNC TRIGGER IMMEDIATELY
-- ============================================================================
-- The trigger is causing players to disappear from team_lineups
-- This will stop the bleeding while we diagnose
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_auto_sync_roster_to_daily ON team_lineups;

-- Log the action
DO $$
BEGIN
  RAISE NOTICE '🛑 EMERGENCY: Auto-sync trigger DISABLED';
  RAISE NOTICE '   Trigger was causing player deletions';
  RAISE NOTICE '   Safe to navigate between Roster and Matchup tabs now';
END $$;
