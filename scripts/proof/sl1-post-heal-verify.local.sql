-- ============================================================================
-- SL-1 POST-HEAL VERIFY — architect Amendments A + B (2026-08-05)
-- ============================================================================
--
-- Run AFTER:
--   Ladder step (2): Garrett manually invoked auto_fix_integrity_issues() COMMITTED
--   Ladder step (3): Garrett manually invoked check_data_integrity() (writes fresh
--                    rows to integrity_check_results)
--
-- USAGE (Garrett runs against PROD):
--   psql "$env:SUPABASE_DB_URL_PROD" -v ON_ERROR_STOP=1 \
--     -f scripts/proof/sl1-post-heal-verify.local.sql
--
-- Read-only queries + one assertion DO block. Zero writes.
--
-- Amendment A (no-duplicate + count match, evidence-not-reasoning):
--   For each healed team in demo league 750f4e1a-92ae-44cf-a798-2f3e06d0d5c9,
--   assert:
--     (a) count(distinct player_id) in bench = count(all player_id in bench)
--         → no duplicates
--     (b) count(all player_id in team_lineups.{starters,bench,ir}) =
--         count(draft_picks WHERE team_id = t.id AND deleted_at IS NULL)
--         → count matches (expected 21 for the demo league)
--   Closes out-of-scope item 1 residual for this run with evidence.
--
-- Amendment B (F18 rule — trust queries, not self-reported counts):
--   Verify heal via the check_data_integrity FRESH results, never via
--   the auto_fix RETURN value (which self-reports wrong per KI-036
--   out-of-scope item 3 — GET DIAGNOSTICS reads UPDATE ROW_COUNT = 1
--   per iteration, not actual player count).
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';   -- Rule 3
\pset pager off
\pset format aligned
\pset border 2

\echo ''
\echo '=========================================='
\echo 'SL-1 POST-HEAL VERIFY — 2026-08-05'
\echo '=========================================='

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q1 (Amendment B — F18 rule) — fresh integrity_check_results, most recent write per check_name ──'

WITH latest AS (
  SELECT DISTINCT ON (check_name)
    check_name,
    check_time,
    status,
    cardinality(coalesce(affected_teams, '{}'::text[])) AS n_teams,
    left(coalesce(details, ''), 140)                    AS detail_snip
  FROM public.integrity_check_results
  WHERE check_time > now() - interval '2 hours'
  ORDER BY check_name, check_time DESC
)
SELECT
  check_name,
  check_time,
  status,
  n_teams,
  detail_snip
FROM latest
ORDER BY check_name;

\echo ''
\echo 'EXPECTED after the manual check_data_integrity invoke:'
\echo '  missing_players_check              status=pass  n_teams=0    (was fail/210)'
\echo '  team_lineups_vs_draft_picks_count  status=pass  n_teams=0    (was fail/10)'
\echo '  fantasy_daily_rosters_sync_today   status=fail  n_teams=12   (KI-040 residue — expected)'
\echo '  Other checks unchanged from prior nightly.'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q2 (Amendment A) — no-duplicate + count-matches per healed team ──'

WITH demo_teams AS (
  SELECT id, team_name
  FROM public.teams
  WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'
),
lineup_bag AS (
  SELECT
    t.id                 AS team_id,
    t.team_name,
    -- Union of all three arrays as a bag of text values.
    (
      SELECT jsonb_agg(elem)
      FROM (
        SELECT jsonb_array_elements_text(coalesce(tl.starters, '[]'::jsonb)) AS elem
        UNION ALL
        SELECT jsonb_array_elements_text(coalesce(tl.bench,    '[]'::jsonb)) AS elem
        UNION ALL
        SELECT jsonb_array_elements_text(coalesce(tl.ir,       '[]'::jsonb)) AS elem
      ) sub
    ) AS all_players
  FROM demo_teams t
  LEFT JOIN public.team_lineups tl ON tl.team_id = t.id
),
per_team AS (
  SELECT
    lb.team_id,
    lb.team_name,
    coalesce(jsonb_array_length(lb.all_players), 0)                                  AS total_entries,
    coalesce(jsonb_array_length(
      (SELECT jsonb_agg(DISTINCT elem)
       FROM jsonb_array_elements_text(coalesce(lb.all_players, '[]'::jsonb)) elem)
    ), 0)                                                                            AS distinct_entries,
    (
      SELECT count(*)
      FROM public.draft_picks dp
      WHERE dp.team_id = lb.team_id
        AND dp.deleted_at IS NULL
    )                                                                                AS draft_picks_count
  FROM lineup_bag lb
)
SELECT
  team_id,
  team_name,
  total_entries,
  distinct_entries,
  draft_picks_count,
  (total_entries = distinct_entries)                             AS no_dupes,
  (total_entries = draft_picks_count)                            AS count_matches,
  (total_entries = distinct_entries
   AND total_entries = draft_picks_count)                        AS amendment_a_pass
FROM per_team
ORDER BY team_name;

\echo ''
\echo 'EXPECTED (all 10 rows):'
\echo '  no_dupes = true, count_matches = true, amendment_a_pass = true'
\echo '  total_entries = 21 (assuming 21 picks per team per architect note)'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q3 (Amendment A hard assert) — raise if any healed team fails ──'

DO $assert$
DECLARE
  v_failed_teams int;
  v_bad_row      record;
BEGIN
  -- Recompute the same set as Q2 and count violators.
  WITH demo_teams AS (
    SELECT id, team_name
    FROM public.teams
    WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'
  ),
  lineup_bag AS (
    SELECT
      t.id                 AS team_id,
      t.team_name,
      (
        SELECT jsonb_agg(elem)
        FROM (
          SELECT jsonb_array_elements_text(coalesce(tl.starters, '[]'::jsonb)) AS elem
          UNION ALL
          SELECT jsonb_array_elements_text(coalesce(tl.bench,    '[]'::jsonb)) AS elem
          UNION ALL
          SELECT jsonb_array_elements_text(coalesce(tl.ir,       '[]'::jsonb)) AS elem
        ) sub
      ) AS all_players
    FROM demo_teams t
    LEFT JOIN public.team_lineups tl ON tl.team_id = t.id
  ),
  per_team AS (
    SELECT
      lb.team_id,
      lb.team_name,
      coalesce(jsonb_array_length(lb.all_players), 0)                                  AS total_entries,
      coalesce(jsonb_array_length(
        (SELECT jsonb_agg(DISTINCT elem)
         FROM jsonb_array_elements_text(coalesce(lb.all_players, '[]'::jsonb)) elem)
      ), 0)                                                                            AS distinct_entries,
      (
        SELECT count(*)
        FROM public.draft_picks dp
        WHERE dp.team_id = lb.team_id
          AND dp.deleted_at IS NULL
      )                                                                                AS draft_picks_count
    FROM lineup_bag lb
  )
  SELECT count(*)
    INTO v_failed_teams
    FROM per_team
   WHERE NOT (total_entries = distinct_entries
              AND total_entries = draft_picks_count);

  RAISE NOTICE '';
  RAISE NOTICE '=== Amendment A hard assert ===';
  RAISE NOTICE '  demo-league teams failing (dup OR count mismatch): %', v_failed_teams;
  RAISE NOTICE '';

  IF v_failed_teams > 0 THEN
    RAISE NOTICE 'Amendment A FAILED. Offending teams:';
    FOR v_bad_row IN
      WITH demo_teams AS (
        SELECT id, team_name FROM public.teams
        WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'
      ),
      lineup_bag AS (
        SELECT
          t.id AS team_id, t.team_name,
          (
            SELECT jsonb_agg(elem) FROM (
              SELECT jsonb_array_elements_text(coalesce(tl.starters, '[]'::jsonb)) AS elem
              UNION ALL SELECT jsonb_array_elements_text(coalesce(tl.bench, '[]'::jsonb))
              UNION ALL SELECT jsonb_array_elements_text(coalesce(tl.ir,    '[]'::jsonb))
            ) sub
          ) AS all_players
        FROM demo_teams t
        LEFT JOIN public.team_lineups tl ON tl.team_id = t.id
      )
      SELECT
        lb.team_id, lb.team_name,
        coalesce(jsonb_array_length(lb.all_players), 0) AS total_entries,
        coalesce(jsonb_array_length(
          (SELECT jsonb_agg(DISTINCT elem) FROM jsonb_array_elements_text(coalesce(lb.all_players, '[]'::jsonb)) elem)
        ), 0) AS distinct_entries,
        (SELECT count(*) FROM public.draft_picks dp
          WHERE dp.team_id = lb.team_id AND dp.deleted_at IS NULL) AS draft_picks_count
      FROM lineup_bag lb
      WHERE NOT (
        coalesce(jsonb_array_length(lb.all_players), 0) =
          coalesce(jsonb_array_length(
            (SELECT jsonb_agg(DISTINCT elem)
             FROM jsonb_array_elements_text(coalesce(lb.all_players, '[]'::jsonb)) elem)
          ), 0)
        AND
        coalesce(jsonb_array_length(lb.all_players), 0) =
          (SELECT count(*) FROM public.draft_picks dp
            WHERE dp.team_id = lb.team_id AND dp.deleted_at IS NULL)
      )
    LOOP
      RAISE NOTICE '  team % (%) — total=%, distinct=%, picks=%',
        v_bad_row.team_name, v_bad_row.team_id,
        v_bad_row.total_entries, v_bad_row.distinct_entries, v_bad_row.draft_picks_count;
    END LOOP;
    RAISE EXCEPTION 'Amendment A FAIL: % team(s) violate no-dup OR count-match invariant.', v_failed_teams;
  END IF;

  RAISE NOTICE 'Amendment A PASS: all 10 demo-league teams satisfy no-dup AND count-match.';
END
$assert$;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q4 (Amendment B corroboration) — count fail rows in the last 2h window per check_name ──'

SELECT
  check_name,
  count(*) FILTER (WHERE status = 'fail')     AS fails,
  count(*) FILTER (WHERE status = 'warning')  AS warns,
  count(*) FILTER (WHERE status = 'pass')     AS passes,
  min(check_time)                              AS first_seen,
  max(check_time)                              AS last_seen
FROM public.integrity_check_results
WHERE check_time > now() - interval '2 hours'
GROUP BY check_name
ORDER BY fails DESC, check_name;

\echo ''
\echo 'EXPECTED after the manual check_data_integrity invoke:'
\echo '  missing_players_check              fails=0'
\echo '  team_lineups_vs_draft_picks_count  fails=0'
\echo '  fantasy_daily_rosters_sync_today   fails=12  (KI-040 residue)'
\echo '  All others carry forward at their prior cadence.'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=========================================='
\echo 'SL-1 POST-HEAL VERIFY COMPLETE'
\echo '=========================================='
\echo ''
\echo 'If Amendment A hard assert PASSED and Q1/Q4 show missing_players=0'
\echo 'and count-check=0, SL-1 is closed on the evidence-not-reasoning bar.'
\echo 'The residual sync-staleness fails are KI-040 by design (offseason'
\echo 'semantics; expectation grew from 12 to 23+ once healed rosters started'
\echo 'reporting today under Aug-6 semantics).'
\echo ''
\echo 'FINAL confirmation (post-KI-041 resolution):'
\echo '  Cron job 4 (auto_fix_integrity nightly 04:00 UTC) is currently'
\echo '  active=false. No scheduled run will land until it is re-enabled.'
\echo '  Ladder step 7 re-enables the job — gated on KI-041 provenance'
\echo '  (who deactivated it; the other operator session transcript is'
\echo '  being checked). Data is healthy in the interim: on-demand'
\echo '  check_data_integrity confirms missing_players=0.'
\echo ''
\echo '  After re-enable, the REAL final confirmation is the first 04:00'
\echo '  UTC run following re-enable. Query it with:'
\echo '    SELECT jrd.start_time, jrd.status, left(jrd.return_message, 200)'
\echo '      FROM cron.job_run_details jrd'
\echo '     WHERE jrd.command ILIKE ''%auto_fix_integrity_issues%'''
\echo '     ORDER BY jrd.start_time DESC LIMIT 5;'
\echo '  Expect the most recent row to be status=succeeded — the first'
\echo '  scheduled success since 2026-02-25.'
\echo '=========================================='
