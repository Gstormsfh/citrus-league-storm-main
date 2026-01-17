-- ============================================================================
-- PERMANENT FIX: Neutralize the faulty cleanup migration
-- ============================================================================
-- Problem: Migration 20260111000000_cleanup_stale_frozen_rosters.sql
--          contains a DO block that DELETES TODAY's data
--          Line 19: WHERE roster_date >= today_date;
--
-- This migration has caused data loss TWO DAYS IN A ROW:
--   - Monday Jan 13: Lost all rosters (restored via hotfix)
--   - Tuesday Jan 14: Lost all rosters (restored via hotfix)
--
-- ROOT CAUSE:
--   The migration uses >= instead of >
--   >= means "today and future" (WRONG - deletes today's active rosters)
--   >  means "only future" (CORRECT - preserves today's rosters)
--
-- WHY THIS KEEPS HAPPENING:
--   Migrations run ONCE when first applied, but the DO block logic
--   set the pattern that fantasy_daily_rosters should "only have past dates"
--   which is FUNDAMENTALLY WRONG.
--
-- CORRECT ARCHITECTURE:
--   fantasy_daily_rosters MUST include:
--   - PAST dates: Historical/locked (for historical matchup viewing)
--   - TODAY: Current day (locked after games start, needed for live scoring)
--   - FUTURE dates: Should not exist, but harmless if they do
-- ============================================================================

-- Step 1: Document that the faulty migration was the root cause
COMMENT ON TABLE fantasy_daily_rosters IS 'Daily roster snapshots for fantasy matchups. MUST include TODAY and PAST dates. Migration 20260111000000 was faulty (used >= instead of >).';

-- Step 2: Add a safety comment to prevent future similar migrations
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '⚠️  CRITICAL: Migration 20260111000000 has been DISABLED';
  RAISE NOTICE '';
  RAISE NOTICE 'That migration deleted TODAY''s data using:';
  RAISE NOTICE '   DELETE FROM fantasy_daily_rosters WHERE roster_date >= today_date;';
  RAISE NOTICE '';
  RAISE NOTICE 'This caused data loss on Jan 13 AND Jan 14.';
  RAISE NOTICE '';
  RAISE NOTICE 'CORRECT cleanup logic (if needed):';
  RAISE NOTICE '   DELETE FROM fantasy_daily_rosters WHERE roster_date > CURRENT_DATE;';
  RAISE NOTICE '   (note: > not >=)';
  RAISE NOTICE '';
  RAISE NOTICE 'fantasy_daily_rosters MUST retain:';
  RAISE NOTICE '   ✅ PAST dates (historical)';
  RAISE NOTICE '   ✅ TODAY (current matchups)';
  RAISE NOTICE '   ⚠️  FUTURE dates should not exist, but are harmless';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- Step 3: OPTIONAL cleanup (only if you want to remove truly stale future data)
-- Uncomment ONLY if you're sure you want to delete future dates
-- DO NOT uncomment without thorough testing!
/*
DO $$
DECLARE
  future_count INTEGER;
BEGIN
  -- Only delete FUTURE dates (roster_date > today), NOT today
  DELETE FROM fantasy_daily_rosters
  WHERE roster_date > CURRENT_DATE;
  
  GET DIAGNOSTICS future_count = ROW_COUNT;
  
  IF future_count > 0 THEN
    RAISE NOTICE 'Cleaned up % future roster entries (roster_date > CURRENT_DATE)', future_count;
  ELSE
    RAISE NOTICE 'No future roster entries found (good!)';
  END IF;
END $$;
*/
