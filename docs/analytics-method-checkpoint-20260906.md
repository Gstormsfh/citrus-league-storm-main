# Public-method applications: measured development checkpoint

Status: **no model or FPAR accepted; production unchanged**. The public-file study
produced concrete independent experiments and forecast safety corrections.
The main candidates did not pass their fixed quality rules. A shooter-only
ablation is promising, but it is not a validated neutral-xG improvement.

## Study became testable work

The [MoneyPuck dictionary inspection](analytics-moneypuck-schema-inspection-20260906.md)
reads all 124 named fields and separates context, later outcomes, identifiers
and fitted predictions. The [primary-source gap matrix](analytics-public-method-gap-20260906.md)
maps MoneyPuck, Evolving Hockey and other preserved research to actual Citrus
implementations. No MoneyPuck shot rows, predictions or fitted parameters were
used in these training runs. The wider method-preservation map remains intact.

## Matched probability results

Lower is better. These are already-inspected chronological **development**
folds, not untouched or peer-matched tests. Every comparison retains the same
eligible event membership: first fold 120,080 attempts; second fold 121,033.

| Predictor | Fold 1 Brier | Fold 1 log loss | Fold 2 Brier | Fold 2 log loss |
|---|---:|---:|---:|---:|
| Frozen neutral baseline | 0.061228321 | 0.225414845 | 0.060100310 | 0.221992991 |
| Neutral strength specialists, sigmoid | 0.061358999 | 0.226187350 | 0.060256753 | 0.222706102 |
| Identity-free intercept control | 0.061228325 | 0.225414857 | 0.060100316 | 0.221992994 |
| Shooter-conditioned ablation | 0.061215094 | 0.225242286 | 0.060093080 | 0.221913537 |
| Joint shooter/goalie primary | 0.061230635 | 0.225294055 | 0.060112510 | 0.221993432 |

Exact values and all controls are retained in the
[strength result](../scripts/proof/results/official-strength-partition-20260906-1731/result.json)
and [identity result](../scripts/proof/results/official-identity-probability-v2-20260906-1742/result.json).
Strength specialists lose to the frozen baseline in both folds; they also lose
to their matched pooled-sigmoid control in the first fold. Sparse defending-net
and unclassified states remain explicit pooled fallbacks, not deleted rows.

The joint identity primary fails first-fold Brier and both second-fold losses
against both reference models. Shooter-only improves both point losses in both
folds, but was declared as an ablation, not a fallback winner. Its Brier paired
intervals include zero in both folds; its second-fold log-loss interval also
includes zero. These intervals hold fits fixed and omit actor cross-game
dependence, refit uncertainty and development-selection multiplicity. The result
supports further shooter-forecast research, not a superiority or causal talent
claim. It must not replace neutral xG used to evaluate goalies.

## Numerical and independent validation

The first identity attempt stopped at its raw-gradient convergence guard before
validation scoring. V2 changes numerical coordinates, not the likelihood,
penalties, bounds or raw-gradient threshold. Calibration-only diagnosis, v1
code and failed partial outputs remain retained. Both full v2 folds then pass
independent sparse objective/gradient and scalar inference checks.

The [independent JavaScript review](../scripts/proof/results/method-challenger-review-20260906-1755/review.json)
recomputes proper-score point estimates, all reliability bins, subgroup
membership and paired point differences; baseline event/label/group/probability
parity is exact. It rehashes 12,951 local files. It does not rerun bootstrap
intervals, AUC/AP or model fitting. The source actors remain retrospective, and
identity fitting stacks on a map calibrated on the same earlier period rather
than cross-fitted nuisance predictions.

One frozen metadata defect is explicitly retained: the generic identity
scorecard's `prediction_scope` still says neutral probability. That label does
**not** describe its shooter/joint predictors. The independent review flags it;
the model contracts and this interpretation govern meaning. Do not consume that
generic label as a serving contract or silently rewrite frozen evidence.

## End-to-end progress and limits

The [daily engine correction](analytics-live-model-gap-20260906.md) stops missing
xG becoming zero, preserves opponent-side ownership and withholds invalid team
exposure. The [actual nightly parent](analytics-nightly-forecast-health-20260906.md)
now blocks writes and ROS rebuilds after missing/invalid workers or unverified
existing-row reuse. Partial write requests cannot report full success. Verified
team elapsed exposure, source completeness, freshness-aware reuse and atomic
publication are still missing; **do not deploy these withholding changes as-is**.

The [FPAR adapter](analytics-fpar-foundation-adapter-20260906.md) calls the actual
ScoringCalculator, binds evidence/scope and performs feasible unique-player
replacement allocation. It stays non-serving with synthetic tests: no real
validated full-horizon physical forecast provider or foundation verifier exists.

Saved verification at
[`method-verification-20260906.ERLcq5`](../scripts/proof/results/method-verification-20260906.ERLcq5/):
2,009 offline Python tests pass, 16 network tests excluded; 206 targeted Python
tests overlap that coverage; 29 FPAR tests and shared typechecking pass. Two
independent-review JavaScript tests pass. An explicit tests-directory PYTHONPATH
entry is currently needed for the frozen strength test's sibling import; this
environment workaround does not alter fitted evidence. No new dependencies were
installed. The 33 Python warnings concern existing naive UTC APIs.

## Next bounded work

Prioritize first-party penalty-age reconstruction, rebound/continuation label
adjudication, and verified shift/venue joins over another undirected parameter
search. Retain the shooter-only result for an explicitly new forecast evaluation
plan, not post-hoc primary promotion. Resolve the team-exposure and freshness
provider before enabling the corrected nightly path, then validate physical
forecasts and actual league FPAR. All original actuals, rejected candidates and
six prospective reservations remain preserved. New variants have no inherited
right to the old prospective reservation.

The [additive local archive receipt](../scripts/proof/results/analytics-method-checkpoint-20260906-1755/receipt.json)
binds selected current working-tree source, all new completed/failed model
attempts, the dictionary inspection and saved tests/review. Prior pins and the
independent review's local hash closure are rechecked during preservation. This
is a local duplicate, not an off-machine backup, runtime reproduction or new
Git commit; original evidence remains in place.
