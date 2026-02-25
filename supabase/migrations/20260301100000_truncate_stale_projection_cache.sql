-- Truncate projection_cache to flush all stale entries calculated with PBP-derived columns.
-- The Projections 3.0 engine now uses official nhl_* columns exclusively.
-- All cached physical projections from before this switch are invalid and would produce
-- wrong fantasy point values (e.g., DeBrusk overstatement).
--
-- Going forward, the CACHE_VERSION constant in calculate_daily_projections.py produces
-- a versioned data_source_hash. load_physical_projection() validates the hash on read,
-- so bumping CACHE_VERSION auto-invalidates old entries without needing another migration.

TRUNCATE TABLE public.projection_cache;
