-- Phase 0c breaker v3: split the failure taxonomy.
--
-- 'ambiguous_unresolvable' — bounded rapid-fire class. Coord-backstop
-- fires where the greedy time-nearest matcher can't find a perfect
-- assignment within the time window (systematic MoneyPuck arena-
-- adjustment discrepancy on crease-vicinity shots, or genuine
-- rapid-fire time-collision the matcher can't distinguish). Terminal —
-- skipped on resume; retrying deterministic ambiguity is wasted API.
--
-- 'match_integrity_fail' — everything else that fails the game closed:
-- provenance-gate violations, unexplained divergence over cap,
-- partial-assignment anomalies.
--
-- Breaker v3 (in orchestrator, not this migration) counts only
-- match_integrity_fail + error toward abs/consecutive/rate; new fourth
-- condition ambiguous_unresolvable rate > 10% at n≥100 halts the
-- season on its own — honesty is bounded.

ALTER TABLE phase0c_progress DROP CONSTRAINT phase0c_progress_status_check;
ALTER TABLE phase0c_progress ADD CONSTRAINT phase0c_progress_status_check
  CHECK (status IN (
    'pending', 'in_progress', 'complete',
    'match_integrity_fail', 'ambiguous_unresolvable', 'error'
  ));

COMMENT ON COLUMN phase0c_progress.status IS
  'pending | in_progress | complete | match_integrity_fail | ambiguous_unresolvable | error';
