# Recent timing adaptation — completed experiment

The [single declared experiment](analytics-recent-timing-plan-20260907.md) improves
both original-fold probability losses against the frozen ridge-10 control. It
also improves both recovered-only losses. No raw features, raw model or production
state changed; no window/penalty sweep was performed.

| Original validation population | Control → recent Brier | Control → recent log loss |
| --- | --- | --- |
| Fold 1, 120,080 shots | 0.061040071 → 0.061002466 | 0.224783143 → 0.224631879 |
| Fold 2, 121,033 shots | 0.059483063 → 0.059212396 | 0.219687252 → 0.218619669 |

Original-population paired game-bootstrap intervals for candidate-minus-control
Brier are [-0.000066035, -0.000010219] and [-0.000322694, -0.000214615]. These
are descriptive fixed-prediction intervals, not refit uncertainty or correction
for adaptive historical experiment selection.

Recovered-only Brier changes from 0.057547159 to 0.057462446 in fold 1 and from
0.053072750 to 0.052747554 in fold 2. Recovered log loss also improves. Recovered
events were evaluated only and never trained the new offsets.

No expanded-population month regresses on either reported loss; the first month
is unchanged by design. All timing-band results are retained, including failures.

## What changed, and what did not

Four logit offsets use only earlier original-population games in the preceding
90 calendar days, resetting the window at each month boundary. The same fixed
ridge and minimum support requirements apply throughout. The saved prequential
control prediction for each training event is used, not an in-sample prediction
from the new offset. Insufficient support falls back to the exact control.

Of 244,259 original-plus-recovered predictions, 223,580 remain exactly unchanged.
The candidate does not alter neutral geometry, movement, pass proxies, strength,
finishing/talent quantities, flurry credits or raw event clocks. It is not a
claim that recorded times measure physical goalie movement exactly.

## Remaining weaknesses

In expanded fold 2, three-to-ten-second follow-ups move from 471.35 to 646.67 xG
against 649 goals. That aggregate alignment alone is not proof of cell calibration.
Same-clock follow-ups improve from 63.15 to 37.19 xG against seven goals but remain
badly overpredicted. One-second follow-ups improve from 352.29 to 189.57 against
135 goals, also still high. The >1–<3-second band regresses on both losses in
fold 2. Original-fold overall bias improves in fold 1 but becomes slightly more
negative in fold 2. These prevent treating this as complete model acceptance.

## Verification

Result: `scripts/proof/results/recent-timing-experiment-20260907-full`.
The declaration, monthly fitted offsets and complete training keys, prediction
rows, scorecards and source/code closure are saved create-only. Both original
fold-level point guards pass. Historical model-development periods are still
adaptive development data, not untouched holdouts.

Four focused tests pass. Full offline regression: **3,580 passed**, 16 network
tests deselected, 33 existing warnings. Receipt:
`scripts/proof/results/recent-timing-experiment-20260907-suite.xml`.

Separate Node checker: `scripts/proof/review_recent_timing.mjs`. It verified all
output hashes, all 244,259 scalar predictions, 72 timing-band fit/support records,
declared training-key membership within saved windows and convex-fit gradients.
Maximum prediction error: 1.666e-16; maximum gradient residual: 2.304e-14.
It does not independently verify physical shot clocks or recompute bootstrap
resamples and is not a separate agent's scientific sign-off.

The reused bootstrap helper's JSON labels say `calibrated_minus_raw_brier` and
`selected_recovered_population`. In this experiment its arguments are explicitly
candidate versus control, evaluated separately on each named population. Read the
intervals accordingly; do not describe original-population intervals as recovered
samples or the control as the uncalibrated tree. Original JSON is preserved.

Next acceptance work must retain the new candidate as a separate comparator,
investigate the remaining timing-cell regressions and package any later candidate
with the same exact date/source binding. No production activation or FPAR acceptance
follows from these development improvements.
