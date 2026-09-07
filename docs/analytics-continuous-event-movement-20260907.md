# Continuous event-specific movement: tested development challenger

## Representation

The distance/time grid was diagnostic, not a final physical model. This experiment replaces its lateral and positive elapsed-time correction buckets with smooth functions. All original base-model inputs remain intact.

For same-team recorded event movement with positive elapsed time, use lateral distance divided by 40 feet, its square, and lateral distance divided by lateral-plus-longitudinal distance. Cross each with exponential decay at fixed 0.5-, 1.5- and 4-second scales. Learn separate coefficients for prior shot-on-goal code 506, missed-shot code 507 and other recorded events. Prior-event-specific temporal effects also use continuous decay. Recorded zero seconds gets a separate indicator, not infinite speed. Missing measurements do not become zero movement.

There is no correction discontinuity at the former lateral boundaries of 5, 10, 20 or 40 feet, or at positive elapsed-time boundaries such as three seconds. Base tree splits and categorical shot-distance corrections can still be discontinuous; this is not a claim that the entire model is globally smooth.

The coefficients are learned, not constrained to say every faster or wider recorded movement is more dangerous. Such a constraint would be unsupported for this mixture of prior events. The data measure event-to-event coordinates, not verified completed passes or goalie travel. Integer-second timestamps cannot establish subsecond shot timing. Tests showing decreasing decay bases are **not** tests establishing monotone final scoring probabilities.

## Training and comparison

Fit only on 2023–24 prequential frozen-ensemble predictions and their original full features. The continuous candidate directly replaces the earlier residual stack; it does not layer a smooth adjustment over the old lateral/time grid. Ridge10, fixed decay scales, supported categorical contexts and an unpenalized intercept were specified before execution. There are 81 fitted coefficients, including the base-logit slope and intercept.

The preceding experiment tested global logistic recalibration and event-context corrections on the grid. Global recalibration worsened Brier, calibration error and mean bias; reject it. Event-context corrections improved discrimination substantially but worsened mean bias.

2025–26 is an adaptively inspected development season, **not untouched validation**. The earlier-only fitting prevents fitting coefficients to that season, but does not remove hypothesis-selection bias. No production changes.

## Independently reproduced results

Same 116,506 eligible shots, with original source gates and actual outcomes preserved.

| Metric | Distance/time grid | Event-context buckets | Continuous event-specific |
|---|---:|---:|---:|
| AUC ↑ | 0.7650463242 | 0.7739354054 | 0.7737995570 |
| Brier ↓ | 0.0606475280 | 0.0602327676 | 0.0602182511 |
| Shot-level correlation ↑ | 0.2986660852 | 0.3100344117 | 0.3099410143 |
| Log loss ↓ | 0.2239233900 | 0.2216616410 | 0.2216193690 |
| Equal-width 10-bin calibration error ↓ | 0.0067679597 | 0.0062077738 | 0.0054054959 |
| Mean probability minus actual goal rate | +0.0013515466 | +0.0053341257 | +0.0053053625 |

The continuous candidate improves all four requested point metrics versus the grid. It improves Brier, log loss and binned calibration error versus the event-context candidate, but slightly loses AUC and correlation. These comparisons involve changes to both event conditioning and functional representation; do not attribute the entire grid-to-continuous gain solely to removing bins.

**Unresolved bias:** in the original fast-lateral category, 621 actual goals compare with 715.023 grid xG, 707.573 event-context xG and 720.819 continuous xG. Continuous does not solve this aggregate overprediction. Whole-cohort mean bias also worsens versus the grid even though binned calibration error improves. These are distinct calibration summaries.

## Evidence and checks

- `scripts/proof/test_grid_context_calibration.py` and `results/grid-context-calibration-20260907/`: global/event-context experiment and all fit/prediction receipts.
- `scripts/proof/test_continuous_event_movement.py` and `results/continuous-event-movement-20260907/`: continuous experiment, declaration, fit, independent scalar metric checks, source bindings and completion health.
- `scripts/proof/test_grid_context_units.py`: four passing tests for identity, monotonic global transform, unseen categories and prior-event/time separation.
- `scripts/proof/test_continuous_movement_units.py`: four passing tests for continuity, joint time/distance/direction inputs, recorded-zero treatment and event-specific surfaces.
- `scripts/proof/replay_movement_challengers.py`: both challengers replayed from original full input vectors and frozen base model parameters, with exact identities and labels checked.
- `scripts/proof/results/movement-challengers-replay-20260907/`: completed full replay, all 116,506 predictions for each challenger reproduced exactly; maximum probability error zero for both.

Keep both challengers and the earlier candidates as evidence. Neither is an unqualified production promotion. The remaining target is calibration on a separate chronologically later calibration season, plus checking event-proxy interpretation before asserting causal pass-difficulty rules. The frozen archive contains a 2024–25 season between fitting and the repeatedly inspected 2025–26 development season; it has not been used in these new fits or newly scored here.
