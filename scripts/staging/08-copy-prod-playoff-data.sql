-- ============================================================================
-- 08-copy-prod-playoff-data.sql
--
-- Copies the NHL 2025 playoff state (seeds + series + pipeline-meta) from
-- production to staging so the bracket/confidence/hub UIs render with real
-- team data and series states. Required for visual QA of any code path that
-- reads nhl_playoff_seeds / nhl_playoff_series — without it the bracket page
-- shows the empty state ("Bracket not yet finalized").
--
-- Source of truth (READ ONLY):
--   Supabase project ref: iezwazccqqrhrjupxzvf  (CitrusFantasySports / prod)
--   Tables read by author when generating this script:
--     - nhl_playoff_seeds  WHERE season = 2025  (16 rows)
--     - nhl_playoff_series WHERE season = 2025  (15 rows)
--     - nhl_pipeline_meta                       (3 rows)
--
-- Target (WRITES HERE):
--   Supabase project ref: jjgspcpvqaiitloglxbb  (citrus-staging)
--   This script ONLY executes against staging. NEVER run it against prod.
--
-- Properties:
--   * Idempotent: DELETEs the season=2025 + meta keys before INSERT, so
--     re-running is safe and refreshes the data in place.
--   * Single transaction: BEGIN/COMMIT — rolls back on any error.
--   * UUIDs preserved verbatim from prod so any cross-table references
--     (nhl_games.series_id, future state) stay referentially consistent.
--   * pipeline-meta.last_refresh uses NOW() at execution time so the
--     staging "Updated Xs ago" freshness badge reflects when YOU synced,
--     not when prod last refreshed.
--
-- Staleness: this is a snapshot. The prod data updates as the live playoffs
-- progress (series move from active → final, R2 fills in from R1 winners,
-- etc.). Re-run this script periodically during active playoffs, especially
-- before any visual QA pass on bracket/confidence/pool pages.
--
-- Long-term: a periodic Supabase function or cron job could automate this,
-- but manual re-run is sufficient for now (see KNOWN_GAPS.md).
--
-- Authored: 2026-05-01 during Phase 1F (visual paint unblock for Phase 1E
-- pool surface fixes).
-- ============================================================================

BEGIN;

-- 1. Idempotent cleanup
DELETE FROM nhl_playoff_series WHERE season = 2025;
DELETE FROM nhl_playoff_seeds WHERE season = 2025;
DELETE FROM nhl_pipeline_meta WHERE key IN ('playoff_seeds', 'playoff_series', 'player_playoff_stats');

-- 2. 16 seeds (8 East + 8 West, season 2025)
INSERT INTO nhl_playoff_seeds (id, season, conference, division, seed, team_id, team_abbrev, wins, losses, ot_losses, points, row_wins, created_at) VALUES
  ('c869d0ae-279a-447f-b9d0-f67fd4ad9207', 2025, 'Eastern', 'Atlantic',     1, 7,  'BUF', 50, 23, 9,  109, 45, '2026-04-17 13:51:07.722104+00'),
  ('94d28537-c509-4e5c-b39f-3f1258bae99a', 2025, 'Eastern', 'Atlantic',     2, 14, 'TBL', 50, 26, 6,  106, 46, '2026-04-17 13:51:07.722104+00'),
  ('7277f6d6-6078-4235-98db-d2656037e6e2', 2025, 'Eastern', 'Metropolitan', 3, 12, 'CAR', 53, 22, 7,  113, 48, '2026-04-17 13:51:07.722104+00'),
  ('3b964d98-84da-434a-b603-3363fd8ee744', 2025, 'Eastern', 'Metropolitan', 4, 5,  'PIT', 41, 25, 16, 98,  38, '2026-04-17 13:51:07.722104+00'),
  ('40ec2aaf-1183-493c-b509-4eabb4a0c62b', 2025, 'Eastern', 'Metropolitan', 5, 4,  'PHI', 43, 27, 12, 98,  33, '2026-04-17 13:51:07.722104+00'),
  ('829ed997-7153-43a1-882d-e02fe355ac42', 2025, 'Eastern', 'WildCard',     6, 9,  'OTT', 44, 27, 11, 99,  41, '2026-04-17 13:51:07.722104+00'),
  ('229cc534-06a4-4ef8-a5a1-9fb3ac4e38fb', 2025, 'Eastern', 'Atlantic',     7, 8,  'MTL', 48, 24, 10, 106, 44, '2026-04-17 13:51:07.722104+00'),
  ('a8368ac9-473a-428b-ba73-fcbe9f1b1d8c', 2025, 'Eastern', 'WildCard',     8, 6,  'BOS', 45, 27, 10, 100, 41, '2026-04-17 13:51:07.722104+00'),
  ('f5988bb9-b907-40fd-8435-556ff0f67e38', 2025, 'Western', 'Central',      1, 21, 'COL', 55, 16, 11, 121, 51, '2026-04-17 13:51:07.722104+00'),
  ('3befaa94-917c-4cf5-b961-64f8dd9512c4', 2025, 'Western', 'Central',      2, 25, 'DAL', 50, 20, 12, 112, 44, '2026-04-17 13:51:07.722104+00'),
  ('da519053-327e-4b26-af49-2a4494493346', 2025, 'Western', 'Pacific',      3, 54, 'VGK', 39, 26, 17, 95,  38, '2026-04-17 13:51:07.722104+00'),
  ('6519351d-8faa-48af-a87d-0574bb9398df', 2025, 'Western', 'Pacific',      4, 22, 'EDM', 41, 30, 11, 93,  41, '2026-04-17 13:51:07.722104+00'),
  ('7041cd51-c641-4118-8833-edb310df4bd2', 2025, 'Western', 'Pacific',      5, 24, 'ANA', 43, 33, 6,  92,  35, '2026-04-17 13:51:07.722104+00'),
  ('368b49ed-6168-47a6-86df-8ba4bc2dffa2', 2025, 'Western', 'WildCard',     6, 59, 'UTA', 43, 33, 6,  92,  43, '2026-04-17 13:51:07.722104+00'),
  ('fee545c8-ad3e-4215-863c-1562fda3b10e', 2025, 'Western', 'Central',      7, 30, 'MIN', 46, 24, 12, 104, 42, '2026-04-17 13:51:07.722104+00'),
  ('e3233ece-4b3b-407d-8692-ce9e6d113f83', 2025, 'Western', 'WildCard',     8, 26, 'LAK', 35, 27, 20, 90,  30, '2026-04-17 13:51:07.722104+00');

-- 3. 15 series (8 R1 active/final + 4 R2 pending + 2 SF pending + 1 SCF pending)
INSERT INTO nhl_playoff_series (series_id, season, round, conference, bracket_slot, parent_slot_a, parent_slot_b, high_seed_team_id, low_seed_team_id, high_seed_wins, low_seed_wins, winner_team_id, games_played, series_status, starts_at, updated_at) VALUES
  ('4c982942-8421-47a2-b88f-a9cd1bdc529a', 2025, 1, 'Eastern', 1,  NULL, NULL, 7,    6,    3, 2, NULL, 5, 'active',  NULL, '2026-05-01 15:11:50.297573+00'),
  ('7da0ad88-0b84-45ae-a937-54213582ba1a', 2025, 1, 'Eastern', 2,  NULL, NULL, 14,   8,    2, 3, NULL, 5, 'active',  NULL, '2026-05-01 15:11:50.297573+00'),
  ('5964e65d-de20-4d64-8c64-d85b0e726215', 2025, 1, 'Eastern', 3,  NULL, NULL, 12,   9,    4, 0, 12,   4, 'final',   NULL, '2026-05-01 15:11:50.297573+00'),
  ('d5b6a1aa-1d8d-4c00-bf26-9b5636e367d1', 2025, 1, 'Eastern', 4,  NULL, NULL, 5,    4,    2, 4, 4,    6, 'final',   NULL, '2026-05-01 15:11:50.297573+00'),
  ('c0748830-ed3b-4e0f-9694-42d0e253dc2e', 2025, 1, 'Western', 5,  NULL, NULL, 21,   26,   4, 0, 21,   4, 'final',   NULL, '2026-05-01 15:11:50.297573+00'),
  ('8682e5f6-d471-42c0-8af6-c76d86577227', 2025, 1, 'Western', 6,  NULL, NULL, 25,   30,   2, 4, 30,   6, 'final',   NULL, '2026-05-01 15:11:50.297573+00'),
  ('a9423f36-ba84-4795-9052-71e97023a84f', 2025, 1, 'Western', 7,  NULL, NULL, 54,   59,   3, 2, NULL, 5, 'active',  NULL, '2026-05-01 15:11:50.297573+00'),
  ('d0042c76-bffb-4239-b815-b31094e4fa22', 2025, 1, 'Western', 8,  NULL, NULL, 22,   24,   2, 4, 24,   6, 'final',   NULL, '2026-05-01 15:11:50.297573+00'),
  ('fe9417d3-088a-42b2-8cf0-73823fb8a882', 2025, 2, NULL,      9,  1,    2,    NULL, NULL, 0, 0, NULL, 0, 'pending', NULL, '2026-04-17 13:51:07.722104+00'),
  ('0db37579-7432-45b3-b9d5-3a4e11aa4f48', 2025, 2, NULL,      10, 3,    4,    NULL, NULL, 0, 0, NULL, 0, 'pending', NULL, '2026-04-17 13:51:07.722104+00'),
  ('27ea0601-36ae-43b4-88fa-25bd45332e56', 2025, 2, NULL,      11, 5,    6,    NULL, NULL, 0, 0, NULL, 0, 'pending', NULL, '2026-04-17 13:51:07.722104+00'),
  ('cbd6dd4e-87ff-41ce-8e33-15cc25923386', 2025, 2, NULL,      12, 7,    8,    NULL, NULL, 0, 0, NULL, 0, 'pending', NULL, '2026-04-17 13:51:07.722104+00'),
  ('adfe9ad4-76c5-4886-8d4c-0ad9155bf0b3', 2025, 3, NULL,      13, 9,    10,   NULL, NULL, 0, 0, NULL, 0, 'pending', NULL, '2026-04-17 13:51:07.722104+00'),
  ('c1160524-f9fc-4e8f-8dac-abf24a421193', 2025, 3, NULL,      14, 11,   12,   NULL, NULL, 0, 0, NULL, 0, 'pending', NULL, '2026-04-17 13:51:07.722104+00'),
  ('32020799-a469-4fd4-8486-38c2de29f5af', 2025, 4, NULL,      15, 13,   14,   NULL, NULL, 0, 0, NULL, 0, 'pending', NULL, '2026-04-17 13:51:07.722104+00');

-- 4. Pipeline-meta freshness rows. Use NOW() so the staging "Updated Xs ago"
--    badge reflects when YOU synced, not when prod last refreshed.
INSERT INTO nhl_pipeline_meta (key, last_refresh) VALUES
  ('playoff_seeds',        NOW()),
  ('playoff_series',       NOW()),
  ('player_playoff_stats', NOW());

-- 5. Verify counts (expects 16 / 15 / 3)
SELECT 'seeds'  AS tbl, count(*) FROM nhl_playoff_seeds  WHERE season = 2025
UNION ALL
SELECT 'series' AS tbl, count(*) FROM nhl_playoff_series WHERE season = 2025
UNION ALL
SELECT 'meta'   AS tbl, count(*) FROM nhl_pipeline_meta;

COMMIT;
