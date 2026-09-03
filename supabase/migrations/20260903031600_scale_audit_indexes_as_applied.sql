-- ============================================================================
-- SCALE AUDIT INDEXES — the record of what was actually applied to prod
-- ============================================================================
-- WHAT CHANGED. The six statements in 20260902120000_scale_audit_hot_read_indexes.sql
-- were reviewed against the production catalog on 2026-09-03 and FOUR were applied.
-- Two were dropped: they duplicate an existing PRIMARY KEY exactly.
--
-- WHY NOW. That file carries its own instruction in its header: it was written
-- without database access, every statement is IF NOT EXISTS, and it says
-- "That makes the file safe to run, NOT safe to run unread. Check first ...
-- Then decide per statement." Nothing had ever run it, so prod had none of the
-- six. This file is that review, with the pg_indexes output and the EXPLAIN
-- that decided the one statement worth arguing about.
--
-- WHO. Ops workstream, 2026-09-03, during the prod/repo migration
-- reconciliation that also applied 20260901233000 (draft_latency_scorecard)
-- and 20260901234000 (ops_ci_runs). PROD_CHANGE_LEDGER Rule 1: prod was
-- mutated, so the applied SQL gets a history row that says so.
--
-- ─────────────────────────────────────────────────────────────────────
-- THE REVIEW, STATEMENT BY STATEMENT
-- ─────────────────────────────────────────────────────────────────────
--
-- APPLIED (4). Re-stated below with CONCURRENTLY stripped, so re-running this
-- file through the normal migration path is a no-op rather than an error.
--
--   idx_nhl_shots_shooter_season_game          measured, see below
--   idx_player_talent_metrics_season_player    PK is (player_id, season) — reversed, so not redundant
--   idx_player_ros_projections_season_player   PK is (player_id) alone
--   idx_player_ros_projections_season_points   no (season, points) composite existed
--
-- DROPPED (2). Both duplicate a UNIQUE PRIMARY KEY on exactly the same columns
-- in exactly the same order. Postgres would have built and then maintained a
-- second copy of an index it already has.
--
--   idx_player_directory_season_player
--     player_directory_pkey    = UNIQUE (season, player_id)   ← identical
--   idx_player_season_stats_season_player
--     player_season_stats_pkey = UNIQUE (season, player_id)   ← identical
--
--   The source file predicted "each of these tables has (season) and
--   (player_id) as SEPARATE single-column indexes and no composite." That is
--   true for player_talent_metrics and player_ros_projections and FALSE for
--   these two, which is the whole reason its header demanded a catalog read
--   before an apply.
--
-- ─────────────────────────────────────────────────────────────────────
-- THE nhl_shots STATEMENT, MEASURED
-- ─────────────────────────────────────────────────────────────────────
-- The source file called this "the single highest-value statement in the file
-- IF the index is absent, and completely worthless if the pipeline already
-- created one," fearing that a shooter_id filter would fall back to a
-- sequential scan of a million rows.
--
-- Neither branch was right. idx_nhl_shots_shooter (shooter_id) DID already
-- exist, so there was never a sequential scan — and the composite was still
-- worth building, for a reason the file could not have guessed without a plan.
--
-- The read (PlayerDashboardService.getPlayerDashboard, shooter 8477492,
-- season 2025, game_type 'regular', 471 rows out of 1,027,346):
--
--   BEFORE                                        11.234 ms, 925 shared buffers
--     Sort (game_id, event_id)  ......................  quicksort, 87 kB
--     └ Bitmap Heap Scan, 75 rows removed by filter
--       └ BitmapAnd
--         ├ idx_nhl_shots_shooter → 4,460 rows ....... 0.53 ms,  12 buffers
--         └ idx_nhl_shots_season  → 119,357 rows ..... 7.41 ms, 473 buffers
--
--   AFTER                                          2.564 ms, 446 shared buffers
--     Index Scan using idx_nhl_shots_shooter_season_game
--       Index Cond: shooter_id AND season AND game_type   (no sort, no recheck)
--
-- 4.4x on execution, 2.1x on buffers. The cost was not the missing shooter
-- index; it was the planner intersecting a 119,357-row season bitmap with a
-- 4,460-row shooter bitmap and discarding almost all of both. The composite
-- also satisfies ORDER BY game_id, event_id in index order, removing the sort.
--
-- Index size: 40 MB on 1,027,346 rows. The nightly pipeline pays a write cost
-- on it; the dashboard read is user-facing and the pipeline is not.
--
-- LOCKING, AS APPLIED. All four ran as CREATE INDEX CONCURRENTLY, one
-- statement per call, so nhl_shots took no ACCESS EXCLUSIVE lock and no read
-- was blocked. CONCURRENTLY cannot run inside a transaction block and this
-- file is applied inside one, so the statements below are the plain form:
-- against prod they are already-satisfied no-ops, and against a fresh database
-- (staging, a branch, a restore) the tables are small or empty and the lock is
-- irrelevant. Anyone re-applying to a LOADED database should run the nhl_shots
-- statement separately as CONCURRENTLY.
--
-- VERIFY (post-apply):
--   SELECT c.relname, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE c.relname LIKE 'idx_nhl_shots_shooter_season_game'
--       OR c.relname LIKE 'idx_player_ros_projections_season_%'
--       OR c.relname = 'idx_player_talent_metrics_season_player';   -- 4 rows, all t
-- ROLLBACK: DROP INDEX CONCURRENTLY <name>;  (read-path only, nothing depends on them)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_nhl_shots_shooter_season_game
  ON public.nhl_shots (shooter_id, season, game_type, game_id, event_id);

CREATE INDEX IF NOT EXISTS idx_player_talent_metrics_season_player
  ON public.player_talent_metrics (season, player_id);

CREATE INDEX IF NOT EXISTS idx_player_ros_projections_season_player
  ON public.player_ros_projections (season, player_id);

CREATE INDEX IF NOT EXISTS idx_player_ros_projections_season_points
  ON public.player_ros_projections (season, total_projected_points DESC);

-- The two dropped statements are deliberately absent. If a future schema
-- change moves either primary key off (season, player_id), THEN the composite
-- becomes worth adding and earns its own migration with its own reason.
DO $gate$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(n ORDER BY n) INTO v_missing
    FROM unnest(ARRAY[
      'idx_nhl_shots_shooter_season_game',
      'idx_player_talent_metrics_season_player',
      'idx_player_ros_projections_season_player',
      'idx_player_ros_projections_season_points'
    ]) AS n
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = n AND i.indisvalid
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'scale audit indexes missing or invalid: %', v_missing;
  END IF;
END
$gate$;
