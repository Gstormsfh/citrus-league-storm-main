-- ============================================================================
-- PERFECT 10 PIPELINE FIXES
-- ============================================================================
-- Closes remaining Stats & Data Pipeline gaps:
-- Gap C: Add missing projection cache columns (ppp, shp, hits, pim)
-- Gap F: Add nightly job tracking table to prevent missed scheduling windows
-- ============================================================================

-- Gap C: Extend projection_cache with the 4 missing projected stats
-- The projection engine already calculates these but they weren't cached
ALTER TABLE public.projection_cache
ADD COLUMN IF NOT EXISTS projected_ppp NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_shp NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_hits NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_pim NUMERIC(5,3) DEFAULT 0;

COMMENT ON COLUMN public.projection_cache.projected_ppp IS 'Raw projected power play points';
COMMENT ON COLUMN public.projection_cache.projected_shp IS 'Raw projected shorthanded points';
COMMENT ON COLUMN public.projection_cache.projected_hits IS 'Raw projected hits';
COMMENT ON COLUMN public.projection_cache.projected_pim IS 'Raw projected penalty minutes';

-- Gap F: Create nightly job tracking table for reliable scheduling
-- Prevents jobs from being skipped if the service misses a narrow window
CREATE TABLE IF NOT EXISTS public.nightly_job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name TEXT NOT NULL,
    run_date DATE NOT NULL DEFAULT CURRENT_DATE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    details JSONB,
    CONSTRAINT unique_job_per_date UNIQUE (job_name, run_date)
);

CREATE INDEX IF NOT EXISTS idx_nightly_job_runs_date ON public.nightly_job_runs(run_date);

COMMENT ON TABLE public.nightly_job_runs IS 'Tracks nightly pipeline job executions to prevent missed runs and enable catch-up processing';
