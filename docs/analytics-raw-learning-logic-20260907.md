# Raw learning logic: capacity and missing inputs

Source comparison: `scripts/utilities/train_xg_v4.py` configures a legacy depth-six boosted-tree model; the certified offline reference uses `max_leaf_nodes=15`. The acquisition source already contains lateral-distance × immediacy and zone-context formulas. These are not new or presumed missing concepts. The legacy trainer was read as source only: no MoneyPuck files, model weights or data were loaded.

Two actual training-logic changes were tested on unchanged original inputs, seed and historical train/validation splits:

- **Capacity:** increase maximum leaves from 15 to 63, retaining all other settings. This tests additional interaction capacity; it does not recreate the legacy XGBoost algorithm or enforce depth six.
- **Native missing inputs:** retain original tree settings and missing indicators, but route numeric NaNs through the tree rather than substituting training medians.

| Model | Fold 1 Brier | Fold 1 log loss | Fold 2 Brier | Fold 2 log loss |
|---|---:|---:|---:|---:|
| Matched raw reference | 0.061189740693280585 | 0.2253990210850298 | 0.06041293784975856 | 0.2229609389950014 |
| Increased capacity | 0.06143222156249297 | 0.2261220883797458 | 0.060562427911780216 | 0.2233350453267276 |
| Native missing inputs | 0.061249665527528405 | 0.2255914893673753 | 0.06039824717203142 | 0.22288576727630277 |

Neither passes both periods. More leaves worsens both metrics in both periods. Native missing handling improves both metrics only in the second period. Neither is promoted; production remains unchanged. These outcomes do not establish that all capacity or missingness designs fail, or that the source audit is complete.

Runner and declaration: `scripts/proof/run_raw_learning_logic.py` and `scripts/proof/results/raw-learning-logic-20260907/declaration.json`. All candidate predictions, source hashes, summary and completion hashes are retained in that result directory. Source closure was verified before and after training. Independent Node arithmetic reproduced both-period losses and checked all output hashes. The reference is the matched raw model, not production or the strongest calibrated candidate. Previously inspected historical development folds do not constitute untouched validation.
