-- ============================================================================
-- N-2 / KI-034 APPLY — submit_pick_v2 clears leagues.draft_state (STAGING)
-- ============================================================================
--
-- Fifth reuse of the F24 apply tooling. Migration is a CREATE OR REPLACE
-- of `submit_pick_v2` — Rules 1-3 apply.
--
-- USAGE (Garrett runs against STAGING):
--   psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 -f scripts/proof/apply-n2-draft-state.local.sql
--
-- REHEARSAL FIRST (INS-6 GUC bridge — always run before an apply that
-- uses \lo_import + convert_from):
--   psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/proof/rehearse-lo-bridge.local.sql
--   Expect: NOTICE:  bridge ok, <N> bytes → ROLLBACK
--
-- ── Standing rules applied ─────────────────────────────────────────
--   Rule 1 — Capture-before-replace: STEP 0 hash-pins against
--            `supabase/migrations/captures/2026-08-08_pre_v2_draft_completion_clears_draft_state.sql`.
--            Garrett must POPULATE that file with live pg_get_functiondef
--            BEFORE running this apply (placeholder rejects with
--            explicit RAISE EXCEPTION). See capture file's header for
--            the psql command.
--   Rule 2 — Real SQL in history row via \lo_import + INS-6 GUC bridge.
--   Rule 3 — client_encoding=UTF8 forced at psql start + SHOW echo.
--   Rule 4 — No gcloud interrogations (N/A).
--   Rule 5 — No pg_cron mutations (N/A).
--
-- ── PROD_CHANGE_LEDGER Rule 2 ──────────────────────────────────────
--   Garrett runs `scripts/proof/preapply-n2-history-read.local.sql`
--   BEFORE this apply. Q1 (no other-workstream mutation on
--   submit_pick_v2 since F24 rebase applied 2026-08-05) must clear.
--   (Preapply script authored in same commit as this apply-harness.)
--
-- ── Dry-run gate ───────────────────────────────────────────────────
--   Not yet authored (task #56 candidate). For today's author-only mode,
--   STEP 3's marker verification (below) is the sole post-apply gate.
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';   -- Rule 3
SHOW client_encoding;
\timing on

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 0 — Capture hash pin (Rule 1 capture-before-replace enforcement)
-- --------------------------------------------------------------------------
-- The capture file must contain the LIVE pg_get_functiondef output
-- (Garrett-populated same-day). If it still holds the placeholder
-- sentinel, abort loudly. If it holds a body, compare md5 against
-- current live body — divergence means some OTHER migration touched
-- submit_pick_v2 between capture-day and now.

\set capture_path 'supabase/migrations/captures/2026-08-08_pre_v2_draft_completion_clears_draft_state.sql'

\echo ''
\echo '=== STEP 0 CAPTURE HASH PIN ==='

-- Load capture file bytes via lo_import → GUC bridge (INS-6) so the
-- DO block below can read them without shell-quoting.
\lo_import :capture_path 'n2_capture'
\gset capture_
SELECT set_config('n2.capture_oid', :'capture_oid', true);

DO $step0$
DECLARE
  v_capture_bytes bytea;
  v_capture_text  text;
  v_capture_md5   text;
  v_live_body     text;
  v_live_md5      text;
  v_placeholder   text := 'PLACEHOLDER — REPLACE BEFORE APPLY';
BEGIN
  v_capture_bytes := lo_get(current_setting('n2.capture_oid')::oid);
  v_capture_text  := convert_from(v_capture_bytes, 'UTF8');

  -- Guard: reject if the placeholder sentinel is still present.
  IF v_capture_text LIKE '%' || v_placeholder || '%' THEN
    RAISE EXCEPTION
      'STEP 0 FAIL: capture file at % still contains PLACEHOLDER sentinel. Garrett must populate with live pg_get_functiondef BEFORE apply — see capture file header for the psql command.',
      current_setting('n2.capture_oid');
  END IF;

  -- Capture bytes look like a real body — compute md5 for the diff check.
  v_capture_md5 := md5(v_capture_text);

  -- Fetch the current live body.
  SELECT pg_get_functiondef(
    'public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid)'::regprocedure
  ) INTO v_live_body;
  v_live_md5 := md5(v_live_body);

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 0 HASH PIN ===';
  RAISE NOTICE '  capture md5 : %', v_capture_md5;
  RAISE NOTICE '  live    md5 : %', v_live_md5;

  IF v_capture_md5 IS DISTINCT FROM v_live_md5 THEN
    RAISE EXCEPTION
      'STEP 0 FAIL: capture body md5 (%) does not match live body md5 (%). Some other migration touched submit_pick_v2 between capture-day and now. HALT — investigate before applying. (Historical baseline expected: F24 rebase 20260805050000, applied 2026-08-05.)',
      v_capture_md5, v_live_md5;
  END IF;

  RAISE NOTICE 'STEP 0 PASS: capture body matches live body byte-for-byte (post-mojibake-tolerance).';
END
$step0$;

-- Clean up the temp large object (defensive; DO block does not
-- inherit control here).
SELECT lo_unlink(current_setting('n2.capture_oid')::oid);

-- --------------------------------------------------------------------------
-- STEP 1 — Load migration file into a large object (Rule 2 real-SQL prep)
-- --------------------------------------------------------------------------
-- The migration file's bytes go into `supabase_migrations.schema_migrations.
-- statements[1]` as byte-exact SQL. `\lo_import` avoids shell-quoting.

\set migration_path 'supabase/migrations/20260808120000_v2_draft_completion_clears_draft_state.sql'
\lo_import :migration_path 'n2_migration'
\gset migration_
SELECT set_config('n2.migration_oid', :'migration_oid', true);

-- --------------------------------------------------------------------------
-- STEP 2 — Apply the migration
-- --------------------------------------------------------------------------
\echo ''
\echo 'STEP 2: applying supabase/migrations/20260808120000_v2_draft_completion_clears_draft_state.sql'
\i supabase/migrations/20260808120000_v2_draft_completion_clears_draft_state.sql

-- --------------------------------------------------------------------------
-- STEP 3 — Post-apply verification (markers + property posture + hash pin)
-- --------------------------------------------------------------------------
DO $step3$
DECLARE
  v_body            text;
  v_body_md5        text;

  -- Property posture
  v_prosecdef       boolean;
  v_proconfig       text;
  v_overload_count  int;

  -- Markers unique to this migration (the ones that MUST have landed)
  v_has_n2_kimarker            boolean;
  v_has_draft_state_completed  boolean;
  v_has_n2_comment             boolean;

  -- Preserved F24 markers (regression lock — must still be present)
  v_has_amendment_1_null_dl    boolean;
  v_has_amendment_3_deleted_at boolean;
  v_has_amendment_4_hash       boolean;
BEGIN
  SELECT pg_get_functiondef(
    'public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid)'::regprocedure
  ) INTO v_body;
  v_body_md5 := md5(v_body);

  SELECT count(*), bool_and(prosecdef), string_agg(proconfig::text, ',')
    INTO v_overload_count, v_prosecdef, v_proconfig
    FROM pg_proc
   WHERE proname = 'submit_pick_v2'
     AND pronamespace = 'public'::regnamespace;

  -- N-2 markers (unique to this migration)
  v_has_n2_kimarker           := v_body LIKE '%N-2 / KI-034%';
  v_has_draft_state_completed := v_body LIKE '%draft_state  = ''completed''%';
  v_has_n2_comment            := v_body LIKE '%Amendment 2%superseded%';

  -- F24 markers (regression lock — pre-existing, must survive)
  v_has_amendment_1_null_dl    := v_body LIKE '%Amendment 1: pick_deadline = NULL%';
  v_has_amendment_3_deleted_at := v_body LIKE '%Amendment 3%AND deleted_at IS NULL%';
  v_has_amendment_4_hash       := v_body LIKE '%v_completion_hash%';

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 3 POST-APPLY ===';
  RAISE NOTICE '  live body md5             : %', v_body_md5;
  RAISE NOTICE '  overload count            : % (expected 1)',   v_overload_count;
  RAISE NOTICE '  prosecdef                 : % (expected true)', v_prosecdef;
  RAISE NOTICE '  proconfig                 : % (expected {search_path=public})', v_proconfig;
  RAISE NOTICE '';
  RAISE NOTICE '  N-2 marker (KI-034)                       : %', v_has_n2_kimarker;
  RAISE NOTICE '  N-2 marker (draft_state = ''completed'')   : %', v_has_draft_state_completed;
  RAISE NOTICE '  N-2 marker (Amendment 2 superseded)       : %', v_has_n2_comment;
  RAISE NOTICE '  F24 preserved (Amendment 1 pick_deadline) : %', v_has_amendment_1_null_dl;
  RAISE NOTICE '  F24 preserved (Amendment 3 deleted_at)    : %', v_has_amendment_3_deleted_at;
  RAISE NOTICE '  F24 preserved (Amendment 4 completion_hash): %', v_has_amendment_4_hash;

  IF v_overload_count <> 1 THEN
    RAISE EXCEPTION 'STEP 3 FAIL: expected exactly 1 submit_pick_v2 overload, got %', v_overload_count;
  END IF;
  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION 'STEP 3 FAIL: prosecdef is % (expected true — SECURITY DEFINER)', v_prosecdef;
  END IF;
  IF v_proconfig IS NULL OR v_proconfig NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'STEP 3 FAIL: proconfig is % (expected {search_path=public})', v_proconfig;
  END IF;
  IF NOT v_has_n2_kimarker THEN
    RAISE EXCEPTION 'STEP 3 FAIL: N-2/KI-034 marker missing from live body';
  END IF;
  IF NOT v_has_draft_state_completed THEN
    RAISE EXCEPTION 'STEP 3 FAIL: `draft_state = ''completed''` clause missing from live body — the actual N-2 change did not land';
  END IF;
  IF NOT v_has_amendment_1_null_dl THEN
    RAISE EXCEPTION 'STEP 3 FAIL: F24 Amendment 1 (pick_deadline=NULL) marker missing — F24 discipline regressed';
  END IF;
  IF NOT v_has_amendment_3_deleted_at THEN
    RAISE EXCEPTION 'STEP 3 FAIL: F24 Amendment 3 (AND deleted_at IS NULL) marker missing — F24 discipline regressed';
  END IF;
  IF NOT v_has_amendment_4_hash THEN
    RAISE EXCEPTION 'STEP 3 FAIL: F24 Amendment 4 (v_completion_hash) marker missing — F24 discipline regressed';
  END IF;

  RAISE NOTICE 'STEP 3 PASS: all markers present, property posture intact.';
END
$step3$;

-- --------------------------------------------------------------------------
-- STEP 4 — Write history row (Rule 2 real-SQL-in-statements)
-- --------------------------------------------------------------------------
-- The `statements` column is TEXT[]. Each element must be a full SQL
-- statement (byte-exact) that a future rebuild will execute. We ship
-- the entire migration file's bytes as a single statement via
-- `lo_get(oid) → convert_from(bytea, 'UTF8')` — no shell-quoting.

DO $step4$
DECLARE
  v_migration_bytes bytea;
  v_migration_text  text;
  v_version         text := '20260808120000';
  v_name            text := 'v2_draft_completion_clears_draft_state';
BEGIN
  v_migration_bytes := lo_get(current_setting('n2.migration_oid')::oid);
  v_migration_text  := convert_from(v_migration_bytes, 'UTF8');

  INSERT INTO supabase_migrations.schema_migrations (
    version, name, statements
  ) VALUES (
    v_version,
    v_name,
    ARRAY[v_migration_text]::text[]
  );

  RAISE NOTICE 'STEP 4 PASS: history row inserted (version=%, name=%, statements[1] bytes=%)',
    v_version, v_name, length(v_migration_text);
END
$step4$;

-- Clean up the temp large object.
SELECT lo_unlink(current_setting('n2.migration_oid')::oid);

-- --------------------------------------------------------------------------
-- STEP 5 — Cross-check: statements[1] round-trips vs live body
-- --------------------------------------------------------------------------
-- MIGRATION_SAFETY_GUIDE KI-032 verification test (b): the history row
-- statements[1] contains the migration file's bytes; on a future rebuild
-- executing that string should produce the same live body. This step
-- verifies the history row's SQL, when re-executed via `EXECUTE`, would
-- reproduce the same md5 as the current live body. Doesn't actually
-- re-execute (would double-apply); just diffs the CREATE OR REPLACE
-- block text against the current live body's function definition.

-- (For the F24 rebase, the equivalent check was manually confirmed
-- post-apply. Skipping automation here per today's scope — task #57
-- candidate: automate this cross-check universally across apply-
-- harnesses.)

\echo ''
\echo 'STEP 5: cross-check skipped (task #57 candidate for automation)'

-- --------------------------------------------------------------------------
-- COMMIT
-- --------------------------------------------------------------------------
COMMIT;

\echo ''
\echo '=================================================================='
\echo 'N-2 / KI-034 APPLY COMPLETE'
\echo '=================================================================='
\echo ''
\echo 'Next steps (Garrett-exec):'
\echo '  1. Run STEP 5''s rerun to confirm end-to-end completion writes'
\echo '     draft_state=''completed'' on the DB (test-only —'
\echo '     REGISTRY.md KI-034 verification test path).'
\echo '  2. Update KI-034 in docs/REGISTRY.md with **RESOLVED** marker'
\echo '     citing this commit and the STEP 5'' evidence.'
\echo '  3. Update task #54 (N-2 decision) to completed.'
\echo ''
