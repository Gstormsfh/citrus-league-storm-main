# Public xG methods versus frozen Citrus development

Reviewed 2026-09-06. This is a methodological gap audit, not a model acceptance,
reproduction or accuracy comparison. Only public explanatory pages were used;
no MoneyPuck datasets, predictions, weights or paid material were acquired.
The number-verification skill guided the distinction between code, fitted
artifacts and measured results. No model, source, schema or existing evidence
was changed for this audit.

## Finding

Citrus already implements much of the disclosed event-context feature family.
The actionable gaps are **power-play age, strength-specific fitting, separately
fitted rebound creation, and train-only rink correction**—not simply adding
distance, shot type or previous-event motion again. Identity-aware probability
is a separate experiment being developed independently; it must not silently
replace the neutral shot-quality estimand.

MoneyPuck's public design is a useful reference baseline, not an executable
specification. Its [methodology](https://moneypuck.com/about.htm) describes
boosted shot probabilities, motion context, power-play duration and separate
rebound/creation accounting. Its [glossary](https://moneypuck.com/glossary.htm)
distinguishes neutral xG, talent adjustment, flurry adjustment and shot-attempt
populations. Neither page establishes a frozen, complete current training
recipe, preprocessing implementation, source revision inventory or fitted
parameter set. Matching concept names cannot establish exact reproduction.

## Exact Citrus evidence boundary

The audited development schema is `official-neutral-prefix-categorical-v2` in
[development_feature_export.py](../data-pipeline/projections/development_feature_export.py),
which extends the numeric schema in
[compact_feature_export.py](../data-pipeline/projections/compact_feature_export.py).
The feature arithmetic is in `prefix_measurements` and
[`project_row_features`](../data-pipeline/projections/causal_feature_projector.py).
Actual fitting, train-only preprocessing, later calibration and validation are
in [development_experiment.py](../data-pipeline/projections/development_experiment.py).

The [frozen plan](analytics-development-ablation-plan-20260906.json),
[machine result review](analytics-development-result-proof-20260906.json) and
[result interpretation](analytics-development-result-20260906.md) identify
`enhanced_context_sigmoid` as a development shortlist selection. The machine
status is `measured-not-accepted`, with `publishable: false`. Thus **fitted and
retrospectively evaluated does not mean validated for serving**. This audit
does not rerun the source replay, deserialize artifacts or recompute metrics;
it makes no new numerical performance claim. It does not certify legacy
serving models by association with these development artifacts.

## Feature-by-feature gap matrix

“Development” below means implemented, fitted and measured in that frozen
experiment, never production-approved by this document. “Contract only” means
arithmetic/interfaces exist but does not imply a fitted probability model.

| Disclosed public concept | Exact Citrus implementation and status | Missing input or limitation | Highest-value next experiment or gate |
|---|---|---|---|
| Geometry and shot category: [MoneyPuck](https://moneypuck.com/about.htm), [Evolving Hockey](https://evolving-hockey.com/blog/a-new-expected-goals-model-for-predicting-goals-in-the-nhl/) | Development: oriented `x_attacking`, `y_attacking`, distance, signed `atan2` angle and categorical `shot_type`. Geometry comparator uses absolute angle, quadratic terms and interaction, with train-only scaling. | Reported coordinates are not corrected tracking locations. Goal-centre angle and unknown orientation are explicitly unavailable; no shot-sign orientation fallback. | Retain comparator and test individual feature-family ablations rather than attribute bundled gains to one feature. |
| Prior-event type and location; elapsed time and displacement: [Evolving Hockey](https://evolving-hockey.com/blog/a-new-expected-goals-model-for-predicting-goals-in-the-nhl/) | Development: `previous_event_type`, current-team-frame prior coordinates, same-team indicator, immediate-event seconds/distance/location-change rate. | Only the immediate same-period event is eligible; boundary or missing-coordinate events are not skipped. Rate is recorded location displacement per clock second, not puck velocity, pass speed or tracked rush. | Freeze and compare a carefully specified alternative prefix definition, preserving missingness and all intervening events. Never call a location proxy a measured pass. |
| Rebound angular motion: [MoneyPuck](https://moneypuck.com/about.htm), [Säfvenberg's implementation writeup](https://safvenberger.github.io/expected-goals-in-ice-hockey/) | Development: immediate prior same-team SOG, shortest circular angle change and angle/time. | Prior SOG is not confirmed rebound possession. Same-clock angular rate is null, not infinity or an arbitrary cap. | Independently audit conditional subgroup calibration; fit a new frozen ablation if warranted, not a correction chosen on validation labels. |
| Strength and empty net: [MoneyPuck](https://moneypuck.com/about.htm); separate strength fits in [Evolving Hockey](https://evolving-hockey.com/blog/a-new-expected-goals-model-for-predicting-goals-in-the-nhl/) | Development: shooting/defending skater counts, both empty-net flags and skater advantage. `run_development_experiment` fits pooled base/enhanced HGB models, not separate EV/PP/SH/EN models. | Situation code can establish observed counts, not why the advantage exists. Sparse or unknown states need an explicit policy. | Fixed pooled-versus-state-specific comparison on identical membership, with training-only minimum-support rule and predeclared pooled fallback. Retain unknown-state coverage. |
| Current power-play duration: [MoneyPuck](https://moneypuck.com/about.htm) | Missing from fitted schema. Projector explicitly marks `time_since_powerplay_started` unavailable with `penalty_state_not_reconstructed`. | `seconds_since_recorded_faceoff` is implemented but is neither PP age nor fatigue. Penalty starts, expiry, goal termination, coincidentals, delayed penalties and period transitions require reconciliation. | Source-only prefix state-machine audit first. Distinguish penalty advantage from extra attacker; only then freeze a PP-age feature ablation. Do not substitute faceoff age. |
| Score, home and game-clock context: [Evolving Hockey](https://evolving-hockey.com/blog/a-new-expected-goals-model-for-predicting-goals-in-the-nhl/) | Development: strict-prefix score differential, shooting-is-home, period and period clock. Final score is not a covariate. | These are contextual predictors, not an explicit score-adjusted aggregate or causal score-effect estimate. | Keep pre-shot versus final-result invariant tests; separately version any aggregate score adjustment. |
| Recording effects across rinks: [Schuckers and Macdonald](https://arxiv.org/abs/1412.1035) | No rink adjustment in the frozen neutral projector. Home-team/rink identifier is a diagnostic group, not a fitted spatial transform. | The cited paper estimates event-recording effects; that is not interchangeable with spatial coordinate correction. A home identifier is not guaranteed physical venue identity. Legacy SQL interpolation plumbing does not supply accepted first-party fitted knots. | Establish physical venue/time mapping and train-only correction estimates; compare raw/corrected geometry with frozen out-of-time membership and sparse-venue fallback. Do not fit corrections using validation seasons. |
| Neutral chance quality versus shooter/goalie effects: [HockeyViz shot-danger explanation](https://hockeyviz.com/txt/preview2526), [MoneyPuck glossary](https://moneypuck.com/glossary.htm) | Frozen development remains identity-free neutral probability. `identity_probability.py` is separate ongoing work, not evidence supporting this frozen result. | Observed goals above xG are not automatically isolated talent; teammate, goalie, deployment and shrinkage choices matter. | Complete the separately owned chronological identity experiment with neutral and identity outputs explicitly named. Do not convert identity effects into GAR or fantasy points without further contracts. |
| Flurry discounting: [MoneyPuck](https://moneypuck.com/about.htm) | Contract/shadow only: [`survival_weighted_flurry`](../data-pipeline/projections/sequence_value.py) discounts each observed shot by prior non-goal survival. [`sequence_shadow.py`](../data-pipeline/projections/sequence_shadow.py) requires matching source/prediction receipts and stays nonpublishable. | An observed chain includes later shots whose existence was not forecast. Conservative source chain boundaries are not inferred possession. Caller validation attestations are not independent calibration proof. | Replay accepted, event-matched probabilities through the shadow stage and audit boundaries. Label the result retrospective accounting, not a newly calibrated possession probability. |
| Expected rebound generation and creation credit: [MoneyPuck](https://moneypuck.com/about.htm) | Contract only: `rebound_creation` requires distinct conditional estimates; `creation_credit` excludes direct rebound-shot credit. Frozen development fits neither conditional target. | Needs source-reconciled rebound-opportunity labels and separately fitted/calibrated continuation quality. Existing legacy multipliers are not accepted estimates. | Define labels/censoring before fitting. Estimate rebound-after-no-goal and conditional next-shot quality from originating-shot information only; evaluate each target separately before allocation. |
| Possession/transition contribution: [Chatel's sequence research](https://hockey-graphs.com/2020/05/13/using-sequences-for-analysis-expected-goals-contribution-and-more/) | Not fitted by the neutral development experiment. Existing observed-chain accounting does not allocate controlled-entry, exit or pass value. | The public research uses richer tracked events. Ordinary PBP lacks comprehensive controlled possession, screens and non-assist passes. | Start an input-observability audit, not a fabricated possession label or borrowed contribution weight. Keep event-chain sums, survival accounting and player credit distinct. |

## Architecture and evaluation are part of the method

The Evolving Hockey article discloses historical XGBoost fitting with separate
strength populations and prior-event preprocessing. It is evidence of an
approach, not proof of today's complete deployment configuration. Citrus uses
scikit-learn histogram gradient boosting with fixed configuration and disabled
early stopping; this is not the same implementation merely because both are
boosted trees. Citrus also retains prevalence and geometry comparators. See
[`chronological_fit.CONFIG`](../data-pipeline/projections/chronological_fit.py)
and the frozen development plan for actual parameters.

Citrus fits medians and categorical vocabularies on training membership only.
Missing and previously unseen categories remain distinct. Sigmoid and isotonic
calibration use the later calibration window, not validation labels.
[`probability_scorecard.py`](../data-pipeline/projections/probability_scorecard.py)
compares matched event probabilities with paired whole-game resampling and
retains reliability/subgroup diagnostics. A diagnostic calibration slope is
not an applied calibrator. The shortlist rule was declared before measurement;
it does not make selection uncertainty disappear or authorize serving.

The result review records unresolved calibration/subgroup limitations. Those
are more directly actionable than copying a public algorithm label. A new
feature or partition experiment must remain a development experiment: freeze
its configuration before fitting, retain all candidates and failures, avoid
the already inspected later test for selection, and create a new prospective
reservation for the final changed pipeline. Public-site metrics cannot be
compared without matched events, labels, source revisions, time windows,
conditioning and calibration protocols.

## Prioritized bounded work

1. **Strength partition experiment:** best immediate architecture test because
   the frozen rows already expose counts and empty-net status. Predeclare a
   partition precedence, support threshold, unknown handling and pooled fallback;
   do not silently drop hard states to improve a score.
2. **PP-age source audit:** best clearly missing event-state feature. Reconcile
   only historical prefix information and report unavailable transitions before
   any model fit. Situation-count changes alone do not prove penalty start.
3. **Calibration and isolated feature ablations:** use new declared development
   comparisons, retaining the current pooled candidate. Bundled enhanced
   features do not establish the individual value of motion, category or clock.
4. **Rebound targets, then creation:** retain the existing mathematical contract
   but supply independently trained conditional probabilities. Observed rebound
   outcomes may define training labels; they must not enter at-shot covariates.
5. **Rink correction and richer possession:** preserve these research lanes,
   gated by venue identity and event observability. Neither should be simulated
   with fitted-looking constants or confused with the identity experiment.

These priorities are engineering judgments about feasibility and evidence
gaps, not predicted accuracy gains. No new training or acceptance decision was
performed in this review.

## Follow-on experiment

The [fixed strength-partition plan](analytics-strength-partition-plan-20260906.json)
now declares a separate additive experiment implemented in
[strength_partition_candidate.py](../data-pipeline/projections/strength_partition_candidate.py).
It compares neutral pooled and specialist HGB probabilities on unchanged
features, retaining the frozen monotone-group calibrated baseline as well as
the same-calibrator pooled control. Count advantage is deliberately not labelled
an adjudicated power play. Unknown/special count states, shooting-empty-net
states and unsupported specialist populations retain pooled predictions.
The runner performs fresh complete source replay and gates fresh pooled vectors
against the retained baseline before scoring. This declaration is not a result
or serving approval; completed evidence must be reviewed separately.

The [completed additive run](../scripts/proof/results/official-strength-partition-20260906-1731/health.json)
now records `complete-strength-development-not-accepted`. Fresh full-source
replay, frozen raw-vector comparison, shape-map comparison and independent JSON
tree inference completed. Observed maximum drift was zero for both folds'
calibration/validation raw vectors and the frozen shape predictions. A separate
post-run check rehashed every health-listed output without a mismatch; no
failure marker exists. Eighteen focused implementation/runner tests passed.

The [retained result](../scripts/proof/results/official-strength-partition-20260906-1731/result.json)
does **not** establish a gain over the current neutral baseline:

| Fold | Predictor | Brier | Log loss |
|---|---|---:|---:|
| Earlier | Pooled sigmoid | 0.06130733 | 0.22573960 |
| Earlier | Partition sigmoid | 0.06135900 | 0.22618735 |
| Earlier | Frozen monotone-group | 0.06122832 | 0.22541485 |
| Later | Pooled sigmoid | 0.06028790 | 0.22273845 |
| Later | Partition sigmoid | 0.06025675 | 0.22270610 |
| Later | Frozen monotone-group | 0.06010031 | 0.22199299 |

Lower is better. Specialization lost to the frozen monotone-group baseline on
both losses in both folds; its small later-fold improvement over pooled sigmoid
does not reverse that finding. This is point-estimate comparison, not a new
significance or prospective claim. Complete paired intervals, original bins and
subgroups remain in each saved scorecard. Equal-count, advantage and disadvantage
specialists met declared support; defending-empty-net did not meet the fixed
training-event minimum and retained pooled outputs in both folds. Unknown and
shooting-empty-net states also remained pooled. No support threshold, cohort,
model setting or calibration rule was changed after the run.
