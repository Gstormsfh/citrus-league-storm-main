# Legacy xG serving audit: source wiring, not deployed proof

This read-only audit preserves the original pre-shot context and derived-model
families. It does not load old serialized models, establish their fitted version,
measure deployed rows, or change production. The number-verification skill was
used to avoid treating filenames, comments or source feature lists as deployed
artifact evidence.

## Findings

1. **Artifact identity is not bound atomically.** Acquisition loads mutable
   `xg_model_moneypuck.joblib`, a separate feature list and three separate encoders
   (`data-pipeline/acquisition/data_acquisition.py:104–145`). The v3 trainer writes
   those independently (`scripts/utilities/train_xg_v3.py:561–575`). The inspected
   startup does not verify a manifest binding model, schema, encoders and
   calibrator. Filenames alone do not identify the fitted model version.
2. **Scoring routes differ.** Daily processing calls `process_single_game_json`
   (`data-pipeline/scoring/run_daily_pbp_processing.py:133–135`). Its preferred-model
   path clips probabilities at 0.60 (`scripts/utilities/process_xg_stats.py:368`).
   Acquisition's per-game and aggregate routes clip at 0.95 (`2291`, `3854`). The
   recomputation helper returns unclipped predictions
   (`scripts/utilities/rescore_xg_2025_recomputed.py:205–211`). These are source
   differences, not newly verified production impact counts.
3. **Missing inputs depend on run composition.** Acquisition computes medians
   from the prediction frame (`2262–2284`, `3816–3845`), creates absent model
   columns as zeros (`2238–2258`), and can fit an encoder on that frame when a
   saved encoder is missing (`2225–2229`, `3764–3768`). An identical shot's
   missing feature can therefore change when different shots share the batch.
4. **Unknown categories differ by path.** Acquisition maps unseen event labels
   to `OTHER` (`2214–2224`); the utility directly transforms strings
   (`scripts/utilities/process_xg_stats.py:257–259`). An unknown category can fail
   one route but pass another, subject to the actual saved vocabulary.
5. **Calibration code exists, but no Python caller was found.** Repository search
   found only the definition of `calculate_calibrated_xg`
   (`scripts/utilities/feature_calculations.py:722`). Its default resolves root
   `models/`, whereas the preserved artifact is in `data-pipeline/models/`. The
   helper expects `shot_type_models/global_model`; v4 trainer creates
   `global/by_shot_type` (`scripts/utilities/train_xg_v4.py:716`). These are separate
   interfaces, not proof of the actual serialized package's structure. Do not
   connect them without an explicit compatible contract and validation.
6. **Original derived families remain important.** Aggregate acquisition applies
   rebound prediction (`3909`), flurry adjustment (`3947–3967`), shooting-talent
   adjustment (`3969–4000`) and created expected goals (`4002–4010`). Their source
   existence is confirmed; numerical parity with other routes is not. They must
   not be presented as new ideas or silently omitted from replacement planning.

## Executable diagnostic

`scripts/proof/test_legacy_serving_diagnostics.py` isolates the actual two
acquisition imputation loops with AST selection, without importing startup or
predictors. For the same missing time-since-event observation it witnesses values
of 2, 20 and 11 seconds as other frame rows change; alone it becomes zero.
Observed values remain unchanged by the isolated loop. Passing these tests
documents current behavior, not desired behavior. The tests do not prove a
particular model tree uses that feature or quantify a prediction difference.

Executed result: **6 passed**, with receipt at
`scripts/proof/results/legacy-serving-diagnostics-20260906.xml`. This is an
additional targeted diagnostic run, not a rerun of the full pipeline suite.

## Required gates

Capture a safe manifest of the deployed artifact bundle; bind a single immutable
training/serving feature contract; replay identical events through every scoring
route with fake predictors first; require same-shot feature invariance under
game splitting and run composition. Preserve raw, calibrated, flurry and
talent-adjusted outputs as distinct quantities. Correct feature semantics with
retraining and chronological validation rather than hot-patching distributions
under an old fitted model. Removing clipping alone is not an accuracy fix.

This is a bounded audit. Database schema, live process configuration, serialized
contents and exhaustive runtime route parity remain outside its verified scope.
