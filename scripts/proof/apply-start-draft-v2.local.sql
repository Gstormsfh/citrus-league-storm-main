-- ============================================================================
-- F27 APPLY — start_draft_v2 migration (STAGING)
-- ============================================================================
--
-- Fourth reuse of the F24 apply tooling. Migration is a NEW function
-- (no prior body to hash-pin), so STEP 0 is a create-analog: assert
-- the function does NOT already exist. STEP 3 asserts the standard
-- property posture post-apply (SECURITY DEFINER, search_path=public,
-- single overload) plus the full F27 marker set.
--
-- USAGE (Garrett runs against STAGING; F27 target per architect):
--   psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 -f scripts/proof/apply-start-draft-v2.local.sql
--
-- REHEARSAL FIRST (INS-6):
--   psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/proof/rehearse-lo-bridge.local.sql
--   Expect: NOTICE:  bridge ok, <N> bytes → ROLLBACK
--
-- ── Standing rules applied ─────────────────────────────────────────
--   Rule 1 — Capture-before-replace: this is a fresh CREATE, no prior
--            body to capture. Documented in STEP 0 note.
--   Rule 2 — Real SQL in history via \lo_import + INS-6 GUC bridge.
--   Rule 3 — client_encoding=UTF8 forced.
--   Rule 4 — No gcloud interrogations (N/A).
--   Rule 5 — No pg_cron mutations (N/A).
--
-- ── PROD_CHANGE_LEDGER Rule 2 ──────────────────────────────────────
--   Garrett runs scripts/proof/preapply-f27-history-read.local.sql
--   BEFORE this apply. Q1 (no other-workstream mutation on leagues /
--   draft_events / draft_status / draft_state / append_draft_event /
--   validate_draft_event_payload since 2026-08-06) + Q5 (start_draft_v2
--   does NOT already exist) must clear.
--
-- ── Dry-run gate ───────────────────────────────────────────────────
--   node scripts/proof/dryrun-apply-start-draft-v2-checks.local.mjs
--   Must be 43/43 PASS (INS-5). Confirmed at commit 36d344c1.
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';   -- Rule 3
SHOW client_encoding;
\timing on

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 0 — Create-analog of hash pin: assert function does NOT exist
-- --------------------------------------------------------------------------
-- Rule 1 (capture-before-replace) applies to REPLACE flows. F27 is a
-- fresh CREATE — no prior body exists to capture. The analog is the
-- inverse assertion: `SELECT COUNT(*) FROM pg_proc WHERE ... = 0`.
-- If any other workstream created start_draft_v2 between the pre-apply
-- history read and this apply, abort loudly.

DO $sanity$
DECLARE
  v_existing_count int;
BEGIN
  SELECT count(*)
    INTO v_existing_count
    FROM pg_proc
   WHERE proname = 'start_draft_v2'
     AND pronamespace = 'public'::regnamespace;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 0 PRE-APPLY (create-analog) ===';
  RAISE NOTICE '  existing start_draft_v2 overloads : % (expected 0)', v_existing_count;
  RAISE NOTICE '';

  IF v_existing_count <> 0 THEN
    RAISE EXCEPTION
      'STEP 0 FAIL: start_draft_v2 already exists in public schema (% overload(s) found). Either another workstream created it (reply-migration convention — PROD_CHANGE_LEDGER Rule 3) OR this apply is a retry after a prior partial commit. Investigate BEFORE proceeding.',
      v_existing_count;
  END IF;

  RAISE NOTICE 'STEP 0 PASS: no pre-existing start_draft_v2; safe to CREATE.';
END
$sanity$;

-- --------------------------------------------------------------------------
-- STEP 1 — Save pre-apply capture (Rule 1 note file, no body to capture)
-- --------------------------------------------------------------------------
-- Client-side \copy of the empty-set query — produces a marker file
-- documenting "no prior body existed" for the audit trail. Symmetric
-- with F24/SL-1b captures that recorded prior live bodies.

\copy (SELECT 'F27 create-analog — no prior start_draft_v2 body existed; STEP 0 verified 0 overloads on ' || now()::text AS marker) TO 'supabase/migrations/captures/2026-08-07_pre_start_draft_v2_create_analog.txt' WITH (FORMAT text, HEADER false)

-- --------------------------------------------------------------------------
-- STEP 2 — Apply the migration
-- --------------------------------------------------------------------------
\echo ''
\echo 'STEP 2: applying supabase/migrations/20260807000000_start_draft_v2.sql'
\i supabase/migrations/20260807000000_start_draft_v2.sql

-- --------------------------------------------------------------------------
-- STEP 3 — Post-apply verification (marker set + property posture)
-- --------------------------------------------------------------------------
-- Marker verification mirrors the dry-run harness at
-- scripts/proof/dryrun-apply-start-draft-v2-checks.local.mjs (43/43
-- PASS confirmed at commit 36d344c1) — but against LIVE
-- pg_get_functiondef output instead of file body. pg_get_functiondef
-- preserves plpgsql body text verbatim; markers match.

DO $verify$
DECLARE
  v_body               text;
  v_body_md5           text;
  v_body_len           int;

  -- Property posture
  v_overload_count     int;
  v_prosecdef          boolean;
  v_proconfig          text;

  -- Sample of key markers (full 43-check set is validated by the
  -- dry-run against the migration file; STEP 3 spot-checks the
  -- ones that would silently fail if the plpgsql body somehow
  -- diverged from the file bytes on apply).
  v_has_start_draft_v2 boolean;
  v_has_step0_lock     boolean;
  v_has_rider1_completed_first boolean;
  v_has_rider1_in_progress boolean;
  v_has_rider1_illegal_combo boolean;
  v_has_amendment3_filters int;
  v_has_deadline_formula boolean;
  v_has_all_six_payload_fields boolean;
  v_has_validator_call boolean;
  v_has_sha256_hash    boolean;
  v_has_append_call    boolean;
  v_has_step7_update   boolean;
BEGIN
  SELECT pg_get_functiondef('public.start_draft_v2(uuid,jsonb,uuid,uuid)'::regprocedure)
    INTO v_body;

  v_body_md5 := md5(v_body);
  v_body_len := length(v_body);

  -- Property posture
  SELECT
    (SELECT count(*) FROM pg_proc WHERE proname = 'start_draft_v2'
                                    AND pronamespace = 'public'::regnamespace)::int,
    p.prosecdef,
    COALESCE(array_to_string(p.proconfig, ' '), '<null>')
    INTO v_overload_count, v_prosecdef, v_proconfig
    FROM pg_proc p
   WHERE p.proname = 'start_draft_v2'
     AND p.pronamespace = 'public'::regnamespace
   LIMIT 1;

  -- Spot-check markers (subset of dry-run's 43). If the file bytes
  -- landed in the plpgsql body exactly as the dry-run validated, all
  -- of these pass; if pg_get_functiondef surprised us with reformat,
  -- specific markers will fail with named indicators.
  v_has_start_draft_v2 := v_body ~ 'CREATE OR REPLACE FUNCTION public\.start_draft_v2\(';
  v_has_step0_lock := v_body ~ $$pg_advisory_xact_lock\(\s*hashtext\('draft_events_idem:'$$;
  v_has_rider1_completed_first := v_body ~ $$draft_already_completed$$;
  v_has_rider1_in_progress := v_body ~ $$draft_already_in_progress$$;
  v_has_rider1_illegal_combo := v_body ~ $$draft_state_not_startable$$;
  v_has_amendment3_filters :=
    (SELECT count(*)::int FROM regexp_matches(v_body, 'AND deleted_at IS NULL', 'g'));
  v_has_deadline_formula := v_body ~ $$make_interval\(secs => ceil\(v_pick_time\)::int\)$$;
  v_has_all_six_payload_fields := (
    v_body ~ $$'started_at'$$
    AND v_body ~ $$'first_pick_deadline'$$
    AND v_body ~ $$'total_rounds'$$
    AND v_body ~ $$'total_teams'$$
    AND v_body ~ $$'pick_time_limit_seconds'$$
    AND v_body ~ $$'draft_format'$$
  );
  v_has_validator_call := v_body ~ $$validate_draft_event_payload\('draft_started', v_payload\)$$;
  v_has_sha256_hash := v_body ~ $$encode\(sha256\(convert_to\(v_payload::text, 'UTF8'\)\), 'hex'\)$$;
  v_has_append_call := v_body ~ $$public\.append_draft_event\($$;
  v_has_step7_update := v_body ~ $$draft_state\s*=\s*'active'$$
                    AND v_body ~ $$draft_status\s*=\s*'in_progress'$$
                    AND v_body ~ $$pick_deadline\s*=\s*v_first_pick_deadline$$;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 3 POST-APPLY VERIFICATION ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Body identity:';
  RAISE NOTICE '  post-apply md5           : %  (NEW pin for INS-7 table)', v_body_md5;
  RAISE NOTICE '  post-apply length        : %', v_body_len;
  RAISE NOTICE '';
  RAISE NOTICE 'Property posture:';
  RAISE NOTICE '  overload count           : %  (expected 1)', v_overload_count;
  RAISE NOTICE '  prosecdef                : %  (expected true — SECURITY DEFINER)', v_prosecdef;
  RAISE NOTICE '  proconfig                : %  (expected search_path=public)', v_proconfig;
  RAISE NOTICE '';
  RAISE NOTICE 'Marker spot-checks (full 43-check set validated by dry-run):';
  RAISE NOTICE '  CREATE OR REPLACE FUNCTION public.start_draft_v2  : %', v_has_start_draft_v2;
  RAISE NOTICE '  Step 0 advisory_xact_lock                          : %', v_has_step0_lock;
  RAISE NOTICE '  Rider 1: draft_already_completed named error       : %', v_has_rider1_completed_first;
  RAISE NOTICE '  Rider 1: draft_already_in_progress named error     : %', v_has_rider1_in_progress;
  RAISE NOTICE '  Rider 1: draft_state_not_startable named error     : %', v_has_rider1_illegal_combo;
  RAISE NOTICE '  Amendment 3 filter count (expected 2, both queries): %', v_has_amendment3_filters;
  RAISE NOTICE '  Deadline CEIL formula                              : %', v_has_deadline_formula;
  RAISE NOTICE '  All six §6.4 payload fields                        : %', v_has_all_six_payload_fields;
  RAISE NOTICE '  validate_draft_event_payload call                  : %', v_has_validator_call;
  RAISE NOTICE '  Amendment 4 sha256 payload hash                    : %', v_has_sha256_hash;
  RAISE NOTICE '  append_draft_event call                            : %', v_has_append_call;
  RAISE NOTICE '  Step 7 three-column atomic UPDATE                  : %', v_has_step7_update;
  RAISE NOTICE '';

  -- Assertions
  IF v_overload_count <> 1 THEN
    RAISE EXCEPTION 'STEP 3 FAIL (overloads): expected 1, got %.', v_overload_count;
  END IF;

  IF v_prosecdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'STEP 3 FAIL (property posture): prosecdef = %, expected true. start_draft_v2 must be SECURITY DEFINER per parity with siblings.',
      v_prosecdef;
  END IF;

  IF v_proconfig <> 'search_path=public' THEN
    RAISE EXCEPTION
      'STEP 3 FAIL (property posture): proconfig = %, expected search_path=public. start_draft_v2 must pin search_path per parity with siblings.',
      v_proconfig;
  END IF;

  IF NOT v_has_start_draft_v2 THEN
    RAISE EXCEPTION 'STEP 3 FAIL: CREATE OR REPLACE FUNCTION public.start_draft_v2 not found in body.';
  END IF;

  IF NOT v_has_step0_lock THEN
    RAISE EXCEPTION 'STEP 3 FAIL: Step 0 advisory lock missing.';
  END IF;

  IF NOT (v_has_rider1_completed_first AND v_has_rider1_in_progress AND v_has_rider1_illegal_combo) THEN
    RAISE EXCEPTION 'STEP 3 FAIL: Rider 1 named errors incomplete.';
  END IF;

  IF v_has_amendment3_filters <> 2 THEN
    RAISE EXCEPTION 'STEP 3 FAIL (Amendment 3): expected 2 `AND deleted_at IS NULL` filters, got %.',
      v_has_amendment3_filters;
  END IF;

  IF NOT v_has_deadline_formula THEN
    RAISE EXCEPTION 'STEP 3 FAIL: deadline CEIL formula missing.';
  END IF;

  IF NOT v_has_all_six_payload_fields THEN
    RAISE EXCEPTION 'STEP 3 FAIL: one or more §6.4 payload fields missing.';
  END IF;

  IF NOT v_has_validator_call THEN
    RAISE EXCEPTION 'STEP 3 FAIL: validate_draft_event_payload call missing.';
  END IF;

  IF NOT v_has_sha256_hash THEN
    RAISE EXCEPTION 'STEP 3 FAIL: Amendment 4 sha256 payload hash missing.';
  END IF;

  IF NOT v_has_append_call THEN
    RAISE EXCEPTION 'STEP 3 FAIL: append_draft_event call missing.';
  END IF;

  IF NOT v_has_step7_update THEN
    RAISE EXCEPTION 'STEP 3 FAIL: Step 7 atomic three-column UPDATE missing or malformed.';
  END IF;

  RAISE NOTICE 'STEP 3 PASS: start_draft_v2 live, property posture correct (SECURITY DEFINER, search_path=public, single overload), all spot-check markers present.';
END
$verify$;

-- --------------------------------------------------------------------------
-- STEP 4 — History reconciliation via \lo_import (Rule 2, INS-6 bridge)
-- --------------------------------------------------------------------------
\echo ''
\echo 'STEP 4: INSERT history for 20260807000000_start_draft_v2 (INS-6 bridge)'

\lo_import 'supabase/migrations/20260807000000_start_draft_v2.sql'
\set oid_f27 :LASTOID
SELECT set_config('vars.oid_f27', :'oid_f27', true) AS bridged_oid_f27;

DO $insert_f27$
DECLARE
  v_oid            oid  := current_setting('vars.oid_f27')::oid;
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
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260807000000'
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RAISE NOTICE '  history row for 20260807000000 already exists — UPDATE (idempotent replay)';
    UPDATE supabase_migrations.schema_migrations
       SET name = 'start_draft_v2',
           statements = ARRAY[v_body]
     WHERE version = '20260807000000';
  ELSE
    RAISE NOTICE '  INSERTing new history row for 20260807000000';
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ('20260807000000', 'start_draft_v2', ARRAY[v_body]);
  END IF;

  RAISE NOTICE '  history row written for 20260807000000';
END
$insert_f27$;

SELECT lo_unlink(:'oid_f27'::oid);

-- --------------------------------------------------------------------------
-- STEP 5 — Final assertion
-- --------------------------------------------------------------------------
DO $final$
DECLARE
  v_hist_row_count int;
  v_live_md5       text;
BEGIN
  SELECT count(*)
    INTO v_hist_row_count
    FROM supabase_migrations.schema_migrations
   WHERE version = '20260807000000';

  SELECT md5(pg_get_functiondef('public.start_draft_v2(uuid,jsonb,uuid,uuid)'::regprocedure))
    INTO v_live_md5;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 5 FINAL ASSERTION ===';
  RAISE NOTICE '  history rows for 20260807000000 : % (expect 1)', v_hist_row_count;
  RAISE NOTICE '  live start_draft_v2 md5         : %  (add to INS-7 pin table)', v_live_md5;
  RAISE NOTICE '';

  IF v_hist_row_count <> 1 THEN
    RAISE EXCEPTION 'STEP 5 FAIL: expected 1 history row, found %.', v_hist_row_count;
  END IF;

  RAISE NOTICE 'STEP 5 PASS: F27 migration applied, history reconciled, start_draft_v2 live.';
END
$final$;

COMMIT;

\echo ''
\echo '=============================================================='
\echo 'F27 APPLY COMPLETE — start_draft_v2 LIVE ON STAGING'
\echo '=============================================================='
\echo ''
\echo 'NEXT (per architect §10 sequence):'
\echo ''
\echo '  1. Commit the create-analog capture:'
\echo '       git add supabase/migrations/captures/2026-08-07_pre_start_draft_v2_create_analog.txt'
\echo '       git commit -m "evidence(F27): create-analog marker (no prior start_draft_v2 body)"'
\echo ''
\echo '  2. Paste post-apply md5 back to architect for INS-7 pin table:'
\echo '       start_draft_v2 md5 → <from STEP 5 above>'
\echo ''
\echo '  3. Engine deploy (F26+F27 combined PR) — first deploy since 527ceb38.'
\echo '     Full 9-item boot verification, three-way digest chain.'
\echo ''
\echo '  4. Lifecycle acceptance run (Rider 4) — assertions A/B/C/D/E all PASS.'
\echo ''
\echo '  5. Zero-client acceptance run (Rider 2) — 5-step scenario, autopick'
\echo '     lands honestly on late-arrival first join.'
\echo ''
\echo '  6. Break-glass rename of scripts/proof/set-draft-status.local.mjs.'
\echo ''
\echo '=============================================================='
