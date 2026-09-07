# Event-memory candidate: completed, not accepted

This is an additive first-party event-history experiment, **not a reconstruction
of the complete original Citrus model**. See the
[original-input parity audit](analytics-legacy-input-parity-20260906.md) for
features already implemented in Citrus but absent from the experimental baseline.

The fixed plan added prior event/attempt counts, prior same-team attempt
geometry/time, and observed strength-spell duration. The availability receipt
covers 541,067 unique eligible development events across 6,272 games. Original
cohorts, source actuals, baselines and reservations are retained.

| Fold / model | Brier (lower better) | Log loss (lower better) |
|---|---:|---:|
| 1 / frozen baseline | 0.0612283213 | 0.2254148455 |
| 1 / memory raw | 0.0612566997 | 0.2255766783 |
| 1 / memory sigmoid | 0.0612772960 | 0.2256150408 |
| 1 / memory monotone-group primary | 0.0612014803 | 0.2252962860 |
| 2 / frozen baseline | 0.0601003101 | 0.2219929914 |
| 2 / memory raw | 0.0604706672 | 0.2231126291 |
| 2 / memory sigmoid | 0.0603303576 | 0.2228301996 |
| 2 / memory monotone-group primary | 0.0601346905 | 0.2220373842 |

The primary improves both point losses in fold 1 and worsens both in fold 2.
It fails the declared both-fold guard. No post-result tuning or promotion.
This bundled experiment does not prove any individual feature useless or useful.

Evidence:

- `scripts/proof/results/official-event-memory-20260906-1803/`: frozen declaration,
  full source replay, feature availability/vectors, JSON models, predictions,
  all scorecards/subgroups/intervals, result and health.
- `scripts/proof/results/event-memory-review-20260906-1810/`: independent JS
  point/bin/subgroup arithmetic, exact baseline membership/predictions and
  12,876 checked file hashes. Maximum point discrepancy below 4e-12. This is not
  an independent refit, bootstrap replication or proof of source authenticity.
- `scripts/proof/results/event-memory-verification-20260906.wlwiM7/`: initial
  full offline suite 2,026 passed / 16 network deselected; 22 overlapping targeted
  tests; 6 additional geometry tests; 6 legacy diagnostic tests. Tests do not
  establish predictive superiority. XML files retain exact scopes.

Development periods have been inspected; these are not untouched/prospective
results. Fixed-fit uncertainty does not cover adaptive feature selection or
refitting. The six original future reservations remain separate and unchanged.
No MoneyPuck data/predictions were used. Production is unchanged.
