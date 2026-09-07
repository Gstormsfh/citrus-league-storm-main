# Explicit factor percentages: a qualified positive result

## Actual formula located

`data-pipeline/acquisition/data_acquisition.py::calculate_pass_quality_score` uses zone/immediacy/movement/distance weights **40/30/20/10**. `scripts/utilities/train_xg_v4.py::V4_FEATURES` includes `pass_quality_score`. These are composite-feature percentages, not direct shares of final xG or feature-importance percentages.

Tested **30/30/30/10** (movement-heavy) and **30/40/20/10** (immediacy-heavy) against the original mix. Each arm appends the same one-dimensional composite plus a missing flag to the original certified raw-model features; only its percentages change across these arms. The no-composite raw reference is also reported. Training cohorts, settings, seeds and unweighted evaluation events remain fixed.

## Result: movement-heavy versus original mix

| Period | Metric | Original mix | Movement-heavy mix |
|---|---|---:|---:|
| Fold 1 | AUC, higher better | 0.7643354192 | 0.7643735155 |
| Fold 1 | Brier, lower better | 0.0612151752 | 0.0611918373 |
| Fold 1 | Log loss, lower better | 0.2254738786 | 0.2254198869 |
| Fold 1 | Calibration ECE, lower better | 0.0053569929 | 0.0051994258 |
| Fold 2 | AUC, higher better | 0.7617625506 | 0.7621193236 |
| Fold 2 | Brier, lower better | 0.0604124218 | 0.0603901260 |
| Fold 2 | Log loss, lower better | 0.2229747540 | 0.2228764213 |
| Fold 2 | Calibration ECE, lower better | 0.0074446970 | 0.0076041964 |

The movement-heavy percentages improve AUC, Brier and log loss over the original composite percentages in both historical periods. Calibration does not improve consistently: ten-equal-width-bin ECE worsens in fold 2. Full reliability-bin means/counts and signed calibration bias are retained. The immediacy-heavy mix also improves AUC/Brier/log loss over the original mix in both periods, but has mixed calibration results.

**No promotion:** neither changed mix beats the no-composite raw reference on all requested metrics in both periods. The strongest existing composed candidate is not this raw reference. No production accuracy gain is established; no production parameter was changed.

## Important scope boundary

These inputs reconstruct the formula from the immediate recorded same-team event in the certified feature vectors, not independently verified legacy pass attribution. The explicit shooting-team coordinate frame is preserved rather than copying the legacy sign-based coordinate flip. Recorded event movement is not tracked puck passing or goalie movement. This is therefore a controlled test of legacy-style factor percentages on an offline proxy, not a replay or replacement of deployed legacy model weights. No MoneyPuck files or weights were loaded.

The periods are previously inspected historical development data, not untouched validation. Point improvements are small and no statistical significance is claimed. AUC, proper probability scores, calibration error and bias are separate criteria; improvement in one is not proof of the others.

## Evidence

Runner: `scripts/proof/run_pass_factor_percentages.py`.
Create-only results: `scripts/proof/results/pass-factor-percentages-20260907/`.
The declaration records exact percentages and code hash before fitting. All event predictions, calibration reliability tables, source hashes and completion hashes are retained. Source closure verified before/after training. Component arithmetic, missingness and percentage sums tested. Independent Node rank-based AUC, Brier and log-loss arithmetic reproduced the saved scores; output hashes verified.
