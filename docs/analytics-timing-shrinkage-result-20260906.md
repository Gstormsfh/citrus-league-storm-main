# Timing residual diagnosis — no new fit

Completed `scripts/proof/results/timing-shrinkage-audit-20260906-full` replays the saved monthly calibration models on their training inputs and compares training and later-test timing cells. No model, clock, target, membership or production behavior changed. All earlier evidence remains intact.

The audit checks the timing-offset score equation: at the penalized optimum, observed minus predicted training goals equals `100 × timing_offset`, within the original optimizer tolerance plus prediction-clipping bound. This identifies a training residual deliberately retained by regularization; it does not prove that reducing regularization improves future predictions.

## Findings

For the final fold-2 map (June 2024), using only its earlier training games:

- Same-clock follow-ups: 117 actual goals versus 163.03 predicted. The ridge equation implies approximately 46.03 excess predicted goals.
- One-second follow-ups: 493 actual goals versus 568.60 predicted. The ridge equation implies approximately 75.60 excess predicted goals.

There is also a substantial training-versus-later-period difference before any monthly updates. In the October 2023 map's one-second cell, the earlier training goal rate is 12.71%, versus 3.61% in the evaluated month. Its predicted test rate is 13.64%. Source composition and recording differences remain possible explanations; this does not establish physical clock semantics or causality.

Thus the remaining bias is not solely a prediction-code mismatch: some already exists on the calibration fit's own data, and the historical training population also differs from later observations. Training cohorts retain all original calibration events as later months accumulate. Sparse test cells, including June, remain marked and are not used as stand-alone evidence of predictive quality.

## Next controlled test

The smallest next experiment is a separately declared reduction in timing-offset regularization, with the same chronological cohorts, original slopes/penalties, raw model and monthly policy. Change only that factor; do not simultaneously introduce recency weighting or search many penalties. Require both losses to pass in both folds against the completed timing candidate, and retain subgroup regressions. No future-performance improvement is claimed by this diagnostic.

## Verification

Seven focused regression tests pass. The no-fit run validates all monthly timing-offset score equations. A separate Node arithmetic check verifies the saved output hashes and independently recomputes those equations. This is a solo diagnostic, not a new independent-agent review, model acceptance, or an FPAR gate pass.
