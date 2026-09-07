# Movement candidate: fixed-prediction diagnostic

The candidate fails its declared two-loss/two-fold guard. Fold 1 improves both point losses; fold 2 improves log loss but slightly worsens Brier. That is not a reason to discard the original movement inputs, nor evidence to accept this particular fitted successor. The aggregate conceals substantial opposing subgroup changes.

Scope: read-only analysis of `scripts/proof/results/official-movement-20260906-full`. No model fitting, retuning, predictions, labels, groups or source files changed. Intervals below are **saved** paired whole-game bootstrap intervals, not independently regenerated here. New loss decompositions use the saved event predictions only.

## Overall paired evidence

All differences are **movement_monotone_group minus frozen_monotone_group**; negative is better. The saved pair is ordered the other way, so both endpoints were reversed and negated correctly.

| Fold | Metric | Baseline | Movement | Difference | Saved 95% paired interval |
| --- | --- | --- | --- | --- | --- |
| 1 | Brier | 0.0612283213 | 0.0611268879 | -0.0001014334 | [-0.0001592700, -0.0000536346] |
| 1 | Log loss | 0.2254148455 | 0.2250946088 | -0.0003202367 | [-0.0004992691, -0.0001732160] |
| 2 | Brier | 0.0601003101 | 0.0601017562 | +0.0000014461 | [-0.0000343840, +0.0000387126] |
| 2 | Log loss | 0.2219929914 | 0.2219653151 | -0.0000276763 | [-0.0001422536, +0.0001153700] |

Fold 1 contains 120,080 evaluated events from 1,378 games; fold 2 contains 121,033 from 1,383 games. Scorecards use 256 whole-game percentile resamples with seed 60906, event-weighted loss, confidence 0.95 and the same full-cohort game draws for subgroups. These are fixed-prediction sampling intervals, not retraining uncertainty. Fold 2's paired intervals include both improvement and deterioration; they do not establish equivalence or waive the strict point-loss guard. Fold 1's paired intervals lie below zero under this procedure, but repeated development comparisons and shared expanding training data preclude treating the folds as independent replication or claiming prospective superiority.

## Prespecified fold-2 strata worth investigating

These strata already existed in the scorecard. Their selection for discussion is retrospective, and intervals are not multiplicity-adjusted. Contributions equal `subgroup_events / total_events * subgroup_loss_difference`. Contributions add within a complete disjoint dimension, **not across dimensions**.

| Existing stratum | Events | ΔBrier | ΔLog loss | Brier contribution to whole fold |
| --- | --- | --- | --- | --- |
| Previous event code 507 | 13,264 | +0.00042850 | +0.00131579 | +0.00004696 |
| Previous event code 506 | 22,404 | +0.00008169 | +0.00024194 | +0.00001512 |
| Previous event code 508 | 16,582 | -0.00025935 | -0.00091695 | -0.00003553 |
| Previous event code 502 | 29,817 | -0.00006223 | -0.00021687 | -0.00001533 |
| Prior same-team shot on goal | 17,050 | +0.00011805 | +0.00038374 | Not additive to preceding-event rows |
| Strength 5v3 | 484 | +0.00160060 | +0.00408737 | +0.00000640 |
| Strength 5v5 | 94,319 | -0.00001464 | -0.00006882 | -0.00001141 |
| Shot type wrist | 65,926 | +0.00002950 | +0.00008489 | +0.00001607 |
| Shot type tip-in | 10,675 | -0.00013430 | -0.00073160 | -0.00001185 |

The saved paired intervals for previous code 507 are Brier **[+0.00027415, +0.00059185]** and log loss **[+0.00079343, +0.00179055]**. For 5v3 they are **[+0.00076565, +0.00271817]** and **[+0.00177502, +0.00706840]**. These are concrete diagnostic warnings under the saved resampling procedure, not proof that one movement feature caused the damage.

The prior-same-team-SOG group's fold-2 paired intervals cross zero for both losses. Its point direction also reverses from fold 1, where ΔBrier was -0.00021514 and ΔLog loss -0.00073332. A richer representation has not established a stable rebound-context improvement yet.

Unknown strength/empty-net context contains 47 events; previous-event codes 509 and 516 contain 46 and 23. These sparse groups retain their point estimates but have unavailable intervals under the original scorecard rule. They remain in the overall population and must not be dropped to manufacture a pass.

## Calibration shape remains the actionable weakness

Fold-2 movement predictions sum to 8,490.43 expected goals against 8,478 observed goals. Near-matching totals conceal miscalibration across probability ranges:

| Movement probability bin | Events | Mean prediction | Observed rate | Observed minus predicted |
| --- | --- | --- | --- | --- |
| 0.05–0.10 | 29,455 | 0.07205 | 0.08026 | +0.00821 |
| 0.20–0.35 | 4,954 | 0.24833 | 0.22124 | -0.02709 |
| 0.35–0.50 | 668 | 0.42160 | 0.34731 | -0.07429 |
| 0.50–0.75 | 473 | 0.58544 | 0.53277 | -0.05267 |
| 0.75–1.00 | 103 | 0.84239 | 0.91262 | +0.07024 |

The corresponding saved gap intervals are respectively [+0.00514,+0.01084], [-0.03714,-0.01666], [-0.11105,-0.04292], [-0.10082,-0.00834], and [+0.01600,+0.12386]. The last bin is small despite passing the original minimum-event rule. The baseline also has underprediction around 0.05–0.10 and overprediction in 0.20–0.50; this weakness is not wholly introduced by movement features. Baseline and candidate reliability bins contain different events, so comparing their gap magnitudes is not a paired same-population treatment effect.

For a direct saved-prediction decomposition, holding membership fixed to **candidate** bins, the 0.35–0.50 and 0.50–0.75 bins contribute +0.00002575 and +0.00001633 to the whole-fold Brier difference. The 0.10–0.20 bin contributes -0.00005218. These exploratory fixed-fit arithmetic contributions explain the cancellation; no new confidence intervals are claimed for that decomposition.

## Implication for the next declared experiment

Preserve the original lateral/timing/previous-event measurements and their availability evidence. Diagnose event-context interactions and calibration shape with declared earlier-only fits and matched full-population comparisons, retaining sparse/unknown contexts. Do not retrofit a fold-2-specific probability patch, remove the difficult subgroups, select the best subgroup model after observing outcomes, or reinterpret log-loss improvement as a two-loss pass. Any next experiment informed by this report must explicitly acknowledge reused development evidence and leave prospective reservations untouched.

## Input identities

- Fold 1 scorecard SHA-256: `1bd77a553d8c77c8d064be0230d219d4c2ecc9a0c11ab405d4c31fe7a3fd7a5b`.
- Fold 2 scorecard SHA-256: `2ca4db47eaeafefb3b88c4b7b8e5284b880fd9e4ec9fcaccccf398b1f3462d32`.
- Fold 2 predictions SHA-256: `0cbccbfc82b356cffb896cf3852bfeed35e3824f181ee6bd922bc124f5ca672c`.

Numbers were read from these artifacts rather than inherited model claims. The report does not certify the external source, independent bootstrap implementation, production readiness or industry ranking.
