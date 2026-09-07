# Prior-SOG source fidelity and residual result

The targeted source audit completed with zero prior-state mismatches across all
241,113 evaluated events. The saved classifier states are faithful to their
declared immediate-raw-predecessor definition. That does **not** establish that
recorded clock differences consistently represent physical rebound timing.

The strongest next lead is a large cross-period timing/outcome discontinuity,
not evidence that a movement input was silently omitted. Existing event-type,
time and movement inputs remain preserved; no model was fitted or changed.

## Source and execution

Plan: `analytics-prior-sog-fidelity-plan-20260906.md`, SHA-256
`323b2c1e886605255ac0e66eae87bd34fbf4e248b933292c35a2b7de754803a7`.
Result directory: `scripts/proof/results/prior-sog-fidelity-20260906-full/`.
Health SHA-256:
`bc30a53dbd06331e7f065f053bf0300a3606004ff98a6df6c2d8496784091569`.

Every selected event was joined to its frozen raw game body and immediate array
predecessor, retaining goals, saved shots and missed shots. Raw IDs, order,
periods, clocks, game dates, target labels, saved contexts and scorecard groups
were checked. Body and receipt bytes were hash-bound. All recorded predictions
were preserved. Geometry availability was recorded separately and never used
to change the prior-SOG state. This is a targeted state audit, not an independent
reconstruction or acceptance of every model feature.

## Observed distinctions

The state is one for an immediate same-period, same-team type-506 predecessor
with recognized owners, **without a time cutoff**. It is zero for other eligible
live predecessors with recognized owners (including faceoffs). Non-live
predecessors and unavailable prerequisites produce null.

All null states in these evaluated periods came from non-live predecessor types;
none came from absent predecessors, period boundaries or invalid owners.
Theoretical null causes therefore differ from the causes observed here.

| Raw predecessor code | Oct 2022–Jun 2023 | Oct 2023–Jun 2024 |
|---|---:|---:|
| 535 (observed raw description: delayed-penalty) | 480 | 592 |
| 509 (penalty) | 52 | 46 |
| 516 (stoppage) | 41 | 23 |
| Total null context | 573 | 661 |

The exact prior-code breakdown is descriptive inspection of retained classifier
facts; it is not a fitted correction or a new uncertainty estimate.

## Short-clock weakness

These cells use the predeclared gap bands and unchanged expanding predictions.
With the source's integer-second clocks, `(0,1]` is exactly one second.

| Prior same-team SOG gap | Period 1 events / goals / xG | Period 2 events / goals / xG |
|---|---:|---:|
| Same clock | 403 / 110 / 134.668 | 279 / 7 / 79.236 |
| One second | 2,824 / 359 / 498.191 | 3,310 / 134 / 522.361 |
| Two seconds | 2,127 / 388 / 392.135 | 2,353 / 415 / 408.529 |
| Three through ten seconds | 5,908 / 443 / 426.554 | 5,521 / 643 / 372.312 |
| Over ten seconds | 6,017 / 395 / 362.195 | 5,587 / 390 / 310.308 |

The aggregate prior-SOG overprediction hides opposite-signed residuals: very
short gaps overpredict heavily, whereas longer gaps underpredict. Expanding
calibration improves aggregate losses and the shortest-gap cells, but worsens
both point losses in the three-to-ten and over-ten-second prior-SOG cells in
both periods. This is not evidence of a universal subgroup improvement.

The sharp change in same-clock and one-second observed goal rates warrants a
source-era timing audit before another calibration fit. Source convention,
event ordering, sample composition and model error are hypotheses, not causes
established by this accounting. Do not interpret recorded event displacement
as measured goalie motion or relabel these events to improve the score.

## Checks and next gate

All 129 focused tests passed: 28 classifier author tests, 21 runner author tests
and 80 independent tests. Tests include original-helper state parity, exact
clock edges, current-outcome invariance, missed-shot retention, a genuine
hash-pinned game replay, source rejection and count/expected-goal/loss conservation.

Full offline suite: **3,286 passed**, 16 network tests deselected, 33 existing
deprecation warnings. Receipt: `scripts/proof/results/prior-sog-fidelity-20260906-suite.xml`.
The number-verification skill was used to anchor claims in these receipts.

Independent read-only result review verified all eight health-bound output
files and all 13,153 consumed-file hashes, exact event/target/prediction/context
joins and every accounting cell using separate arithmetic, with zero numerical
difference reported. No bootstrap or independent all-feature replay was claimed.

Next bounded diagnostic: compare timing and ordering conventions across the
original training, calibration and validation eras; examine exact clocks,
repeated locations/actors and goal-versus-nongoal predecessor timing. Separately
check delayed-penalty contexts against recorded strength and empty-net state.
Preserve all original values and fit no validation-derived correction. No
production, finishing, talent, FPAR or overall model acceptance follows here.
