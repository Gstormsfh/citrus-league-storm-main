# Stronger recent candidate — full-vector replay complete

The ungated [recent-timing candidate](analytics-recent-timing-result-20260907.md)
now has an explicit offline inference wrapper and completed full-vector replay.
This is integration/reproducibility evidence, not another accuracy improvement.

All **244,259 original-plus-recovered predictions** replay exactly:

| Population | Events | Maximum baseline error | Maximum recent-candidate error |
| --- | --- | --- | --- |
| Fold 1 expanded | 121,749 | 0 | 0 |
| Fold 2 expanded | 122,510 | 0 | 0 |

The replay uses certified saved full movement vectors for the original population
and corrected raw-reconstructed vectors for recovered games. It is not a new
raw-event reconstruction of the entire original population. Both source closures
are verified. Eighteen dated adjustment sidecars bind the original frozen base
bundles to the completed recent-timing fit receipts.

## Contract

`scripts/proof/recent_timing_inference.py` accepts full feature rows, runs the
frozen base model/calibrator and derives the timing category from that same
feature vector. Caller-supplied timing bands and outcome labels are not used.
It binds the base fingerprint, source health identity, exact month and 90-day
training window, band support and finite bounded offsets. Sparse bands preserve
the baseline exactly. Training-game replay, duplicate rows, mismatched files,
dates and production-use declarations are rejected. The API accepts features,
not an already-adjusted prediction as a substitute for features.

This is a local proof module, not a deployed service. Validation of a declared
training-end date alone does not authenticate history: the runner additionally
pins the experiment/source closure. The earlier separate scalar review checked
actual training membership and fitted gradients. No fitting occurs in this replay.

## Evidence

Runner: `scripts/proof/replay_recent_candidate.py`.
Result: `scripts/proof/results/recent-candidate-replay-20260907-full`.
The manifest binds each base bundle and sidecar file hash. Prediction rows retain
raw xG, baseline neutral xG, adjusted neutral xG and artifact fingerprints.

Six new focused tests pass. Full offline regression: **3,589 passed**, 16 network
tests deselected, 33 existing warnings. Receipt:
`scripts/proof/results/recent-candidate-replay-20260907-suite.xml`.
An additional Node check verifies all output hashes, exact original/expanded
membership, and bit-for-bit raw/baseline/recent probability equality against the
completed experiment. This is not a new independent scientific validation.

The rejected [past-loss gate](analytics-timing-loss-gate-result-20260907.md) is not
included. Remaining same-clock overprediction, band regressions, finishing/talent
exposure and FPAR gates remain open. No production activation, new fit, parameter
search or deletion of original evidence occurred.
