-- ============================================================================
-- SL-1 / KI-036 apply — auto_fix_integrity_issues UUID cast repair (PROD)
-- ============================================================================
--
-- First reuse of the F24 apply tooling. Same architecture:
--   Rule 3 (client_encoding=UTF8), \set ON_ERROR_STOP on, single BEGIN…COMMIT
--   transaction, hash-pinned STEP 0, capture-before-replace STEP 1, apply
--   STEP 2, windowed marker + property preservation STEP 3, byte-exact
--   history INSERT via \lo_import + INS-6 GUC bridge STEP 4, final assert
--   STEP 5. All INS-4..INS-7 lessons already baked into the pattern.
--
-- USAGE (Garrett runs against PROD; standing rule — Claude never invokes psql):
--
--   psql "$env:SUPABASE_DB_URL_PROD?client_encoding=UTF8" \
--     -v ON_ERROR_STOP=1 \
--     -f scripts/proof/apply-sl1-auto-fix.local.sql
--
--   (Or set PGCLIENTENCODING=UTF8 in the environment and drop the query-
--    string suffix.)
--
--   Rehearsal FIRST (INS-6 mandate — verify the LO bridge works on THIS
--   connection before touching state):
--     psql "$env:SUPABASE_DB_URL_PROD" -v ON_ERROR_STOP=1 \
--       -f scripts/proof/rehearse-lo-bridge.local.sql
--   Expect: NOTICE:  bridge ok, <N> bytes  →  ROLLBACK
--
-- PROPERTY PRESERVATION (architect flag, 2026-08-05):
--   Prod's live function is NOT SECURITY DEFINER, has NO search_path
--   pinned (prosecdef=false, proconfig=null). The fix intentionally
--   preserves that posture — hardening the function is a separate,
--   deliberate docket item, not a drive-by. STEP 3 asserts these
--   properties are UNCHANGED post-apply.
--
-- ACCEPTANCE LADDER (per architect):
--   (1)  This apply — hash-pinned rollback-guarded.
--   (2)  Garrett manually invokes `SELECT * FROM auto_fix_integrity_issues();`
--        COMMITTED — real prod write, his hands (not this script).
--   (3)  Garrett manually invokes `SELECT * FROM check_data_integrity();`.
--   (4)  Query fresh integrity_check_results:
--          missing_players_check           expect 0 (from 210)
--          team_lineups_vs_draft_picks_count expect 0 (from 10)
--          fantasy_daily_rosters_sync_today expect 12 (KI-040 residue)
--   (5)  Amendment A no-dup + count assert (see sl1-post-heal-verify).
--   (6)  Tonight's in-cron 04:00 UTC run (22:00 MT) — 163rd run, first
--        scheduled success since Feb 25. Read job_run_details tomorrow AM.
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';   -- Rule 3
SHOW client_encoding;
\timing on

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 0 — Hash pin + property preservation preflight
-- --------------------------------------------------------------------------
-- Architect capture (2026-08-05, same day):
--   md5(pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure))
--     = 35802d12f8e20d97912fb9e6ced45cc7
--   def_len                    = 1911
--   overload_count             = 1
--   prosecdef (SECURITY DEFINER) = false
--   proconfig (search_path)    = null
--
-- Any drift and STEP 0 aborts. Nothing has moved since the capture unless
-- another mutator touched the function.

DO $sanity$
DECLARE
  v_body            text;
  v_body_md5        text;
  v_body_len        int;
  v_overload_count  int;
  v_prosecdef       boolean;
  v_proconfig       text;

  v_expected_md5    text := '35802d12f8e20d97912fb9e6ced45cc7';
  v_expected_len    int  := 1911;
BEGIN
  SELECT pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure)
    INTO v_body;

  v_body_md5 := md5(v_body);
  v_body_len := length(v_body);

  SELECT
    (SELECT count(*) FROM pg_proc WHERE proname = 'auto_fix_integrity_issues'
                                    AND pronamespace = 'public'::regnamespace)::int,
    p.prosecdef,
    COALESCE(array_to_string(p.proconfig, ' '), '<null>')
    INTO v_overload_count, v_prosecdef, v_proconfig
    FROM pg_proc p
   WHERE p.proname = 'auto_fix_integrity_issues'
     AND p.pronamespace = 'public'::regnamespace
   LIMIT 1;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 0 PRE-APPLY HASH PIN + PROPERTIES ===';
  RAISE NOTICE '  live body md5             : %', v_body_md5;
  RAISE NOTICE '  expected md5              : %', v_expected_md5;
  RAISE NOTICE '  md5 match                 : %', (v_body_md5 = v_expected_md5);
  RAISE NOTICE '  live body length          : %  (expected %)', v_body_len, v_expected_len;
  RAISE NOTICE '  overload count            : %  (expected 1)', v_overload_count;
  RAISE NOTICE '  prosecdef                 : %  (expected false)', v_prosecdef;
  RAISE NOTICE '  proconfig (search_path)   : %  (expected <null>)', v_proconfig;
  RAISE NOTICE '';

  IF v_body_md5 <> v_expected_md5 THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (md5): live body md5 % <> expected % (architect capture 2026-08-05). The function has changed since capture. Investigate BEFORE re-running.',
      v_body_md5, v_expected_md5;
  END IF;

  IF v_body_len <> v_expected_len THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (length): live body length % <> expected %. Even though md5 matched (unlikely), assert-fail because length is a stronger fingerprint than the checksum alone.',
      v_body_len, v_expected_len;
  END IF;

  IF v_overload_count <> 1 THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (overloads): found % overloads of auto_fix_integrity_issues, expected exactly 1. A second overload would be replaced or shadowed by CREATE OR REPLACE — investigate.',
      v_overload_count;
  END IF;

  IF v_prosecdef IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (prosecdef): live prosecdef = %, expected false. Prod is NOT SECURITY DEFINER; if it has become one, this apply would either strip that hardening (silent privilege change) or is being run against the wrong DB.',
      v_prosecdef;
  END IF;

  IF v_proconfig <> '<null>' THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (proconfig): live proconfig = %, expected <null>. Prod has no search_path pinned; if one exists now, either it was added deliberately (this apply would strip it) or the wrong DB is targeted.',
      v_proconfig;
  END IF;

  RAISE NOTICE 'STEP 0 PASS: md5 + length + overloads + prosecdef + proconfig all match architect capture.';
END
$sanity$;

-- --------------------------------------------------------------------------
-- STEP 1 — Save pre-apply capture (Rule 1)
-- --------------------------------------------------------------------------
-- Client-side \copy writes to the client filesystem; survives txn rollback
-- as a snapshot at time-of-read.

\copy (SELECT pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure)) TO 'supabase/migrations/captures/2026-08-05_pre_auto_fix_integrity_issues.sql' WITH (FORMAT text, HEADER false)

-- --------------------------------------------------------------------------
-- STEP 2 — Apply the fix migration
-- --------------------------------------------------------------------------
\echo ''
\echo 'STEP 2: applying supabase/migrations/20260805200000_sl1_auto_fix_uuid_cast.sql'
\i supabase/migrations/20260805200000_sl1_auto_fix_uuid_cast.sql

-- --------------------------------------------------------------------------
-- STEP 3 — Post-apply verification (marker set + property preservation)
-- --------------------------------------------------------------------------
-- Windowing philosophy (INS-4/INS-5): self-anchored unique strings with
-- \s* tolerance, windowed only where the marker is inherently ambiguous.
-- For SL-1 the markers are simple — every one is self-anchored body-wide
-- because the fixed function has no repeat-in-different-region ambiguity.

DO $verify$
DECLARE
  v_body            text;
  v_body_md5        text;
  v_body_len        int;

  -- Fix markers (post-apply must be true)
  v_has_starters_cast   boolean;
  v_has_bench_cast      boolean;
  v_has_ir_cast         boolean;
  v_has_agg_text_cast   boolean;
  v_has_nested_starters boolean;
  v_has_nested_bench    boolean;
  v_has_nested_ir       boolean;
  v_marker_count        int;

  -- Negative markers (post-apply must be false — the pre-fix forms must be gone)
  v_has_bare_starters   boolean;
  v_has_bare_bench      boolean;
  v_has_bare_ir         boolean;
  v_has_integer_cast    boolean;

  -- Property preservation (architect flag)
  v_overload_count  int;
  v_prosecdef       boolean;
  v_proconfig       text;
BEGIN
  SELECT pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure)
    INTO v_body;

  v_body_md5 := md5(v_body);
  v_body_len := length(v_body);

  -- Fix markers — all 6 ? sites now have ::text; jsonb_agg cast is ::text.
  -- Body-wide self-anchored per INS-5 principle (no ambiguity in this
  -- function — every cast site is uniquely identifiable).
  v_has_starters_cast   := v_body ~ $$tl\.starters \? dp\.player_id::text$$;
  v_has_bench_cast      := v_body ~ $$tl\.bench\s+\? dp\.player_id::text$$;
  v_has_ir_cast         := v_body ~ $$tl\.ir\s+\? dp\.player_id::text$$;
  v_has_agg_text_cast   := v_body ~ $$jsonb_agg\(dp\.player_id::text\)$$;
  v_has_nested_starters := v_body ~ $$team_lineups\.starters \? dp\.player_id::text$$;
  v_has_nested_bench    := v_body ~ $$team_lineups\.bench\s+\? dp\.player_id::text$$;
  v_has_nested_ir       := v_body ~ $$team_lineups\.ir\s+\? dp\.player_id::text$$;

  -- Negative markers — the bare (pre-fix) forms must be GONE. Use a
  -- negative-lookbehind proxy: match `? dp.player_id` NOT followed by
  -- `::text`. If the fix landed everywhere, this pattern finds zero
  -- occurrences.
  v_has_bare_starters   := v_body ~ $$tl\.starters \? dp\.player_id(?!::text)$$;
  v_has_bare_bench      := v_body ~ $$tl\.bench\s+\? dp\.player_id(?!::text)$$;
  v_has_bare_ir         := v_body ~ $$tl\.ir\s+\? dp\.player_id(?!::text)$$;
  v_has_integer_cast    := v_body ~ $$dp\.player_id::INTEGER$$;

  v_marker_count :=
    (CASE WHEN v_has_starters_cast   THEN 1 ELSE 0 END) +
    (CASE WHEN v_has_bench_cast      THEN 1 ELSE 0 END) +
    (CASE WHEN v_has_ir_cast         THEN 1 ELSE 0 END) +
    (CASE WHEN v_has_agg_text_cast   THEN 1 ELSE 0 END) +
    (CASE WHEN v_has_nested_starters THEN 1 ELSE 0 END) +
    (CASE WHEN v_has_nested_bench    THEN 1 ELSE 0 END) +
    (CASE WHEN v_has_nested_ir       THEN 1 ELSE 0 END);

  -- Property preservation (architect flag)
  SELECT
    (SELECT count(*) FROM pg_proc WHERE proname = 'auto_fix_integrity_issues'
                                    AND pronamespace = 'public'::regnamespace)::int,
    p.prosecdef,
    COALESCE(array_to_string(p.proconfig, ' '), '<null>')
    INTO v_overload_count, v_prosecdef, v_proconfig
    FROM pg_proc p
   WHERE p.proname = 'auto_fix_integrity_issues'
     AND p.pronamespace = 'public'::regnamespace
   LIMIT 1;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 3 POST-APPLY VERIFICATION ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Body identity:';
  RAISE NOTICE '  post-apply md5            : %', v_body_md5;
  RAISE NOTICE '  post-apply length         : %', v_body_len;
  RAISE NOTICE '';
  RAISE NOTICE 'Fix markers (7 required, all body-wide self-anchored):';
  RAISE NOTICE '  tl.starters ? ::text                : %', v_has_starters_cast;
  RAISE NOTICE '  tl.bench    ? ::text                : %', v_has_bench_cast;
  RAISE NOTICE '  tl.ir       ? ::text                : %', v_has_ir_cast;
  RAISE NOTICE '  jsonb_agg(...::text) in UPDATE      : %', v_has_agg_text_cast;
  RAISE NOTICE '  team_lineups.starters ? ::text      : %', v_has_nested_starters;
  RAISE NOTICE '  team_lineups.bench    ? ::text      : %', v_has_nested_bench;
  RAISE NOTICE '  team_lineups.ir       ? ::text      : %', v_has_nested_ir;
  RAISE NOTICE '  → total fix markers present         : % / 7', v_marker_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Negative markers (all must be false):';
  RAISE NOTICE '  tl.starters ? dp.player_id (no cast) : %', v_has_bare_starters;
  RAISE NOTICE '  tl.bench    ? dp.player_id (no cast) : %', v_has_bare_bench;
  RAISE NOTICE '  tl.ir       ? dp.player_id (no cast) : %', v_has_bare_ir;
  RAISE NOTICE '  dp.player_id::INTEGER (crash site)   : %', v_has_integer_cast;
  RAISE NOTICE '';
  RAISE NOTICE 'Property preservation (must MATCH pre-apply):';
  RAISE NOTICE '  overload count            : %  (expected 1)', v_overload_count;
  RAISE NOTICE '  prosecdef                 : %  (expected false — preserving prod posture)', v_prosecdef;
  RAISE NOTICE '  proconfig                 : %  (expected <null> — preserving prod posture)', v_proconfig;
  RAISE NOTICE '';

  IF v_marker_count <> 7 THEN
    RAISE EXCEPTION 'STEP 3 FAIL (fix markers): expected 7 fix markers, found %. See notices above.', v_marker_count;
  END IF;

  IF v_has_bare_starters OR v_has_bare_bench OR v_has_bare_ir THEN
    RAISE EXCEPTION 'STEP 3 FAIL (residual bare `?`): at least one jsonb `?` site still lacks ::text. See notices above.';
  END IF;

  IF v_has_integer_cast THEN
    RAISE EXCEPTION 'STEP 3 FAIL (crash site not fixed): dp.player_id::INTEGER still present in body. Fix did not land.';
  END IF;

  IF v_overload_count <> 1 THEN
    RAISE EXCEPTION 'STEP 3 FAIL (overloads): % overloads found, expected 1.', v_overload_count;
  END IF;

  IF v_prosecdef IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'STEP 3 FAIL (silent privilege change): post-apply prosecdef = %, expected false. Migration file added SECURITY DEFINER — that is a hardening decision, not a drive-by. Roll back and remove.',
      v_prosecdef;
  END IF;

  IF v_proconfig <> '<null>' THEN
    RAISE EXCEPTION
      'STEP 3 FAIL (silent search_path pin): post-apply proconfig = %, expected <null>. Migration file added SET search_path — that is a hardening decision, not a drive-by. Roll back and remove.',
      v_proconfig;
  END IF;

  RAISE NOTICE 'STEP 3 PASS: all 7 fix markers present, all 4 negative markers absent, property preservation (prosecdef=false, proconfig=null) intact.';
END
$verify$;

-- --------------------------------------------------------------------------
-- STEP 4 — History reconciliation (INS-6 bridge)
-- --------------------------------------------------------------------------
-- One INSERT: the new SL-1 migration. No backfill needed (20260116000003
-- is presumably in prod history from its original `supabase db push`).
-- If it isn't, that's a separate reconciliation task.

\echo ''
\echo 'STEP 4: INSERT history for 20260805200000_sl1_auto_fix_uuid_cast (INS-6 GUC bridge)'

\lo_import 'supabase/migrations/20260805200000_sl1_auto_fix_uuid_cast.sql'
\set oid_sl1 :LASTOID
SELECT set_config('vars.oid_sl1', :'oid_sl1', true) AS bridged_oid_sl1;

DO $insert_sl1$
DECLARE
  v_oid            oid  := current_setting('vars.oid_sl1')::oid;
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
    RAISE EXCEPTION 'STEP 4 FAIL: sha256(decoded text) <> sha256(original bytes) — UTF8 round-trip lost bytes.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260805200000'
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RAISE NOTICE '  history row for 20260805200000 already exists — UPDATE (idempotent replay)';
    UPDATE supabase_migrations.schema_migrations
       SET name = 'sl1_auto_fix_uuid_cast',
           statements = ARRAY[v_body]
     WHERE version = '20260805200000';
  ELSE
    RAISE NOTICE '  INSERTing new history row for 20260805200000';
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ('20260805200000', 'sl1_auto_fix_uuid_cast', ARRAY[v_body]);
  END IF;

  RAISE NOTICE '  history row written for 20260805200000';
END
$insert_sl1$;

SELECT lo_unlink(:'oid_sl1'::oid);

-- --------------------------------------------------------------------------
-- STEP 5 — Final assertion + guard against post-apply property drift
-- --------------------------------------------------------------------------

DO $final$
DECLARE
  v_hist_row_count int;
  v_final_md5      text;
BEGIN
  SELECT count(*) INTO v_hist_row_count
    FROM supabase_migrations.schema_migrations
   WHERE version = '20260805200000';

  SELECT md5(pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure))
    INTO v_final_md5;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 5 FINAL ASSERTION ===';
  RAISE NOTICE '  history rows for 20260805200000  : % (expect 1)', v_hist_row_count;
  RAISE NOTICE '  post-apply live md5              : %  (NEW pin for future superseders)', v_final_md5;
  RAISE NOTICE '';

  IF v_hist_row_count <> 1 THEN
    RAISE EXCEPTION 'STEP 5 FAIL: expected 1 history row for 20260805200000, found %.', v_hist_row_count;
  END IF;

  RAISE NOTICE 'STEP 5 PASS: apply complete, history reconciled, live md5 recorded (add to INS-7 standing pin table).';
END
$final$;

COMMIT;

\echo ''
\echo '=============================================================='
\echo 'SL-1 APPLY COMPLETE'
\echo '=============================================================='
\echo ''
\echo 'NEXT (Garrett, per architect acceptance ladder):'
\echo ''
\echo '  Ladder step (2). Manually invoke the fixed function on PROD:'
\echo '    psql "$env:SUPABASE_DB_URL_PROD" -c "SELECT * FROM public.auto_fix_integrity_issues();"'
\echo '  Expected: single row {restored_missing_players, 10, 1} '
\echo '            (KI-036 out-of-scope 3: players_restored self-reports 1 per '
\echo '             team due to GET DIAGNOSTICS bug; F18 rule — trust queries,'
\echo '             not self-reported counts).'
\echo ''
\echo '  Ladder step (3). Manually invoke check_data_integrity to write fresh '
\echo '  rows to integrity_check_results:'
\echo '    psql "$env:SUPABASE_DB_URL_PROD" -c "SELECT * FROM public.check_data_integrity();"'
\echo ''
\echo '  Ladder steps (4)+(5). Run the post-heal verify pack:'
\echo '    psql "$env:SUPABASE_DB_URL_PROD" -v ON_ERROR_STOP=1 \'
\echo '      -f scripts/proof/sl1-post-heal-verify.local.sql'
\echo '  Expected:'
\echo '    Q1 (Amendment B — F18 rule): missing_players 0, count-check 0,'
\echo '                                   sync-staleness 12 (KI-040 residue).'
\echo '    Q2 (Amendment A): 10 healed teams, no dup player entries per team,'
\echo '                       count matches draft_picks count per team.'
\echo ''
\echo '  Ladder step (6). Tomorrow morning: read cron.job_run_details for the'
\echo '  22:00 MT / 04:00 UTC cron run. Confirm first scheduled success since'
\echo '  2026-02-25 (163rd run).'
\echo ''
\echo '  Then commit the capture file:'
\echo '    git add supabase/migrations/captures/2026-08-05_pre_auto_fix_integrity_issues.sql'
\echo '    git commit -m "evidence(SL-1): pg_get_functiondef capture of pre-fix auto_fix body (prod)"'
\echo ''
\echo '  Signal architect for post-apply ratification + KI-036 close-out.'
\echo '=============================================================='
