-- ============================================================================
-- SL-1b v2 REPLY APPLY — re-enable auto_fix nightly job (KI-041 close)
-- ============================================================================
--
-- Third reuse of the F24 apply tooling. Same architecture as prior
-- direct-apply harnesses. Target: prod. Mutation scope: single row in
-- cron.job (jobid=4, active=false → active=true).
--
-- USAGE (Garrett runs against PROD):
--   psql "$env:SUPABASE_DB_URL_PROD?client_encoding=UTF8" -v ON_ERROR_STOP=1 -f scripts/proof/apply-reenable-auto-fix.local.sql
--
-- REHEARSAL FIRST (INS-6 mandate):
--   psql "$env:SUPABASE_DB_URL_PROD" -v ON_ERROR_STOP=1 -f scripts/proof/rehearse-lo-bridge.local.sql
--   Expect: NOTICE:  bridge ok, <N> bytes → ROLLBACK
--
-- STEP 0 PIN (SL-1b v2 body md5):
--   md5(pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure))
--     = d0a54ca8925c9a8604781294a4b5631a
--   This is the LIVE v2 body from KI-036 close. Drift = the wrong DB or
--   an unnoticed supersede between v2 apply and this re-enable.
--
-- SCOPE:
--   - No function replacement — auto_fix_integrity_issues is live and
--     unchanged from SL-1b v2.
--   - Single mutation via pg_cron API:
--       PERFORM cron.alter_job(job_id := v_jobid, active := true)
--     where v_jobid is looked up from jobname='auto-fix-integrity'
--     (0F-OPS-3's convention). Reversible:
--       PERFORM cron.alter_job(job_id := <id>, active := false)
--     reproduces 0F-OPS-3's terminal state.
--   - Verified: jobname command still matches auto_fix pattern (guards
--     against jobname repurposing between disable and re-enable).
--
-- MECHANIC NOTE (INS-11 fix, 2026-08-06 evening):
--   v1 of this apply used direct DML — `UPDATE cron.job SET active=true
--   WHERE jobid=4`. Refused at migration line 116 with
--   `permission denied for table job`: Supabase's postgres role has
--   SELECT but not UPDATE on cron.job. pg_cron's designed mutation
--   surface is the cron.alter_job / cron.schedule / cron.unschedule
--   API functions. Standing rule added to MIGRATION_SAFETY_GUIDE
--   (Rule 5): all pg_cron mutations on Supabase go through the API,
--   never direct table DML. Seventh consecutive atomic refusal caught
--   by the transactional wrap — zero residue.
--
-- Property preservation: N/A here — this migration doesn't touch any
-- function's prosecdef/proconfig. STEP 3 asserts the auto_fix function
-- md5 STILL matches the SL-1b v2 pin (i.e., not perturbed by this apply).
--
-- KI-041 CLOSE: 0F-OPS-3 attribution recorded; reply-migration
-- convention established as coordination channel until a shared change
-- ledger exists. See `docs/PROD_CHANGE_LEDGER.md` for the interim
-- protocol.
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';   -- Rule 3
SHOW client_encoding;
\timing on

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 0 — Hash pin + pre-state verification
-- --------------------------------------------------------------------------
DO $sanity$
DECLARE
  v_body_md5        text;
  v_expected_md5    text := 'd0a54ca8925c9a8604781294a4b5631a';

  v_jobid           bigint;
  v_jobid_active    boolean;
  v_jobid_command   text;
BEGIN
  -- Hash pin: auto_fix_integrity_issues live body must be SL-1b v2.
  SELECT md5(pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure))
    INTO v_body_md5;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 0 PRE-APPLY HASH PIN + CRON PRECONDITION ===';
  RAISE NOTICE '  auto_fix live body md5    : %', v_body_md5;
  RAISE NOTICE '  expected (SL-1b v2 body)  : %', v_expected_md5;
  RAISE NOTICE '  md5 match                 : %', (v_body_md5 = v_expected_md5);

  IF v_body_md5 <> v_expected_md5 THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (md5): auto_fix live md5 % <> expected SL-1b v2 %. Either v2 was superseded or wrong DB. Investigate BEFORE re-enabling.',
      v_body_md5, v_expected_md5;
  END IF;

  -- Cron precondition: jobname 'auto-fix-integrity' exists, currently
  -- inactive, command matches auto_fix. Lookup by jobname mirrors
  -- 0F-OPS-3's convention (jobid can drift).
  SELECT jobid, active, command
    INTO v_jobid, v_jobid_active, v_jobid_command
    FROM cron.job
   WHERE jobname = 'auto-fix-integrity';

  RAISE NOTICE '  jobname ''auto-fix-integrity'' jobid : %', COALESCE(v_jobid::text, '<not found>');
  RAISE NOTICE '  currently active          : %  (expected false — 0F-OPS-3 terminal state)', v_jobid_active;
  RAISE NOTICE '  command (first 80)        : %', COALESCE(left(v_jobid_command, 80), '<null>');
  RAISE NOTICE '';

  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'STEP 0 FAIL (cron): jobname ''auto-fix-integrity'' not found. Aborting.';
  END IF;

  IF v_jobid_command NOT ILIKE '%auto_fix_integrity_issues%' THEN
    RAISE EXCEPTION 'STEP 0 FAIL (cron): jobname ''auto-fix-integrity'' command does not match auto_fix pattern. Actual: %. Refusing to re-enable a repurposed jobname.',
      v_jobid_command;
  END IF;

  IF v_jobid_active THEN
    RAISE NOTICE 'STEP 0 NOTE: already active — apply is a no-op replay. Proceeding for history-row correctness.';
  END IF;

  RAISE NOTICE 'STEP 0 PASS: auto_fix v2 pinned, jobname ''auto-fix-integrity'' (jobid=%) target verified.', v_jobid;
END
$sanity$;

-- --------------------------------------------------------------------------
-- STEP 1 — Capture cron.job pre-state (Rule 1 analog for cron mutations)
-- --------------------------------------------------------------------------
-- No pg_get_functiondef equivalent for cron rows; capture the
-- jobname='auto-fix-integrity' row to a file client-side.

\copy (SELECT to_json(j) FROM cron.job j WHERE j.jobname = 'auto-fix-integrity') TO 'supabase/migrations/captures/2026-08-06_pre_reenable_cron_job_auto_fix_integrity.json' WITH (FORMAT text, HEADER false)

-- --------------------------------------------------------------------------
-- STEP 2 — Apply the reply migration
-- --------------------------------------------------------------------------
\echo ''
\echo 'STEP 2: applying supabase/migrations/20260806200000_reenable_auto_fix_after_sl1b_v2.sql'
\i supabase/migrations/20260806200000_reenable_auto_fix_after_sl1b_v2.sql

-- --------------------------------------------------------------------------
-- STEP 3 — Post-apply verification
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_body_md5      text;
  v_expected_md5  text := 'd0a54ca8925c9a8604781294a4b5631a';

  v_jobid           bigint;
  v_jobid_active    boolean;
  v_jobid_schedule  text;
  v_jobid_command   text;
BEGIN
  -- Function body unchanged: hash pin STILL matches.
  SELECT md5(pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure))
    INTO v_body_md5;

  IF v_body_md5 <> v_expected_md5 THEN
    RAISE EXCEPTION 'STEP 3 FAIL (function drift): auto_fix live md5 changed during apply. Expected %, got %.',
      v_expected_md5, v_body_md5;
  END IF;

  -- Cron job now active + schedule intact. Lookup by jobname (jobid varies).
  SELECT jobid, active, schedule, command
    INTO v_jobid, v_jobid_active, v_jobid_schedule, v_jobid_command
    FROM cron.job
   WHERE jobname = 'auto-fix-integrity';

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 3 POST-APPLY VERIFICATION ===';
  RAISE NOTICE '  auto_fix body md5 unchanged   : %', (v_body_md5 = v_expected_md5);
  RAISE NOTICE '  jobname ''auto-fix-integrity'' jobid : %', COALESCE(v_jobid::text, '<not found>');
  RAISE NOTICE '  active                        : %  (expected true)', v_jobid_active;
  RAISE NOTICE '  schedule                      : %', v_jobid_schedule;
  RAISE NOTICE '  command (first 80)            : %', COALESCE(left(v_jobid_command, 80), '<null>');
  RAISE NOTICE '';

  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'STEP 3 FAIL: jobname ''auto-fix-integrity'' not found in cron.job after alter_job call.';
  END IF;

  IF NOT v_jobid_active THEN
    RAISE EXCEPTION 'STEP 3 FAIL: cron.alter_job completed but jobname active is still false. Verify permissions or investigate.';
  END IF;

  IF v_jobid_command NOT ILIKE '%auto_fix_integrity_issues%' THEN
    RAISE EXCEPTION 'STEP 3 FAIL: jobname command changed during apply. Actual: %.', v_jobid_command;
  END IF;

  RAISE NOTICE 'STEP 3 PASS: auto_fix body unchanged, jobname ''auto-fix-integrity'' (jobid=%) active=true, schedule + command intact.', v_jobid;
END
$verify$;

-- --------------------------------------------------------------------------
-- STEP 4 — History reconciliation (INS-6 GUC bridge, Rule 2 byte-exact)
-- --------------------------------------------------------------------------
\echo ''
\echo 'STEP 4: INSERT history for 20260806200000_reenable_auto_fix_after_sl1b_v2 (INS-6 bridge)'

\lo_import 'supabase/migrations/20260806200000_reenable_auto_fix_after_sl1b_v2.sql'
\set oid_reen :LASTOID
SELECT set_config('vars.oid_reen', :'oid_reen', true) AS bridged_oid_reen;

DO $insert_reen$
DECLARE
  v_oid            oid  := current_setting('vars.oid_reen')::oid;
  v_body           text;
  v_hash           text;
  v_hash_of_bytes  text;
  v_already_exists boolean;
BEGIN
  v_body          := convert_from(lo_get(v_oid), 'UTF8');
  v_hash          := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  v_hash_of_bytes := encode(sha256(lo_get(v_oid)), 'hex');

  RAISE NOTICE '';
  RAISE NOTICE '  file bytes uploaded to OID  : %', v_oid;
  RAISE NOTICE '  text length after decode    : % chars', length(v_body);
  RAISE NOTICE '  sha256 of decoded text      : %', v_hash;
  RAISE NOTICE '  sha256 of original bytes    : %', v_hash_of_bytes;
  RAISE NOTICE '  round-trip byte-equivalent  : %', (v_hash = v_hash_of_bytes);

  IF v_hash <> v_hash_of_bytes THEN
    RAISE EXCEPTION 'STEP 4 FAIL: sha256(decoded text) <> sha256(original bytes).';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260806200000'
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RAISE NOTICE '  history row for 20260806200000 already exists — UPDATE (idempotent replay)';
    UPDATE supabase_migrations.schema_migrations
       SET name = 'reenable_auto_fix_after_sl1b_v2',
           statements = ARRAY[v_body]
     WHERE version = '20260806200000';
  ELSE
    RAISE NOTICE '  INSERTing new history row for 20260806200000';
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ('20260806200000', 'reenable_auto_fix_after_sl1b_v2', ARRAY[v_body]);
  END IF;

  RAISE NOTICE '  history row written for 20260806200000';
END
$insert_reen$;

SELECT lo_unlink(:'oid_reen'::oid);

-- --------------------------------------------------------------------------
-- STEP 5 — Final assertion
-- --------------------------------------------------------------------------
DO $final$
DECLARE
  v_hist_row_count int;
  v_jobid_active   boolean;
BEGIN
  SELECT count(*)
    INTO v_hist_row_count
    FROM supabase_migrations.schema_migrations
   WHERE version = '20260806200000';

  SELECT active INTO v_jobid_active FROM cron.job WHERE jobname = 'auto-fix-integrity';

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 5 FINAL ASSERTION ===';
  RAISE NOTICE '  history rows for 20260806200000       : % (expect 1)', v_hist_row_count;
  RAISE NOTICE '  jobname ''auto-fix-integrity'' active  : %  (expect true)', v_jobid_active;
  RAISE NOTICE '';

  IF v_hist_row_count <> 1 THEN
    RAISE EXCEPTION 'STEP 5 FAIL: expected 1 history row, found %.', v_hist_row_count;
  END IF;

  IF NOT v_jobid_active THEN
    RAISE EXCEPTION 'STEP 5 FAIL: jobname ''auto-fix-integrity'' active is false at final check.';
  END IF;

  RAISE NOTICE 'STEP 5 PASS: reply migration recorded, cron.alter_job re-enabled auto-fix-integrity.';
END
$final$;

COMMIT;

\echo ''
\echo '=============================================================='
\echo 'SL-1b v2 REPLY APPLY COMPLETE — KI-041 CLOSED'
\echo '=============================================================='
\echo ''
\echo 'NEXT (per architect close):'
\echo ''
\echo '  1. Commit the pre-apply capture:'
\echo '       git add supabase/migrations/captures/2026-08-06_pre_reenable_cron_job_auto_fix_integrity.json'
\echo '       git commit -m "evidence(KI-041): pre-reenable cron.job row snapshot (jobname=auto-fix-integrity, 0F-OPS-3 terminal state)"'
\echo ''
\echo '  2. FINAL confirmation (tomorrow AM, first 04:00 UTC after apply):'
\echo '       SELECT jrd.start_time, jrd.status, left(jrd.return_message, 200)'
\echo '         FROM cron.job_run_details jrd'
\echo '        WHERE jrd.command ILIKE ''%auto_fix_integrity_issues%'''
\echo '        ORDER BY jrd.start_time DESC LIMIT 5;'
\echo '     Expect: most recent row status=succeeded — first scheduled'
\echo '     success since 2026-02-25.'
\echo ''
\echo '=============================================================='
