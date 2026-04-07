-- pipeline_runs: audit trail for data pipeline executions and dead-man health checks.
-- Populated by the pipeline-deadman edge function (and optionally by Python workers).
-- Used to detect silent pipeline failures within 15 minutes instead of 3 days.

CREATE TABLE IF NOT EXISTS public.pipeline_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    rows_ingested integer,
    error_message text,
    metadata jsonb
);

CREATE INDEX IF NOT EXISTS pipeline_runs_service_started_idx
    ON public.pipeline_runs (service_name, started_at DESC);

-- RLS: deny-by-default, service_role has full access via bypass.
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically, but we add an explicit permissive policy
-- for clarity. Authenticated users get no access by default.
-- TODO: once an admin_users table is available, add a SELECT policy for admins, e.g.:
--   CREATE POLICY pipeline_runs_admin_read ON public.pipeline_runs
--     FOR SELECT TO authenticated
--     USING (auth.uid() IN (SELECT user_id FROM public.admin_users));
CREATE POLICY pipeline_runs_service_role_all
    ON public.pipeline_runs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
