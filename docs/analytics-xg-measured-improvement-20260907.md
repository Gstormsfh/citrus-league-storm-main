# Measured xG improvement: refreshed symmetric model + fixed ensemble

## Outcome

An executable offline candidate improves **AUC, Brier score and shot-level Pearson correlation in both historical evaluation periods**, compared with the strongest saved selected-timing candidate used in this comparison. Log loss also improves. This is a modest measured historical improvement, not a claim of production deployment or industry-leading accuracy.

| Period | Metric | Existing candidate | New fixed ensemble |
|---|---|---:|---:|
| 2022–23 | AUC ↑ | 0.7661636115227621 | 0.7671177844098549 |
| 2022–23 | Brier ↓ | 0.061002465697801454 | 0.06092552167158251 |
| 2022–23 | Correlation ↑ | 0.2957163679756453 | 0.2974247454556119 |
| 2022–23 | Log loss ↓ | 0.22463187894349046 | 0.22431456408485176 |
| 2023–24 | AUC ↑ | 0.7738350401919832 | 0.7754600495226945 |
| 2023–24 | Brier ↓ | 0.05917868749486365 | 0.05907413965531072 |
| 2023–24 | Correlation ↑ | 0.302707707525632 | 0.3052287688995984 |
| 2023–24 | Log loss ↓ | 0.2184762725293142 | 0.21798291993063892 |

Brier reductions are approximately **0.126%** and **0.177%** relative, respectively. Correlation here is Pearson correlation between individual shot probabilities and binary goal outcomes, not player-season projection correlation.

## What changed

1. **Training chronology:** the reference raw model had kept the following season entirely for calibration. The refreshed model trains on the original training cohort plus the first half of the original calibration dates. The next quarter of dates controls early stopping; the final quarter fits the existing conditional calibration family. Original evaluation dates stay later than all three stages. Entire games remain separated.
2. **Learned shot model:** XGBoost histogram trees learn from all original certified numerical and categorical inputs. The fixed settings, stopping points and fitted native JSON model files are retained. This is not multiplication of input columns or weighting training examples.
3. **Rink reflection:** current lateral position, prior lateral position and signed shot angle are transformed together into a common side-of-rink representation. Movement magnitudes, elapsed times, strength, shot type and other inputs remain available. Missing features remain missing. The experiment does not add actual tracked passes, goalie tracking or finishing talent data.
4. **Earlier-only timing updates:** the same four timing bands receive offset fits from preceding original-population events within 90 days, never contemporaneous or future outcomes.
5. **Fixed equal ensemble:** `new_xg = 0.5 * existing_candidate_xg + 0.5 * refreshed_symmetric_xg`. No blend-percentage search was performed. This retains useful existing predictions while combining a genuinely different fitted shot model.

The refreshed symmetric model also improves all three requested point metrics in both periods **without** the ensemble. The ensemble further lowers Brier, but does not dominate the refreshed model on every individual metric. The non-symmetric refresh and its fixed ensemble are preserved for comparison. These experiments change several aspects together; they do not establish which change alone caused the gain.

## Verification completed

- Exact original evaluation population: 120,080 events in fold 1 and 121,033 in fold 2, **241,113 total**. Reference and candidate use identical event identities and targets.
- Native model save/load and full-feature inference reproduced every refreshed prediction with maximum absolute error **0**.
- The complete existing-plus-refreshed ensemble was rebuilt from full feature vectors, not supplied score-table inputs. All ensemble probabilities reproduced with maximum absolute error **0**.
- Independent Node calculations reproduced rank-based AUC, Brier, Pearson correlation and log loss, and verified the exact 50/50 arithmetic and output hashes.
- **32 targeted tests passed**, including existing composed inference tests. Additional replay checks rejected training-game inputs, duplicate inputs and out-of-window dates, and confirmed current target labels do not affect prediction.
- Paired whole-game bootstrap, 2,000 fixed-seed samples: the ensemble-minus-reference Brier intervals are `[-0.0001145948, -0.0000386106]` and `[-0.0001429564, -0.0000657681]`. Both exclude zero in these exploratory historical comparisons. No corresponding significance claim is made for AUC or correlation.

## Exact artifacts

- Training, fitted native models and chronological stage membership: `scripts/proof/results/bounded-xg-refresh-20260907/`.
- Ensemble scores, predictions, bootstrap intervals and independent review: `scripts/proof/results/refresh-ensemble-20260907/`.
- Saved-model full-feature replay: `scripts/proof/results/refreshed-xg-replay-20260907/`.
- Complete two-model ensemble replay and dated manifest: `scripts/proof/results/refreshed-ensemble-full-replay-20260907/`.
- Test receipt: `scripts/proof/results/refreshed-ensemble-tests-20260907.xml`.
- Executable code: `scripts/proof/run_bounded_xg_refresh.py`, `scripts/proof/replay_refreshed_xg.py`, `scripts/proof/refreshed_xg_ensemble.py`.

All output directories are create-only. Existing evidence, actuals and model artifacts were preserved. No MoneyPuck files, data or model weights were loaded.

## Remaining boundary

These historical periods have been repeatedly inspected during development. This is **not untouched validation**, and exploratory intervals are not adjusted for all prior comparisons. The ensemble was proposed after seeing the first refreshed model's first-period scores, before the other scores were observed. Mean calibration bias does not improve consistently, despite lower Brier/log loss; this is not a blanket calibration claim.

**Production remains unchanged.** These date-bounded historical models must not be applied directly to current games. Current-date training, untouched later evaluation, production input equivalence and deployment/rollback validation remain necessary before claiming live accuracy improvement. Finishing/talent, FPAR and the broader input audit are not declared complete by this result.
