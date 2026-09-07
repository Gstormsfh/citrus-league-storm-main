# Recovered-shot frozen xG evaluation

The corrected [feature reconstruction](analytics-reviewed-feature-reconstruction-20260907.md)
has now been passed through the existing dated, frozen raw-model/calibrator
bundles. All **3,146 recovered shots in 36 games** were scored exactly once.
No fit, parameter search, original cohort replacement or production change occurred.
Reviewed non-shot goal credits remain outside these prediction rows.

## Recovered-only results

Lower Brier score and log loss are better. Bias is mean predicted probability
minus observed goal rate; positive values mean overprediction.

| Development fold | Shots / games / goals | Raw → calibrated Brier | Raw → calibrated log loss | Calibrated xG / goals |
| --- | --- | --- | --- | --- |
| Fold 1 | 1,669 / 19 / 108 | 0.057710 → 0.057547 | 0.216177 → 0.215601 | 113.821 / 108 |
| Fold 2 | 1,477 / 17 / 93 | 0.054499 → 0.053073 | 0.205074 → 0.200419 | 100.479 / 93 |

The calibrated-minus-raw Brier differences are -0.000163 and -0.001426.
Exploratory paired game-bootstrap 95% percentile intervals are respectively
[-0.000439, +0.000141] and [-0.002160, -0.000804], using 2,000 draws and seed
60907. Fold 1's interval crosses zero. This is not a prospective acceptance test:
the recovered games were selected by source discrepancies and the surrounding
model development already inspected these historical periods.

Both recovered samples remain overpredicted: probability bias +0.003487 and
+0.005063. For shots immediately after a same-team recorded SOG, calibrated bias
is +0.019097 over 236 shots in fold 1 and +0.018295 over 216 shots in fold 2.
Five-on-four slices also remain overpredicted. Sparse shot-type and strength
slices are retained in the scorecards rather than treated as stable conclusions.
The results support retaining calibration for further validation, not claiming
the weaknesses are solved or fitting another map on these outcomes.

## Expanded development population

Original and recovered game memberships are disjoint. Expanded totals are
121,749 shots in 1,397 games for fold 1 and 122,510 shots in 1,400 games for fold 2.
The expanded calibrated Brier scores are 0.060992 and 0.059406, with log losses
0.224657 and 0.219455. **Changes relative to original-population metrics are not
model improvements:** the evaluation population changed while the model stayed
fixed. Original scorecards and predictions remain untouched.

Game coverage does not imply complete shot coverage: the separate missing-angle
event remains excluded. The three withheld first-fold games are unchanged.

## Evidence and checks

Runner: `scripts/proof/evaluate_recovered_xg.py`; tests:
`scripts/proof/test_evaluate_recovered_xg.py`.
Result: `scripts/proof/results/recovered-xg-evaluation-20260907-full`.
Health SHA-256:
`5b946d8ffe2adbaa8e74530971706a285b30a7971d116d4e9bb82af328109bd9`.

The run verifies the complete consumed feature/model source closures, exact
schema, unique dated bundle selection, original/recovered game disjointness,
original target joins and complete prediction membership. Contexts come from
the same input feature vectors as inference. Each output row records source
feature hash, dated bundle path/hash, raw probability and calibrated probability.
Original, recovered and expanded scorecards are saved separately, with recovered
calibration bins and context slices.

Seven focused tests pass. Full offline suite: **3,558 passed**, 16 network tests
deselected, 33 existing warnings; receipt
`scripts/proof/results/recovered-xg-evaluation-20260907-suite.xml`.
A separate Node calculation verified all output hashes, all recovered target and
feature joins, recovered loss/bias arithmetic and weighted expanded metrics.
Maximum arithmetic discrepancy was 2.132e-13. This did not independently rebuild
the tree model or bootstrap draws and is not a separate agent's scientific review.

## Remaining gates

Recovered-source end-to-end inference is complete. Overall model acceptance is
not: first-fold bias and timing/strength weaknesses remain, as do complete
appearance/TOI and validated finishing-talent exposure, downstream FPAR gates and
production rollout validation. Do not describe the descriptive finishing ratios
as persistent talent or claim industry-leading accuracy from this result.
