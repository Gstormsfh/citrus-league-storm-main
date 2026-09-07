# Verified movement-feature reuse: exact full-row comparison

The v2 verified fast path reproduced the slow source replay's complete
augmented rows, cohort metadata and validation groups. Each split's digest
includes every serialized row field, not only a row count or feature summary.
No model fitting, calibration selection, production write or promotion occurred.

## One local process comparison

| Path | Wall time | Peak process RSS, bytes |
|---|---:|---:|
| Verified v2 reuse | 80.478049375 s | 3,749,380,096 |
| Full source replay and movement reconstruction | 244.826326792 s | 2,461,876,224 |

This run's reuse path took about one third of the wall time (3.04× ratio),
saving 164.35 seconds, **but used more peak memory**. These are sequential local
process measurements, not repeated benchmarks or a general performance
guarantee. Filesystem caching and other machine activity were not controlled.
Timing covers the proof's verification/comparison work, not model fitting.

| Fold | Training rows | Calibration rows | Validation rows |
|---|---:|---:|---:|
| 1 | 180,038 | 119,916 | 120,080 |
| 2 | 299,954 | 120,080 | 121,033 |

These expanding folds overlap; their row counts must not be added as unique
observations. Full-row hashes and group hashes match exactly between modes.

## What the fast path verifies

`verified_movement_reuse_v2.py` binds completed conditional/movement health,
source and code closure, original export inventory, movement vectors, schemas,
folds and cohorts. It rehashes source bytes, rejects unsafe paths and inventory
drift, and binds Python/NumPy/SciPy/scikit-learn versions into its cache identity.
It reuses the original certification instant; it does not invent a newer
source-freshness or historical-as-of claim.

During the fast proof, baseline source adaptation, baseline projection, movement
history projection and `Replay.replay` were replaced by functions that raise if
called. Completion therefore verifies this path did not invoke those projectors.
The returned object's `verify()` rechecks disk closure and in-memory feature,
label, schema, configuration, cohort and group integrity. Consumers must call
it after their work; it is not a license to mutate data and skip final checks.

The v2 tests passed 22 cases before execution, including malformed identities,
source drift, absolute traversal and after-load mutations. No v2 source, tests
or proof files changed after this execution began.

## Receipts and independent check

- Fast: `scripts/proof/results/verified-movement-reuse-v2-fast-20260906/`.
  Report SHA-256 `0979a44988b6dbfa7502b4b6e70d0d664b70a97ec766c6ae4669d8ac83178bf8`;
  health SHA-256 `2ada9b942badd8f3e5d03da8028a6e4949628cec592f9225f27a9c1ec20e9930`.
- Slow: `scripts/proof/results/verified-movement-reuse-v2-slow-20260906/`.
  Report SHA-256 `a4f31155f937170595543243dcb7e736f2eddb4adbef625d5b513cc607e50091`;
  health SHA-256 `9551c5a9a3877076b43c91a371a80e95b5f0434011ca22c939fc78aae7b38180`.

An additional Node check recomputed both report/health hashes, required the exact
three-file inventory for each proof, confirmed the slow report's fast-reference
hash, and compared their complete comparison objects directly. The main agent
also independently confirmed these hashes and equality.

The original v1 module, tests, proof and completed preliminary fast receipt at
`verified-movement-reuse-fast-20260906` remain unchanged. V2 fixes were written
as new files after review identified absolute-path and in-memory verification
gaps. The preliminary v1 timing is not substituted into this v2 comparison.

This is local verified feature reuse, not a portable runtime bundle, accepted
xG model, untouched evaluation, new prospective reservation or FPAR acceptance.
