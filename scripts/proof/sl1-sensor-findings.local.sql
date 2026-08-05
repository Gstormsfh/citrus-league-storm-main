-- ============================================================================
-- SL-1 SENSOR-FINDINGS QUERY PACK
-- ============================================================================
-- Opens the Season-Loop audit for SL-1: auto-fix-integrity dead for ≥8 days
-- (UUID-to-integer cast crash in team_lineups bench-repair).
--
-- Purpose: gather ground truth on the current state of the integrity-check
-- sensor + auto-fix loop BEFORE proposing any repair. All queries are
-- read-only OR transactionally wrapped with ROLLBACK. Zero state risk.
--
-- USAGE (Garrett runs; hand paste output back to Claude/architect):
--
--   psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/proof/sl1-sensor-findings.local.sql
--
-- No secrets. Uses standard read + cron.* catalog access.
-- Rule 3 applies (client_encoding=UTF8 recommended but not load-bearing for
-- read-only queries).
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
\pset border 2

\echo ''
\echo '=========================================='
\echo 'SL-1 SENSOR FINDINGS — 2026-08-05'
\echo '=========================================='

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q1: Column types — settles the UUID vs integer cast question ──'

SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'draft_picks'    AND column_name = 'player_id')
    OR (table_name = 'draft_picks_v2' AND column_name = 'player_id')
    OR (table_name = 'team_lineups' AND column_name IN ('starters', 'bench', 'ir'))
    OR (table_name = 'teams'        AND column_name = 'id')
    OR (table_name = 'draft_order'  AND column_name IN ('team_order', 'deleted_at'))
    OR (table_name = 'players'      AND column_name = 'id')
  )
ORDER BY table_name, column_name;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q2: draft_picks vs draft_picks_v2 row counts (which is live?) ──'

SELECT 'draft_picks'    AS table_name, count(*) AS rows FROM public.draft_picks
UNION ALL
SELECT 'draft_picks_v2' AS table_name, count(*) AS rows FROM public.draft_picks_v2;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q3: Recent integrity_check_results — last 25 rows ──'

SELECT
  check_time,
  check_name,
  status,
  left(coalesce(details, ''), 120)                            AS detail_snip,
  cardinality(coalesce(affected_teams, '{}'::text[]))         AS n_teams,
  auto_fixed
FROM public.integrity_check_results
ORDER BY check_time DESC
LIMIT 25;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q4: Failure histogram by day + check_name — last 14 days ──'

SELECT
  date_trunc('day', check_time)::date              AS day,
  check_name,
  count(*) FILTER (WHERE status = 'fail')          AS fails,
  count(*) FILTER (WHERE status = 'warning')       AS warns,
  count(*) FILTER (WHERE status = 'pass')          AS passes
FROM public.integrity_check_results
WHERE check_time > now() - interval '14 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q5: Direct-invoke auto_fix_integrity_issues (WRAPPED IN ROLLBACK) ──'
\echo '   — Captures SQLSTATE + SQLERRM if it throws.'

BEGIN;
DO $sensor$
DECLARE
  v_out         record;
  v_row_count   int := 0;
BEGIN
  BEGIN
    FOR v_out IN SELECT * FROM public.auto_fix_integrity_issues() LOOP
      v_row_count := v_row_count + 1;
      RAISE NOTICE 'auto_fix out row %: %', v_row_count, row_to_json(v_out);
    END LOOP;
    RAISE NOTICE 'auto_fix COMPLETED cleanly — % row(s) returned', v_row_count;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_fix EXCEPTION — SQLSTATE=% SQLERRM=%', SQLSTATE, SQLERRM;
    -- Do NOT re-raise; we want the ROLLBACK to run cleanly regardless.
  END;
END
$sensor$;
ROLLBACK;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q6: pg_cron scheduling — is auto_fix scheduled + active? ──'

SELECT
  jobid,
  schedule,
  left(command, 100) AS command_snip,
  active,
  database
FROM cron.job
WHERE command ILIKE '%auto_fix_integrity_issues%'
   OR command ILIKE '%check_data_integrity%'
ORDER BY jobid;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q7: cron.job_run_details — last 25 runs of any integrity job ──'

SELECT
  jrd.start_time,
  jrd.status,
  left(coalesce(jrd.return_message, ''), 160) AS msg_snip,
  left(coalesce(jrd.command, ''),        80)  AS command_snip
FROM cron.job_run_details jrd
WHERE jrd.command ILIKE '%auto_fix_integrity_issues%'
   OR jrd.command ILIKE '%check_data_integrity%'
ORDER BY jrd.start_time DESC
LIMIT 25;

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q8: cross-check auto-fix crash target — count teams with players in draft_picks but NOT in team_lineups ──'
\echo '   (This is what auto_fix would try to repair; count sizes the blast radius.)'

SELECT
  count(DISTINCT t.id) AS teams_with_missing_players,
  count(*)             AS total_missing_player_rows
FROM public.draft_picks dp
JOIN public.teams t         ON t.id = dp.team_id
JOIN public.team_lineups tl ON tl.team_id = t.id
WHERE dp.deleted_at IS NULL
  AND NOT (
    tl.starters ? dp.player_id::text OR
    tl.bench    ? dp.player_id::text OR
    tl.ir       ? dp.player_id::text
  );

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=========================================='
\echo 'SL-1 SENSOR FINDINGS COMPLETE'
\echo '=========================================='
\echo 'Paste the full output back for triage.'
\echo 'Q1 answers the type question; Q5 catches the live exception;'
\echo 'Q6/Q7 confirm the ≥8-day dead state; Q8 sizes the missing-players'
\echo 'blast radius the fix will need to repair.'
