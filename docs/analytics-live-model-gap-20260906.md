# Remaining live model gap — read-only source review

Status: diagnostic, not serving approval. Repository/captured-definition review on
2026-09-06; no fresh hosted query, model deserialization, fit, collection or write.
Current deployment state cannot be inferred from local source alone. Prior live
captures remain dated evidence, not a newly authenticated production inventory.

## Critical distinction: three different scorers

| Callable path | Required model/feature state | Actual downstream path | Remaining boundary |
|---|---|---|---|
| Python acquisition `data_acquisition.py:104–164`, prediction at `2238–2293` | Prefers `xg_model_moneypuck.joblib` and companion feature list; fallback `xg_model.joblib`; separate encoders, optional xA/rebound artifacts. Files exist locally but were **not loaded** in this review. | Retained legacy ingest fields; do not equate these predictions with either SQL scorer. | Unknown artifact provenance/compatibility, import-time deserialization and suppressed version warnings. Missing features are inserted as zero; some missing values use the current scoring frame's median, not a pinned training transform. File existence is not verified callable inference. |
| SQL `citrus_score_v5_batch(integer)` → `xg_v5(...)` | Mutable v5 cell/parent/global/empty-net/moat tables and newer era/property dependencies; feature meanings include distance/angle, rebound, skaters, empty net and pass proxies. | `raw_shots.xg_v5` → on-ice/GAR; Python daily goalie/opponent reads also use this column. | Full inference is **not** exercised by the retained composed fixture. Exact fitted table contents and their training/source/feature/calibration lineage are not authenticated by function-body capture. |
| SQL `score_xg_sql_v2(integer)` | `nhl_xg_sql_keys`, `nhl_shot_fold`, `nhl_xg_sql_cells`, recorded/rink-adjusted geometry. | `nhl_shots.xg_sql` → season player/goalie/team totals, dashboard, season-stats rollup and Python finishing calculation. | Actual function/key plumbing has local cell-mode coverage, but synthetic cell values do not verify fitted production parameters or chronological generalization. Event-hash folds are not whole-game chronological holdouts. |

SQL evidence anchors: `docs/analytics-writer-lineage-audit-20260906.md:31–39`;
latest locally inspected v5 batch definition
`supabase/migrations/20260826200000_citrus_property_shape_rebounds_and_provenance.sql:420–442`.
Migration text is not proof that production currently has that exact definition.
The initial v5 migration's performance commentary is not revalidated here.

## What “zero eligible v5” really means

This is a **test boundary**, not a production population measurement.
`scripts/test_nightly_composed_locks.mjs:51–65` deliberately supplies already
scored synthetic rows and a throw-on-use v5 expression helper. The expanded
composed/cell proofs retain this restriction. Clearing a raw score would enter
the unimplemented fixture expression, not demonstrate a production failure.
See `docs/analytics-composed-nightly-20260906.md`, especially its cell-mode
limitations. Do not solve this by assigning more synthetic probabilities and
calling it successful model inference.

The two nightly entry points are also distinct:

- `.github/workflows/main.yml:41` runs Python
  `nightly_projection_batch.py`, which imports `calculate_daily_projection`
  at lines 77–78. This forecasts and writes projections; it does not load or
  validate either SQL model's fit just because it reads their output.
- Captured `nightly_xg_pipeline()` runs the raw-v5/strength/TOI/on-ice/GAR chain,
  then rink adjustment, legacy SQL scoring, season refresh and GSAx. Completing
  this SQL control flow does not establish that Python forecast assumptions or
  all consumer populations are valid.

## Concrete compatibility and availability gaps

1. **No approved interchangeable model artifact.** The separately saved new
   JSON models/calibration maps have source-replayed development evidence
   (`analytics-actor-attribution-result-20260906.md`), but are not drop-in v5
   cell tables or legacy joblib models. Their ordered numeric/categorical
   schema, missingness policy and calibrated variant must travel together.
   Existing pure entry points are `portable_context_model.predict_rows`
   (`portable_context_model.py:163`) and `calibration_shape.predict`
   (`calibration_shape.py:134`); no new invocation was performed here.
   They remain nonpublishing development candidates; replacing a filename or
   SQL version label cannot make legacy features compatible.
2. **Mutable values do not identify a model revision.** Captured score and
   aggregate schemas lack immutable source/model/feature/calibrator identities
   (`analytics-writer-lineage-audit-20260906.md:19`). A model label, `fitted_at`
   or row `updated_at` cannot reconstruct overwritten parameter contents or
   prove complete population coverage. Local immutable publication solves a
   transport contract, not current scorer authentication.
3. **Missing probabilities still enter forecast sums as zero.**
   `calculate_daily_projections.py:721` sums `xg_sql` through `or 0`;
   lines 980 and 1534 similarly coalesce missing `xg_v5`. This can turn
   incomplete scoring into apparently measured finishing/opponent/shot-quality
   inputs. The recently fixed dashboard null boundary does not repair these
   independent forecast reads. Preserve actual goals separately.
4. **Flags do not activate a verified replacement xG model.**
   `AnalyticsReadModelService.ts:75–78` enables TOI publication only when
   `ANALYTICS_TOI_PUBLICATIONS_ENABLED === 'true'`; default absence is off.
   That is not an xG model rollout switch. Legacy ingestion chooses its model
   by artifact availability/fallback, not a reviewed immutable model manifest.
   Existing rink-CDF default-off behavior must not be changed to make schemas
   appear compatible.

## Smallest usable next correction

First stop the known forecast consumption error, without replacing models:
introduce a narrow complete-score read contract for the three existing daily
forecast reads. Require finite nonnegative probabilities, preserve explicit
zero, and make missing/partial populations unavailable with an explicit reason
instead of returning a measured sum or refreshing a derived value. Preserve
official goals and existing outputs on failure. Trace each caller's unavailable
behavior before changing its return type; merely returning zero or a neutral
talent multiplier would conceal the problem.

Initial proposed disjoint implementation ownership (subsequently authorized for
the engine correction documented below):
`data-pipeline/projections/calculate_daily_projections.py` and targeted new tests
for its finishing/opponent/shot-quality readers. Coordinate before edits with
the FPAR/forecast owner; do not change physical forecast coefficients or root's
identity-probability/runner files. Tests should cover complete zeros, one missing
score, invalid values, failed page, source correction and unchanged official
goals. This is usable fail-closed behavior, not complete model acceptance.

To close the real inference gate after that, choose and pin one model contract;
freeze its exact source cohort, fitted parameters, preprocessing, calibration
and code; score at least one genuinely eligible official-source event through
the **actual chosen writer expression** and compare with independent pinned
inference before any database publication. For existing SQL models this needs
read-only parameter-table extraction in addition to function definitions. For
the new JSON candidate it needs an explicit additive adapter, not legacy schema
pretence, and quality/rollout gates remain. Retain all incompatible, unavailable
and corrected records. No hosted write is needed to diagnose this boundary.

## Local correction checkpoint (not deployed)

The separately authorized edit to `calculate_daily_projections.py` now rejects
missing/nonfinite/out-of-range probabilities, keeps measured zero distinct from
an undefined goals/xG ratio, and reads complete ordered stored score populations
without the old arbitrary shot limits. Player/season cache reuse is removed for
finishing because it cannot identify source corrections. Official goals remain
unchanged. This authenticates neither stored population against official PBP nor
mutable model lineage; ordered paged reads are not transaction snapshots.

Opponent context uses only the exact scheduled attacking side with a Boolean
`is_home_team`. Unknown ownership, duplicate identity, unknown period type,
missing selected-game coverage or failed reads withhold; explicit shootout rows
are excluded. Measured zero context retains zero xG/high-danger rate but its
finishing ratio is unavailable, and the dependent goalie forecast is withheld.

The team-rate reader had a more fundamental unit defect: its denominator summed
individual player ice time, not team elapsed exposure. It now explicitly raises
`unverified_team_elapsed_exposure` instead of manufacturing team duration or
returning a mislabeled rate. DDR and on-ice intermediates propagate that reason;
the existing top-level projection boundary returns no candidate on failure.
This will materially reduce available skater forecasts until verified exposure
is supplied. Unit success does **not** authorize rollout or measured-neutral
fallbacks. Other existing model priors are not validated by this correction.

Health is an explicit reason log plus `xg_input_health()` process-local reason
counters. The unchanged `nightly_projection_batch.py:848–925` drops absent
workers and can still print completion/rebuild ROS from old rows. Therefore
complete cross-worker expected/emitted/withheld health and stale downstream
refresh prevention remain a runner-level rollout gate, not a closed claim here.
This lane edits no writer, schema, old output, hosted database or FPAR file.

Historical source preservation was checked: the old engine bytes remain in
`scripts/proof/results/analytics-adaptive-calibration-checkpoint-20260906-1706/working-tree-source.tar.gz`.
Reading that exact archive member reproduces its recorded SHA-256
`1608ea01dfde0972984639b830ed08ec07d4206b41df9cc0b7fb0753dbb12c27` from
`working-tree-source-members.json`. The current source intentionally differs;
old receipts and archives were not rewritten or represented as current hashes.

The new selections are supported by local schema declarations:
`20250121000000_add_enhanced_features_to_raw_shots.sql:55–60` adds
`event_id INTEGER` and `period_type VARCHAR(20)` to `raw_shots`;
`20260804044538_document_schema_tables_and_moat_columns.sql:169` documents
event IDs as valid only within their own provenance lineage. No cross-provider
event join was added. This is local schema evidence, not fresh hosted catalog
verification. The old season-filter regression fixture was authorized to gain
explicit game/event identities; its filtering and numerical expectations stay
unchanged.
