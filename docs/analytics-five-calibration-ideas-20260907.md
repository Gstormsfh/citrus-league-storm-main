# Five targeted accuracy experiments

## Outcome

None of the five candidates improves both Brier score and log loss in both historical periods relative to the strongest current offline candidate. All are rejected for promotion. Production is unchanged. This is not evidence that the raw model cannot improve; it rejects these five specific residual calibration designs.

## Fixed comparison

The reference is the earlier-only selected recent/shape candidate. Every new monthly fit uses only original-population outcomes from the preceding 90 days, at least 100 events and 30 games, fixed ridge 10, and no current-month outcomes. Recovered rows never train. The same original and recovered events are scored for every candidate. Raw-model inputs and frozen predictions remain unchanged.

Five ideas: scoring-rate intercept correction; confidence/temperature adjustment; slope-plus-intercept (Platt) calibration; asymmetric beta calibration; global plus pooled rebound-timing intercept corrections. These are five residual model changes, not five raw-model retrainings. They are practical targeted hypotheses, not a demonstrated ranking of the five best possible improvements.

Changes relative to reference; negative is better:

| Candidate | Fold 1 Brier delta | Fold 1 log-loss delta | Fold 2 Brier delta | Fold 2 log-loss delta |
|---|---:|---:|---:|---:|
| Rate offset | -0.0000085064 | +0.0000035835 | +0.0000133529 | +0.0000423184 |
| Temperature | -0.0000016658 | +0.0000096316 | +0.0000066599 | +0.0000068187 |
| Platt | -0.0000104795 | -0.0000000258 | +0.0000168453 | +0.0000394447 |
| Beta | -0.0000073917 | +0.0000071160 | +0.0000169489 | +0.0000396972 |
| Pooled timing offsets | -0.0000069826 | +0.0000012444 | +0.0000479279 | +0.0002204196 |

The first-period Platt log-loss gain is negligible, and its paired uncertainty interval includes zero. No first-period improvement should be described as established. Paired whole-game bootstrap intervals (1,000 fixed-seed resamples) are retained for both metrics; they are exploratory, not adjusted for five comparisons. These historical folds have been adaptively inspected and are not untouched validation.

## Evidence and reproducibility

- Runner: `scripts/proof/test_five_calibration_ideas.py`.
- Completed, create-only evidence: `scripts/proof/results/five-calibration-ideas-20260907-v3/`.
- `declaration.json`: fixed design and runner hash recorded before evaluation.
- `summary.json`: original, recovered and expanded population scores, deltas and intervals.
- Per-fold files preserve all predictions and monthly parameters/training-support receipts.
- `health.json`: hashes of completed output files.
- Independent checker: `scripts/proof/review_five_calibration_ideas.mjs`.
- `independent-review.json`: 1,221,295 candidate predictions checked, maximum probability difference 2.220446049250313e-16; all population losses, reference choices and dated training membership reproduced.

Two incomplete numerical-solver attempts remain in the unsuffixed and v2 directories, without completion receipts. The final run evaluates the same five designs, uses a numerically stable loss difference, and independently checks the projected gradient of the strictly convex bounded objective rather than trusting a line-search status string. No metric-based parameter changes were made between attempts.
