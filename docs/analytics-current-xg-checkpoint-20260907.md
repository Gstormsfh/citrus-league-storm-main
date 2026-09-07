# Current xG evidence checkpoint

**Reference:** ungated ridge-recent timing candidate. **Status:** verified
development reference, not accepted for production or FPAR.

`scripts/proof/check_current_xg_checkpoint.py` now revalidates the pinned reference,
full-vector replay, two alternative experiments, residual diagnosis and original
input-coverage ledger together. Successful completion means the evidence is
internally consistent—not that open acceptance obligations have been satisfied.

## Verified decisions

- Reference improves or ties both original-fold losses against baseline.
- All 244,259 expanded-population predictions reproduce the reference exactly.
- The past-loss gate fails replacement guards in both original folds.
- The bounded prior fails the first-fold replacement guard. Its better later-fold
  result does not override that failure.
- Same-clock residuals remain explicitly attached to the reference.
- Static input coverage reconciles, but acceptance remains false.

The ledger retains 566 tracked entries and 3,962 open disposition/gate entries.
Those are conservative inventory bookkeeping entries, **not 3,962 distinct bugs**.
They have not been silently marked complete because an offline replay passed.
This checkpoint does not discover every possible new source or certify every
original model family; the ledger's scope limitations still apply.

## Release boundary

The checkpoint always returns `model_accepted: false`, `fpar_accepted: false` and
`release_allowed: false`. Its `--require-release` mode fails. This is a development
evidence tool, not a deployed interlock or a production authorization service.
Changing a report field cannot authorize release through this tool.

Outstanding evidence is grouped explicitly: timing-cell quality; original-input
and training/serving/consumer lineage; source and appearance/TOI exposure;
persistent talent validation separate from descriptive finishing; physical
forecasts/FPAR after foundation acceptance; production safety/rollback and
prospective evaluation. No new fit or production mutation occurred here.

## Reproduce and verify

Run `scripts/proof/check_current_xg_checkpoint.py --output` with a **new** directory
directly under `scripts/proof/results`, using the established offline Python
environment. Existing result directories are never overwritten.

Completed result: `scripts/proof/results/current-xg-checkpoint-20260907-full`.
Health SHA-256:
`2564cff75bafef837ba59f90b2f660310c32926099d0c4794ef82c52acf7412a`.
It includes the machine-readable checkpoint and complete consumed-file hashes.

Six focused tests pass. Full offline regression: **3,600 passed**, 16 network
tests deselected, 33 existing warnings. Receipt:
`scripts/proof/results/current-xg-checkpoint-20260907-suite.xml`.
An additional Node check verifies the checkpoint's health-listed file hashes.

The preserved [candidate replay](analytics-recent-candidate-replay-20260907.md),
[recent-candidate result](analytics-recent-timing-result-20260907.md),
[loss-gate rejection](analytics-timing-loss-gate-result-20260907.md) and
[bounded-prior trade-off](analytics-bounded-timing-prior-result-20260907.md)
remain the detailed evidence, not superseded or deleted reports.
