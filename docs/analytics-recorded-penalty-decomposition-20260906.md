# Matched-shot penalty error decomposition

Completed no-fit evidence:
`scripts/proof/results/recorded-penalty-decomposition-20260906-full/`.
Health SHA-256: `deab6d4c9f38c242eced78d91b16b8f62770b0cad05b6107ff19ad612a5ac192`.

## Finding

The later-period penalty-candidate regression is already present in the raw
probabilities. It cannot be explained solely by the calibration adjustment.
The earlier period shows small raw gains, so this is not a stable improvement
across the two periods. The candidate remains rejected under its original guard.

All differences below are candidate minus frozen movement control; positive
means worse. The calibration residual is the **difference between the two
models' calibration effects**, not a causal attribution or the standalone
benefit/harm of either calibrator.

| Fold | Loss | Raw change | Calibration residual | Total calibrated change |
|---|---|---:|---:|---:|
| Earlier | Brier | -0.000013261 | +0.000003080 | -0.000010181 |
| Earlier | Log loss | -0.000026808 | +0.000012981 | -0.000013827 |
| Later | Brier | +0.000012378 | -0.000000166 | +0.000012212 |
| Later | Log loss | +0.000053835 | +0.000006341 | +0.000060175 |

All aggregate raw and total intervals cross zero. This decomposition explains
the observed point differences; it does not establish a population-wide causal
effect of adding penalty fields or a new model-quality claim.

### Prior-shot context

The later fold's prior-same-team-SOG group contains 17,050 events. Its raw
log-loss change is +0.000655990 (fixed-fit paired game-bootstrap 95% interval
[+0.000389167, +0.000931586]); its calibrated change is +0.000662384.
The raw Brier change is +0.000185036, versus +0.000175889 calibrated.
Thus this important group's observed regression precedes calibration.

Its weighted total log-loss contribution is +0.000093310, offset partly by
-0.000035154 from the not-prior-same-team-SOG group and +0.000002019 from
unknown prior-shot context. Those contributions sum to the full-fold change;
overlapping probability-band rollups must not be added to them.

The earlier fold's same subgroup has negative raw point changes with intervals
crossing zero. These development subgroups are exploratory and subject to
multiple comparisons; recorded prior SOG does not certify rebound possession.
Do not route shots to a different model based on these validation results.

## What makes the comparison matched

The utility joins old raw, old calibrated, new raw and new calibrated outputs
using exact game/event identity and identical labels. Existing contexts and
saved diagnostic predictions must match. All models use the frozen old
calibrated probability to assign bands, including the same endpoint rules.

The cross-cells are probability band × prior-SOG context × exact same-team
annotation state × exact opponent annotation state. Unknown states are not
replaced with zero or omitted. Earlier: 120,080 events, 1,378 games, 130 observed
cells (75 sparse). Later: 121,033 events, 1,383 games, 153 observed cells
(101 sparse). Sparse means fewer than 100 events or 30 games; cells remain
visible regardless. Empty Cartesian combinations contain no observed evidence.

At each shot, total loss change equals raw loss change plus calibration residual.
Weighted cell contributions conserve the whole-fold change. All components and
cells share 256 fixed-fit whole-game resamples. Cell contributions use the entire
resampled fold's event count; cell means use their own resampled event count.
Absent cells contribute zero; their undefined cell means are excluded and counted.
The intervals condition on fixed models, not retraining or adaptive selection.
Their endpoints cannot be summed. This diagnostic uses its separately recorded
seed, so its intervals need not exactly equal the prior scorecard's intervals.

## Reproduction and boundaries

`scripts/proof/decompose_recorded_penalty.py` consumes health-pinned JSON outputs,
not serialized executable models. It writes its declaration before computation,
refuses an existing destination, records source/code/runtime hashes, checks
consumed bytes again afterward and seals outputs. Run with the recorded NumPy
runtime and a new output directory:

```sh
python scripts/proof/decompose_recorded_penalty.py \
  scripts/proof/results/recorded-penalty-decomposition-NEW-RUN
```

Author and independent synthetic tests cover arithmetic, identity matching,
probability boundaries, conservation, deterministic shared bootstrap weights,
empty draws, immutable inputs and create-only destinations. No model was fitted,
no production or database changes were made, and no original input was removed.
The full original-family audit and foundation acceptance gates remain open.

Verification receipts:

- Focused Python tests: 36 passed, saved in
  `recorded-penalty-decomposition-20260906-tests.xml` under proof results.
- Combined pipeline/proof offline suite: 2,829 passed, 16 network tests
  deselected, 33 existing UTC-deprecation warnings; receipt
  `recorded-penalty-decomposition-20260906-full-suite.xml`. Focused tests overlap
  this suite and are not additive.
- Independent JavaScript reviewer: 13 tests passed. Completed evidence in
  `recorded-penalty-decomposition-review-20260906-full/` rechecks identities,
  all observed cells, both rollups, proper-loss point values and conservation.
  It performed 4,362 point comparisons with maximum discrepancy 2.22e-16.
  It did not independently reproduce the bootstrap intervals or rederive
  contexts from raw events. Health SHA-256:
  `c2edd6ceea21ce4c9ac0cabb255cb2314ae6a7d57661ae822520ffcc56253c93`.

## Decision

Keep the frozen movement/conditional candidate and all rejected evidence. Do not
try to rescue the penalty candidate by calibrating the exposed validation groups.
A subsequent experiment must preserve movement inputs and address raw-model
stability, select settings using training-side chronological splits only, and
retain the unchanged validation guard. Final superiority requires separately
untouched or prospective evidence; FPAR does not bypass that foundation.

Next experiment specification: compare movement versus movement plus recorded
penalties on predeclared chronological splits entirely inside original training
membership, initially keeping the existing architecture and settings fixed.
No hyperparameter sweep, calibration rescue or subgroup-specific model switching.
Only repeatable training-side gains warrant another separately declared candidate;
otherwise retain this recovered input as unhelpful for the tested setup and
advance to other input-recovery obligations. This experiment has not yet run.

## Preservation

`scripts/proof/results/analytics-input-recovery-checkpoint-20260906-2041/receipt.json`
records a verified local source/evidence duplicate, including this diagnostic
and its independent review. Earlier originals and the prospective reservation
remain intact. This is not an off-machine backup or a complete runtime image.
Loose root-level JUnit receipts remain separately retained, outside the listed
archive directories. This next-step/preservation addendum was written after the
snapshot; the snapshot contains the preceding version of this report.
