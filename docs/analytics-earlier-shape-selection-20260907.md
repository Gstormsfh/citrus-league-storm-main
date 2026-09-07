# Earlier-only calibrator selection: positive retrospective result

One declared rule: at each month boundary use the shape calibrator only if its cumulative earlier-original-cohort prequential Brier AND log loss are strictly lower than the recent reference. Otherwise retain that reference exactly. No parameter sweep. Recovered outcomes never select the model. Raw models, movement inputs and neutral quantities are unchanged.

| Original population | Reference Brier → selected | Reference log loss → selected |
|---|---|---|
| Fold 1 | 0.06100246569780218 → identical | 0.22463187894349188 → identical |
| Fold 2 | 0.05921239612098888 → 0.05917868749486358 | 0.21861966893179907 → 0.21847627252931476 |

Both point guards pass. Fold 1 always retains the reference. Fold 2 selects shape from December 2023 onward based on earlier predictions, not current-month outcomes. A separate Python implementation using `math.fsum` reproduced every monthly decision and original/recovered/expanded loss within 1e-12.

Runner: `scripts/proof/check_earlier_shape_selection.mjs`.
Create-only result: `scripts/proof/results/earlier-shape-selection-20260907.json`, containing exact source prediction hashes, code hash, monthly support/decision receipts and all population scorecards.

This is a modest historical improvement, not production acceptance. The rule was developed after inspecting these historical folds and previous failed alternatives; its construction is adaptive even though each simulated prediction uses earlier outcomes. No untouched test, selection-aware uncertainty, complete subgroup acceptance, full-vector inference packaging or production deployment has been established. Do not describe it as a demonstrated production accuracy gain or publish by changing an acceptance flag.
