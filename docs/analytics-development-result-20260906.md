# Earlier-development result — improved losses, not accepted

The source-replayed experiment and post-fit result verification completed. The
predeclared equal-fold ranking selects **enhanced_context_sigmoid** for further
development, not serving. All nine nonconstant candidates passed the declared
no-worse-than-raw-geometry loss guard; both prevalence baselines remain recorded.

[Machine review](analytics-development-result-proof-20260906.json) binds the
full result receipt, all candidates, paired comparisons, every selected-model
reliability bin and all 77 subgroups in each fold. The original complete
scorecards remain retained, including every predictor's subgroup results.
The create-only result wrapper independently replayed source membership and
verified 12,785 source/export/code/artifact files. No model was deserialized or
refitted by that wrapper, and it did not recompute scorecard statistics.

## Population and chronology

The unchanged official-source development export contains 541,067 eligible
attempts from the declared 2019–2023 seasons. It retains 93 quarantined games
and one geometry-ineligible candidate in the audit. Validation uses 120,080
attempts / 1,378 games / 8,648 goals in fold 1, and 121,033 attempts / 1,383
games / 8,478 goals in fold 2. Training and calibration precede each validation
window; the two validation game sets do not overlap.

The [plan](analytics-development-ablation-plan-20260906.json) was timestamped
before this export and fit. This is current-revision retrospective development,
not historical-as-of or untouched evidence. No event files from July 2024 onward
were accessed by this experiment/result replay. The already-inspected 2025 test
was not used to rank these candidates. Old experiments, source observations and
all six original prospective reservations remain unchanged.

The closing preservation check independently rehashed all 18 files bound by the
first-experiment machine proof, including its reservation and original result
artifacts, plus all 17 inventoried legacy model artifacts. Every hash matched;
no legacy model was deserialized or used as a new training input.

## Declared ranking

Lower Brier and log loss are better. These are equal-weight means of the two
fold scores, not pooled scores or independent-replication uncertainty.

| Candidate | Mean Brier | Mean log loss |
|---|---:|---:|
| geometry_raw | 0.063672 | 0.238738 |
| geometry_sigmoid | 0.063632 | 0.238638 |
| geometry_isotonic | 0.063562 | 0.238241 |
| base_context_raw | 0.061614 | 0.228317 |
| base_context_sigmoid | 0.061502 | 0.228049 |
| base_context_isotonic | 0.061408 | 0.227933 |
| enhanced_context_raw | 0.060864 | 0.224381 |
| enhanced_context_sigmoid | 0.060798 | 0.224239 |
| enhanced_context_isotonic | 0.060761 | 0.224518 |

Enhanced isotonic has a slightly lower mean Brier than enhanced sigmoid, but a
higher mean log loss. The declared primary ranking is log loss; it was not
changed after seeing this tradeoff.

For the selected candidate, fold 1 Brier is 0.061307 (95% interval
0.060358–0.062283), log loss 0.225740 (0.222699–0.228836), and AUC 0.763874
(0.758574–0.768705). Fold 2 Brier is 0.060288 (0.059365–0.061327), log loss
0.222738 (0.219610–0.226109), and AUC 0.761598 (0.756800–0.766816).

Compared with base-context sigmoid on the same events, selected-minus-base
Brier differences are −0.000770 (95% −0.000898 to −0.000658) and −0.000639
(−0.000732 to −0.000536). Log-loss differences are −0.003863 (−0.004358 to
−0.003439) and −0.003758 (−0.004156 to −0.003300). The saved pair direction is
base-minus-enhanced; these displayed differences explicitly reverse it.

Intervals use the declared 256 paired whole-game resamples, conditional on
fixed fitted candidates. They do not include refitting, account for model
selection/multiple comparisons, or establish prospective superiority.

## Calibration and subgroup limits

The selected model expects 9,120.88 versus 8,648 observed goals in fold 1,
and 8,539.98 versus 8,478 in fold 2. The closer second-fold total does not mean
the probability scale is calibrated. Both folds overpredict in the 0.20–0.35
bin: observed-minus-predicted rate gaps are −0.03603 and −0.04040, with both
conditional intervals below zero. The 0.05–0.10 bin underpredicts in both.

Every declared dimension was reviewed: shot type, strength, defending empty net,
season, home-rink identifier, game type, previous-event category and prior
same-team SOG. Backhand, tip-in and poke categories overpredict in both folds.
The prior-same-team-SOG subgroup also overpredicts in both (rate gaps about
−0.01296 and −0.01292). This recorded-event condition is not confirmation of a
rebound. Several strength/category/unknown groups are sparse; their unavailable
intervals remain null. Home-rink groups are descriptive checks, not proof of a
causal recording bias. Unadjusted subgroup intervals are diagnostic, not a
multiple-testing acceptance procedure.

These are reasons to continue calibration and subgroup work. No acceptance
threshold was invented after the results, and no probability adjustment was
fitted to these validation labels.

## Preserved scope and next gate

The [methods](analytics-development-methods-20260906.md) and
[complete preservation map](analytics-method-preservation-20260906.md) remain in
force. No MoneyPuck files, predictions or fitted constants entered this run.
Rink correction, real shifts, talent, rebounds/flurry, xA, goalie evaluation,
GAR, uncertainty and fantasy opportunity remain distinct preserved stages.

Before a new final pipeline is served: resolve calibration/subgroup limits,
execute a versioned final fit with compatible source/model lineage, and create
a **new** timestamped prospective reservation before future observations.
Neither this result nor synthetic database execution accepts the full
foundation, fitted legacy SQL parameters, FPAR or production load.
