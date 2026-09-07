# Targeted scoring improvement from last-season diagnostics

## What the deeper audit found

The 242 same-timestamp events are not simply removable duplicates: 95 have different shooters, 78 involve more than ten feet of recorded displacement, and only 14 share identical coordinates. None of these facts proves or disproves duplication by itself. All attempts and actual goals are retained. The model category is an immediate same-team SOG followed by another attempt at the same integer timestamp, not verified instantaneous puck travel or possession continuity.

The same weakness exists in the **earlier 2023–24 development predictions**: 279 same-timestamp events, 7 goals and 41.39 predicted goals. Earlier 5-on-4 predictions also overestimate: 16,883 shots, 1,597 goals and 1,669.34 xG. These earlier residuals support targeted corrections independently of the 2025–26 goal totals.

## Implemented change

Two narrow **post-model log-odds adjustments**, fitted with the existing fixed ridge penalty of 10 to earlier 2023–24 original-population prequential ensemble predictions:

- Same timestamp after a same-team SOG: offset **-1.0310503055710196**.
- 5-on-4: offset **-0.051326773248359325**.

For a matching shot, add the applicable offset to the frozen ensemble's log odds, then transform back to probability. Add both once when both conditions apply. Every other shot keeps its exact original prediction. These are learned scoring adjustments, not input feature-importance percentages, tree retraining, or deletion/relabeling of events. They do not assert that a timestamp is a physically accurate rebound interval.

Coefficients were not fitted to 2025–26 outcomes. However, the hypotheses were chosen after inspecting 2025–26, making the following result an **adaptive development retest, not untouched holdout confirmation**.

## Retest on identical 2025–26 shots

| Metric | Frozen ensemble | Same-timestamp only | 5-on-4 only | Both adjustments |
|---|---:|---:|---:|---:|
| AUC ↑ | 0.7600721918 | 0.7606416760 | 0.7602316840 | **0.7608012635** |
| Brier ↓ | 0.0609663595 | 0.0609364109 | 0.0609469327 | **0.0609176999** |
| Shot-level correlation ↑ | 0.2912415787 | 0.2918824114 | 0.2914224259 | **0.2920577973** |
| Log loss ↓ | 0.2253035687 | 0.2251584389 | 0.2252424384 | **0.2250995356** |
| Ten-bin calibration ECE ↓ | 0.0074836771 | 0.0073237053 | 0.0073275010 | **0.0071719947** |

The combined Brier-change interval from 2,000 paired whole-game bootstrap samples is **[-0.0000604855, -0.0000368118]**. It is exploratory and not corrected for adaptive hypothesis selection or multiple comparisons.

Both changes contribute separately; the combined point scores are best among these declared tests. This does not establish optimal coefficients or universal subgroup improvement.

| Diagnostic slice | Actual goals | Frozen ensemble xG | Adjusted xG |
|---|---:|---:|---:|
| Same timestamp | 4 | 30.90 | 12.20 |
| 5-on-4 | 1,504 | 1,678.64 | 1,602.36 |

Residual overprediction remains. The categories overlap and are not additive. Fast-lateral and close-range residuals from the prior evaluation remain further investigation targets; this change does not declare them solved.

## Verification and artifacts

- Raw-event audit: `scripts/proof/results/same-timestamp-audit-20260907.json`.
- Fitting and retest: `scripts/proof/test_targeted_last_season_adjustments.py`.
- Coefficients, exact training event keys, training predictions, all retest predictions and scorecards: `scripts/proof/results/targeted-earlier-adjustments-20260907/`.
- Executable full-feature inference: `scripts/proof/targeted_xg_inference.py`.
- Full-feature replay: `scripts/proof/results/targeted-full-feature-replay-20260907/`.
- **116,506 predictions reproduced**, maximum absolute difference **1.1102230246251565e-16**. **100,585 shots remain exactly unchanged**.
- Four focused tests passed: unaffected-shot identity, timestamp eligibility, overlap applied once and invalid probability rejection. Receipt: `scripts/proof/results/targeted-xg-tests-20260907.xml`.
- Independent scalar metric calculations and earlier-fit gradients verified in `independent-review.json`.

The same original 32 quarantined games remain excluded; no coverage restriction was introduced to manufacture a gain. The original frozen candidate and prior evaluation remain preserved. **Production is unchanged.** A current-date training/serving integration and separately declared future evaluation are still required before live deployment or an industry-leading claim.
