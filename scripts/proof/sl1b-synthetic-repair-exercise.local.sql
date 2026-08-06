-- ============================================================================
-- SL-1b — synthetic repair exercise (step 4.5, architect addendum 2026-08-06)
-- ============================================================================
--
-- Slots between ladder step 4 (baseline no-op invoke) and step 5
-- (check_data_integrity fresh writes). Converts "the concat fix should
-- work" into "we watched it repair flat" — because unwrap-first (step 2)
-- leaves the v2 repair arm unexecuted on prod.
--
-- MECHANIC:
--   Phase 1 (COMMITTED): remove exactly ONE uuid from ONE demo team's
--     bench (deterministic pick, last-element removal). Capture the
--     removed uuid + team_id into session GUCs (persist across txns).
--   Phase 2 (COMMITTED): invoke public.auto_fix_integrity_issues() ONCE.
--     The v2 concat arm fires because that team now has a player in
--     draft_picks that isn't in bench.
--   Phase 3 (ROLLBACK — read-only asserts): verify the repair:
--     (a) bench length back to 21 (was 21 → 20 → 21)
--     (b) `bench ? '<removed_uuid>'` is TRUE — the removed uuid is
--         present at TOP LEVEL of the array. This is the KEY assertion:
--         if v2 still wraps in jsonb_build_array, ? would return FALSE
--         because the removed uuid would be inside a nested array.
--     (c) zero nested arrays in bench — no element has jsonb_typeof=array
--     (d) zero duplicates — distinct count == total count
--
-- REVERSIBLE BY CONSTRUCTION:
--   The removed uuid is captured before removal. If Phase 2 auto_fix
--   fails to restore, or Phase 3 assertions fail (indicating v2 didn't
--   land correctly), the removed uuid is still known — operator can
--   manually re-append via
--     UPDATE team_lineups SET bench = bench || jsonb_build_array('<uuid>')
--     WHERE team_id = '<captured_team_id>';
--   (jsonb_build_array is CORRECT here because we're appending a single
--   element, not concatenating an array — this is the shape the v2
--   concat is designed to reproduce.)
--
-- USAGE (Garrett runs against PROD; between ladder steps 4 and 5):
--   psql "$env:SUPABASE_DB_URL_PROD" -v ON_ERROR_STOP=1 \
--     -f scripts/proof/sl1b-synthetic-repair-exercise.local.sql
--
-- Rule 3 (client_encoding=UTF8) forced.
--
-- PRECONDITION (from ladder steps 2+3+4):
--   - Demo league 10 teams each have flat bench with 21 uuids (post-unwrap)
--   - Function body is v2 (post-apply)
--   - Baseline no-op invoke ran (step 4 — should have returned no_issues_found)
--   If any precondition unmet, Phase 1's guard raises before touching state.
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';
\pset pager off
\pset format aligned
\pset border 2
\timing on

\echo ''
\echo '=========================================='
\echo 'SL-1b SYNTHETIC REPAIR EXERCISE — 2026-08-06'
\echo '=========================================='

-- --------------------------------------------------------------------------
-- Phase 1 — Remove one uuid from one demo team's bench (COMMITTED)
-- --------------------------------------------------------------------------
\echo ''
\echo '── Phase 1: capture target + remove last uuid ──'

BEGIN;

-- Precondition guard + target selection + state capture.
-- Deterministic pick: ORDER BY t.team_name, t.id — first alphabetical team,
-- id tiebreak. Same team every run for reproducibility.
DO $capture$
DECLARE
  v_team_id       uuid;
  v_team_name     text;
  v_bench         jsonb;
  v_bench_len     int;
  v_removed_uuid  text;
  v_removed_idx   int;
  v_nested_check  int;
BEGIN
  -- Pick the target team.
  SELECT t.id, t.team_name, tl.bench, jsonb_array_length(coalesce(tl.bench, '[]'::jsonb))
    INTO v_team_id, v_team_name, v_bench, v_bench_len
    FROM public.teams t
    LEFT JOIN public.team_lineups tl ON tl.team_id = t.id
   WHERE t.league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'
   ORDER BY t.team_name, t.id
   LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Phase 1 PRECONDITION FAIL: no team found in demo league 750f4e1a-92ae-44cf-a798-2f3e06d0d5c9. Rolling back.';
  END IF;

  -- Precondition: bench must be flat + non-empty.
  IF v_bench_len = 0 THEN
    RAISE EXCEPTION 'Phase 1 PRECONDITION FAIL: team % (%) has empty bench — expected 21 uuids post-unwrap+repair. Investigate ladder steps 2-4 before rerunning.',
      v_team_name, v_team_id;
  END IF;

  SELECT count(*)
    INTO v_nested_check
    FROM jsonb_array_elements(v_bench) elem
   WHERE jsonb_typeof(elem) = 'array';
  IF v_nested_check > 0 THEN
    RAISE EXCEPTION 'Phase 1 PRECONDITION FAIL: team % bench contains % nested-array element(s). Unwrap (step 2) may have missed. Aborting.',
      v_team_name, v_nested_check;
  END IF;

  -- Capture the LAST element for removal. Negative-index syntax bench -> -1
  -- returns the last element; ->> gives it as text.
  v_removed_idx  := v_bench_len - 1;
  v_removed_uuid := v_bench ->> v_removed_idx;

  IF v_removed_uuid IS NULL OR v_removed_uuid = '' THEN
    RAISE EXCEPTION 'Phase 1 CAPTURE FAIL: last-element extraction returned null/empty from bench of length %. Corrupt bench shape.',
      v_bench_len;
  END IF;

  -- Persist to session GUCs (is_local=false → survives across transactions).
  PERFORM set_config('vars.sr_team_id',      v_team_id::text,   false);
  PERFORM set_config('vars.sr_team_name',    v_team_name,       false);
  PERFORM set_config('vars.sr_removed_uuid', v_removed_uuid,    false);
  PERFORM set_config('vars.sr_bench_len_pre',v_bench_len::text, false);

  RAISE NOTICE '';
  RAISE NOTICE '  target team_id           : %', v_team_id;
  RAISE NOTICE '  target team_name         : %', v_team_name;
  RAISE NOTICE '  pre-removal bench length : % (must be 21)', v_bench_len;
  RAISE NOTICE '  uuid slated for removal  : % (bench index %)', v_removed_uuid, v_removed_idx;
  RAISE NOTICE '';
END
$capture$;

-- Remove exactly one uuid via `jsonb - text` (removes first matching element).
UPDATE public.team_lineups
   SET bench = bench - current_setting('vars.sr_removed_uuid')
 WHERE team_id = current_setting('vars.sr_team_id')::uuid;

-- Verify removal: bench length dropped by exactly 1, uuid absent at top level.
DO $post_remove$
DECLARE
  v_bench_len_post int;
  v_still_present  boolean;
BEGIN
  SELECT jsonb_array_length(coalesce(bench, '[]'::jsonb)),
         bench ? current_setting('vars.sr_removed_uuid')
    INTO v_bench_len_post, v_still_present
    FROM public.team_lineups
   WHERE team_id = current_setting('vars.sr_team_id')::uuid;

  PERFORM set_config('vars.sr_bench_len_removed', v_bench_len_post::text, false);

  RAISE NOTICE '  post-removal bench length: % (must be pre - 1 = %)',
    v_bench_len_post, current_setting('vars.sr_bench_len_pre')::int - 1;
  RAISE NOTICE '  uuid still present at top: % (must be false)', v_still_present;

  IF v_bench_len_post <> current_setting('vars.sr_bench_len_pre')::int - 1 THEN
    RAISE EXCEPTION 'Phase 1 REMOVAL FAIL: bench length change wrong (pre=%, post=%). Rolling back.',
      current_setting('vars.sr_bench_len_pre')::int, v_bench_len_post;
  END IF;

  IF v_still_present THEN
    RAISE EXCEPTION 'Phase 1 REMOVAL FAIL: removed uuid still present at top level of bench. Rolling back.';
  END IF;

  RAISE NOTICE '  Phase 1 PASS: uuid removed, bench length dropped by 1.';
END
$post_remove$;

COMMIT;

-- --------------------------------------------------------------------------
-- Phase 2 — Invoke auto_fix_integrity_issues() ONCE (COMMITTED)
-- --------------------------------------------------------------------------
\echo ''
\echo '── Phase 2: invoke auto_fix (should fire v2 concat arm) ──'

SELECT * FROM public.auto_fix_integrity_issues();

-- --------------------------------------------------------------------------
-- Phase 3 — Assert repair correctness (read-only, ROLLBACK-safe)
-- --------------------------------------------------------------------------
\echo ''
\echo '── Phase 3: assert repair — length, top-level, no-nest, no-dup ──'

BEGIN;

DO $assert$
DECLARE
  v_bench            jsonb;
  v_bench_len_final  int;
  v_bench_len_pre    int := current_setting('vars.sr_bench_len_pre')::int;
  v_removed_uuid     text := current_setting('vars.sr_removed_uuid');
  v_team_id          uuid := current_setting('vars.sr_team_id')::uuid;
  v_team_name        text := current_setting('vars.sr_team_name');

  v_at_top_level     boolean;
  v_nested_count     int;
  v_distinct_count   int;
  v_total_count      int;

  v_failures         int := 0;
BEGIN
  SELECT bench, jsonb_array_length(coalesce(bench, '[]'::jsonb))
    INTO v_bench, v_bench_len_final
    FROM public.team_lineups
   WHERE team_id = v_team_id;

  -- Assert (a): length back to pre-removal (21).
  IF v_bench_len_final <> v_bench_len_pre THEN
    RAISE NOTICE '  (a) LENGTH FAIL: bench length = %, expected % (pre-removal).',
      v_bench_len_final, v_bench_len_pre;
    v_failures := v_failures + 1;
  ELSE
    RAISE NOTICE '  (a) LENGTH PASS: bench length back to % (= pre-removal).', v_bench_len_final;
  END IF;

  -- Assert (b): removed uuid present at TOP LEVEL — this is the key assertion.
  -- ? operator only sees top-level elements; if v2 still wrapped in
  -- jsonb_build_array, this would return FALSE.
  v_at_top_level := v_bench ? v_removed_uuid;
  IF NOT v_at_top_level THEN
    RAISE NOTICE '  (b) TOP-LEVEL FAIL: `bench ? ''%''` returned false. v2 repair may be nested or absent.',
      v_removed_uuid;
    v_failures := v_failures + 1;
  ELSE
    RAISE NOTICE '  (b) TOP-LEVEL PASS: removed uuid % present at top level of bench.', v_removed_uuid;
  END IF;

  -- Assert (c): zero nested-array elements. If v2 still wraps in
  -- jsonb_build_array, at least one element would be typeof=array.
  SELECT count(*)
    INTO v_nested_count
    FROM jsonb_array_elements(v_bench) elem
   WHERE jsonb_typeof(elem) = 'array';
  IF v_nested_count > 0 THEN
    RAISE NOTICE '  (c) NEST FAIL: % nested-array element(s) in bench. v2 concat arm NOT firing flat.',
      v_nested_count;
    v_failures := v_failures + 1;
  ELSE
    RAISE NOTICE '  (c) NEST PASS: zero nested-array elements in bench.';
  END IF;

  -- Assert (d): zero duplicates.
  SELECT count(*), count(DISTINCT elem)
    INTO v_total_count, v_distinct_count
    FROM jsonb_array_elements_text(v_bench) elem;
  IF v_total_count <> v_distinct_count THEN
    RAISE NOTICE '  (d) DUP FAIL: total=%, distinct=%. % duplicate(s).',
      v_total_count, v_distinct_count, (v_total_count - v_distinct_count);
    v_failures := v_failures + 1;
  ELSE
    RAISE NOTICE '  (d) DUP PASS: total = distinct = %; no duplicates.', v_total_count;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '  Summary: 4 asserts run; % failure(s).', v_failures;
  RAISE NOTICE '';

  IF v_failures > 0 THEN
    RAISE EXCEPTION 'PHASE 3 FAIL: % assertion(s) failed on team % (%). v2 repair did not produce the expected flat shape. See notices above. RECOVERY: manually re-append the captured uuid if auto_fix did not:  UPDATE team_lineups SET bench = bench || jsonb_build_array(''%'') WHERE team_id = ''%'';',
      v_failures, v_team_name, v_team_id, v_removed_uuid, v_team_id;
  END IF;

  RAISE NOTICE 'PHASE 3 PASS: v2 concat arm demonstrably repairs flat.';
  RAISE NOTICE '  team %: bench length back to %, uuid % restored at top level, no nest, no dup.',
    v_team_name, v_bench_len_final, v_removed_uuid;
END
$assert$;

ROLLBACK;

-- --------------------------------------------------------------------------
-- Teardown — clear session GUCs
-- --------------------------------------------------------------------------
SELECT set_config('vars.sr_team_id',        '', false);
SELECT set_config('vars.sr_team_name',      '', false);
SELECT set_config('vars.sr_removed_uuid',   '', false);
SELECT set_config('vars.sr_bench_len_pre',  '', false);
SELECT set_config('vars.sr_bench_len_removed','', false);

\echo ''
\echo '=========================================='
\echo 'SYNTHETIC REPAIR EXERCISE COMPLETE'
\echo '=========================================='
\echo ''
\echo 'If PHASE 3 PASS: v2 concat arm demonstrably repairs flat. Proceed to'
\echo 'ladder step 5 (manual check_data_integrity invoke).'
\echo ''
\echo 'If PHASE 3 FAIL: STOP. The recovery UPDATE is printed in the exception'
\echo 'message; re-append the removed uuid to restore the team to a good state,'
\echo 'then investigate why v2 did not concat flat.'
\echo ''
\echo '=========================================='
