# Executable selected-timing xG candidate

Implemented in `scripts/proof/selected_timing_candidate.py`. This is a full-feature offline model candidate, not merely a score-table selection. It preserves the frozen raw model, movement features and existing calibration; the dated selector chooses the recent offset or shape calibration using only earlier original-population outcomes. Shape is applied to the baseline probability, never compounded onto the recent offset.

## Verified result

Create-only evidence: `scripts/proof/results/selected-timing-replay-20260907-v2-full`.
Health SHA-256: `f295d9ab4f2eba2d3627b832b3709d8ee58ac7dbe002f370863d1be0bd40f78b`.

All 244,259 full-feature predictions replayed against frozen expected predictions, with maximum absolute difference 1.1102230246251565e-16. Source dependency closure verified before and after execution; output file hashes independently checked with Node. Existing actuals and frozen model artifacts were not modified. The earlier incomplete first output directory is retained without a completion receipt.

Original-population losses (lower is better):

| Period | Recent Brier | Selected Brier | Recent log loss | Selected log loss |
|---|---:|---:|---:|---:|
| Fold 1 | 0.061002465697801454 | 0.061002465697801454 | 0.22463187894349046 | 0.22463187894349046 |
| Fold 2 | 0.05921239612098902 | 0.05917868749486365 | 0.21861966893179718 | 0.2184762725293142 |

Targeted tests: 12 passed, receipt `scripts/proof/results/selected-timing-tests-20260907.xml`. Tests cover exact reference preservation, caller-band overrides, selection ties, recovered/current-month outcome rejection, sparse-fit rejection and avoiding double calibration. No refit or parameter search was performed.

## Boundary

The second historical period improves modestly; the first is unchanged. This selection rule was developed after inspecting historical results: earlier-only simulation does not make this untouched validation. No prospective accuracy, production improvement or industry-leading performance is established. Bundles remain explicitly offline-only and date-bounded; they must not be applied directly to current production games. Production model parameters remain unchanged. This adapter preserves rather than resolves the separate finishing/talent and broader feature-coverage gates.
