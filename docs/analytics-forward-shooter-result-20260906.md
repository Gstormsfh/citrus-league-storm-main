# Forward shooter/movement: completed, not accepted

The new shooter-conditioned candidate failed its declared accuracy guard in
both validation folds. It does not replace the frozen movement/conditional
candidate or production. This is a completed fitted experiment, not merely a
replay of the previous shooter model.

## Design and preserved inputs

The [immutable plan](analytics-forward-shooter-movement-plan-20260906.json)
retains the frozen raw movement model, preprocessing and all its 47 numeric
and two categorical inputs. Each fold uses earlier calibration games to fit
the conditional map and later calibration games to fit shooter effects; no
outcomes are shared between those two fitting stages. Validation follows both.
Whole dates and games stay together. This is a three-stage forward holdout,
not pooled cross-fitting. A global-intercept-only control separates shooter
effects from an overall scoring-rate correction.

The frozen conditional comparator used the entire original calibration period;
the new map used only its earlier portion. This allocation difference means
the comparison evaluates the complete new pipeline, not a clean isolated test
of whether shooter identity contains useful information. No raw model was
refitted and no MoneyPuck files, predictions or fitted weights were used.

## Actual results

Lower is better. The primary shooter candidate had to be no worse on both
metrics in each fold against every declared control; averaging cannot rescue it.

| Fold | Candidate | Brier | Log loss |
|---|---|---:|---:|
| Earlier | Frozen conditional | 0.061125805 | 0.225090313 |
| Earlier | New neutral | 0.061138834 | 0.225178233 |
| Earlier | Global control | 0.061185274 | 0.225302840 |
| Earlier | Shooter | 0.061172622 | 0.225183311 |
| Later | Frozen conditional | 0.060098779 | 0.221949190 |
| Later | New neutral | 0.060179267 | 0.222262079 |
| Later | Global control | 0.060170443 | 0.222260337 |
| Later | Shooter | 0.060154665 | 0.222173704 |

Shooter point losses improve over the global control in both folds, but all
four paired 95% game-bootstrap intervals for those improvements cross zero.
This does not establish a reliable gain from shooter effects. Against the
frozen conditional comparator, shooter Brier is worse in both folds with both
intervals excluding zero; later-fold log loss is also worse with its interval
excluding zero. These are fixed-fit development intervals, not uncertainty
over the whole model-selection process or a fresh superiority test.

## Calibration remains the priority

The earlier fold contains 8,648 goals. New-neutral expected goals are 8,987.61;
the global correction increases them to 9,232.86 and shooter adjustment to
9,249.39. The later-period correction worsens the already-high validation total.
The later fold has 8,478 goals versus 8,453.97 shooter expected goals, yet its
proper losses still trail the frozen comparator. Matching the overall total
does not demonstrate that individual shot probabilities are calibrated.

In the earlier fold, shooter probabilities in the 0.20–0.35 band average
0.248638 versus an observed rate of 0.212537 (7,147 events). The 0.10–0.20 band
averages 0.141056 versus 0.127068 (22,909 events). These retrospective bins
diagnose shape error; they must not become validation-fitted corrections.
The later fold also underpredicts its 0.05–0.10 band (0.071894 predicted versus
0.081339 observed) while overpredicting its 0.20–0.35 band (0.247674 versus
0.221621). These are each model's own probability bands, not fixed-membership
cross-model decompositions. A single global rate adjustment cannot by itself
address opposite-sign errors across those bands.

Next research priority: separate temporal calibration drift and reduced map-fit
support from the shooter effect, using an explicitly declared earlier-only
design. Preserve neutral xG separately from shooter-conditioned probabilities;
do not turn fitted log-odds into a constant finishing multiplier. Any subsequent
candidate requires a fresh declaration, training-only selection and eventual
untouched or prospective evidence. Finishing uncertainty, penalty stability,
daily projections and GAR/FPAR remain separate unresolved gates.

## Evidence and limits

Completed output:
`scripts/proof/results/official-forward-shooter-movement-20260906-retry1/`.
Health SHA-256:
`829119131d856969b5278d1b14d1a711c19b4a5a404b6b932ee40cf29af9fe22`.
Both folds passed the original source/actor joins, chronology, exact raw-model
replay, saved-model scalar checks and inference-order checks. The first
prefit implementation failure and its correction are preserved in the
[execution history](analytics-forward-shooter-execution-20260906.md).
The corrected offline suite passed 2,944 tests; network tests were excluded.

The independent saved-output review is
`scripts/proof/results/forward-shooter-movement-review-20260906-retry1/`;
health SHA-256:
`93e9d10c339f3b53e683f992abfaa7d2d85b534fe8d834f6e74178e2b10b8b2d`.
It verified 13,030 file hashes and 20,712 point comparisons, with maximum
absolute numerical disagreement below 1.82e-12, and independently reproduced
both failed guards. It does not independently refit models or recompute
bootstrap intervals, AUC or average precision.

The outer validation periods had already been inspected in earlier experiments.
This is adaptive development. Revised source records do not establish their
historical availability. Existing finishing and talent implementations remain
preserved, but neither their preservation nor this experiment certifies their
replacement, causal player skill, future shot exposure or production quality.
