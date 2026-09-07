# Forward shooter experiment: execution history

The statistical specification remains the immutable
[forward-holdout plan](analytics-forward-shooter-movement-plan-20260906.json).
Execution failures are retained separately from predictive results. A passing
software suite is not evidence of improved predictive quality.

## First attempt: stopped before fitting

`scripts/proof/results/official-forward-shooter-movement-20260906-full/`
contains the failed attempt. Its `failure.json` SHA-256 is
`5d90ae212756bac3deab4689f50a4a592214c6a6ea4726a929f67248485c2225`.
No fold completed and no fit declaration or fitted outputs were produced.

The source verifier in `run_forward_shooter_movement.py` incorrectly equated
the movement row's `source_sha256` with the raw PBP body-byte digest. The
original compact export assigns the fingerprint of the entire adapted source
envelope; development export carries that value forward. These are different
hash domains. A correction must verify raw bytes against the pinned file and
receipt, independently reconstruct and verify the adapted envelope, and retain
the original per-event and actor attribution checks. It must not discard either
hash check or alter the statistical plan.

Before this execution, the offline suite passed 2,933 tests with 16 network
tests deselected and 33 deprecation warnings. Receipt:
`scripts/proof/results/forward-shooter-movement-20260906-full-suite.xml`.
The failure exposes a gap in that first suite's realistic source-verifier
coverage, despite its other chronology and inference checks passing.

The original runner and failed evidence remain unchanged. Any corrected
execution uses a separately named runner and a new create-only output directory.
Production is unchanged; this attempt yields no model-quality conclusion.

## Execution-only correction

`scripts/proof/run_forward_shooter_movement_v2.py` wraps the unchanged original
runner, pins its original bytes and the failed-attempt receipt, and replaces
only the source-role verifier. It verifies raw captured body bytes separately
from the reconstructed adapted-envelope fingerprint. Source event fingerprints
and original shooter/goalie attributions are still checked. The original
certification instant is reused; this is not newly established historical
availability.

The original 51 focused tests plus four author and seven independent correction
tests passed together (62). The independent tests use a genuine frozen game,
the real adapter and development projector, and saved actor records. They
reproduce the first failure and reject corrupted body bytes, receipts, event
hashes, actor IDs, and substitution of the raw-body digest for the envelope
digest. The statistical plan is unchanged. The new create-only execution is
`scripts/proof/results/official-forward-shooter-movement-20260906-retry1/`.
The corrected full offline suite passed 2,944 tests with 16 network tests
deselected and 33 deprecation warnings; receipt:
`scripts/proof/results/forward-shooter-movement-20260906-retry1-suite.xml`.
