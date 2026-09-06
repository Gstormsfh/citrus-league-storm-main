# Neutral xG probability scorecard implementation

Status: executable offline measurement machinery, not a trained model or a
predictive-quality result. No artifact was loaded, no live rows changed, and no
serving selection was promoted. Existing model families remain preserved.

Subsequent execution: the [first real result](analytics-first-neutral-experiment-result-20260906.md)
now records a completed source-replayed fit, later calibration and retrospective
measurement with this scorecard. The implementation checkpoint below remains
historical; its "next required result" is now completed. Calibration weakness,
source exclusions and separate future reservations are explicit in that result;
no serving or world-class acceptance is implied.

`data-pipeline/projections/probability_scorecard.py` measures exactly matched
event-level neutral-goal probabilities. Every model must supply a finite
probability for every event; missing peer rows fail rather than silently select
a favorable intersection. The caller must retain prediction rows, upstream
exclusions, and actual source/split/feature/model/calibrator execution receipts.
The report checks the canonical prediction-row hash and declared pipeline
inventory, but explicitly does not authenticate sources or verify actual fitting.

## Measurement choices

- Event-weighted binary Brier score and explicitly clipped log loss. Clipping is
  a caller-declared numeric policy, not silently applied to Brier, ranking or
  reliability. The report counts clipped predictions and impossible observations
  whose unmodified log loss is infinite. Unrepresentable observed/expected ratios
  become unavailable while other valid metrics remain reportable.
- Tie-aware ROC AUC and noninterpolated average precision, not trapezoidal PR
  area. Single-outcome discrimination is unavailable, never a favorable score.
- Frozen reliability bins include empty bins; the final upper endpoint includes
  one. Each bin retains event/game counts, mean prediction, observed rate and gap.
- Unpenalized calibration intercept/slope is a retrospective diagnostic, not a
  deployable recalibration. Boundary probabilities, constant predictors,
  separation and failed/ill-conditioned fits abstain. Its uncertainty is not
  computed in this first implementation and remains an explicit scorecard gap.

These score definitions follow the primary
[scikit-learn metric documentation](https://scikit-learn.org/stable/modules/model_evaluation.html).
Calibration requires checking probability agreement, not treating discrimination
or one aggregate ratio as sufficient evidence; see the
[calibration documentation](https://scikit-learn.org/stable/modules/calibration.html).
The installed comparison library used in local regression tests is scikit-learn
1.5.2; NumPy 1.26.4 and SciPy 1.13.1 execute the new module. These are measured
runtime versions, not an instruction to upgrade or a claim to use newer APIs.

## Uncertainty and subgroup honesty

The caller declares seed, resample count, confidence, minimum original cohort
sizes and valid-resample fraction before evaluation. Each resample selects whole
games with replacement, carrying every event in a selected game together. The
same game multiplicities are used for all models and every subgroup, enabling
paired differences on the same data. No independent per-shot bootstrap is used.
The paired-resampling principle is also documented in
[SciPy bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html);
this implementation applies the sampling unit to games rather than rows.

Intervals are marginal percentile intervals with explicit valid, undefined and
not-computed counts. Sparse original groups retain descriptive results but do
not expend bootstrap work on unusable intervals. Unknown groups remain a named
`None` population. Differences are explicitly left-minus-right; negative loss
differences and positive ranking differences have different interpretations.
These intervals condition on the fixed pipeline and cohort. They do not capture
training uncertainty, all cross-game dependence, multiplicity, or future-domain
shift, and a small declared resampling count is not evidence of interval stability.

Operational shape limits bound model, bin and group cardinality and bootstrap
array size. They are not statistical acceptance thresholds and do not establish
production capacity. No production/load acceptance is inferred from local runs.

## Verification and next gate

Synthetic tests cross-check weighted/tied metric formulas against the independent
library, compare cluster draws against explicit duplicated-game calculations,
verify exact zero paired differences for identical models, retain sparse/unknown
groups, and reject changed row hashes or incomplete model inventories. Independent
review found a subnormal-probability ratio overflow and JSON integer-key coercion;
both are fixed with dedicated regressions. These tests validate implementation,
not Citrus model performance.

The next required result is an actual first-party chronological fit and scorecard,
with all learned stages fitted on their permitted earlier windows and every source
exclusion retained. Historical evaluation must remain labeled retrospective.
Prospective testing requires a genuinely frozen complete pipeline before new
observations arrive. Nothing here authorizes MoneyPuck files, fitted constants,
unknown legacy model deserialization, or an unmatched competitor benchmark.
