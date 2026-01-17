-- ============================================================================
-- CLEANUP STALE FROZEN ROSTERS
-- ============================================================================
-- Purpose: Delete frozen roster entries for today and future dates
-- Reason: fantasy_daily_rosters should only contain HISTORICAL (past) rosters
--         Today and future dates should use current rosters from team_lineups
--
-- This fixes the issue where dropped players show up in today's Matchup tab
-- because stale frozen roster data exists in the database.
-- ============================================================================

DO $$
DECLARE
  today_date DATE := CURRENT_DATE;
  deleted_count INTEGER;
BEGIN
  -- Delete all frozen roster entries for today and future dates
  DELETE FROM fantasy_daily_rosters
  WHERE roster_date >= today_date;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Cleanup complete: Deleted % frozen roster entries for dates >= %', deleted_count, today_date;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After running this migration:
-- 1. fantasy_daily_rosters should only have dates < today
-- 2. Matchup tab for today should show current roster (no dropped players)
-- 3. Roster tab frozen view should only work for past dates
-- ============================================================================
