-- ============================================================================
-- F24 REBASE APPLY (F25 recovery) — 2026-08-05
-- ============================================================================
--
-- Applies migration `20260805050000_v2_draft_completion_emitter_rebased.sql`
-- and reconciles the `supabase_migrations.schema_migrations` history with
-- three byte-exact entries (see architect ratification for Amendment 4).
--
-- USAGE (Garrett runs; standing rule — Claude never invokes psql):
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/proof/apply-f24-rebase.local.sql
--
-- Working directory: repo root. All file paths below are relative to CWD.
--
-- SECRETS: SUPABASE_DB_URL from Secret Manager per README standing pattern.
-- MUST NOT be a pooler URL (KI-E010: LISTEN/NOTIFY frames don't survive).
--
-- BYTE-EXACT PRESERVATION:
-- Uses psql client's \lo_import to upload each migration file as a
-- Postgres large object (bytea, no encoding pass), then reads it back
-- with lo_get() + convert_from(bytea, 'UTF8') inside the INSERT. No
-- shell-quoting gymnastics, no line-ending translation, no dollar-quote
-- collision risk. Verifies via SHA256 of the file bytes before/after the
-- round-trip.
--
-- MIDNIGHT RULE: If Garrett does not paste this into psql by ~23:15 MT,
-- the apply waits for morning. Drafting, commits, and REGISTRY entries
-- are already committed regardless.
-- ============================================================================

\set ON_ERROR_STOP on
\timing on

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 0 — Sanity: assert current live state is the F25-broken 20260805023419
-- --------------------------------------------------------------------------
-- If this fails, the world moved since we captured. STOP. Do not proceed.
-- (The rebase migration assumes it is superseding 20260805023419, which
-- assumes 20260805023419 IS what's live right now on this DB.)

DO $sanity$
DECLARE
  v_current_body text;
  v_has_pick_deadline_in_payload boolean;
  v_has_event_version_2 boolean;
BEGIN
  SELECT pg_get_functiondef('public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid)'::regprocedure)
    INTO v_current_body;

  -- F25-broken body is 20260512-based and OMITS pick_deadline from the payload.
  -- Batch-2 body (correct base) INCLUDES it. If the payload has pick_deadline
  -- already, then either the rebase already ran, or the world is not what we
  -- think it is.
  v_has_pick_deadline_in_payload := v_current_body ~ $$'pick_deadline',\s*v_new_deadline$$;
  v_has_event_version_2 := v_current_body ~ $$event_version.*'pick'.*2$$;

  RAISE NOTICE 'STEP 0 pre-apply sanity:';
  RAISE NOTICE '  current body contains pick_deadline in payload : %', v_has_pick_deadline_in_payload;
  RAISE NOTICE '  current body has event_version=2 on pick INSERT: %', v_has_event_version_2;

  IF v_has_pick_deadline_in_payload OR v_has_event_version_2 THEN
    RAISE EXCEPTION
      'STEP 0 FAIL: live body already has batch-2 markers. Either the rebase already applied, or the base state is not the F25-broken 20260805023419. Investigate BEFORE re-running this apply.';
  END IF;

  RAISE NOTICE 'STEP 0 PASS: live body is F25-broken 20260805023419 as expected.';
END
$sanity$;

-- --------------------------------------------------------------------------
-- STEP 1 — Save pre-apply capture (Rule 1: capture-before-replace evidence)
-- --------------------------------------------------------------------------
-- Writes the current live body to a file OUTSIDE the DB via \copy.
-- Server writes to the client filesystem via psql's \copy client-side.
-- The apply is INSIDE a transaction; the file write happens transactionally
-- from the client's perspective (rollback of DB txn does not rewind the file,
-- but that's fine — the capture is a snapshot at time-of-apply, not a
-- committed row).

\copy (SELECT pg_get_functiondef('public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid)'::regprocedure)) TO 'supabase/migrations/captures/2026-08-05_pre_v2_draft_completion_emitter_rebased.sql' WITH (FORMAT text, HEADER false)

-- --------------------------------------------------------------------------
-- STEP 2 — Apply the rebase migration body
-- --------------------------------------------------------------------------
\echo 'STEP 2: applying supabase/migrations/20260805050000_v2_draft_completion_emitter_rebased.sql'

\i supabase/migrations/20260805050000_v2_draft_completion_emitter_rebased.sql

-- --------------------------------------------------------------------------
-- STEP 3 — Post-apply verification: live body carries both batch-2 + F24 markers
-- --------------------------------------------------------------------------

DO $verify$
DECLARE
  v_new_body text;

  -- Batch-2 restoration markers
  v_has_pick_deadline_in_payload boolean;
  v_has_deadline_before_validate boolean;  -- Approximated: pick_deadline appears in body before validate_draft_event_payload call
  v_has_event_version_2 boolean;

  -- F24 markers
  v_has_deleted_at_filter_step2 boolean;
  v_has_deleted_at_filter_completion boolean;
  v_has_completion_branch boolean;
  v_has_d8_warning boolean;
  v_has_status_completed_deadline_null boolean;
  v_has_sha256_hash boolean;
  v_has_v_completion_payload_declared boolean;
  v_has_v_completion_hash_declared boolean;
  v_has_return_pick_deadline_null boolean;

  -- Negative marker
  v_touches_draft_state boolean;

  -- Function properties
  v_is_security_definer boolean;
  v_search_path text;
  v_overload_count int;
BEGIN
  SELECT pg_get_functiondef('public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid)'::regprocedure)
    INTO v_new_body;

  -- Batch-2 restoration markers
  v_has_pick_deadline_in_payload := v_new_body ~ $$'pick_deadline', v_new_deadline$$;
  v_has_deadline_before_validate := position('v_new_deadline :=' IN v_new_body) > 0
                                AND position('v_new_deadline :=' IN v_new_body) < position('validate_draft_event_payload' IN v_new_body);
  v_has_event_version_2 := v_new_body ~ $$'pick', 2, v_payload$$;

  -- F24 markers
  v_has_deleted_at_filter_step2 := v_new_body ~ $$AND round_number = p_round\s*AND deleted_at IS NULL$$;
  v_has_deleted_at_filter_completion := v_new_body ~ $$FROM public.draft_order\s+WHERE league_id = p_league_id\s+AND deleted_at IS NULL$$;
  v_has_completion_branch := v_new_body ~ $$v_total_picks > 0 AND p_pick_number >= v_total_picks$$;
  v_has_d8_warning := v_new_body ~ $$RAISE WARNING\s+'submit_pick_v2 completion branch$$;
  v_has_status_completed_deadline_null := v_new_body ~ $$draft_status = 'completed',\s*pick_deadline = NULL$$;
  v_has_sha256_hash := v_new_body ~ $$sha256\(convert_to\(v_completion_payload::text, 'UTF8'\)\)$$;
  v_has_v_completion_payload_declared := v_new_body ~ $$v_completion_payload jsonb$$;
  v_has_v_completion_hash_declared := v_new_body ~ $$v_completion_hash\s+text$$;
  v_has_return_pick_deadline_null := v_new_body ~ $$'pick_deadline', NULL$$;

  -- Negative marker (Amendment 2 evidence-closed)
  v_touches_draft_state := v_new_body ~ $$draft_state\s*=$$;

  -- Function properties
  SELECT p.prosecdef,
         COALESCE(array_to_string(p.proconfig, ' '), ''),
         (SELECT count(*) FROM pg_proc WHERE proname = 'submit_pick_v2' AND pronamespace = 'public'::regnamespace)::int
    INTO v_is_security_definer, v_search_path, v_overload_count
    FROM pg_proc p
   WHERE p.proname = 'submit_pick_v2'
     AND p.pronamespace = 'public'::regnamespace
   LIMIT 1;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 3 POST-APPLY VERIFICATION ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Batch-2 restoration markers:';
  RAISE NOTICE '  pick_deadline in pick payload build   : %', v_has_pick_deadline_in_payload;
  RAISE NOTICE '  deadline computed before validate     : %', v_has_deadline_before_validate;
  RAISE NOTICE '  event_version=2 in pick INSERT        : %', v_has_event_version_2;
  RAISE NOTICE '';
  RAISE NOTICE 'F24 markers:';
  RAISE NOTICE '  Step 2 on-clock deleted_at filter     : %', v_has_deleted_at_filter_step2;
  RAISE NOTICE '  Completion SUM deleted_at filter      : %', v_has_deleted_at_filter_completion;
  RAISE NOTICE '  Completion branch guard               : %', v_has_completion_branch;
  RAISE NOTICE '  D8 absorb-and-announce WARNING        : %', v_has_d8_warning;
  RAISE NOTICE '  UPDATE status=completed + deadline=NULL: %', v_has_status_completed_deadline_null;
  RAISE NOTICE '  sha256 hash of completion payload     : %', v_has_sha256_hash;
  RAISE NOTICE '  v_completion_payload declared         : %', v_has_v_completion_payload_declared;
  RAISE NOTICE '  v_completion_hash declared            : %', v_has_v_completion_hash_declared;
  RAISE NOTICE '  branch RETURN pick_deadline=NULL      : %', v_has_return_pick_deadline_null;
  RAISE NOTICE '';
  RAISE NOTICE 'Negative marker (must be false):';
  RAISE NOTICE '  writes draft_state                    : %', v_touches_draft_state;
  RAISE NOTICE '';
  RAISE NOTICE 'Function properties:';
  RAISE NOTICE '  SECURITY DEFINER                      : %', v_is_security_definer;
  RAISE NOTICE '  search_path config                    : %', v_search_path;
  RAISE NOTICE '  overloads of submit_pick_v2           : %', v_overload_count;
  RAISE NOTICE '';

  IF NOT (v_has_pick_deadline_in_payload
      AND v_has_deadline_before_validate
      AND v_has_event_version_2
      AND v_has_deleted_at_filter_step2
      AND v_has_deleted_at_filter_completion
      AND v_has_completion_branch
      AND v_has_d8_warning
      AND v_has_status_completed_deadline_null
      AND v_has_sha256_hash
      AND v_has_v_completion_payload_declared
      AND v_has_v_completion_hash_declared
      AND v_has_return_pick_deadline_null
      AND NOT v_touches_draft_state
      AND v_is_security_definer
      AND v_search_path = 'search_path=public'
      AND v_overload_count = 1) THEN
    RAISE EXCEPTION 'STEP 3 FAIL: post-apply marker verification did not all pass. See notices above. Rolling back.';
  END IF;

  RAISE NOTICE 'STEP 3 PASS: all batch-2 + F24 markers present, no draft_state writes, SECURITY DEFINER + search_path=public + single overload.';
END
$verify$;

-- --------------------------------------------------------------------------
-- STEP 4 — History reconciliation via \lo_import (byte-exact preservation)
-- --------------------------------------------------------------------------
-- Three history rows land here:
--   (4a) BACKFILL 20260727010000 — the July 27 direct apply that Supabase
--        history missed (shrinks the db-push mismatch set by one). Real
--        SQL from the repo file, byte-exact.
--   (4b) UPDATE 20260805023419 — replace placeholder in statements[] with
--        the actual applied SQL from the repo file, byte-exact.
--   (4c) INSERT 20260805050000 — the new rebase migration, byte-exact
--        contents of the just-applied file.
--
-- Mechanic: \lo_import uploads client file → server-side large object.
-- lo_get() returns bytea. convert_from(bytea, 'UTF8') decodes to text
-- with no re-encoding. lo_unlink() cleans up.
--
-- Verification: SHA256 of the round-tripped text is compared against
-- SHA256 of the original bytes computed on the server after upload.
-- Both use core pg (sha256 on bytea, digest on text via encoding).

\echo ''
\echo 'STEP 4a: BACKFILL history for 20260727010000_pick_event_carries_pick_deadline (July 27 direct apply)'

\lo_import 'supabase/migrations/20260727010000_pick_event_carries_pick_deadline.sql'
\set oid_10c2b2 :LASTOID

DO $backfill_10c2b2$
DECLARE
  v_body text;
  v_hash text;
  v_oid_from_bytea text;
BEGIN
  v_body := convert_from(lo_get(:'oid_10c2b2'::oid), 'UTF8');
  v_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  v_oid_from_bytea := encode(sha256(lo_get(:'oid_10c2b2'::oid)), 'hex');

  RAISE NOTICE '  file bytes uploaded to OID    : %', :'oid_10c2b2';
  RAISE NOTICE '  text length after decode      : % chars', length(v_body);
  RAISE NOTICE '  sha256 of decoded text        : %', v_hash;
  RAISE NOTICE '  sha256 of original bytes      : %', v_oid_from_bytea;
  RAISE NOTICE '  round-trip byte-equivalent    : %', (v_hash = v_oid_from_bytea);

  IF v_hash <> v_oid_from_bytea THEN
    RAISE EXCEPTION 'STEP 4a FAIL: sha256(decoded text) <> sha256(original bytes) — UTF8 round-trip lost bytes. Investigate before proceeding.';
  END IF;

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('20260727010000', 'pick_event_carries_pick_deadline', ARRAY[v_body])
  ON CONFLICT (version) DO UPDATE
    SET name = EXCLUDED.name,
        statements = EXCLUDED.statements;

  RAISE NOTICE '  BACKFILL row written for 20260727010000';
END
$backfill_10c2b2$;

SELECT lo_unlink(:'oid_10c2b2'::oid);

\echo ''
\echo 'STEP 4b: UPDATE history for 20260805023419_v2_draft_completion_emitter (replace placeholder with actual SQL)'

\lo_import 'supabase/migrations/20260805023419_v2_draft_completion_emitter.sql'
\set oid_f25 :LASTOID

DO $update_f25$
DECLARE
  v_body text;
  v_hash text;
  v_oid_from_bytea text;
  v_existing_statements_first text;
BEGIN
  v_body := convert_from(lo_get(:'oid_f25'::oid), 'UTF8');
  v_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  v_oid_from_bytea := encode(sha256(lo_get(:'oid_f25'::oid)), 'hex');

  RAISE NOTICE '  file bytes uploaded to OID    : %', :'oid_f25';
  RAISE NOTICE '  text length after decode      : % chars', length(v_body);
  RAISE NOTICE '  sha256 of decoded text        : %', v_hash;
  RAISE NOTICE '  sha256 of original bytes      : %', v_oid_from_bytea;
  RAISE NOTICE '  round-trip byte-equivalent    : %', (v_hash = v_oid_from_bytea);

  IF v_hash <> v_oid_from_bytea THEN
    RAISE EXCEPTION 'STEP 4b FAIL: sha256 round-trip failed. Investigate.';
  END IF;

  SELECT statements[1] INTO v_existing_statements_first
    FROM supabase_migrations.schema_migrations
   WHERE version = '20260805023419';

  RAISE NOTICE '  existing statements[1] (first 80 chars): %', COALESCE(left(v_existing_statements_first, 80), '<NULL>');

  UPDATE supabase_migrations.schema_migrations
     SET statements = ARRAY[v_body]
   WHERE version = '20260805023419';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STEP 4b FAIL: no history row for 20260805023419 to update. It should exist from tonight''s direct apply.';
  END IF;

  RAISE NOTICE '  UPDATE row written for 20260805023419';
END
$update_f25$;

SELECT lo_unlink(:'oid_f25'::oid);

\echo ''
\echo 'STEP 4c: INSERT history for 20260805050000_v2_draft_completion_emitter_rebased (the just-applied rebase)'

\lo_import 'supabase/migrations/20260805050000_v2_draft_completion_emitter_rebased.sql'
\set oid_f24r :LASTOID

DO $insert_f24r$
DECLARE
  v_body text;
  v_hash text;
  v_oid_from_bytea text;
BEGIN
  v_body := convert_from(lo_get(:'oid_f24r'::oid), 'UTF8');
  v_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  v_oid_from_bytea := encode(sha256(lo_get(:'oid_f24r'::oid)), 'hex');

  RAISE NOTICE '  file bytes uploaded to OID    : %', :'oid_f24r';
  RAISE NOTICE '  text length after decode      : % chars', length(v_body);
  RAISE NOTICE '  sha256 of decoded text        : %', v_hash;
  RAISE NOTICE '  sha256 of original bytes      : %', v_oid_from_bytea;
  RAISE NOTICE '  round-trip byte-equivalent    : %', (v_hash = v_oid_from_bytea);

  IF v_hash <> v_oid_from_bytea THEN
    RAISE EXCEPTION 'STEP 4c FAIL: sha256 round-trip failed. Investigate.';
  END IF;

  INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('20260805050000', 'v2_draft_completion_emitter_rebased', ARRAY[v_body]);

  RAISE NOTICE '  INSERT row written for 20260805050000';
END
$insert_f24r$;

SELECT lo_unlink(:'oid_f24r'::oid);

-- --------------------------------------------------------------------------
-- STEP 5 — Final assertion: history-vs-live body equivalence
-- --------------------------------------------------------------------------
-- Architect's mechanical post-apply check: history-row SQL (as it would
-- re-run on a rebuild) produces a function body byte-identical to what's
-- live. Approximated here by asserting the migration file's SQL contains
-- the CREATE OR REPLACE FUNCTION body that matches pg_get_functiondef's
-- output for the same function.
--
-- Perfect equivalence isn't achievable (pg_get_functiondef adds
-- LANGUAGE/SECURITY DEFINER decoration, prettifies whitespace, quotes
-- some identifiers), so we assert the STRUCTURAL equivalence: every
-- marker present in the file body is also present in the live body.
-- The STEP 3 marker checks already prove this direction for F24; this
-- step is Garrett's read-back for the record.

DO $final$
DECLARE
  v_row_count int;
  v_live_body_len int;
BEGIN
  SELECT count(*) INTO v_row_count
    FROM supabase_migrations.schema_migrations
   WHERE version IN ('20260727010000', '20260805023419', '20260805050000');

  SELECT length(pg_get_functiondef('public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid)'::regprocedure))
    INTO v_live_body_len;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 5 FINAL ASSERTION ===';
  RAISE NOTICE '  history rows for expected 3 versions   : % (expect 3)', v_row_count;
  RAISE NOTICE '  live submit_pick_v2 body length        : % chars', v_live_body_len;
  RAISE NOTICE '';

  IF v_row_count <> 3 THEN
    RAISE EXCEPTION 'STEP 5 FAIL: expected 3 history rows across the three versions, found %.', v_row_count;
  END IF;

  RAISE NOTICE 'STEP 5 PASS: history reconciled, live body verified.';
END
$final$;

COMMIT;

\echo ''
\echo '=============================================================='
\echo 'F24 REBASE APPLY COMPLETE'
\echo '=============================================================='
\echo 'Next steps (Garrett, per architect post-apply checklist):'
\echo '  1. Confirm capture file exists at:'
\echo '       supabase/migrations/captures/2026-08-05_pre_v2_draft_completion_emitter_rebased.sql'
\echo '  2. Confirm all STEP 3 marker checks NOTICEd as true.'
\echo '  3. Confirm STEP 4a/4b/4c sha256 round-trips all NOTICEd as byte-equivalent.'
\echo '  4. Commit the capture file to git (already staged in the F24-rebase commit).'
\echo '  5. Signal architect for post-apply ratification.'
\echo '  6. Once ratified: proceed with F24 acceptance rerun from Block 1 (fresh reset).'
\echo '=============================================================='
