# Forward shooter loss decomposition: calibration is the next priority

The completed, independently checked analysis locates the failed candidate's
loss in different stages across the two development periods. The global
adjustment worsens the earlier fold; the changed calibration map dominates the
later-fold regression. The shooter increment offsets some loss at the point
estimate, but its aggregate intervals still cross zero. No candidate has been
rescued or promoted, and no fitting or production changes occurred.

## Same-shot accounting

The [diagnostic specification](analytics-forward-shooter-decomposition-plan-20260906.md)
was fixed before execution. Brier and log-loss differences are calculated on
identical shots. Positive means worse; negative means better. The first three
rows in each fold sum to the total, apart from floating-point rounding.

| Fold | Loss component | Brier difference | Log-loss difference |
|---|---|---:|---:|
| Earlier | Map pipeline | +0.000013029 | +0.000087920 |
| Earlier | Global adjustment | +0.000046439 | +0.000124607 |
| Earlier | Shooter increment | −0.000012651 | −0.000119529 |
| Earlier | Total versus frozen | +0.000046817 | +0.000092997 |
| Later | Map pipeline | +0.000080488 | +0.000312889 |
| Later | Global adjustment | −0.000008824 | −0.000001742 |
| Later | Shooter increment | −0.000015778 | −0.000086633 |
| Later | Total versus frozen | +0.000055886 | +0.000224515 |

The earlier global Brier difference has a fixed-fit 95% game-bootstrap interval
of [+0.000035318, +0.000059450]. The later map-pipeline Brier difference has
[+0.000067050, +0.000095751], and its log-loss interval is
[+0.000257413, +0.000366408]. All four aggregate shooter-increment intervals
cross zero. These results prioritize calibration work; they do not establish
that player talent is useless or that a new talent estimator is validated.

The map-pipeline contrast includes changed calibration fitting support and
parameters, not an isolated causal effect of sample size. The shooter increment
compares whole fitted models, including separately fitted intercepts; it is
not a pure causal shooter coefficient.

## Where the loss appears

Bands are anchored to the same frozen conditional probabilities for every
candidate. The 0.05–0.10 band has positive map-pipeline Brier contributions in
both folds: +0.000007527 and +0.000014795 per full-fold event. Their intervals
exclude zero. The later fold's 0.10–0.20 and 0.20–0.35 bands contribute
+0.000025059 and +0.000028780 respectively, also with intervals above zero.

The earlier global Brier contribution is positive in every observed month;
the later map-pipeline Brier contribution is positive in every observed month.
These are descriptive patterns within the same inspected development data,
not independent replications or a license to tune month-specific corrections.

The broad `not_prior_same_team_sog` group contributes most of the overall
Brier regression in both folds (+0.000043709 and +0.000040167). The
`prior_same_team_sog` total intervals cross zero. Unknown prior-SOG context
remains a separate null group; it is not an unknown-shooter label and was not
filtered out. Do not blame a single rebound or talent feature for the entire
pipeline loss.

All observed cross-cells were retained: 211 in the earlier fold and 212 in the
later fold, of which 124 and 122 are sparse. Shared whole-game draws preserve
paired comparisons. Cell means count and exclude empty-cell draws; weighted
contributions use the full resampled fold denominator, including zero
contributions. Sparse and overlapping subgroup results remain exploratory.
The multinomial resampling implementation is separately declared; its intervals
are not byte-identical replays of the earlier scorecard's random draws.

## Next bounded model work

Prioritize a calibration-only rolling-origin study within the original
calibration periods. Keep the raw movement model, all inputs and the calibration
family/settings fixed. Initialize with the existing earlier-half map; compare
that unchanged map with an expanding-history map on later calendar blocks,
fitting each update only on strictly earlier dates. Exclude shooter/global
stacking and split-ratio search from this first study. Fail rather than silently
repair class, support or resource gates. This tests forward stability without
claiming to isolate sample-size versus recency causally.

Any later choice of calibration complexity, shrinkage or update policy must be
selected without the outer validation outcomes. The proposed study still needs
an explicit pre-fit declaration; it has not run. Do not simply remove the global
intercept or retune probability bands because the inspected folds suggest it.
Shooter-conditioned probabilities, neutral xG and constant finishing multipliers
remain distinct outputs.

The original candidate stays rejected. Untouched/prospective quality,
historical data availability, finishing uncertainty, daily forecasts and
GAR/FPAR acceptance remain open; this diagnostic does not close them.

## Reproducible evidence

- Runner: `scripts/proof/decompose_forward_shooter.py`.
- Output: `scripts/proof/results/forward-shooter-decomposition-20260906-full/`.
  Health SHA-256:
  `bea71403e62e107d2c1a515c781da5e8251301cf67c3661f98ff7cf67c438ffe`.
- Independent review:
  `scripts/proof/results/forward-shooter-decomposition-review-20260906-full/`.
  Health SHA-256:
  `d6c17d544f3326db6e3002dcfa0ad81cfac8064532f90dea01e794ac5996eba7`.
- Independent point review verified 13,046 file hashes and 8,470 comparisons,
  with maximum absolute disagreement 4.44e-16. It does not independently
  recompute bootstrap intervals or refit models.
- Focused Python suite: 57 passed; JavaScript reviewer suite: 26 passed.
  Full offline suite: 3,001 passed, 16 network tests deselected, 33 deprecation
  warnings. Receipt:
  `scripts/proof/results/forward-shooter-decomposition-20260906-suite.xml`.

Original source, failed attempts, fitted artifacts and the prior verified local
recovery checkpoint remain unchanged. New evidence is retained locally; this
is not a claim of a new off-machine backup.
