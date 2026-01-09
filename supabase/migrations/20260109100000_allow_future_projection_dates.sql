-- ============================================================================
-- ALLOW FUTURE PROJECTION DATES
-- ============================================================================
-- Removes the constraint that blocked future date projections.
-- For a fantasy sports forecasting system, we NEED to project future games.
-- The "data leak protection" was designed for backtesting, not production use.
-- ============================================================================

-- Drop the constraint that prevents future projections
ALTER TABLE public.projection_cache
DROP CONSTRAINT IF EXISTS projection_date_not_future;

-- Add a comment explaining why we allow future dates
COMMENT ON TABLE public.projection_cache IS 'Stores physical (score-blind) projections before fantasy scoring. Supports forecasting for future game dates. Used by the projection engine to cache intermediate calculations.';

-- Optional: Add a check for reasonable date range (e.g., not more than 30 days in future)
-- Uncomment if you want some bounds checking:
-- ALTER TABLE public.projection_cache
-- ADD CONSTRAINT projection_date_reasonable_range 
-- CHECK (projection_date <= CURRENT_DATE + INTERVAL '30 days');

