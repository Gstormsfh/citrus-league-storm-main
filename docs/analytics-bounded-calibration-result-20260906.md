# Bounded calibration execution result

The numerical execution gate passed. No new hockey model was fitted, no accuracy
improvement is claimed, and production remains unchanged. The frozen dense
calibrator and all earlier evidence remain intact.

## Retained evidence

`scripts/proof/results/bounded-conditional-proof-20260906-full/health.json`
SHA-256: `a86f40c8d30e1e29081e0369ee136ccb2eabec51618e05f8764120c63c7ae4ed`.
The create-only proof binds its source map, saved inputs, implementation, tests
and execution declaration; it rechecks source hashes and exact inventories.

Saved-map inference on all 59,101 earlier calibration rows matched the dense
implementation exactly in this run. On the declared first 2,048 rows, saved and
identity coefficients produced maximum objective error `5.551115123125783e-17`
and gradient error `9.974659986866641e-18`, below absolute tolerance `1e-12`.
This is replay at fixed coefficients, not a real-cohort refit comparison.

The synthetic 250,000-row test correctly exceeded the dense design's 32,000,000
cell limit (44,750,000 charged cells). Bounded execution completed using chunks
of 4,096 and 8,192 rows, with identical predictions, objective difference
`2.220446049250313e-16` and maximum gradient difference
`4.597017211338539e-17`. The 4,096-row allocation charges 1,311,904 live numeric
cells. The separately recorded 250,000-row *requested* chunk was only checked by
the allocation calculator; its capped execution was not stress-tested here.

The proof took about 1.46 seconds, including source verification, on this local
runtime. Process-lifetime peak RSS was 246,677,504 bytes. Neither figure is a
training benchmark or a total-memory guarantee: Python objects, native runtime
overhead and the retained dense reference also contribute to process memory.

## Tests and limitations

All 84 focused tests passed: 31 author tests, 34 independently authored numerical
review tests and 19 proof-harness tests. They cover analytic/finite-difference
gradients, penalty scaling, original optimizer initialization and constraints,
unknown states/categories, JSON inference, input rejection, source corruption,
and release of each design before the next chunk.

A small synthetic dense-versus-bounded fitted comparison passed its separately
disclosed `2e-6` probability tolerance. This does not establish bitwise optimizer
identity or full-cohort optimizer convergence. The larger stress proof does not
fit any model.

Full offline regression: **3,118 passed, 16 network tests deselected**, with 33
existing deprecation warnings. Receipt:
`scripts/proof/results/bounded-conditional-20260906-suite.xml`.

Next: separately declare and execute the full-period, strictly earlier-history
calibration transfer study. Preserve all months and inputs; report convergence,
runtime and monthly weaknesses. No new feature selection or parameter tuning is
authorized by this numerical proof, and no finishing, FPAR or acceptance gate
is closed by it. The number-verification skill was used to tie these quantities
to the retained proof and test receipts rather than inherited model claims.

Independent read-only result review verified the exact output inventory, all
five health-bound output hashes and all 97 consumed-file hashes. Its review
confirmed the distinction between executed chunk sizes and allocation-only
calculations; it did not refit models or certify predictive accuracy.
