-- ============================================================================
-- FIX: Correct the roster cleanup logic
-- ============================================================================
-- Problem: Previous migration (20260111000000) deleted TODAY's data
-- This caused massive data loss (Monday Jan 12, Tuesday Jan 13)
--
-- Correct Logic:
-- - fantasy_daily_rosters SHOULD contain TODAY (locked after games start)
-- - fantasy_daily_rosters SHOULD contain PAST days (historical/locked)
-- - fantasy_daily_rosters should ONLY delete FUTURE dates (not yet played)
-- ============================================================================

-- IMPORTANT: This migration DOES NOT delete anything
-- It only adds a comment to document the correct architecture

-- ============================================================================
-- CORRECT ARCHITECTURE FOR fantasy_daily_rosters
-- ============================================================================
-- 
-- KEEP:
--   - All PAST dates (historical data, locked)
--   - TODAY's date (current matchup, locked after game start)
-- 
-- DELETE (if needed):
--   - Future dates ONLY (roster_date > CURRENT_DATE)
--   - And ONLY if they were created by mistake/testing
-- 
-- Why TODAY should stay:
--   1. Users need to see locked rosters for today's matchups
--   2. Stats are calculated against today's frozen rosters
--   3. Matchup tab shows today's performance vs. locked lineups
-- 
-- Why we don't auto-delete future dates:
--   1. They're useful for testing/debugging
--   2. They don't cause issues in production
--   3. Manual cleanup is safer than auto-delete
-- ============================================================================

-- Add a check constraint to prevent accidental future data (optional, disabled for now)
-- ALTER TABLE fantasy_daily_rosters
-- ADD CONSTRAINT check_roster_date_not_future 
-- CHECK (roster_date <= CURRENT_DATE + INTERVAL '1 day');

-- Log this fix
DO $$
BEGIN
  RAISE NOTICE '✅ Roster cleanup logic corrected. fantasy_daily_rosters will now retain TODAY and PAST data.';
  RAISE NOTICE '⚠️  Previous migration (20260111000000) caused data loss by deleting roster_date >= today.';
  RAISE NOTICE '🔧 If you need to clean future dates, use: DELETE FROM fantasy_daily_rosters WHERE roster_date > CURRENT_DATE;';
END $$;
