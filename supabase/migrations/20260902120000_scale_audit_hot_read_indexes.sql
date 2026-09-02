-- PERF (2026-09-02 scale audit, docs/PERFORMANCE_AND_SCALE_2026-09-02.md).
--
-- ─────────────────────────────────────────────────────────────────────
-- READ THIS BEFORE APPLYING. NOT APPLIED TO ANY DATABASE.
-- ─────────────────────────────────────────────────────────────────────
-- This file was written WITHOUT database access. Every statement was
-- derived by reading query code against the CREATE INDEX statements in
-- `supabase/migrations/`, so it can only see indexes this repo created.
-- `nhl_shots` and `player_xg_season` are pipeline-managed tables with NO
-- DDL anywhere in this repo, so their real index set is unknown here.
--
-- Every statement is `IF NOT EXISTS`, so applying this against a
-- database that already has an equivalent index is a no-op. That makes
-- the file safe to run, NOT safe to run unread. Check first:
--
--   SELECT tablename, indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND tablename IN ('nhl_shots','player_directory','player_season_stats',
--                        'player_talent_metrics','player_ros_projections')
--    ORDER BY tablename, indexname;
--
-- Then decide per statement. A human applies this through the normal
-- migration path after that review; nothing here has been measured with
-- EXPLAIN and none of it should be taken on trust.
--
-- LOCKING. A plain CREATE INDEX takes an ACCESS EXCLUSIVE lock and
-- blocks writes to that table for the build. On the ~2k-row player
-- tables that is milliseconds and not worth thinking about. On
-- `nhl_shots` (1,026,149 rows) it is seconds, and the writer is the
-- nightly pipeline, not a user request — so build it OUTSIDE the
-- pipeline window, or run that one statement on its own as
-- `CREATE INDEX CONCURRENTLY` (which CANNOT run inside a transaction
-- block, so it must not be part of this migration file).

-- ── 1. nhl_shots: the per-player dashboard read ──────────────────────
--
-- `PlayerDashboardService.getPlayerDashboard` reads
--   WHERE shooter_id = $1 AND season = $2 AND game_type = $3
--   ORDER BY game_id, event_id
-- against 1,026,149 rows, for every player dashboard whose 2-minute
-- cache entry has lapsed.
--
-- The service's own comment names the table's primary key as
-- `(game_id, event_id)`, which cannot help a `shooter_id` equality
-- filter — a PK scan there is a full scan with a filter. If no index on
-- `shooter_id` exists, every cache-missed dashboard page load is a
-- sequential scan of a million rows.
--
-- This is the single highest-value statement in the file IF the index is
-- absent, and completely worthless if the pipeline already created one.
-- Run the pg_indexes query above before assuming either.
--
-- Column order matches the filter: equality columns first, then the sort
-- keys, so the read becomes an index scan with no sort step.
CREATE INDEX IF NOT EXISTS idx_nhl_shots_shooter_season_game
  ON public.nhl_shots (shooter_id, season, game_type, game_id, event_id);

-- ── 2. The season-scoped player tables: paged reads ──────────────────
--
-- Every full-table read in the app now pages:
--   WHERE season = $1 ORDER BY player_id LIMIT 1000 OFFSET n
-- (`server/src/lib/pagedRead.ts`, and the three private copies of the
-- same loop it was extracted from).
--
-- Today each of these tables has `(season)` and `(player_id)` as
-- SEPARATE single-column indexes and no composite. Neither can satisfy
-- filter-then-sort on its own, so the planner filters on one and sorts
-- the result — and because OFFSET paging re-executes the whole query per
-- page, that sort is paid once per page, not once per read.
--
-- HONEST SIZING: these tables hold roughly 1-2k rows per season today,
-- where a sort is sub-millisecond and this buys very little. The reason
-- to add them anyway is shape, not size: they are season-keyed and grow
-- by a full copy every season, the reads are already paged, and a
-- composite turns an O(pages x n log n) pattern into a plain index scan.
-- Do not expect a visible latency change on today's data.
CREATE INDEX IF NOT EXISTS idx_player_directory_season_player
  ON public.player_directory (season, player_id);

CREATE INDEX IF NOT EXISTS idx_player_season_stats_season_player
  ON public.player_season_stats (season, player_id);

CREATE INDEX IF NOT EXISTS idx_player_talent_metrics_season_player
  ON public.player_talent_metrics (season, player_id);

CREATE INDEX IF NOT EXISTS idx_player_ros_projections_season_player
  ON public.player_ros_projections (season, player_id);

-- ── 3. player_ros_projections: the projection board ──────────────────
--
-- `GET /api/players/ros-projections` and the auction auto-nominate
-- strategy both read
--   WHERE season = $1 ORDER BY total_projected_points DESC
--
-- The table has `(total_projected_points DESC)` alone and
-- `(position, total_projected_points DESC)`, but nothing leading with
-- `season`. With one season loaded that distinction is invisible; the
-- moment a second season's projections are ingested — which is the
-- explicit reason `getProjectionsSeason()` exists — the season filter
-- starts discarding half the index scan.
--
-- Same honest sizing caveat as section 2: 1,055 rows today.
CREATE INDEX IF NOT EXISTS idx_player_ros_projections_season_points
  ON public.player_ros_projections (season, total_projected_points DESC);
