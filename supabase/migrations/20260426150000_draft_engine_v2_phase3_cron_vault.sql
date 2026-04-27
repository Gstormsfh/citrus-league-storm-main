-- Draft Engine v2 — Phase 3 chunk 10d: pg_cron schedules + Vault secret.
--
-- Two cron jobs land here:
--   1. 'draft-deadline-sweep'      — every 10s, calls draft_deadline_sweep()
--   2. 'draft-autopick-keepalive'  — every 2 min, POSTs to the worker
--
-- Plus operator instructions for provisioning the Vault secret that
-- holds the worker auth token.
--
-- ── ⚠️  STAGING-ONLY URL HARDCODED  ⚠️ ────────────────────────────────
-- The keep-alive cron command embeds the staging Edge Function URL
-- (project ref jjgspcpvqaiitloglxbb). Phase 8a prod cutover MUST ship
-- a re-parameterized version with the prod project ref. There is no
-- environment variable to read at SQL apply time; the URL is baked in.
-- Search for "STAGING_PROJECT_REF" below to find the line that must
-- change for prod.
-- ──────────────────────────────────────────────────────────────────────
--
-- ── ⚠️  OPERATOR PRE-FLIGHT REQUIRED  ⚠️ ─────────────────────────────
-- BEFORE applying this migration, provision the Vault secret holding
-- the worker auth token. The keep-alive cron resolves the Authorization
-- header from this secret at every fire — without it, the Edge
-- Function returns 401 on every keep-alive (degraded but safe; sweep
-- still works, just no worker drains the queue).
--
-- Provisioning recipe (run in Supabase Dashboard SQL Editor as
-- postgres, NOT as part of any committed file):
--
--   SELECT vault.create_secret(
--     '<paste SUPABASE_SERVICE_ROLE_KEY here>',
--     'draft-autopick-token',
--     'Bearer token used by draft-autopick-keepalive cron to invoke
--      the draft-autopick Edge Function. Matches the Edge Function''s
--      timing-safe compare against SUPABASE_SERVICE_ROLE_KEY (chunk
--      10c follow-up commit). Rotate when the project service-role
--      key rotates.'
--   );
--
-- Verify provisioning with:
--   SELECT name, description FROM vault.decrypted_secrets
--    WHERE name = 'draft-autopick-token';
--
-- This migration's verify block raises a NOTICE (not an exception) if
-- the secret is missing, so the migration applies cleanly even if the
-- operator hasn't provisioned yet — but the keep-alive will 401 until
-- they do.
-- ──────────────────────────────────────────────────────────────────────
--
-- Spec refs: §4.8 sweep, §11.1 cron cadences. Plan refs: §734 (sweep
-- schedule), §761 (keep-alive schedule), Q1 (Vault) lock-in.

-- ── 1. Verify Vault secret presence (NOTICE only — non-fatal) ─────────

DO $vault_check$
DECLARE
  v_secret_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name = 'draft-autopick-token'
  ) INTO v_secret_exists;

  IF v_secret_exists THEN
    RAISE NOTICE '  Vault: draft-autopick-token is provisioned.';
  ELSE
    RAISE NOTICE '  Vault: draft-autopick-token is MISSING. Provision it before keep-alive can succeed (see migration header for the recipe).';
  END IF;
END
$vault_check$;

-- ── 2. Schedule draft-deadline-sweep (every 10 seconds) ───────────────
-- 6-field cron expression; pg_cron supports sub-minute schedules. The
-- sweep is safe to run at this cadence — it acquires a transaction-
-- scoped advisory lock and no-ops if another sweep is in flight (chunk
-- 10b). At 10s cadence, 6 sweeps run per minute; expected steady-state
-- is ~5 lock-contended (returning 0) and 1 doing actual work.

DO $cron_sweep$
BEGIN
  PERFORM cron.schedule(
    'draft-deadline-sweep',
    '*/10 * * * * *',  -- every 10 seconds (6-field)
    'SELECT public.draft_deadline_sweep()'
  );
  RAISE NOTICE '  Scheduled: draft-deadline-sweep (every 10s)';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available, skipping draft-deadline-sweep schedule';
END $cron_sweep$;

-- ── 3. Schedule draft-autopick-keepalive (every 2 minutes) ────────────
-- Calls the draft-autopick Edge Function via pg_net. pg_net's
-- net.http_post is async — the cron job returns immediately with a
-- request_id; the actual HTTP exchange happens in pg_net's background
-- worker. Response (success or 401 or 5xx) lands in net.http_response.
--
-- The Edge Function has its own 140s loop budget; the keep-alive
-- cadence (2 min) plus the worker's 30s idle-exit means coverage is
-- near-continuous (10s gap max). During that gap, the sweep cron
-- (every 10s) catches any expired deadlines and re-enqueues them for
-- the next worker invocation.
--
-- Authorization header: 'Bearer ' || (SELECT decrypted_secret FROM
-- vault.decrypted_secrets WHERE name = 'draft-autopick-token'). The
-- COALESCE guard surfaces a missing secret as a clearly-broken token
-- ('Bearer MISSING_SECRET_PROVISION_VIA_VAULT') rather than a NULL
-- header, making the failure mode obvious in Edge Function auth_failed
-- logs.
--
-- Vault read API note: Supabase Vault does NOT expose a
-- vault.read_secret(text) function. Reading by name uses the
-- vault.decrypted_secrets view. An earlier draft of this migration
-- had `vault.read_secret('draft-autopick-token')` and would have
-- raised `function vault.read_secret(unknown) does not exist` at
-- every cron fire — caught only because the cron is paused on staging
-- per the Phase 3 sign-off discipline. Fix landed in the chunk 11e
-- vault-fix follow-up commit.
--
-- timeout_milliseconds: 150000 matches the Edge Function ceiling so
-- pg_net doesn't kill a still-running worker.

DO $cron_keepalive$
BEGIN
  PERFORM cron.schedule(
    'draft-autopick-keepalive',
    '*/2 * * * *',  -- every 2 minutes
    $kacmd$
      SELECT net.http_post(
        -- STAGING_PROJECT_REF: jjgspcpvqaiitloglxbb. Phase 8a edits this.
        url := 'https://jjgspcpvqaiitloglxbb.supabase.co/functions/v1/draft-autopick',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || COALESCE(
            (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'draft-autopick-token'),
            'MISSING_SECRET_PROVISION_VIA_VAULT'
          ),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 150000
      )
    $kacmd$
  );
  RAISE NOTICE '  Scheduled: draft-autopick-keepalive (every 2 min)';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron / pg_net not available, skipping draft-autopick-keepalive schedule';
END $cron_keepalive$;

-- ── 4. Verify (cron jobs registered) ──────────────────────────────────

DO $verify$
DECLARE
  v_job_count int;
BEGIN
  -- Wrap the cron.job lookup in its own EXCEPTION block — pg_cron may
  -- not exist in dev/test environments, in which case the schedules
  -- above silently skipped and we'd want this verify to also skip.
  BEGIN
    SELECT count(*)
      INTO v_job_count
      FROM cron.job
     WHERE jobname IN ('draft-deadline-sweep', 'draft-autopick-keepalive');
  EXCEPTION WHEN others THEN
    RAISE NOTICE '  cron.job not queryable, skipping schedule verification';
    RETURN;
  END;

  IF v_job_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 Phase 3 cron jobs (sweep + keepalive), got %', v_job_count;
  END IF;
END
$verify$;
