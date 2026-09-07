# Original-style zone/quality matched result

The declared candidate **fails**. Original-style zone/quality inputs were restored
on top of all corrected movement inputs, but this fitted extension did not
improve both proper losses against both frozen controls in both folds. No model
or production promotion follows; original actuals and prior evidence remain.

Plan: `analytics-zone-context-plan-20260906.json`. Complete create-only run:
`scripts/proof/results/official-zone-context-20260906-full/`.

| Fold | Predictor | Brier | Log loss |
|---|---|---:|---:|
| 1 | Frozen neutral | 0.061228321278 | 0.225414845483 |
| 1 | Frozen movement | 0.061126887867 | 0.225094608780 |
| 1 | Zone/quality primary | 0.061139692775 | 0.225087347344 |
| 2 | Frozen neutral | 0.060100310127 | 0.221992991437 |
| 2 | Frozen movement | 0.060101756184 | 0.221965315122 |
| 2 | Zone/quality primary | 0.060115215281 | 0.221990932829 |

Fold 1's primary worsens Brier versus movement. Fold 2 worsens both losses
versus movement and Brier versus neutral. The raw and sigmoid alternatives are
retained, not selected as fallback winners. A failed fit does not establish that
the original hypothesis is useless or license removing original inputs.

## What was restored and verified

The new prior-same-team-attempt context adds six numeric original-style zone
measurements and one zone category. It uses explicit common-frame geometry and
the original strict positive, at-most-three-second context window. This is
recorded-event context, not measured passes or goalie tracking. The experiment
retains original development features and corrected movement measurements.

The runner replays source bytes, retains all appended vectors, verifies exact
frozen control predictions, and checks portable JSON raw inference on calibration
and validation rows within its predeclared tolerance. Complete scorecards retain
all populations, difficult groups, bins and paired fixed-prediction intervals.

Independent JavaScript review completed under
`zone-context-candidate-review-20260906-full/`: 12,905 checked files; 13,338 and
13,296 point comparisons in the two folds. Maximum arithmetic discrepancy was
below 3e-12. This independently checks fixed-fit points, not bootstrap generation,
AUC/AP, optimizer correctness, historical availability or production routes.

The independently reconstructed source-vector sample also matches:
`zone-source-vector-review-20260906-full/report.json` records 45 games, 3,849
selected rows, 115,470 numeric and 3,849 categorical comparisons. Prior-attempt
identity and elapsed time were reconstructed separately; pair arithmetic uses
the frozen, separately tested modules. This is sampled provenance evidence,
not a second full-corpus feature implementation.

An additional sampled inference experiment is deliberately retained as **failed**
under `zone-inference-batch-review-20260906-full/`. Raw predictions matched at the
point checked, but a bitwise calibrated singleton comparison differed by
2.60208521e-18, consistent with floating-point rounding. It does not establish an
end-to-end bitwise batch-parity pass. The original runner's tolerance-based raw
inference check is separate and unchanged; the failed reviewer is not rewritten.

A separate v2 diagnostic subsequently passed on 64 sampled events per fold:
`zone-inference-batch-review-v2-20260906-full/report.json`. It declared raw
comparisons exact and calibrated comparisons at absolute tolerance 1e-12, zero
relative tolerance, before execution. Raw comparisons all matched exactly;
calibrated singleton maximum discrepancies were 8.67e-18 and 1.04e-17. Saved,
reversed and duplicated calibrated comparisons matched exactly. This resolves
the numerical diagnostic within an explicit tolerance, not the failed model
quality gate or any production-route validation.

## Remaining gates

Reused development folds and repeated candidate selection are not an untouched
test or proof of industry superiority. Conditional calibration remains under
separate development review. Recorded penalty context, true active-penalty
clocks, rink transforms, actual shift membership and downstream xA/rebound/
flurry/talent/GAR/FPAR quantities retain their distinct evidence requirements.
The prospective reservations are untouched.
