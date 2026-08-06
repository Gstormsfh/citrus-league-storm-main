-- ============================================================================
-- SL-1b — apply v2: auto_fix_integrity_issues unwrap-jsonb_build_array
-- ============================================================================
--
-- Second reuse of the F24 apply tooling. Same architecture as v1
-- (apply-sl1-auto-fix.local.sql):
--   Rule 3 (client_encoding=UTF8), \set ON_ERROR_STOP on, single BEGIN…COMMIT,
--   hash-pinned STEP 0, capture-before-replace STEP 1, apply STEP 2, marker
--   + property preservation STEP 3, byte-exact history INSERT via
--   \lo_import + INS-6 GUC bridge STEP 4, final assert STEP 5. INS-4..INS-7
--   lessons baked in.
--
-- USAGE (Garrett runs against PROD):
--   psql "$env:SUPABASE_DB_URL_PROD`?client_encoding=UTF8" \
--     -v ON_ERROR_STOP=1 \
--     -f scripts/proof/apply-sl1b-auto-fix-v2.local.sql
--
-- APPLY ORDER (architect ladder, 2026-08-06):
--   1. Rehearsal (INS-6 bridge check on the target connection)
--   2. Data unwrap: scripts/proof/unwrap-sl1b-demo-league.local.sql
--   3. THIS v2 apply  ← YOU ARE HERE
--   4. Manual auto_fix_integrity_issues() invoke
--   5. Manual check_data_integrity() invoke
--   6. Post-heal verify: scripts/proof/sl1-post-heal-verify.local.sql
--      (SAME file as v1 — the assertions are shape-agnostic)
--   7. Re-enable cron job 4 (FINAL step; pending KI-041 cron-governance answer)
--
-- STEP 0 PIN (architect capture, 2026-08-06):
--   md5(pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure))
--     = 0bd6c0f8cfbc9b9b3f970b52009bfbd2
--   This is v1's live body (SL-1 v1 applied 2026-08-05). Any drift → abort.
--
-- PROPERTY PRESERVATION (unchanged from v1, still in force):
--   prosecdef == false (NOT SECURITY DEFINER)
--   proconfig == null  (NO search_path pinned)
--   Any change is a silent privilege change and aborts STEP 3.
--
-- MOJIBAKE OBSERVATION (INS-7, from prior applies): if the client_encoding
-- isn't UTF8, the "SL-1b (2026-08-06)" line + emdashes in the header comment
-- will render as mojibake in the stored function body. Rule 3 forces UTF8
-- to keep the stored body clean. Post-apply md5 is a NEW pin captured this
-- run — architect ratifies whatever md5 comes back.
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';   -- Rule 3
SHOW client_encoding;
\timing on

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 0 — Hash pin + property preservation preflight
-- --------------------------------------------------------------------------
DO $sanity$
DECLARE
  v_body            text;
  v_body_md5        text;
  v_body_len        int;
  v_overload_count  int;
  v_prosecdef       boolean;
  v_proconfig       text;

  v_expected_md5    text := '0bd6c0f8cfbc9b9b3f970b52009bfbd2';
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
  RAISE NOTICE '  expected md5 (v1 body)    : %', v_expected_md5;
  RAISE NOTICE '  md5 match                 : %', (v_body_md5 = v_expected_md5);
  RAISE NOTICE '  live body length          : %', v_body_len;
  RAISE NOTICE '  overload count            : %  (expected 1)', v_overload_count;
  RAISE NOTICE '  prosecdef                 : %  (expected false)', v_prosecdef;
  RAISE NOTICE '  proconfig (search_path)   : %  (expected <null>)', v_proconfig;
  RAISE NOTICE '';

  IF v_body_md5 <> v_expected_md5 THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (md5): live body md5 % <> expected % (v1 body, architect capture 2026-08-06). Either v1 was superseded by another mutation or the wrong DB is targeted. Investigate BEFORE re-running.',
      v_body_md5, v_expected_md5;
  END IF;

  IF v_overload_count <> 1 THEN
    RAISE EXCEPTION 'STEP 0 FAIL (overloads): found % overloads, expected 1.', v_overload_count;
  END IF;

  IF v_prosecdef IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (prosecdef): live prosecdef = %, expected false. Prod is NOT SECURITY DEFINER.',
      v_prosecdef;
  END IF;

  IF v_proconfig <> '<null>' THEN
    RAISE EXCEPTION
      'STEP 0 FAIL (proconfig): live proconfig = %, expected <null>.',
      v_proconfig;
  END IF;

  RAISE NOTICE 'STEP 0 PASS: md5 matches v1 body, properties preserved.';
END
$sanity$;

-- --------------------------------------------------------------------------
-- STEP 1 — Save pre-apply capture (Rule 1)
-- --------------------------------------------------------------------------
\copy (SELECT pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure)) TO 'supabase/migrations/captures/2026-08-06_pre_sl1b_auto_fix_integrity_issues.sql' WITH (FORMAT text, HEADER false)

-- --------------------------------------------------------------------------
-- STEP 2 — Apply the v2 fix migration
-- --------------------------------------------------------------------------
\echo ''
\echo 'STEP 2: applying supabase/migrations/20260806100000_sl1b_auto_fix_unwrap_agg.sql'
\i supabase/migrations/20260806100000_sl1b_auto_fix_unwrap_agg.sql

-- --------------------------------------------------------------------------
-- STEP 3 — Post-apply verification (marker set + property preservation)
-- --------------------------------------------------------------------------
-- Marker set for v2:
--   POSITIVE (must hold post-apply):
--     - all 6 jsonb ? sites have ::text (unchanged from v1)
--     - jsonb_agg(dp.player_id::text) still present in UPDATE subquery
--     - `bench = bench || COALESCE(` shape (v2 signature — no jsonb_build_array)
--     - '[]'::jsonb fallback present
--   NEGATIVE (must be absent):
--     - jsonb_build_array in the UPDATE SET clause (v1 wrapper — the v2 fix)
--     - dp.player_id::INTEGER (original crash site — must remain absent)
--     - any bare `? dp.player_id` without ::text
--     - draft_status writes to the function's declared search path

DO $verify$
DECLARE
  v_body            text;
  v_body_md5        text;
  v_body_len        int;

  -- UPDATE window (self-anchored per INS-5 principle; UPDATE region is uniquely
  -- identifiable via the SET line, contains the wrapper we're removing).
  v_pos_update       int;
  v_update_window    text;

  -- Positive markers
  v_has_starters_cast   boolean;
  v_has_bench_cast      boolean;
  v_has_ir_cast         boolean;
  v_has_agg_text_cast   boolean;
  v_has_nested_starters boolean;
  v_has_nested_bench    boolean;
  v_has_nested_ir       boolean;
  v_has_direct_concat   boolean;  -- v2 signature: `bench = bench || COALESCE(`
  v_has_empty_fallback  boolean;  -- v2 signature: `'[]'::jsonb`

  -- Negative markers
  v_has_bare_starters   boolean;
  v_has_bare_bench      boolean;
  v_has_bare_ir         boolean;
  v_has_integer_cast    boolean;
  v_has_build_array_in_update boolean;  -- v1 wrapper — must be GONE

  -- Property preservation
  v_overload_count  int;
  v_prosecdef       boolean;
  v_proconfig       text;
BEGIN
  SELECT pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure)
    INTO v_body;

  v_body_md5 := md5(v_body);
  v_body_len := length(v_body);

  -- UPDATE window: anchored at `UPDATE team_lineups` inside the function
  -- body. Window is 600 chars — enough to cover the SET clause + subquery
  -- but bounded away from the surrounding LOOP/RAISE NOTICE noise.
  v_pos_update    := position('UPDATE team_lineups' IN v_body);
  v_update_window := CASE WHEN v_pos_update > 0
    THEN substring(v_body, v_pos_update, 600) ELSE '' END;

  -- Positive markers (all body-wide except direct-concat/fallback which
  -- are windowed to the UPDATE region).
  v_has_starters_cast   := v_body ~ $$tl\.starters \? dp\.player_id::text$$;
  v_has_bench_cast      := v_body ~ $$tl\.bench\s+\? dp\.player_id::text$$;
  v_has_ir_cast         := v_body ~ $$tl\.ir\s+\? dp\.player_id::text$$;
  v_has_agg_text_cast   := v_body ~ $$jsonb_agg\(dp\.player_id::text\)$$;
  v_has_nested_starters := v_body ~ $$team_lineups\.starters \? dp\.player_id::text$$;
  v_has_nested_bench    := v_body ~ $$team_lineups\.bench\s+\? dp\.player_id::text$$;
  v_has_nested_ir       := v_body ~ $$team_lineups\.ir\s+\? dp\.player_id::text$$;
  -- v2 signature: `bench = bench || COALESCE(` within the UPDATE window.
  v_has_direct_concat   := v_update_window ~ $$bench = bench \|\| COALESCE\($$;
  -- v2 fallback: '[]'::jsonb inside the UPDATE window.
  v_has_empty_fallback  := v_update_window ~ $$'\[\]'::jsonb$$;

  -- Negative markers.
  v_has_bare_starters   := v_body ~ $$tl\.starters \? dp\.player_id(?!::text)$$;
  v_has_bare_bench      := v_body ~ $$tl\.bench\s+\? dp\.player_id(?!::text)$$;
  v_has_bare_ir         := v_body ~ $$tl\.ir\s+\? dp\.player_id(?!::text)$$;
  v_has_integer_cast    := v_body ~ $$dp\.player_id::INTEGER$$;
  -- v1's jsonb_build_array wrapper MUST be absent from the UPDATE window.
  -- Body-wide search would be safe here since the function has no other
  -- jsonb_build_array uses — but window is stricter and equally correct.
  v_has_build_array_in_update := v_update_window ~ $$jsonb_build_array$$;

  -- Property preservation
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
  RAISE NOTICE '=== STEP 3 POST-APPLY VERIFICATION (V2 MARKER SET) ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Body identity:';
  RAISE NOTICE '  post-apply md5            : %  (NEW pin for future superseders)', v_body_md5;
  RAISE NOTICE '  post-apply length         : %', v_body_len;
  RAISE NOTICE '  UPDATE window start       : %  (window len %)', v_pos_update, length(v_update_window);
  RAISE NOTICE '';
  RAISE NOTICE 'Positive markers (v1 fix continuity):';
  RAISE NOTICE '  tl.starters ? ::text                : %', v_has_starters_cast;
  RAISE NOTICE '  tl.bench    ? ::text                : %', v_has_bench_cast;
  RAISE NOTICE '  tl.ir       ? ::text                : %', v_has_ir_cast;
  RAISE NOTICE '  jsonb_agg(...::text) in UPDATE      : %', v_has_agg_text_cast;
  RAISE NOTICE '  team_lineups.starters ? ::text      : %', v_has_nested_starters;
  RAISE NOTICE '  team_lineups.bench    ? ::text      : %', v_has_nested_bench;
  RAISE NOTICE '  team_lineups.ir       ? ::text      : %', v_has_nested_ir;
  RAISE NOTICE '';
  RAISE NOTICE 'Positive markers (v2 fix signatures):';
  RAISE NOTICE '  bench = bench || COALESCE(          : %', v_has_direct_concat;
  RAISE NOTICE '  ''[]''::jsonb fallback (in UPDATE)  : %', v_has_empty_fallback;
  RAISE NOTICE '';
  RAISE NOTICE 'Negative markers (all must be false):';
  RAISE NOTICE '  tl.starters ? dp.player_id (no cast) : %', v_has_bare_starters;
  RAISE NOTICE '  tl.bench    ? dp.player_id (no cast) : %', v_has_bare_bench;
  RAISE NOTICE '  tl.ir       ? dp.player_id (no cast) : %', v_has_bare_ir;
  RAISE NOTICE '  dp.player_id::INTEGER (crash site)   : %', v_has_integer_cast;
  RAISE NOTICE '  jsonb_build_array in UPDATE (v1 wrap): %', v_has_build_array_in_update;
  RAISE NOTICE '';
  RAISE NOTICE 'Property preservation:';
  RAISE NOTICE '  overload count            : %  (expected 1)', v_overload_count;
  RAISE NOTICE '  prosecdef                 : %  (expected false)', v_prosecdef;
  RAISE NOTICE '  proconfig                 : %  (expected <null>)', v_proconfig;
  RAISE NOTICE '';

  IF NOT (v_has_starters_cast AND v_has_bench_cast AND v_has_ir_cast
      AND v_has_agg_text_cast
      AND v_has_nested_starters AND v_has_nested_bench AND v_has_nested_ir) THEN
    RAISE EXCEPTION 'STEP 3 FAIL: at least one v1 continuity marker missing (::text cast on a ? site or jsonb_agg).';
  END IF;

  IF NOT v_has_direct_concat THEN
    RAISE EXCEPTION 'STEP 3 FAIL: v2 signature `bench = bench || COALESCE(` not found in UPDATE window.';
  END IF;

  IF NOT v_has_empty_fallback THEN
    RAISE EXCEPTION 'STEP 3 FAIL: v2 empty-array fallback ''[]''::jsonb not found in UPDATE window.';
  END IF;

  IF v_has_bare_starters OR v_has_bare_bench OR v_has_bare_ir THEN
    RAISE EXCEPTION 'STEP 3 FAIL: at least one jsonb ? site still lacks ::text.';
  END IF;

  IF v_has_integer_cast THEN
    RAISE EXCEPTION 'STEP 3 FAIL: dp.player_id::INTEGER crash site reappeared.';
  END IF;

  IF v_has_build_array_in_update THEN
    RAISE EXCEPTION 'STEP 3 FAIL: jsonb_build_array wrapper still present in UPDATE — v2 fix did not land.';
  END IF;

  IF v_overload_count <> 1 THEN
    RAISE EXCEPTION 'STEP 3 FAIL (overloads): % overloads, expected 1.', v_overload_count;
  END IF;

  IF v_prosecdef IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'STEP 3 FAIL (silent privilege change): post-apply prosecdef = %, expected false.',
      v_prosecdef;
  END IF;

  IF v_proconfig <> '<null>' THEN
    RAISE EXCEPTION
      'STEP 3 FAIL (silent search_path pin): post-apply proconfig = %, expected <null>.',
      v_proconfig;
  END IF;

  RAISE NOTICE 'STEP 3 PASS: v1 continuity + v2 signatures present, negative markers absent, property preservation intact.';
END
$verify$;

-- --------------------------------------------------------------------------
-- STEP 4 — History reconciliation (INS-6 GUC bridge)
-- --------------------------------------------------------------------------
\echo ''
\echo 'STEP 4: INSERT history for 20260806100000_sl1b_auto_fix_unwrap_agg (INS-6 bridge)'

\lo_import 'supabase/migrations/20260806100000_sl1b_auto_fix_unwrap_agg.sql'
\set oid_sl1b :LASTOID
SELECT set_config('vars.oid_sl1b', :'oid_sl1b', true) AS bridged_oid_sl1b;

DO $insert_sl1b$
DECLARE
  v_oid            oid  := current_setting('vars.oid_sl1b')::oid;
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
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260806100000'
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RAISE NOTICE '  history row for 20260806100000 already exists — UPDATE (idempotent replay)';
    UPDATE supabase_migrations.schema_migrations
       SET name = 'sl1b_auto_fix_unwrap_agg',
           statements = ARRAY[v_body]
     WHERE version = '20260806100000';
  ELSE
    RAISE NOTICE '  INSERTing new history row for 20260806100000';
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ('20260806100000', 'sl1b_auto_fix_unwrap_agg', ARRAY[v_body]);
  END IF;

  RAISE NOTICE '  history row written for 20260806100000';
END
$insert_sl1b$;

SELECT lo_unlink(:'oid_sl1b'::oid);

-- --------------------------------------------------------------------------
-- STEP 5 — Final assertion
-- --------------------------------------------------------------------------
DO $final$
DECLARE
  v_hist_row_count int;
  v_final_md5      text;
BEGIN
  SELECT count(*) INTO v_hist_row_count
    FROM supabase_migrations.schema_migrations
   WHERE version = '20260806100000';

  SELECT md5(pg_get_functiondef('public.auto_fix_integrity_issues()'::regprocedure))
    INTO v_final_md5;

  RAISE NOTICE '';
  RAISE NOTICE '=== STEP 5 FINAL ASSERTION ===';
  RAISE NOTICE '  history rows for 20260806100000  : % (expect 1)', v_hist_row_count;
  RAISE NOTICE '  post-apply live md5 (v2)         : %  (add to INS-7 pin table)', v_final_md5;
  RAISE NOTICE '';

  IF v_hist_row_count <> 1 THEN
    RAISE EXCEPTION 'STEP 5 FAIL: expected 1 history row, found %.', v_hist_row_count;
  END IF;

  RAISE NOTICE 'STEP 5 PASS: apply complete, history reconciled, v2 md5 recorded.';
END
$final$;

COMMIT;

\echo ''
\echo '=============================================================='
\echo 'SL-1b V2 APPLY COMPLETE'
\echo '=============================================================='
\echo ''
\echo 'NEXT (per architect ladder):'
\echo '  4. Manual auto_fix invoke (COMMITTED, Garrett hands):'
\echo '       psql "$env:SUPABASE_DB_URL_PROD" -c "SELECT * FROM public.auto_fix_integrity_issues();"'
\echo '     Expected (assuming unwrap ran first + demo-league bench flat):'
\echo '       fix_applied     | teams_affected | players_restored'
\echo '       no_issues_found | 0              | 0'
\echo '     If it reports restored_missing_players, that is information —'
\echo '     it means either (a) the unwrap did not run or (b) additional'
\echo '     damage exists outside the 10 demo rows. Investigate before'
\echo '     step 4.5.'
\echo ''
\echo '  4.5. Synthetic repair exercise (architect addendum, 2026-08-06). PowerShell one-line:'
\echo '       psql "$env:SUPABASE_DB_URL_PROD" -v ON_ERROR_STOP=1 -f scripts/proof/sl1b-synthetic-repair-exercise.local.sql'
\echo '       Removes one uuid from one demo team, invokes auto_fix, asserts'
\echo '       length + top-level + no-nest + no-dup. Converts "concat should'
\echo '       work" into "we watched it repair flat". Reversible by construction;'
\echo '       recovery UPDATE printed if any assert fails.'
\echo ''
\echo '  5. Manual check_data_integrity invoke (writes fresh sensor rows):'
\echo '       psql "$env:SUPABASE_DB_URL_PROD" -c "SELECT * FROM public.check_data_integrity();"'
\echo ''
\echo '  6. Post-heal verify (same file as v1 — shape-agnostic). PowerShell one-line:'
\echo '       psql "$env:SUPABASE_DB_URL_PROD" -v ON_ERROR_STOP=1 -f scripts/proof/sl1-post-heal-verify.local.sql'
\echo '     Pre-registered acceptance (fork A resolved 2026-08-06 17:21:24Z):'
\echo '       missing_players_check              0 (verified — was 210)'
\echo '       team_lineups_vs_draft_picks_count  0 (FORK A: check sums array lengths, no new KI)'
\echo '       fantasy_daily_rosters_sync_today   23+ residue (KI-040 — expectation now tracks healed rosters)'
\echo ''
\echo '  7. Re-enable cron job 4 (auto-fix-integrity nightly 04:00 UTC):'
\echo '       BLOCKED — job 4 stays active:false until KI-041 provenance lands.'
\echo '       (Garrett did not knowingly disable it; other session transcript being checked.)'
\echo '       Data is healthy in the interim: detection sensor runs 4×/day on demand.'
\echo '       First scheduled success confirmation is the first 04:00 run AFTER re-enable.'
\echo ''
\echo '  Then commit the pre-apply capture:'
\echo '    git add supabase/migrations/captures/2026-08-06_pre_sl1b_auto_fix_integrity_issues.sql'
\echo '    git commit -m "evidence(SL-1b): pg_get_functiondef capture of v1 body (pre-v2)"'
\echo ''
\echo '=============================================================='
