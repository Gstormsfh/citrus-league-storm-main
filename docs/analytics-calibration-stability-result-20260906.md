# Calibration stability: development guard passed, not promoted

Expanding calibration improved aggregate Brier and log loss in both declared
forward-time development periods. Both fixed-fit paired log-loss intervals
exclude zero; Brier intervals cross zero. This is useful evidence for testing
the update policy further, not proof of uniformly better calibration or
production readiness.

## What actually ran

The [immutable plan](analytics-calibration-stability-plan-20260906.json) retained
the frozen raw movement model, all 47 numeric and two categorical inputs, and
the existing conditional calibration settings. The fixed comparator used the
saved earlier-half map. Expanding maps added only calibration games preceding
each future monthly test block. The first block reused the initial map for both
outputs; nine later blocks fitted new maps. No raw-model, shooter or separate
global-intercept fitting occurred, and no parameters or split ratios were tuned.

Only the later halves of the original calibration periods were scored: five
blocks with 60,815 events in the earlier fold and six blocks with 60,952 in the
later fold. The latter begins with the partial January 16–31 block. Source
integrity/reuse may read outer artifact bytes and reconstruct rows, but outer
validation outcomes did not enter this study's fits, scores or policy selection.
The historical periods are not newly blinded; one earlier validation period
overlaps a later calibration period from prior experiments.

## Results

Lower is better. The unchanged guard required both aggregate losses to be no
worse in each fold; it did not require every month to improve.

| Fold | Policy | Brier | Log loss |
|---|---|---:|---:|
| Earlier | Fixed | 0.060647355 | 0.223862340 |
| Earlier | Expanding | 0.060639236 | 0.223782258 |
| Later | Fixed | 0.061112338 | 0.224972074 |
| Later | Expanding | 0.061102253 | 0.224904065 |

Expanding-minus-fixed differences and paired 95% whole-game intervals:

| Fold | Metric | Difference | Interval |
|---|---|---:|---|
| Earlier | Brier | −0.000008119 | [−0.000022663, +0.000005831] |
| Earlier | Log loss | −0.000080082 | [−0.000146020, −0.000021909] |
| Later | Brier | −0.000010085 | [−0.000026785, +0.000007075] |
| Later | Log loss | −0.000068009 | [−0.000126798, −0.000008815] |

These intervals condition on saved fitted maps. They omit fitting and adaptive
selection uncertainty and serial dependence beyond individual games. Expanding
history changes calibration support and recency together; no causal separation
between those effects is established.

## Weaknesses that remain

March Brier worsened in both periods: +0.000002253 and +0.000016170. June blocks
have only 15 and five games and remain explicitly sparse; they were not removed.
The earlier June block contributes substantially to the aggregate Brier gain,
so that small overall gain should not be oversold. Log-loss gains also occur
outside June. Passing the aggregate rule is not uniform monthly superiority.

Both folds still show underprediction in their 0.05–0.10 probability bands and
overprediction below 0.01. These are retrospective calibration diagnostics, not
permission to fit band-specific corrections to these outcomes. Prior-SOG and
other context gains are not uniformly replicated; missing context remains
retained. The original talent/finishing families are not discarded or certified
by this neutral-calibration study.

## Next gate

Freeze the tested update rule before evaluating another forward period. Verify
that every update's labels were available before its cutoff, and bind each
prediction to its raw model, source and map version. A changed pipeline needs
its own prospective reservation; the existing reservation binds different
baseline models and must remain unchanged. Its future window starts September
15, 2026, so it does not supply completed future evidence today.

The historical freeze includes later seasons, but the
[earlier neutral-model plan](analytics-first-neutral-experiment-plan-20260906.json)
already designated 2024–25 calibration and 2025–26 test data without an
untouched-history claim. Do not call
them newly untouched simply because this policy has not yet scored them.
Further historical development may continue under a new declared design, with
honest selection history; genuine prospective acceptance requires future data.
No automatic production, downstream finishing, uncertainty or GAR/FPAR
acceptance follows from this result.

## Evidence and checks

- Completed study: `scripts/proof/results/official-calibration-stability-20260906-full/`.
  Health SHA-256:
  `a46bd245f67e43c45950a4a593679e8b1ce610fca361b3fc88819c360ebf7718`.
- Independent review: `scripts/proof/results/calibration-stability-review-20260906-full/`.
  Health SHA-256:
  `fa296db11b74ee61fc1e82aea7ff71186cbe27978cdf1b4a8bc6136bf07dde47`.
  It verified 13,122 file hashes and 48,142 point comparisons with maximum
  absolute disagreement below 9.10e-13. It did not independently refit maps or
  recompute bootstrap intervals, AUC or average precision.
- Focused Python tests: 33 passed, including genuine first-block source replay,
  future-label isolation and actual-run preflight failure preventing all fits.
  Independent JavaScript tests: 18 passed.
- Full offline suite: 3,034 passed, 16 network tests deselected and 33
  deprecation warnings. Receipt:
  `scripts/proof/results/calibration-stability-20260906-suite.xml`.

Source, settings, prior attempts and reservations are preserved. Production is
unchanged. New maps and their full training/test receipts remain local evidence.
