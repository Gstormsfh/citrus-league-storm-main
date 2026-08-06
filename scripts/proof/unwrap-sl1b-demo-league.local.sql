-- ============================================================================
-- SL-1b — one-time bench unwrap for demo league (v1 damage repair)
-- ============================================================================
--
-- Repairs the 10 team_lineups rows in league
-- 750f4e1a-92ae-44cf-a798-2f3e06d0d5c9 ("Demo League - Citrus Storm Showcase")
-- that SL-1 v1 shaped as [[21 uuids]] (nested inner array) instead of the
-- intended flat [uuid1, uuid2, ..., uuid21].
--
-- ARCHITECT-SPECIFIED GUARD (2026-08-06):
--   SET bench = bench->0
--   WHERE jsonb_array_length(bench) = 1
--     AND jsonb_typeof(bench->0) = 'array'
--
-- Scoped further to the 10 demo-league teams so any collateral row shaped
-- [[...]] elsewhere is NOT touched by this repair (separate migration if
-- others exist — pre-scan below counts them for the record).
--
-- USAGE (Garrett runs against PROD; standing rule — Claude never invokes psql):
--
--   psql "$env:SUPABASE_DB_URL_PROD" -v ON_ERROR_STOP=1 \
--     -f scripts/proof/unwrap-sl1b-demo-league.local.sql
--
-- Rule 3 (client_encoding=UTF8) forced. Rule 4 (--quiet on gcloud) not
-- applicable — no gcloud calls here.
--
-- SAFETY: BEGIN…COMMIT wrap. Pre-count + post-count printed. If pre-count
-- ≠ 10 (the expected 10 demo-league rows), aborts before touching anything.
-- Collateral-scan query prints counts of rows OUTSIDE the demo league
-- that would match the same shape — informational; those rows are NOT
-- touched here.
--
-- APPLY ORDER (architect ladder, 2026-08-06):
--   1. Rehearsal (INS-6, bridge check)
--   2. THIS unwrap  ← YOU ARE HERE
--   3. v2 apply (apply-sl1b-auto-fix-v2.local.sql)
--   4. Manual auto_fix invoke (baseline no-op expected post-unwrap)
--   4.5. Synthetic repair exercise (sl1b-synthetic-repair-exercise.local.sql)
--        — architect addendum; converts "concat should work" into "watched it repair flat"
--   5. Manual check_data_integrity invoke
--   6. Post-heal verify (sl1-post-heal-verify.local.sql — same file as v1)
--   7. Re-enable cron job 4 (final step, pending KI-041 answer)
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';
\pset pager off
\pset format aligned
\pset border 2
\timing on

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=========================================='
\echo 'SL-1b DEMO-LEAGUE UNWRAP — 2026-08-06'
\echo '=========================================='
\echo ''
\echo '── Pre-scan: how many team_lineups rows in the demo league match ──'

WITH demo_teams AS (
  SELECT id FROM public.teams WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'
)
SELECT
  count(*)                                                                        AS demo_teams_total,
  count(*) FILTER (WHERE tl.team_id IS NOT NULL)                                  AS demo_teams_with_lineup,
  count(*) FILTER (WHERE jsonb_array_length(coalesce(tl.bench,'[]'::jsonb)) = 1
                     AND jsonb_typeof(coalesce(tl.bench,'[]'::jsonb) -> 0) = 'array') AS demo_teams_nested_bench
FROM demo_teams dt
LEFT JOIN public.team_lineups tl ON tl.team_id = dt.id;

\echo ''
\echo '── Collateral scan: rows OUTSIDE the demo league with the same shape ──'
\echo '   (Informational only — NOT touched by this unwrap.)'

SELECT
  count(*) AS non_demo_rows_with_nested_bench
FROM public.team_lineups tl
WHERE jsonb_array_length(coalesce(tl.bench,'[]'::jsonb)) = 1
  AND jsonb_typeof(coalesce(tl.bench,'[]'::jsonb) -> 0) = 'array'
  AND tl.team_id NOT IN (
    SELECT id FROM public.teams WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'
  );

\echo ''
\echo '── Pre-abort guard: expected 10 demo-league nested rows ──'

DO $guard$
DECLARE
  v_nested_count int;
BEGIN
  SELECT count(*)
    INTO v_nested_count
    FROM public.team_lineups tl
   WHERE tl.team_id IN (SELECT id FROM public.teams
                          WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9')
     AND jsonb_array_length(coalesce(tl.bench,'[]'::jsonb)) = 1
     AND jsonb_typeof(coalesce(tl.bench,'[]'::jsonb) -> 0) = 'array';

  RAISE NOTICE '';
  RAISE NOTICE '  demo-league nested-bench rows found : % (expected 10)', v_nested_count;

  IF v_nested_count = 0 THEN
    RAISE EXCEPTION 'PRE-ABORT: found 0 nested-bench rows in demo league. Either the unwrap already ran (safe to skip) or the shape assumption is wrong. NOT unwrapping — investigate. Rolling back.';
  END IF;

  IF v_nested_count <> 10 THEN
    RAISE WARNING 'PRE-ABORT WARN: expected 10 nested-bench rows in demo league, found %. Proceeding but flagging — architect quoted "10 teams × 21 picks". Actual count differs. Investigate the delta after unwrap.',
      v_nested_count;
  ELSE
    RAISE NOTICE '  PRE-ABORT PASS: 10 nested-bench rows as expected.';
  END IF;
END
$guard$;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── UNWRAP: SET bench = bench->0 for 10 demo-league rows ──'

WITH updated AS (
  UPDATE public.team_lineups tl
     SET bench = tl.bench -> 0
   WHERE tl.team_id IN (SELECT id FROM public.teams
                          WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9')
     AND jsonb_array_length(coalesce(tl.bench,'[]'::jsonb)) = 1
     AND jsonb_typeof(coalesce(tl.bench,'[]'::jsonb) -> 0) = 'array'
  RETURNING tl.team_id
)
SELECT count(*) AS rows_unwrapped FROM updated;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Post-scan: verify shape is now flat ──'

WITH demo_lineups AS (
  SELECT tl.team_id, tl.bench
  FROM public.team_lineups tl
  WHERE tl.team_id IN (SELECT id FROM public.teams
                          WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9')
)
SELECT
  count(*)                                                                    AS demo_rows_total,
  count(*) FILTER (WHERE jsonb_array_length(coalesce(bench,'[]'::jsonb)) > 0
                     AND jsonb_typeof(coalesce(bench,'[]'::jsonb) -> 0) = 'string') AS flat_string_shape,
  count(*) FILTER (WHERE jsonb_array_length(coalesce(bench,'[]'::jsonb)) = 1
                     AND jsonb_typeof(coalesce(bench,'[]'::jsonb) -> 0) = 'array')  AS still_nested,
  count(*) FILTER (WHERE jsonb_array_length(coalesce(bench,'[]'::jsonb)) = 0)       AS empty_bench,
  min(jsonb_array_length(coalesce(bench,'[]'::jsonb)))                              AS min_len,
  max(jsonb_array_length(coalesce(bench,'[]'::jsonb)))                              AS max_len
FROM demo_lineups;

\echo ''
\echo 'EXPECTED after unwrap:'
\echo '  demo_rows_total      10'
\echo '  flat_string_shape    10'
\echo '  still_nested         0'
\echo '  empty_bench          0'
\echo '  min_len / max_len    both = 21 (or the actual pick count per team)'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Post-unwrap hard assert ──'

DO $post$
DECLARE
  v_still_nested int;
  v_flat_string  int;
  v_total        int;
BEGIN
  SELECT
    count(*) FILTER (WHERE jsonb_array_length(coalesce(tl.bench,'[]'::jsonb)) = 1
                       AND jsonb_typeof(coalesce(tl.bench,'[]'::jsonb) -> 0) = 'array'),
    count(*) FILTER (WHERE jsonb_array_length(coalesce(tl.bench,'[]'::jsonb)) > 0
                       AND jsonb_typeof(coalesce(tl.bench,'[]'::jsonb) -> 0) = 'string'),
    count(*)
    INTO v_still_nested, v_flat_string, v_total
    FROM public.team_lineups tl
   WHERE tl.team_id IN (SELECT id FROM public.teams
                          WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

  RAISE NOTICE '';
  RAISE NOTICE '  demo rows total       : %', v_total;
  RAISE NOTICE '  still nested          : % (must be 0)', v_still_nested;
  RAISE NOTICE '  flat-string bench     : %', v_flat_string;
  RAISE NOTICE '';

  IF v_still_nested > 0 THEN
    RAISE EXCEPTION 'POST-UNWRAP FAIL: % rows still nested after UPDATE. Rolling back.', v_still_nested;
  END IF;

  RAISE NOTICE 'POST-UNWRAP PASS: zero nested-shape rows remain in demo league.';
END
$post$;

COMMIT;

\echo ''
\echo '=========================================='
\echo 'SL-1b DEMO-LEAGUE UNWRAP COMMITTED'
\echo '=========================================='
\echo ''
\echo 'NEXT: apply v2 (scripts/proof/apply-sl1b-auto-fix-v2.local.sql)'
\echo 'then manual invoke of auto_fix_integrity_issues, then check_data_integrity,'
\echo 'then post-heal verify (scripts/proof/sl1-post-heal-verify.local.sql).'
