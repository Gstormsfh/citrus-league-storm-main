# Actual input change: raw movement-interaction retraining

Tested explicit same-team lateral movement, angular movement and centerline crossing multiplied by elapsed-time decay, plus a lateral-movement × proximity-to-net interaction. Both immediate recorded live events and prior same-team unblocked attempts supply these features. Same-clock geometry remains available without inventing a speed; missing geometry/ownership remains missing. These are recorded-event proxies, not actual tracked passes or goalie positions.

All original numeric and categorical inputs remain. Training-only imputation and missing indicators are used for the appended inputs. The reference and candidate raw boosted-tree models were retrained with identical original chronological splits, settings and seed. This is an input/logic experiment, not post-hoc calibration. It does not represent an exhaustive audit of the legacy or production model.

| Raw-model comparison | Reference Brier | New Brier | Reference log loss | New log loss |
|---|---:|---:|---:|---:|
| Fold 1 | 0.061189740693280585 | 0.061221486344912424 | 0.2253990210850298 | 0.22548126755440442 |
| Fold 2 | 0.06041293784975856 | 0.06042846070867022 | 0.2229609389950014 | 0.22288425428628753 |

Rejected: both metrics worsen in the first period; only log loss improves in the second. No production change. This raw-model reference is not the strongest composed candidate, so these numbers must not be presented as a direct comparison to that candidate or production.

Evidence: `scripts/proof/results/movement-interactions-20260907/`. Predictions, original/new feature names, training dates, settings, source hashes and completion hashes are retained. Source closure was verified before training and after scoring. An independent Node calculation reproduced both metrics from saved predictions and checked output hashes. Feature arithmetic/missingness regression test passed in `scripts/proof/test_movement_interactions.py`. The experiment uses previously inspected historical development folds, not untouched validation. Unaccepted trained estimators were not saved as deployable artifacts.
