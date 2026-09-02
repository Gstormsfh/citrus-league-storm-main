-- ============================================================================
-- OPS_CI_RUNS — CI / deploy / nightly outcomes, readable through the Supabase MCP
-- ============================================================================
-- WHAT. One table, public.ops_ci_runs. Every job in ci.yml, production-deploy.yml,
-- main.yml, data-invariants.yml and schema-snapshot.yml ends with an
-- `if: always()` step (.github/actions/report-run) that POSTs one row here over
-- PostgREST with the service-role key: workflow, run id, sha, job, status and a
-- one-line summary (test totals, deploy result, the failing step).
--
-- WHY NOW. Claude's container cannot reach github.com, so until this table
-- existed the only way a CI or deploy result reached a Claude session was
-- Garrett pasting the log. Supabase is the one connector both sides already
-- share (process-efficiency audit 2026-09-01, §C "Supabase as the telemetry
-- channel", §D-5). With this table Claude runs
--   SELECT workflow, job, status, summary, url FROM public.ops_ci_runs
--    WHERE status = 'failure' ORDER BY created_at DESC LIMIT 20;
-- through the MCP and sees the outcome without a paste.
--
-- WHO. Ops workstream, from the D-5 item of the audit. Applied to prod via the
-- Supabase MCP after merge (standing constraint: no `supabase db push` from
-- the repo — docs/CLAUDE_MIGRATIONS_PR291.md); this file is the record of what
-- was applied (docs/PROD_CHANGE_LEDGER.md Rule 1).
--
-- ACCESS. RLS enabled with NO policies: anon and authenticated get default-deny
-- (and are explicitly revoked below, so the table is invisible to them even
-- through a future permissive default). service_role bypasses RLS, which is the
-- only reader and writer: GitHub Actions inserts, Claude reads via the MCP.
-- No definer function, no RPC, no app code path touches this table.
--
-- SIZE. ~20 rows per CI run, a few hundred a day in a busy week; summary is
-- capped at 4 KB (the action truncates client-side and the CHECK enforces it).
-- Retention is deliberately not wired in this migration: 'audit-log-retention'
-- is a shared cron job (PROD_CHANGE_LEDGER Rule 2 — read its history first),
-- and the table needs months of rows before a window can be chosen. Revisit
-- when it passes ~50 MB.
--
-- VERIFY (post-apply):
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ops_ci_runs'::regclass;  -- t
--   SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='ops_ci_runs'; -- 0
--   SELECT has_table_privilege('anon','public.ops_ci_runs','SELECT');           -- f
--   SELECT has_table_privilege('authenticated','public.ops_ci_runs','SELECT');  -- f
--   SELECT has_table_privilege('service_role','public.ops_ci_runs','INSERT');   -- t
-- ROLLBACK: DROP TABLE public.ops_ci_runs;  (telemetry only, nothing depends on it)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ops_ci_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow     text        NOT NULL,
  run_id       bigint      NOT NULL,
  run_attempt  integer     NOT NULL DEFAULT 1,
  sha          text        NOT NULL,
  ref          text,
  job          text        NOT NULL,
  status       text        NOT NULL
                 CHECK (status IN ('success', 'failure', 'cancelled', 'skipped')),
  started_at   timestamptz,
  finished_at  timestamptz NOT NULL DEFAULT now(),
  summary      text
                 CHECK (summary IS NULL OR octet_length(summary) <= 4096),
  url          text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ops_ci_runs IS
  'One row per GitHub Actions job outcome (CI, production deploy, nightly '
  'projections, data invariants, schema snapshot). Written by '
  '.github/actions/report-run over PostgREST with the service-role key; read '
  'by Claude through the Supabase MCP because the container cannot reach '
  'github.com. Service-role only: RLS on, no policies, anon/authenticated '
  'revoked. See docs/RUNBOOKS/CI_TELEMETRY.md.';

COMMENT ON COLUMN public.ops_ci_runs.workflow IS
  'Workflow display name (GITHUB_WORKFLOW), e.g. ''CI'', ''Production Deploy''.';
COMMENT ON COLUMN public.ops_ci_runs.run_id IS
  'GITHUB_RUN_ID. Together with run_attempt identifies one run of the workflow.';
COMMENT ON COLUMN public.ops_ci_runs.sha IS
  'Commit the job ran against. For pull_request events this is the PR head '
  'commit, not the synthetic merge commit.';
COMMENT ON COLUMN public.ops_ci_runs.ref IS
  'Branch name: the PR head branch for pull_request events, else GITHUB_REF_NAME.';
COMMENT ON COLUMN public.ops_ci_runs.job IS
  'Job key from the workflow file (GITHUB_JOB), e.g. ''test-server''.';
COMMENT ON COLUMN public.ops_ci_runs.status IS
  'job.status at the final step: success | failure | cancelled. skipped is '
  'reserved for jobs that report a dependency''s result (needs.<job>.result).';
COMMENT ON COLUMN public.ops_ci_runs.started_at IS
  'Run start (GitHub run_started_at). NULL when the API lookup was unavailable.';
COMMENT ON COLUMN public.ops_ci_runs.summary IS
  'One line, <= 4 KB, ANSI-stripped and truncated by the action: test totals, '
  'failing step, deploy result. Not a log; the url is the log.';
COMMENT ON COLUMN public.ops_ci_runs.url IS
  'Link to the GitHub Actions run.';

-- Read patterns: "latest failures" and "latest runs of workflow X".
CREATE INDEX IF NOT EXISTS ops_ci_runs_created_at_idx
  ON public.ops_ci_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS ops_ci_runs_workflow_created_at_idx
  ON public.ops_ci_runs (workflow, created_at DESC);

-- Service-role only. RLS with no policies already denies anon and authenticated
-- (and the default privileges set in 20260804045646 give anon nothing), but the
-- explicit REVOKE means a future policy cannot open this table by accident: a
-- policy is only consulted when the role holds the privilege in the first place.
ALTER TABLE public.ops_ci_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_ci_runs FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.ops_ci_runs TO service_role;

-- Post-apply gate: the shape above is the whole point of the table, so refuse
-- to leave it in any other state.
DO $gate$
DECLARE
  v_rls      boolean;
  v_policies integer;
BEGIN
  SELECT relrowsecurity INTO v_rls
    FROM pg_catalog.pg_class WHERE oid = 'public.ops_ci_runs'::regclass;
  SELECT count(*) INTO v_policies
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'ops_ci_runs';

  IF NOT v_rls THEN
    RAISE EXCEPTION 'ops_ci_runs: RLS is not enabled';
  END IF;
  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'ops_ci_runs: expected 0 policies, found %', v_policies;
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.ops_ci_runs', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.ops_ci_runs', 'SELECT') THEN
    RAISE EXCEPTION 'ops_ci_runs: anon or authenticated can still SELECT';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.ops_ci_runs', 'INSERT') THEN
    RAISE EXCEPTION 'ops_ci_runs: service_role cannot INSERT';
  END IF;

  RAISE NOTICE 'ops_ci_runs OK: rls=%, policies=%, service_role insert=true', v_rls, v_policies;
END
$gate$;
