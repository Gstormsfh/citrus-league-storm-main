# Distance-by-time xG correction: promising challenger, calibration regression

## Change tested

Replace the single fast-lateral residual correction with a distance/time grid. Existing continuous distance, longitudinal movement, lateral movement, elapsed time, angular change and rate features remain in the base model. The grid adjusts its residual errors; it is not the entire xG model.

- Lateral distance: [0,5), [5,10), [10,20), [20,40), [40,infinity) feet.
- Time: recorded zero, (0,1], (1,3], (3,10] seconds.
- Eligibility: same-team immediate recorded event with finite, nonnegative movement and elapsed time.
- Same-clock is a separate category, never infinite speed. Missing movement is not zero movement.
- Jointly retain same-timestamp prior-shot, 5v4 and under-10-foot corrections.
- Fit only on 2023–24 prequential ensemble predictions; no 2025–26 outcomes used in fitting.
- Fit supported categories with ridge3 shrinkage toward the earlier coarse correction. Require at least 100 earlier events, five goals and five non-goals. Unsupported cell coefficients retain the coarse value; shared coefficients can still change their final prediction.

The bins and support rules were declared before executing this experiment. They are physical cutoffs, not outcome-selected quantiles. The earlier coarse fit and grid fit use the same earlier season, so this is not an independently tuned shrinkage prior.

## Verified development results

Comparison is against the previous joint-four candidate on the same 116,506 eligible 2025–26 shots. This season has already informed hypotheses: **adaptive development retest, not untouched holdout**.

| Metric | Previous joint-four | Distance/time grid |
|---|---:|---:|
| AUC, higher better | 0.7628528382 | 0.7650463242 |
| Brier, lower better | 0.0608500792 | 0.0606475280 |
| Shot-level outcome correlation, higher better | 0.2930818728 | 0.2986660852 |
| Log loss, lower better | 0.2246116595 | 0.2239233900 |
| Calibration error, 10 equal-width bins, lower better | 0.0060605345 | 0.0067679597 |
| Mean probability minus goal rate | +0.0006728012 | +0.0013515466 |

Independent scalar calculations reproduced every metric. Exploratory paired-game bootstrap 95% interval for Brier change: [-0.0002541914, -0.0001514984]. It does not correct for adaptive selection.

Original fast-lateral category: 621 actual goals, previous 684.004 expected, grid 715.023 expected. **Its aggregate bias worsens**, despite better overall ranking, Brier and log loss. This is not a clean replacement or a completed calibration fix.

Selected disjoint category diagnostics:

| Lateral movement / recorded time | Events | Actual goals | Previous xG | Grid xG |
|---|---:|---:|---:|---:|
| Under 5 ft / positive to 1 second | 2,207 | 109 | 171.81 | 113.04 |
| 5–10 ft / positive to 1 second | 1,153 | 48 | 99.31 | 45.66 |
| 20–40 ft / positive to 1 second | 886 | 17 | 49.68 | 20.16 |
| 10–20 ft / over 1 to 3 seconds | 1,864 | 293 | 240.16 | 319.14 |
| 40+ ft / over 1 to 3 seconds | 1,080 | 32 | 59.87 | 48.66 |

These observational categories do not hold shot type, location or prior-event type constant. They are **not causal evidence that a longer completed pass makes a chance worse**. Event-to-event coordinate change is not verified pass travel or actual goalie displacement. The 40+ ft / positive-to-1-second cell had only three goals in the earlier fit season and retained the old cell correction instead of learning an unstable new one.

## Artifacts and disposition

- `scripts/proof/test_lateral_time_grid.py`: declared experiment, chronological/data/hash checks, joint fitting, independently checked scores, per-cell diagnostics.
- `scripts/proof/results/lateral-time-grid-20260907/`: fit, predictions, all 20 cells, scores and completion health.
- `scripts/proof/test_lateral_time_grid_units.py`: four passing tests covering the user's distance examples, zero time, missing/wrong-team values and one-hot boundaries.
- `scripts/proof/lateral_grid_inference.py`: hash-bound, date-bounded offline full-feature scorer.
- `scripts/proof/results/lateral-time-grid-replay-20260907/`: completed full-feature replay; all 116,506 predictions reproduced exactly, maximum probability error zero.

Keep as a challenger; production and the previous candidate remain unchanged. Next required work is earlier-only calibration validation plus prior-event-type/shot-location checks for the unusual recorded movement cells, not forcing latest-season expected totals to equal actuals.
