-- Phase 0c: PbP replay for 7 moat features across 8 historical seasons
-- (2017-18 → 2024-25). Per-game checkpoint table so a long-running batch
-- can be resumed idempotently and audited afterward. See:
--   apps/web/docs/PHASE_0_EXECUTION_PLAN.md § 0c
--   apps/web/docs/PHASE_0B_DIAGNOSTIC.md (0b's fail-stop + fail-closed
--     patterns 0c inherits)
--   scripts/utilities/replay_pbp_for_moat.py (orchestrator)
--
-- Status transitions (per-game):
--   pending → in_progress → complete            (happy path)
--                        → match_integrity_fail (order-match vs coord-verify
--                                                disagreed; no UPDATE performed)
--                        → error                (fetch / extract exception;
--                                                error_detail carries the trace)
--
-- Idempotency: orchestrator claims a game by UPSERTing (game_id, status,
-- attempted_at). Games already 'complete' are skipped on rerun. Games in
-- 'in_progress' from a killed run are re-claimed and re-attempted (safe
-- because the actual raw_shots UPDATE is a single batched round-trip per
-- game that either completes or doesn't).
--
-- Read-only fallback: `SELECT status, COUNT(*) FROM phase0c_progress
-- GROUP BY status;` gives an instant health check.

CREATE TABLE IF NOT EXISTS phase0c_progress (
  game_id       bigint PRIMARY KEY,
  season        int NOT NULL,
  status        text NOT NULL CHECK (status IN
                  ('pending','in_progress','complete',
                   'match_integrity_fail','error')),
  rows_matched  int,
  rows_updated  int,
  nhl_unmatched int,
  db_unmatched  int,
  has_pass_count int,
  error_detail  text,
  attempted_at  timestamptz,
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_phase0c_progress_season_status
  ON phase0c_progress (season, status);

COMMENT ON TABLE phase0c_progress IS
  'Phase 0c per-game checkpoint. See apps/web/docs/PHASE_0_EXECUTION_PLAN.md § 0c.';
COMMENT ON COLUMN phase0c_progress.status IS
  'pending | in_progress | complete | match_integrity_fail | error';
COMMENT ON COLUMN phase0c_progress.rows_matched IS
  'Rows successfully order-matched AND coord-verified against staging raw_shots.';
COMMENT ON COLUMN phase0c_progress.nhl_unmatched IS
  'NHL events extracted but with no DB peer (508 blocks + dedupe-seconds + unexplained).';
