-- ============================================================================
-- FIX: Auto-sync trigger fires on INSERT too (not just UPDATE)
-- ============================================================================
-- Problem: AI teams (and any team whose lineup is created for the first time)
--          never get fantasy_daily_rosters entries because the auto-sync trigger
--          only fires on UPDATE. The first lineup save is an INSERT.
--
-- Fix: Add a separate INSERT trigger that runs the same sync function.
--      The function already handles all the logic correctly.
-- ============================================================================

-- Add INSERT trigger alongside the existing UPDATE trigger
CREATE TRIGGER trigger_auto_sync_roster_to_daily_on_insert
AFTER INSERT ON team_lineups
FOR EACH ROW
EXECUTE FUNCTION bulletproof_auto_sync_team_lineup_to_daily_rosters();

COMMENT ON TRIGGER trigger_auto_sync_roster_to_daily_on_insert ON team_lineups IS
'Fires on INSERT to sync new team lineups (e.g. AI teams, first-time saves) to fantasy_daily_rosters. Complements the UPDATE trigger.';
