# Timing shape experiment: mixed result, not promoted

The declared slope-plus-intercept extension improves the second original fold but worsens the first. It therefore fails the two-fold point guard. The verified intercept-only recent-timing reference remains unchanged.

| Original cohort | Recent Brier | Shape Brier | Recent log loss | Shape log loss |
|---|---:|---:|---:|---:|
| Fold 1 | 0.061002465697801454 | 0.061013315741946156 | 0.22463187894349046 | 0.22468035069901796 |
| Fold 2 | 0.05921239612098902 | 0.059165620112409445 | 0.21861966893179718 | 0.21843494515318887 |

The expanded-population one-second band worsens on both losses in both folds. Same-clock performance improves in fold 2 but worsens in fold 1. These subgroup results further rule out describing the experiment as an across-the-board improvement. Reliability bins remain in the scorecards. These inspected historical comparisons are adaptive development evidence, not prospective results or proof of statistical significance.

## Verified progress remains

The prior [recent-timing experiment](analytics-recent-timing-result-20260907.md) improved both original-fold losses against its frozen control:

- Fold 1 Brier: 0.0610400709898065 → 0.061002465697801454; log loss: 0.22478314266736085 → 0.22463187894349046.
- Fold 2 Brier: 0.059483063387925035 → 0.05921239612098902; log loss: 0.21968725162696034 → 0.21861966893179718.

Those gains are modest, verified offline gains—not production impact or an industry-leading comparison. Neither this failure nor the rejected shooter experiment overwrites that candidate. Its complete feature-vector replay and source-bound finishing bridge remain preserved.

## Evidence

- Plan fixed before results: `docs/analytics-timing-shape-plan-20260907.md`.
- Runner/tests: `scripts/proof/run_timing_shape.py`, `scripts/proof/test_timing_shape.py`.
- Result: `scripts/proof/results/timing-shape-20260907-full`.
- Health SHA-256: `6080f762775b5486d1561bf42935ddcc8b4a62f678a696c960c42474ffeeead5`.
- Independent scalar review: `node scripts/proof/review_timing_shape.mjs`; all 244,259 predictions and 72 band fits checked, with exact original-only earlier-window membership. Maximum probability discrepancy 2.220446049250313e-16; maximum projected-gradient residual 6.777044427863643e-7, below the declared implementation tolerance.
- Full offline suite: 3,621 passed, 16 network tests deselected, 33 existing warnings. Receipt: `scripts/proof/results/timing-shape-20260907-suite.xml`.

No parameter sweep or post-result rule change was performed. No production, original inputs, model selection, actuals or MoneyPuck data were changed. Original-feature coverage, prospective validation and consumer acceptance remain open. Further work should prioritize the existing candidate's unresolved source/consumer contracts rather than accumulating additional parameter trials on these same folds.
