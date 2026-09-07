# Proposed next calibration experiment: context-dependent shape

Proposal only. No fitter, predictions, model files or serving configuration were
changed. This is not permission to rerun a failed experiment with altered
thresholds. A separately frozen implementation and executable preregistration
must precede fitting.

## What was already tried

Read the calibration, calibration-shape, adaptive-calibration and movement
result reports before choosing this proposal. The existing sequence already
includes sigmoid, isotonic, beta, context-offset beta, clipped/smoothed isotonic,
global monotone logit, context-offset monotone logit, rolling intercept and
conservative selective intercept. Plain beta and the isotonic variants did not
beat their declared controls; both temporal intercept challengers failed their
second development fold. Repeating those searches is not a new hypothesis.

`calibration_shape.py:59–86` supplies the key architectural distinction: the
current conditional map has a **single shared vector of probability slopes**
and categorical **intercept offsets**. It cannot change slope/curvature by
context. The separately tested strength-partition raw predictor is not a test
of context-specific calibration shape on a fixed movement predictor.

The movement summaries confirm its declared overall guard fails. Fold-two
movement monotone Brier is 0.06010175618378989 versus frozen neutral
0.060100310127386036; log loss improves instead. The saved diagnostic shows
opposing prior-event subgroup changes and residual bin-shape problems despite
near-balanced total goals. Those are reasons to investigate heterogeneity,
not evidence that this proposal will fix it. Exact sources are
`scripts/proof/results/official-movement-20260906-full/fold2/summary.json` and
`docs/analytics-movement-diagnostic-20260906.md`.

## One bounded, nonduplicate candidate

Keep the **already-frozen movement raw model** fixed, irrespective of the zone
experiment result. Do not choose a raw-model winner after seeing this proposal's
losses. Fit one new monotone calibration map directly to that raw probability
on the original calibration period, retaining existing context intercepts.

Add partially pooled slope vectors for the existing three-state prior-same-team
SOG context: true, false and unknown. Use the current fixed probability knots;
every context's slopes must remain nonnegative. Penalize deviations from the
shared slopes with a fixed quadratic weight of 1,000; retain the current shared
identity, adjacent-slope and intercept penalties. This proposed weight is an
explicit conservative engineering choice, not a learned optimal constant or a
literature result. Do not sweep it on these validation folds. Missing is a real
context, not a fabricated false; a context absent from calibration falls back
to shared slopes with no learned deviation.

One concrete parameterization uses nonnegative shared slopes and nonnegative
context slopes, with quadratic penalties on their differences. The Bernoulli
log-loss is convex in this linear logit parameterization. Preserve original
categorical offsets and their ridge penalties; there is no extra post-hoc
second calibration stage fitted on the same labels. Bound resource use and
independently verify gradients, constraints and convergence before a real fit.

## Evaluation and leakage boundaries

- Base-model training stays earlier than calibration, which stays earlier than
  validation. No validation labels enter the map; no in-validation updates.
- Preserve identical events, outcomes and groups. Compare raw movement,
  existing movement monotone map, original frozen neutral and this one new map.
  The primary requires no worse Brier **and** log loss in **both** folds versus
  both mapped controls. Do not change the guard because a difference is small.
- Preserve full bins and all subgroup losses. Report context-specific slopes
  and unknown/unseen counts without excluding sparse or difficult populations.
- Export an independently executable JSON map, verify every calibration and
  validation prediction, and confirm altering validation labels cannot change
  any fitted parameter. No original artifacts or reservations are rewritten.

This proposal is informed by **reused development results** and adds another
comparison to an already adaptive search. Even a pass is exploratory, not an
independent significance result or acceptance. Fixed-fit bootstrap intervals do
not repair multiplicity, repeated selection or refit uncertainty. A later
prospective evaluation must be declared separately without consuming or silently
amending the six existing reservations.

## Research boundary

The official calibration documentation requires separation of base training
and calibration data and cautions that Brier/log loss measure more than
calibration alone: [scikit-learn probability calibration](https://scikit-learn.org/stable/modules/calibration.html).
Beta calibration is already represented in the earlier experiment, not proposed
again here: [Kull et al., primary paper](https://proceedings.mlr.press/v54/kull17a.html).
The partially pooled context-slope design above is a Citrus proposal, not a
claim to reproduce either source's algorithm or published performance.
