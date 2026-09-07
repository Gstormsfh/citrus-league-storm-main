# Bounded calibration execution gate

This is an execution change, not a new calibration policy or an accuracy claim.
The completed calibration stability study remains unchanged. Before extending
its expanding-history policy, the dense design allocation must be replaced by
an independently checked, bounded-memory equivalent.

## Scope declared before extended fitting

Add `scripts/proof/bounded_conditional_calibration.py`; do not edit the frozen
`data-pipeline/projections/conditional_calibration_shape.py`. Preserve its
knots, context vocabulary rules, explicit unknown states, initialization,
nonnegative constraints, penalties, optimizer settings, convergence gate and
JSON prediction contract. Evaluate likelihood and gradient in deterministic
chunks; apply penalties once and normalize by the entire training population.
Never drop training rows, silently increase the allocation limit, omit later
months, or cache the complete dense design. The row limit remains unchanged.

Chunk reduction changes floating-point summation order. Mathematical and
numerical equivalence do not imply bitwise-identical fitted parameters.
Chunk size is an execution parameter, not a tunable statistical parameter.

## Evidence required before extended fitting

- Dense/chunked objective and gradient agreement, including all penalties.
- Independent finite-difference gradients, JSON inference parity, absent-state
  and unknown-category behavior, malformed-input rejection and convergence tests.
- Saved-map replay using retained earlier calibration inputs; no new cohort fit.
- A synthetic population larger than the dense allocation limit must complete
  within chunk bounds. This is an execution stress test, not hockey evidence.
- Create-only proof receipts with source hashes and failures retained. Saved-map
  prediction tolerance is absolute `1e-12`; numerical fit tests must disclose
  their separate tolerances rather than claiming exact fitted identity.

## Later validation remains separate

The full outer-period expanding-history study requires a new declaration after
this execution gate passes. Earlier outer-period outcomes would train subsequent
maps: this is adaptive retrospective evaluation, not fixed-heldout validation.
Historical game dates do not establish actual label availability or revision
cutoffs. The later official seasons were already used by the original neutral
experiment, and their existing feature exports are not certified movement
exports. Do not call those seasons untouched or relax the frozen exporter.

The existing prospective reservation binds the original pipelines, not this
movement/calibration policy. A new prospective reservation must precede its
future evaluation. None of these execution tests closes finishing, FPAR,
production rollout, or overall model-acceptance gates. Production is unchanged.
