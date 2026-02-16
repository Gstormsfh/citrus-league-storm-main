-- ============================================================================
-- CLEANUP STALE TEST PROJECTION ROWS
-- ============================================================================
-- This migration removes orphaned test rows from player_projected_stats
-- that were created during development/testing.
-- 
-- These rows have calculation_method values of 'test_hybrid' or 'test_goalie_model'
-- and are causing incorrect projections to display in the player cards.
-- ============================================================================

-- Delete test rows (3 total: 2 test_hybrid, 1 test_goalie_model)
DELETE FROM public.player_projected_stats
WHERE calculation_method IN ('test_hybrid', 'test_goalie_model');

-- Log the cleanup
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % stale test projection rows', deleted_count;
END $$;
