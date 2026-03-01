-- ============================================================================
-- Migration: Enable Row Level Security on 4 tables that were missing it
-- Date: 2026-03-01
-- Tables: nightly_job_runs, player_talent_metrics, projection_cache, team_mapping_config
-- ============================================================================

-- ============================================================================
-- 1. nightly_job_runs — internal operations table
--    READ: authenticated users only (for admin dashboards / monitoring)
--    WRITE: service role only (bypasses RLS automatically)
-- ============================================================================

ALTER TABLE public.nightly_job_runs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Authenticated users can view nightly job runs" ON public.nightly_job_runs;

-- Allow authenticated users to read job run history
CREATE POLICY "Authenticated users can view nightly job runs"
ON public.nightly_job_runs
FOR SELECT
USING (auth.role() = 'authenticated');

-- Note: INSERT/UPDATE/DELETE are handled by the service role key,
-- which bypasses RLS automatically. No explicit write policy needed.

-- ============================================================================
-- 2. player_talent_metrics — player data (public reference data)
--    READ: public (anyone, including anonymous users)
--    WRITE: service role only (bypasses RLS automatically)
-- ============================================================================

ALTER TABLE public.player_talent_metrics ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Public read access for player talent metrics" ON public.player_talent_metrics;

-- Allow anyone to read player talent metrics (public reference data)
CREATE POLICY "Public read access for player talent metrics"
ON public.player_talent_metrics
FOR SELECT
USING (true);

-- Note: INSERT/UPDATE/DELETE are handled by the service role key,
-- which bypasses RLS automatically. No explicit write policy needed.

-- ============================================================================
-- 3. projection_cache — internal cache table
--    READ: authenticated users only (projections are a premium feature)
--    WRITE: service role only (bypasses RLS automatically)
-- ============================================================================

ALTER TABLE public.projection_cache ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Authenticated users can view projection cache" ON public.projection_cache;

-- Allow authenticated users to read cached projections
CREATE POLICY "Authenticated users can view projection cache"
ON public.projection_cache
FOR SELECT
USING (auth.role() = 'authenticated');

-- Note: INSERT/UPDATE/DELETE are handled by the service role key,
-- which bypasses RLS automatically. No explicit write policy needed.

-- ============================================================================
-- 4. team_mapping_config — configuration/reference data
--    READ: public (anyone, including anonymous users)
--    WRITE: service role only (bypasses RLS automatically)
-- ============================================================================

ALTER TABLE public.team_mapping_config ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Public read access for team mapping config" ON public.team_mapping_config;

-- Allow anyone to read team mapping configuration (public reference data)
CREATE POLICY "Public read access for team mapping config"
ON public.team_mapping_config
FOR SELECT
USING (true);

-- Note: INSERT/UPDATE/DELETE are handled by the service role key,
-- which bypasses RLS automatically. No explicit write policy needed.
