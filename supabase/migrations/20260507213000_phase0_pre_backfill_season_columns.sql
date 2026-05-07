-- Phase 0 / 0d-pre item #3: Backfill the `season` column on raw_shots,
-- player_shifts, and player_toi_by_situation.
--
-- These three tables have season = NULL on every row at the time this
-- migration is authored. The R7-2 baseline check
-- `raw_shots_season_populated` is the FAIL sentinel that flips PASS once
-- this lands. See:
--   apps/web/docs/PHASE_0_EXECUTION_PLAN.md
--   apps/web/docs/PHASE_0_VALIDATION_QUERIES.md § B.1
--   apps/web/docs/PRE_PHASE_0_BASELINE.md
--
-- Derivation:
--   NHL game_id encoding is YYYYNNNNNN where YYYY is the season start
--   year (e.g. 2025020001 = first regular-season game of 2025-26).
--   `game_id / 1000000` (integer division) yields the season as a
--   4-digit short form, matching the convention already used by
--   nhl_games / player_directory / player_game_stats / player_gar_components
--   (where 2025 = 2025-26 season).
--
-- Idempotency: every UPDATE is gated on `WHERE season IS NULL`.
-- Re-running this migration is a no-op on rows already populated.
-- Reverting the change is trivial (`UPDATE … SET season = NULL`)
-- if a downstream issue emerges, but the season values themselves
-- are derived deterministically from game_id and cannot be wrong.
--
-- Expected post-migration state:
--   raw_shots:                 season populated for ~99,394 rows (all 2025)
--   player_shifts:             season populated for ~351,759 rows
--                              (mix of 2024 + 2025; min game_id = 2024020740)
--   player_toi_by_situation:   season populated for ~66,042 rows (all 2025)

BEGIN;

UPDATE public.raw_shots
SET season = (game_id / 1000000)::int
WHERE season IS NULL;

UPDATE public.player_shifts
SET season = (game_id / 1000000)::int
WHERE season IS NULL;

UPDATE public.player_toi_by_situation
SET season = (game_id / 1000000)::int
WHERE season IS NULL;

COMMIT;
