# Calibration-shape development checkpoint

Status: another modest development improvement, **not accepted**. Production,
hosted databases, serving exports, previous evidence and prospective reservations
remain unchanged. No MoneyPuck files, predictions or fitted parameters were used.

## Frozen comparison and measured result

The [declaration](analytics-calibration-shape-plan-20260906.json) preceded this
real attempt. Source code was frozen at `7841a4ac`. The runner replayed the
unchanged earlier-development export, reused the pinned JSON raw models and
exactly reproduced all prior calibration and validation raw vectors. It did
not refit raw models, load legacy pickle/joblib or use the already-observed
2025 historical test. All four new maps fit calibration-period labels only.

This is an adaptive choice informed by earlier results on these same two
development folds, not new independent, untouched or prospective evidence.
The guard required no worse Brier **and** log loss in **each** fold against the
retained context-aware beta baseline. Equal-fold mean log loss then Brier
determined the eligible development ranking; no acceptance was automatic.

| Candidate | Mean Brier | Mean log loss | Fixed guard versus context-aware beta |
|---|---:|---:|---|
| Preserved sigmoid | 0.060797618 | 0.224239026 | Fails both losses in both folds |
| Preserved context-aware beta | 0.060716239 | 0.223930724 | Reference |
| Clipped isotonic | 0.060761018 | 0.224231122 | Fails both losses in both folds |
| Smoothed clipped isotonic | 0.060747977 | 0.224107700 | Fails both losses in both folds |
| Monotone piecewise logit | 0.060750487 | 0.224026883 | Fails fold 1 log loss and both fold 2 losses |
| Context-aware monotone piecewise logit | 0.060664316 | 0.223703918 | Passes; further development only |

The new shortlisted map's fold 1 Brier/log loss are 0.061228321 / 0.225414845;
fold 2 values are 0.060100310 / 0.221992991. Shortlisted-minus-reference Brier
differences are −0.000045940 (95% interval −0.000060539 to −0.000033442) and
−0.000057906 (−0.000068219 to −0.000047442). Log-loss differences are
−0.000168405 (−0.000210823 to −0.000127126) and −0.000285206
(−0.000345923 to −0.000219307).

These are the unchanged 256 paired whole-game resamples, conditional on fitted
models. They do not account for refitting, adaptive model selection, multiple
comparisons or future generalization. Proper losses measure more than
calibration alone. Smoothing improves the clipped-isotonic point losses in both
folds, but neither isotonic candidate beats the retained beta baseline.

## Calibration weaknesses remain visible

The complete review preserves six candidates, all reliability bins, every
paired comparison and all 77 subgroups in each fold across all eight original
dimensions. Missing subgroups/bins/candidates, duplicate subgroups and incomplete
population partitions are rejected. Shortlist-versus-reference changes were
inspected across every subgroup, not just the favorable ones.

- In the 0.20–0.35 probability bin, observed-minus-predicted gaps improve from
  −0.035347 to −0.032371 in fold 1 and from −0.036061 to −0.027729 in fold 2.
  Both new intervals remain below zero. The 0.35–0.50 bin also remains
  overpredicted: −0.048781 / −0.063229, with both intervals below zero.
- The 0.05–0.10 bin remains underpredicted: +0.004026 / +0.007475, despite
  smaller gaps. Fold 1's 0.10–0.20 gap worsens slightly to −0.012006, and its
  highest bin changes from roughly balanced to underprediction (+0.064605).
  Predictions move between bins; these are not identical-bin-member causal
  comparisons. Sparse intervals remain unavailable rather than invented.
- Fold 1 expects 9,120.21 goals against 8,648 observed, versus the reference's
  9,130.08. Fold 2 expects 8,516.89 against 8,478, versus 8,529.64. Both improve
  aggregate bias, but fold 1 still overpredicts about 472 goals.
- Prior-same-team-SOG gaps improve only slightly to −0.010268 / −0.008300.
  This recorded context is not confirmed rebound or possession identification.
  Fold 2 unknown prior-SOG context remains strongly underpredicted (+0.062123).
- Both losses worsen for 3v3 and bat shots in both folds. Empty-net log loss
  worsens in both folds, and empty-net Brier worsens in fold 2, even though its
  mean gap improves. Fold 2 slap-shot log loss worsens; fold 1 wrap-around
  losses worsen. These are retained diagnostic results, not new rejection
  thresholds invented after observing the data.
- The shortlist has worse subgroup Brier point estimates than the reference
  in 14 of 77 slices in each fold, and worse log loss in 13 / 11 slices.
  Overlapping slices are not independent trials and these counts are not
  significance tests. Rink identity comparisons remain descriptive, not
  causal recording-bias estimates.

All non-shortlisted candidate statistics remain available. Calibration shape
alone has not resolved source/population shifts or established reliable
player-level, goalie, exposure, forecast or fantasy outputs.

## Cross-language and source closure

Python JSON raw inference exactly reproduces the pinned calibration/validation
vectors in both folds. The new TypeScript map proof checks every new candidate
on all 120,080 and 121,033 validation rows. The maximum discrepancy across all
new maps is 3.33e-16; the context-aware shortlist's maximum is 2.22e-16. Both are
below the predeclared 1e-12 absolute tolerance. The smoothed-isotonic map has
zero measured discrepancy on this exact raw-input comparison.

This composes with the [prior full-cohort feature-to-TypeScript-tree proof](analytics-calibration-result-20260906.md).
The new bridge specifically receives source-bound raw probabilities and context;
it does not independently reparse PBP or rerun TypeScript trees. The scorer is
not serving-exported. Missing context and unseen categories are still distinct;
the original 840 unseen shot-type values in fold 1 validation remain counted.

The completed runner reverified consumed source, code and prior artifacts.
The separate full review rehashed 12,848 bound files, including its experiment
inputs and complete output inventory. It copies completed scorecards; it does
not claim an independent statistical recomputation. Twenty-two experiment files
(including health) and the full review remain in their create-only result roots.

The [compact index](analytics-calibration-shape-result-index-20260906.json)
pins health, result and the 31,005,803-byte full review. The separate
[local archive receipt](analytics-calibration-shape-checkpoint-archive-20260906.json)
records exact member and hash verification. No originals were
removed. Local duplication is not off-machine disaster recovery.

The archive binds source commit `406c10b3`, all 23 new evidence files and 2,111
tracked source members. Closing independent checks matched both new compressed
archive hashes and all three indexed result/review hashes. A separate check
also matched the 46 prior legacy/first-experiment/archive/result-index hashes,
including all 17 inventoried legacy artifacts and the original reservation.

Before fitting: 1,658 offline Python tests passed, 16 network tests deselected,
with 33 existing datetime warnings. Shared TypeScript type checking and all
284 shared tests passed. Archive/review verification passed 30 tests (18 new
shape-review checks plus 12 preserved archive/review checks). Test counts are
implementation evidence, not model quality claims.

## Research lineage and next mission lane

The smoothed-isotonic candidate uses plateau representatives and monotone cubic
interpolation, motivated by Jiang et al. Midpoint representatives, clipped tails
and output bounds are explicit Citrus choices; the paper's experiments are not
claimed as reproduced. Its goodness-of-fit criterion was not adopted as an
acceptance rule. [Primary paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC3248752/).

The monotone piecewise-logit family is an original Citrus implementation with
fixed logit knots, nonnegative slopes, identity-centered and adjacent-slope
penalties, and optional existing context offsets. It is not an implementation
claim for SplineCalib. [Lucena's primary abstract](https://arxiv.org/abs/1809.07751).
The independent cubic coefficients follow the documented PCHIP construction.
[SciPy 1.13.1 reference](https://docs.scipy.org/doc/scipy-1.13.1/reference/generated/scipy.interpolate.PchipInterpolator.html).

Do not immediately start another validation-driven calibration search. Preserve
this shortlist and baseline, then prioritize the remaining local end-to-end
model → explicit variant/lineage → publication → actual consumer proof. A local
fixture must never mislabel unaccepted development output as passed production
foundation evidence. Include stale/missing/unseen context, duplicate identities,
complete population and corrections/rollback; keep any aggregate population
distinct from full-season official actuals.

Then resolve writer/event/TOI/season/legacy-parameter and operational gaps in
[the acceptance record](ANALYTICS_ACCEPTANCE.md). FPAR remains gated on validated
physical forecasts, supported scoring categories, common horizon, eligibility
and feasible joint replacement allocation. Preserve the entire
[method map](analytics-method-preservation-20260906.md), including flurry,
talent, goalie, opportunity and uncertainty—not just the latest xG candidate.
No new approval is needed for bounded local tests; hosted writes, promotion,
paid resources and unconfirmed data rights remain outside the overnight scope.
