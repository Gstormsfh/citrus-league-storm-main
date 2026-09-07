# Residual diagnosis and bounded-prior comparison

## Diagnosis

The later fold's recent-candidate same-clock sample contains 285 shots, seven
goals and 37.192 xG. Only 7.758 excess xG occurs before sufficient training
history; 22.434 remains after support is available. The highest-probability
decile accounts for 8.045 excess xG, while the other rows account for 22.146.
The error is therefore neither only a startup problem nor only a few extremes.

For each supported fit, the checked stationarity equation is
`sum(adjusted training probabilities - targets) + 10 * offset = 0`.
Negative offsets therefore retain positive training residuals under the fixed
ridge. This establishes a mechanical shrinkage effect, not proof that reducing
the penalty improves future predictions.

Diagnostic: `scripts/proof/results/recent-residual-diagnosis-20260907-full`.
Health SHA-256:
`e5b7ba1ffa39243c43d5359a272462842ce73ceedce66e6681653ae2405a6c1e`.
Code/tests: `scripts/proof/diagnose_recent_residuals.py` and its matching test file.

## Single declared experiment: do not promote

The [bounded-prior plan](analytics-bounded-timing-prior-plan-20260907.md) changed
only the offset penalty, equally across all four bands. Training membership,
90-day chronology, support rules, baseline probabilities and held-out/recovered
populations remain identical. No parameter sweep was run.

| Original fold | Ridge-recent Brier → bounded prior | Ridge-recent log loss → bounded prior |
| --- | --- | --- |
| Fold 1 | 0.061002465698 → 0.061002486481 | 0.224631878943 → 0.224629929848 |
| Fold 2 | 0.059212396121 → 0.059201420401 | 0.218619668932 → 0.218579958567 |

The first-fold Brier regression is only approximately 2.08e-8, but it still
fails the declared strict no-worsening point guard. Do not revise that rule
after observing this result. This does not establish a statistically meaningful
difference; it records the predeclared decision and preserves the trade-off.

Later-fold same-clock xG improves from 37.192 to 16.935 against seven goals.
However, later-fold one-second and two-second bands worsen on both losses, and
the three-to-ten-second band worsens on log loss despite a Brier improvement.
Three expanded-population months per fold worsen on at least one loss. All
monthly/band scorecards remain saved. Aggregate goal-count alignment alone is
not a sufficient acceptance criterion.

The ungated ridge-recent candidate and its verified full-vector replay remain
the reference. The alternative is retained as a non-promoted experiment.

## Verification

Result: `scripts/proof/results/bounded-timing-prior-20260907-full`.
Health SHA-256:
`8f6207c54be7c21ab35f511ca62e96f7b40397761c098e45d2aa021ae29a748f`.
Runner/tests: `scripts/proof/run_bounded_timing_prior.py`,
`scripts/proof/test_bounded_timing_prior.py`.
Separate checker: `scripts/proof/review_bounded_timing_prior.mjs`.

The Node checker independently verifies all output hashes, 244,259 scalar
predictions, 72 band-fit training memberships, chronological windows and convex
gradient residuals. Maximum scalar error is 1.388e-16; maximum gradient residual
is 2.221e-14. This is implementation verification, not prospective scientific
validation or an independent-agent review.

Five new focused tests pass across diagnosis and experiment. Full offline suite:
**3,594 passed**, 16 network tests deselected, 33 existing warnings. Receipt:
`scripts/proof/results/bounded-timing-prior-20260907-suite.xml`.

No original events, goal credits, feature families or models were deleted or
overwritten. Production is unchanged. Same-clock accuracy, other timing-band
regressions, finishing/talent exposure and FPAR acceptance remain open. No next
parameter sweep is implied by this result.
