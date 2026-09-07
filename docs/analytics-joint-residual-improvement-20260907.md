# Joint residual xG correction — development evidence

This experiment compares against the previous strongest timestamp-plus-5v4 ridge10 candidate, not against an unadjusted weak baseline. Production is unchanged. All recorded events and actual outcomes are preserved.

## What changed

Fit overlapping category corrections jointly on the original 2023–24 prequential ensemble predictions. The base model is unchanged. Reduce the fixed coefficient penalty from ridge10 to ridge1, allowing the earlier observations to support a stronger rare-category correction. Two arms were declared before execution: timestamp plus 5v4; and those two plus fast lateral movement and under-10-foot shots. Neither fit uses 2025–26 outcomes.

Four-category coefficients, added to base log odds when eligible:

| Existing input category | Learned log-odds correction |
|---|---:|
| Same-team prior shot on goal at identical recorded timestamp | -1.672545 |
| 5v4 | -0.029833 |
| Same-team immediate event, elapsed 0–3 seconds, lateral displacement at least 10 feet | -0.388055 |
| Shot distance under 10 feet | +0.048963 |

These are conditional residual adjustments, **not percentages of final xG or replacements for the underlying shot features**. Overlapping categories enter one fitted model. Unmatched events remain exactly unchanged. Identical integer-second timestamps do not establish literal simultaneous shots or the goalie's position. The lateral feature describes recorded event movement, not verified pass or goalie tracking.

## Last-season results

116,506 eligible shots, retaining the existing source gates and exclusions. Latest-season hypotheses were selected after inspecting this season: this is an adaptive development retest, not untouched confirmation.

| Metric | Previous strongest candidate | Joint four-category candidate |
|---|---:|---:|
| AUC, higher better | 0.7608012635 | 0.7628528382 |
| Brier, lower better | 0.0609176999 | 0.0608500792 |
| Shot-level probability/outcome correlation, higher better | 0.2920577973 | 0.2930818728 |
| Log loss, lower better | 0.2250995356 | 0.2246116595 |
| Equal-width 10-bin calibration error, lower better | 0.0071719947 | 0.0060605345 |
| Mean probability minus goal rate | +0.0017630281 | +0.0006728012 |

Exploratory paired-game bootstrap 95% interval for Brier change: [-0.0001115017, -0.0000216983], from 2,000 fixed-seed draws. This does not account for adaptive hypothesis selection or establish AUC/correlation significance.

| Category | Actual goals | Previous expected goals | New expected goals |
|---|---:|---:|---:|
| Same timestamp | 4 | 12.203 | 6.293 |
| Fast lateral | 621 | 917.998 | 684.004 |
| 5v4 | 1,504 | 1,602.358 | 1,614.072 |
| Under 10 feet | 2,212 | 2,457.143 | 2,464.592 |

Categories overlap; do not add their totals. The power-play and close-range aggregate biases worsen slightly. The earlier-season data support a small positive close-range residual after accounting for overlap, not indiscriminate downweighting. No parameters were forced to match latest-season goal totals.

The two-category weaker-penalty arm improved AUC/Brier/correlation slightly but worsened calibration error, and its Brier interval crossed zero. The four-category arm is the useful result, not merely lowering the timestamp penalty.

## Reproduction and evidence

- `scripts/proof/test_joint_residual_adjustments.py`: create-only experiment, source hash verification, chronological separation, joint fitting, numerical gradient check, candidate scores and game bootstrap.
- `scripts/proof/results/joint-residual-adjustments-20260907/`: declaration, fitted parameters, predictions, summary, source bindings and completion health.
- `scripts/proof/test_joint_residual_units.py`: eligibility/missing/boundary tests, overlap/identity check, regularization direction check.
- `scripts/proof/joint_residual_inference.py`: hash-bound offline scorer, independent scalar metric recomputation, and full-vector replay.
- `scripts/proof/results/joint-residual-full-replay-20260907/`: completed replay receipt and independently recomputed metrics. All 116,506 full-vector predictions reproduced exactly (maximum probability error zero); 82,537 unaffected events remained exactly unchanged. All three focused unit tests passed.

This is a measured offline scoring improvement, not a demonstrated production improvement, untouched-season generalization result, or industry-leading accuracy claim. Finishing/talent layers and FPAR are not changed by this experiment.
