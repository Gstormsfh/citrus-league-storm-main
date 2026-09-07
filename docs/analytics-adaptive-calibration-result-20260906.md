# Temporal calibration: two completed, rejected challengers

Date: 2026-09-06. Local development only. Both challengers fail the fixed
no-regression guard; neither replaces the frozen baseline. This is not xG,
foundation, new-metric, FPAR or industry-superiority acceptance.

## Measured outcome

Lower Brier and log loss are better. Goal bias is predicted minus observed
goals on the identical eligible event population, not official season actuals.
The baseline is the retained context-aware monotone-logit development map.

| Development validation window | Model | Brier | Log loss | Goal bias |
|---|---|---:|---:|---:|
| 2022-07-01–2023-06-30 | Frozen baseline | 0.0612283213 | 0.2254148455 | +472.206 |
| Same | Rolling intercept | 0.0611769499 | 0.2253272113 | +44.189 |
| Same | Conservative selective intercept | 0.0612131170 | 0.2253838273 | +361.067 |
| 2023-07-01–2024-06-30 | Frozen baseline | 0.0601003101 | 0.2219929914 | +38.890 |
| Same | Rolling intercept | 0.0601023111 | 0.2220044423 | −30.348 |
| Same | Conservative selective intercept | 0.0601004576 | 0.2219934391 | +38.578 |

Fold 1 has 120,080 eligible attempts in 1,378 games and 8,648 goals; fold 2 has
121,033 attempts in 1,383 games and 8,478 goals. Both probability losses improve
in fold 1 and worsen in fold 2 for both challengers. The selective fold-2 loss
increases are small: approximately 0.000000148 Brier and 0.000000448 log loss.
They fail the predeclared point-estimate rule; this does not establish
statistically significant inferiority.

The selective model changes predictions on 157 of 222 fold-1 dates but only
two of 230 fold-2 dates. Each fold has six sparse-history dates with exact
baseline fallback. The other 59 and 222 dates respectively select a zero offset.
No threshold was tuned to remove the two losing dates.

The useful finding is limited: lagged global correction can reduce the large
first-period aggregate bias, but has not solved conditional calibration or
demonstrated a consistently better xG model. The second candidate retains
substantial mid/high-bin overprediction. For example, its 0.35–0.50 bin has
observed-minus-predicted gaps of −0.04060 and −0.06322 in folds 1 and 2.
Those are descriptive within-candidate bins, not matched fixed-bin causal effects.
All months, original bins and 77 overlapping subgroups per fold remain in the
scorecards, including regressions; subgroup counts are not independent tests.

## What was implemented and actually executed

The [first fixed plan](analytics-prequential-calibration-plan-20260906.json)
was declared before its real-data run. A single intercept adjusts frozen
probabilities using a rolling 60-day history, a two-day simulated label lag,
ridge 100 and bounds of −1.5 to +1.5. All games on one date share a state.
For target date D, the eligible history is D−62 < game date ≤ D−2. At least
1,000 events and 20 games are required; otherwise the baseline is retained
exactly. Earlier calibration rows seed the simulation; lag-eligible earlier
validation labels enter subsequent states. No raw model or original map is refit.

After inspecting that result, the [second fixed plan](analytics-selective-calibration-plan-20260906.json)
adds one uncertainty-scaled L1 penalty. Its scale uses centered whole-game
residuals with a Bernoulli variance floor and a fixed multiplier of two. This
is regularization, not a confidence interval or guaranteed false-update control.
There was no lookback, multiplier, ridge or subgroup parameter sweep. The second
design is explicitly adaptive development informed by the first result.

The first runner freshly replays original official body/receipt captures through
unchanged source gates and feature projection for every original calibration and
validation game in both folds. Cohort/source/feature digests and raw probabilities
match the saved evidence exactly; validation calibrated vectors also match
exactly. Applying the saved map to seed rows is new inference: no prior saved
seed calibrated vector exists, so that comparison correctly remains unavailable.

The second runner composes with that fresh proof. It rehashes the complete first
output inventory and consumed inputs, joins exact event/date/target/base and
prior-candidate vectors, and preserves the failed first challenger in every
comparison. It does not claim another independent raw-source replay.

Independent Python audits reconstruct every daily history and compare scalar
fits against a separate Brent-root solver; the second also independently
rebuilds its game-residual penalty. Flipping labels on and after a mid-validation
date leaves every earlier and same-day prediction unchanged in both folds.
The [separate JavaScript review](analytics-adaptive-calibration-review-20260906.json)
recomputes 312 overall/subgroup cohorts and 7,020 model reliability bins across
both result sets, with maximum absolute point-statistic discrepancy about
1.06e−10. It rehashes 12,898 bound files. It does not independently recompute
bootstrap intervals, AUC, average precision, raw feature parsing or model fits.

## Limits that remain binding

These are already-inspected earlier seasons, not an untouched test. Source
revisions are current captures; game-date-plus-two-days only simulates label
availability, not historical completion, ingestion or revision timestamps.
The original whole-game paired intervals condition on realized predictions;
they do not replay adaptation and omit cross-date training dependence, refit
uncertainty and the effects of adaptive selection. No acceptance relies on them.

[Park et al.](https://proceedings.mlr.press/v108/park20b.html) and
[Alexandari et al.](https://proceedings.mlr.press/v119/alexandari20a.html)
motivate distinguishing covariate and label shifts and checking calibration
assumptions. These Citrus supervised simulations implement neither paper's
algorithm and do not assume the conditions for a label-shift correction hold.
No MoneyPuck files, fitted constants or predictions were used. Legacy binary
artifacts were hashed only, never deserialized.

Rebound/flurry work and the wider [method-preservation inventory](analytics-method-preservation-20260906.md)
remain intact. Observed-chain accounting is not prospective possession value.
Rebound creation still needs separately fitted and chronologically validated
continuation/outcome models; this checkpoint did not fit them. FPAR still needs
accepted source identity, appearance/TOI, physical forecasts and feasible
replacement allocation. Neither more tests nor passing local transport can
substitute for those evidence gates.

The next modeling direction should address source/context and conditional-shape
weaknesses, with explicit prediction-time information and independent target
definitions for auxiliary metrics. Do not keep tuning this global intercept on
the same losing dates. A complete new adaptive pipeline would require its own
future evaluation reservation; all six original reservations remain unchanged.

## Verification and preservation

Latest full offline Python suite: 1,853 passed, 16 network tests deselected,
33 pre-existing datetime warnings. The combined targeted suites pass 133 tests;
these overlap the full suite and must not be added to it as unique coverage.
The earlier first-challenger checkpoint retains 1,829 full and 80 targeted passes.

One initial selective synthetic test used a signal stronger than its intended
zero-offset threshold: gradient 4 exceeded 2√3.2. The test-only fixture was
corrected to gradient 2 below 2√1.6 before any real selective fit. No fitter,
plan or real-data result changed. The initial one-failure/23-pass output remains
in task history, and its correction is recorded in verification notes; no initial
XML was requested. Both real experiment executions completed without a harness
failure. Their candidate-quality guards failed and remain failed.

The [fresh integrity receipt](analytics-adaptive-calibration-integrity-20260906.json)
verifies all 62 separately named prior/result/archive pins, including legacy
artifacts and original reservations. No original evidence, actual, receipt,
experiment, serving selector or hosted database was rewritten. Production is
unchanged. New source is frozen by file hashes and rechecks, not a new commit:
the current workspace policy makes Git metadata read-only.

The [evidence index](analytics-adaptive-calibration-index-20260906.json) binds both
completed runs, declarations, code, independent review and test receipts.
The [archive receipt](analytics-adaptive-calibration-archive-20260906.json)
records an additive local byte snapshot, with originals retained. It is not an
off-machine backup, full runtime reproduction, Git commit or model acceptance.
