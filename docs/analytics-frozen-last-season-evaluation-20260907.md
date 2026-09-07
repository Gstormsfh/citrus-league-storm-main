# Frozen candidate tested on 2025–26

## Result

The previously built **fixed 50/50 ensemble improves AUC, Brier, shot-level correlation, log loss and ten-bin calibration error** over its frozen existing-model component on the included last-season shots. The refreshed component alone improves several metrics but lowers correlation; the fixed blend performs better overall. No percentage, tree, calibration map or timing offset was fitted or changed using 2025–26 outcomes.

| Metric | Frozen existing component | Frozen refreshed component | Frozen 50/50 ensemble |
|---|---:|---:|---:|
| AUC ↑ | 0.7591034681 | 0.7596754337 | **0.7600721918** |
| Brier ↓ | 0.0610611110 | 0.0610603049 | **0.0609663595** |
| Shot-level Pearson correlation ↑ | 0.2901692733 | 0.2886109871 | **0.2912415787** |
| Log loss ↓ | 0.2257459694 | 0.2255588966 | **0.2253035687** |
| Ten-equal-width-bin calibration ECE ↓ | 0.0077612728 | **0.0073801186** | 0.0074836771 |
| Mean predicted minus observed probability | +0.0039670941 | +0.0010980619 | +0.0025325780 |

The ensemble-minus-existing paired whole-game Brier interval from 2,000 fixed-seed bootstrap samples is **[-0.0001429801, -0.0000481130]**. This is an exploratory interval, not multiplicity-adjusted inference. No separate significance claim is made for AUC or correlation.

## What was frozen and what was tested

- Latest existing component snapshot: fold 2, June 2024, including its already-selected shape calibration.
- Refreshed symmetric model: the saved fold-2 XGBoost model, saved conditional calibration, and its June 2024 timing offsets.
- Exact ensemble weights: 0.5 existing + 0.5 refreshed, unchanged from the prior experiment.
- Evaluation: July 2025 through August 2026, NHL 2025–26 regular season and playoffs, excluding shootouts and retaining the original unblocked-attempt/geometry/source eligibility rules.
- Both sets of timing parameters remain constant throughout this season. This is a **forward evaluation of the last frozen snapshot**, not rolling recalibration on last-season goals. Existing date-bound replay/serving guards were not edited; a separate explicitly nonpublishing evaluation adapter applies the pinned parameters.

The comparison is against the frozen component developed in this mission, **not a verified replay of currently deployed production xG**. The captured data and source diagnostics had previously been inspected, so this report does not claim a pristine, untouched holdout. Candidate fitting and weight selection did not consume these season outcomes in this evaluation.

## Coverage

The official frozen schedule contains 1,394 terminal games. **1,362 games and 116,506 shots, including 8,348 goals**, pass the unchanged checks. **32 games remain excluded** because frozen final attempt totals disagree; no gate was weakened and no exception was silently introduced. Thus this is not a claim of complete all-game season coverage. Full game inventory and excluded IDs are retained.

## What the results identify for improvement

| Slice | Shots | Actual goals | Ensemble xG | Finding |
|---|---:|---:|---:|---|
| Same-clock prior-SOG events | 242 | 4 | 30.90 | Large overprediction; Brier worsens versus existing component. Small goal count requires care. |
| 5-on-4 | 15,737 | 1,504 | 1,678.64 | Material overprediction and worse Brier; higher-volume regression than the rare timestamp slice. |
| Fast lateral recorded events | 7,174 | 621 | 928.45 | Brier improves versus existing component, but substantial overprediction remains. |
| Shots under 10 ft | 16,806 | 2,212 | 2,492.54 | Brier improves, but close-range probabilities remain too high on average. |

These slices overlap; their errors must not be added as independent totals. Fast lateral means an immediate same-team recorded event within three seconds and at least ten feet lateral displacement, not observed pass or goalie tracking. Same-clock does not prove instantaneous puck travel.

Next targeted development work is now evidence-based:

1. Review zero-second event ordering and timestamp resolution before treating these as genuinely immediate rebound opportunities; compare the existing and refreshed components' same-clock contributions using earlier data.
2. Diagnose the 5-on-4 regression by distance, shot type and timing before changing a global power-play factor. Fit any proposed correction on earlier seasons, not these reported outcomes.
3. Separate same-team recorded movement from verified possession/pass evidence where available; test whether the observed fast-lateral bias is an eligibility problem or a conditional probability error.

Do not force fitted xG totals to these observed goal totals and report the result as held-out improvement. These diagnostics become development information for the next candidate, which needs a separately declared evaluation.

## Reproduction and evidence

- Feature export: `scripts/proof/export_last_season_candidate_features.py`; data and inventories in `scripts/proof/results/last-season-candidate-features-20260907/`.
- Frozen inference/evaluation: `scripts/proof/evaluate_frozen_last_season.py`.
- Metrics, all predictions, reliability bins, slice scorecards and model pin declaration: `scripts/proof/results/frozen-last-season-evaluation-20260907/`.
- Independent rank-based AUC, scalar Brier/log-loss, Pearson correlation and calibration review: `scripts/proof/review_last_season_evaluation.py`; receipt `independent-review.json`.
- Historical-vector and fixed-parameter replay check: `scripts/proof/check_last_season_protocol.py`; completed receipt `protocol-review.json`. All 94 historical fixture vectors matched their certified originals; fixed-parameter prediction error was at most 1.3877787807814457e-17, and changing current target labels did not change predictions. Its metadata-shifted fixture is a test only and is not included in evaluation data.

Frozen source body/receipt hashes, source gates and exact model file hashes were checked. Existing artifacts and actuals were preserved. No MoneyPuck files, model weights or data were loaded. **Production is unchanged; no world-class or industry-ranking claim is established.**
