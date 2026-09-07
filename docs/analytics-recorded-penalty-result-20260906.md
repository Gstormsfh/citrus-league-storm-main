# Recorded-penalty candidate: completed, not accepted

The additive penalty-context experiment failed its declared improvement guard.
Keep the frozen conditional-shape comparison candidate unchanged; do not promote
this experiment. Production was not changed. This result does not establish that
penalty information is inherently unhelpful.

## What was tested

The immutable [pre-fit plan](analytics-recorded-penalty-candidate-plan-20260906.json)
added recorded same-team/opponent penalty age, duration, type and explicit
annotation states to the existing movement inputs. All 47 numeric and two
categorical movement fields were preserved, yielding 51 numeric and six
categorical fields. Original identities, labels, chronological partitions and
old-field preprocessing were checked. No MoneyPuck data, predictions or fitted
weights were used in this experiment.

Recorded annotation age is not remaining penalty time, adjudicated manpower,
actual goalie movement or a reconstructed power-play clock. This experiment
does not close every legacy-input or downstream model-family obligation.

## Declared decision

Lower Brier and log loss are better. The calibrated addition had to be no worse
on **both measures in each fold against both frozen controls**. No averaging
across folds or post-result change to that rule is allowed.

| Validation fold | Candidate | Brier | Log loss |
|---|---|---:|---:|
| Earlier | Frozen conditional shape | 0.061125805 | 0.225090313 |
| Earlier | Recorded penalty + conditional shape | 0.061115624 | 0.225076486 |
| Later | Frozen conditional shape | 0.060098779 | 0.221949190 |
| Later | Recorded penalty + conditional shape | 0.060110991 | 0.222009365 |

The earlier fold passed; the later fold failed against both controls. The saved
result contains the neutral control and raw candidate as well. Against the
frozen conditional candidate, all four aggregate paired 95% game-bootstrap
intervals cross zero: an incremental overall gain is not established. The
point-estimate guard still fails; it was not a significance-based rule.

## Calibration weaknesses to investigate without another fit

The later fold's `prior_sog_same_team=prior_same_team_sog` subgroup contains
17,050 events across 1,383 games. Candidate-minus-frozen-conditional differences:

- Brier: +0.000175889; fixed-fit 95% game-bootstrap interval
  [+0.000104796, +0.000259317].
- Log loss: +0.000662384; interval [+0.000422959, +0.000916432].

This is exploratory subgroup evidence with multiple comparisons, not a
replicated finding across folds or a confirmed rebound-possession label.

Aggregate calibration must not hide probability-band errors. In the later
fold, the new calibrated candidate's 0.05–0.10 band has mean probability
0.072115 versus observed goal rate 0.080259 (29,442 events). Its 0.20–0.35
band has 0.248471 versus 0.219782 (4,964 events), and its 0.35–0.50 band
has 0.420846 versus 0.338369 (662 events). These are diagnostic observations,
not permission to fit a correction on these validation outcomes.

Next bounded analysis: matched-event loss decomposition in frozen-control
probability bands, crossed with prior-shot context and recorded penalty state,
including unknown and sparse cells in both folds. Keep membership identical
between models and separate raw-model changes from calibration changes. Any
new fitted candidate needs its own declaration and eventual untouched or
prospective validation; these already-inspected development folds are not that
final test. FPAR remains behind the foundation acceptance gates.

## Reproducibility and verification

- Create-only run: `scripts/proof/results/official-recorded-penalty-20260906-full/`.
  Its health receipt binds 24 files, including declarations, models, calibrators,
  bundles, predictions, scorecards and fit receipts. Execution completed;
  `model_accepted`, `publishable` and `production_changed` are all false.
- Independent point review:
  `scripts/proof/results/recorded-penalty-review-20260906-full/`.
  It verified 12,953 files and 26,859 point comparisons; maximum absolute
  discrepancy was 2.73e-12. It did not independently recompute bootstrap
  intervals, AUC/AP or model fits, or rederive diagnostic states from raw source.
- JSON inference matched fitted raw predictions exactly; named batches and
  reversed batches matched saved calibrated predictions. Sampled singleton and
  independent scalar-calibration checks remained within 1e-12.
- Offline full suite: 2,419 passed, 16 network tests deselected; receipt
  `scripts/proof/results/recorded-penalty-verification-20260906-final-full-suite.xml`.
  Independent JavaScript reviewer tests: nine passed. Focused tests overlap the
  full suite and are not an additional independent model-quality result.
- The v8 coverage ledger preserves unresolved obligations; test success and
  inference parity are not proof of forecasting superiority or full acceptance.

The experiment preserves source and fitted evidence regardless of its outcome.
It supports a reproducible rejection of this candidate, not a claim that Citrus
is already the most accurate xG system or that the full mission is complete.
