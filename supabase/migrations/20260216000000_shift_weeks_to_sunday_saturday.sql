-- ============================================================================
-- SHIFT WEEK BOUNDARIES FROM MONDAY-SUNDAY TO SUNDAY-SATURDAY
-- ============================================================================
-- This migration updates all existing matchup records to shift week boundaries
-- from Monday-Sunday to Sunday-Saturday (still 7 days, just shifted by -1 day).
-- 
-- This aligns the app with the advertised "Saturday Finishes" competitive advantage.
-- ============================================================================

-- Shift all matchup week dates by -1 day (Monday -> Sunday, Sunday -> Saturday)
UPDATE matchups
SET 
  week_start_date = week_start_date - INTERVAL '1 day',
  week_end_date = week_end_date - INTERVAL '1 day'
WHERE week_start_date IS NOT NULL AND week_end_date IS NOT NULL;

-- Update table comments to reflect new week boundaries
COMMENT ON TABLE public.player_weekly_stats IS 'Pre-aggregated weekly player statistics (Sunday-Saturday weeks)';
COMMENT ON COLUMN public.fantasy_daily_rosters.roster_date IS 'Date of the roster snapshot (Sunday-Saturday of matchup week)';

-- Log the update
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % matchup records to use Sunday-Saturday week boundaries', updated_count;
END $$;
