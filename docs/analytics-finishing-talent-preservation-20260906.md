# Finishing and talent remain required Citrus components

They are not replaced by a successful neutral xG experiment. Existing source and
artifacts remain preserved; successor acceptance must include their separate
contracts, temporal evidence and downstream validation. They are not yet fitted
and validated components of the new movement/penalty experiment.

## Keep the quantities distinct

| Quantity | Meaning and preservation requirement |
|---|---|
| Observed shooting percentage | Goals divided by eligible shots on goal, with aligned player, season and game type. Preserve actuals and exposure; missing exposure is not zero talent. |
| Finishing above expected | Goals relative to neutral expected goals on a coherent population. A ratio, a percentage above expected and goals-minus-xG are different displays. Preserve the denominator model/version. |
| Estimated shooter talent | Shrunk estimate using earlier player evidence, not the current shot or future outcomes. A multiplier of 1.15 means a relative multiplier, not a 15% chance of scoring. |
| Talent-adjusted output | A separately labeled shooter-conditioned or accounting quantity; do not silently substitute it for neutral shot difficulty. |
| Finishing forecast uncertainty | Distribution around a declared forecast target; it must not silently redefine that target or apply the same finishing effect twice. |

The canonical v8 coverage ledger retains unresolved `family:shooting_talent`.
`causal_feature_contract.py` explicitly requires prior-game first-party fitting
and an out-of-fold baseline. These are admission requirements, not completed
evidence. Daily forecasts and uncertainty remain separate consumer obligations.

## Original implementation, inspected rather than assumed

`scripts/utilities/calculate_shooting_talent.py` estimates a posterior multiplier
from goals/base-xG with a discrete talent grid and a normal approximation. The
implemented ratio likelihood is not an exact binomial model, despite inherited
comments. Its saved player lookup alone does not establish prediction-time
cutoffs or source-model provenance.

`scripts/utilities/feature_calculations.py:781` applies the multiplier to flurry
xG by default and caps the result at 0.50. This is not automatically a calibrated
shot-conditioned probability. The source-isolated tests verify multiplication,
input-copy preservation and unknown-player defaults. An unknown player still
receives the cap: neutral multiplier 1.0 is not an identity transformation for
an input above 0.50. A missing player ID raises in this legacy helper. Acquisition
fallback behavior and actual runtime activation require separate verification.

`data-pipeline/projections/calculate_daily_projections.py` has a separate
`calculate_finishing_talent` estimator and downstream use. Its contract and
source/missingness tests must remain distinct from the artifact-lookup path.
Do not estimate another finishing factor from already talent-adjusted xG.

## Reproduced uncertainty mismatch

The isolated `_apply_finishing_uncertainty` method in
`data-pipeline/projections/projection_uncertainty.py:415` reads total xG only
as a positive-evidence gate. Once positive, changing its magnitude does not
change the sampled distribution. The method instead constructs shooting-rate
draws relative to a league-rate prior, then divides by the supplied finishing
multiplier. That does not generally center the adjustment at one.

A deterministic posterior-mean draw fixture demonstrates this: 20 goals on
100 shots and 20 total xG has goals/xG of 1.0, yet the method changes unit goal
samples to 1.5. A separate fixture with an existing multiplier of 1.25 changes
unit samples to 0.8. These are algebraic counterexamples, not estimates of the
clipped posterior mean, real-player bias or production impact.

Do not patch this by blindly normalizing every Monte Carlo batch: that changes
the distribution and can hide a mismatch between the point forecast and the
posterior target. First declare whether the goal is preserving the point mean
or revising it from a coherent shooter/shot-quality posterior, then test both
forecast calibration and uncertainty coverage on earlier-only data.

## Verification and next gates

`data-pipeline/tests/test_legacy_finishing_uncertainty_diagnostics.py` AST-loads
only the inspected pure method/helper and constants. It does not import legacy
acquisition, deserialize model binaries or query a database. Its eight diagnostic
tests and the existing uncertainty suite passed together: **72 tests**. Receipt:
`scripts/proof/results/finishing-talent-preservation-20260906-final-tests.xml`.
The earlier narrower receipt remains preserved. Tests reproduce current behavior;
they are not successful predictive validation of that behavior.

Inspected source SHA-256:

- `projection_uncertainty.py`: `e54773a1f7a4c1641d9b32dc61490669e8d120dd3e5670fdfc4ac739127c3225`
- `feature_calculations.py`: `8089ebad40fb04d99700574c26cf8763bbbe8e33f53a0d2d0d96f2ab56eb2ccc`
- `calculate_shooting_talent.py`: `6860a2e03029a83d60867be2f39d17529d82e73447324acd039c25a9927fca1c`

Before admitting a successor: bind neutral baseline and player history to
earlier-only cutoffs; preserve unknown players and actual exposure; validate
shrinkage and cap policies; evaluate shooter-conditioned predictions separately;
reconcile finishing exactly once through daily goals and uncertainty; then
validate downstream goalie/physical forecasts and GAR/FPAR under their declared
definitions. The training-only penalty stability audit does not close these
talent gates. No production logic, original artifact or frozen experiment was
changed in this diagnostic pass.
