# Citrus Data Inventory

**Last updated:** 2026-09-06 · **Status:** Stable canonical structure
**Maintainer protocol:** When adding any new data artifact (table, file, model, script), update this doc inline. The companion `apps/web/docs/DATA_ORGANIZATION_AUDIT.md` holds the full audit + reorganization history (phases R1-R6 complete); this file is the day-to-day "where does data live?" reference.

**Reorganization complete:** see [`apps/web/docs/DATA_ORGANIZATION_AUDIT.md`](./apps/web/docs/DATA_ORGANIZATION_AUDIT.md) §§7-8 for R5 dispositions + Investigation 1 model-lineage findings. R6 archived the Dec 2024 pre-monorepo repo to `~/Documents/_archive/citrus-pre-monorepo/` — see `README_ARCHIVED.md` at that location for the full lineage map.

---

## 1. Active data sources

### 1.1 Supabase projects (organization `zgxmcbfbwwbspmtxjmtk`)

| Project | ID | Created | Role |
|---|---|---|---|
| **CitrusFantasySports (prod)** | `iezwazccqqrhrjupxzvf` | 2025-09-01 | Primary user-facing database. Read by `apps/web/`, `server/`, `data-pipeline/`. Mountain-Time, region `ca-central-1` |
| **citrus-staging** | `jjgspcpvqaiitloglxbb` | 2026-04-23 | Staging environment for `staging-deploy.yml`. Mostly empty; populated via the `scripts/staging/04-load-stats-data.mjs` flow |

**Recovery posture:** pre-launch on free-tier daily backups (RTO ~24h,
RPO up to 24h, $0/mo). PITR upgrade ($~100/mo) is gated on user state —
see [`docs/RECOVERY_STRATEGY.md`](docs/RECOVERY_STRATEGY.md) for the
trigger rules. Verification procedure:
[`docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md`](docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md).

### 1.2 What lives in prod (Supabase, by storage size)

| Table | Rows | Size | Owner / writer |
|---|---|---|---|
| `player_shifts` | 341,612 | 86 MB | `data-pipeline/acquisition/ingest_shiftcharts.py` |
| `player_shifts_official` | 198,110 *(pg_class estimate; list_tables reports 0 — see audit §6)* | 34 MB | unclear |
| `raw_shots` | 99,322 | 81 MB | `scripts/utilities/populate_raw_shots.py` ← `data-pipeline/acquisition/data_acquisition.py` |
| `player_projected_stats` | 70,296 | 45 MB | `data-pipeline/projections/nightly_projection_batch.py` |
| `integrity_check_results` | 65,431 | 16 MB | likely `scripts/utilities/validate_*.py` or similar |
| `player_toi_by_situation` | 64,308 | 14 MB | `scripts/utilities/calculate_player_toi.py` |
| `player_game_stats` | 53,358 | 36 MB | `scripts/utilities/process_xg_stats.py` + boxscore loaders |
| `raw_player_stats` | 15,489 | 2.2 MB | **RLS disabled** (advisory). Source unclear |
| `fantasy_daily_rosters` | 8,848 | 12 MB | server `LeagueMembershipService` writes |
| `staging_2024_skaters` / `staging_2025_skaters` | 4,600 / 3,945 | ~3 MB each | **RLS disabled**, source unclear (legacy staging?) |
| `nhl_games` | 1,385 | 1.3 MB | `data-pipeline/acquisition/ingest_nhl_playoff_bracket.py` + schedule ingestor |
| `raw_nhl_data` | 1,350 | 41 MB (JSONB) | `data-pipeline/acquisition/ingest_raw_nhl.py` |
| `player_directory` / `player_season_stats` / `player_talent_metrics` / `player_gar_components` / `player_ros_projections` | 938 / 1066 / 1012 / 935 / 926 | <1 MB each | `build_player_season_stats.py` owns season stats plus talent xG/60 and official-appearance average TOI; other fields have separate writers |
| `goalie_*` family | 82-197 | <200 KB each | `scripts/utilities/calculate_goalie_*.py` |
| `ops_ci_runs` | 0 at creation (2026-09-01); ~20 rows per CI run | grows ~1 MB/month | `.github/actions/report-run` (every job in `ci.yml`, `production-deploy.yml`, `main.yml`, `data-invariants.yml`, `schema-snapshot.yml`) over PostgREST with the service-role key. Service-role only (RLS on, no policies). Read by Claude via MCP — `docs/RUNBOOKS/CI_TELEMETRY.md` |
| `draft_kit_entitlements` / `draft_kit_blurbs` | 0 / 0 | negligible | **Migration written, NOT applied** (`supabase/migrations/20260902090000_draft_kit_entitlements_and_blurbs.sql`). Draft Kit paid section: who is entitled, and the human-written copy. Both service-role write only; see §1.3 |

**Critical observations:**
- `player_shifts_official` has a row-count discrepancy (pg_class says 198K, list_tables says 0). Worth investigating.
- `raw_player_stats`, `staging_2024_*`, `staging_2025_*`, `team_stats`, `players` (the lowercase non-schema-qualified version), `2025_Skaters` — **all RLS-disabled** (advisory) and many appear unused in app queries. Candidates for orphan triage.
- `public.public.players` — table literally named `public.players` inside the public schema (double-schema-prefix in the name). Almost certainly an artifact of a bad migration. Flagged.
- See `apps/web/docs/DATA_ORGANIZATION_AUDIT.md` for orphan analysis details.

### 1.3 Draft Kit tables

`supabase/migrations/20260902090000_draft_kit_entitlements_and_blurbs.sql`
adds the two tables behind the paid `/draft-kit` section. **Applied to prod
2026-09-02** (verified: RLS on, 0 write policies, `citrus_draft_kit_tier()`
SECURITY DEFINER with `search_path` pinned). Not yet applied to staging.

| Table | Purpose | Write path | RLS |
|---|---|---|---|
| `draft_kit_entitlements` | One row per user per tier grant (`kit` \| `suite`), with `granted_at` / `expires_at` / `source`. FK to `auth.users` with ON DELETE CASCADE | service role only | Enabled. SELECT policy is `auth.uid() = user_id`; no write policy exists, so a client cannot grant itself access |
| `draft_kit_blurbs` | Human-written kit copy. `author_name` is NOT NULL, `source_name` / `source_url` are CHECKed to travel as a pair, `is_published` gates visibility | service role only | Enabled. Free-tier rows readable by anon; paid rows gated on a live entitlement for `auth.uid()` |

`draft_kit_blurbs` is populated from Markdown files under
`data-pipeline/draftkit/blurbs/` by `data-pipeline/draftkit/load_blurbs.py`
(see §3.2). Each file's row id is `uuid5` of its path relative to that
directory, so a re-run updates the row it came from rather than duplicating
it; renaming a file orphans the old row, which `--prune-sql` reports and
never deletes on its own.

The migration also adds `public.citrus_draft_kit_tier()` — SECURITY DEFINER,
`SET search_path = public`, and deliberately argument-less so there is no user
id for a caller to forge. It returns the calling user's live tier or `'free'`.

The section READS existing tables and adds none of its own data:
`player_directory` (identity, club, headshot), `player_season_stats`
(actuals, `x_goals`), `player_gar_components` (the impact decomposition),
`player_talent_metrics.xg_per_60`, `player_ros_projections` (projected
fantasy points), and `goalie_xg_season` (GSAx). Percentiles are computed
server-side inside F / D / G cohorts and are not stored.

`player_talent_metrics.avg_toi_per_game` is written by
`data-pipeline/projections/build_player_season_stats.py` from regular-season
appearances only. Every TOI measurement must be present; stored zero requires
confirmation as `0:00` or `00:00` in the NHL regular-season game log. The
distinct appearance count must match NHL landing featuredStats for the exact
season and regularSeason.subSeason.gamesPlayed (or an unambiguous historical
single-team NHL season total). `monitoring/appearance_contract.py` also compares
the exact game set and every stored TOI measurement with the complete official
game log. Missing or mismatched evidence
writes NULL and is counted as withheld in the health log. Official lookups use
one landing and one game-log request per skater, with bounded retries;
ambiguous historical totals are withheld. Invalid skater season rows and new
xG rates are withheld; the job reports counts and exits 2 on incompleteness.
The previously unapplied `20260906002239` backfill was withdrawn:
season totals alone do not establish input completeness. Any future backfill
requires a verified source snapshot, staging proof, backup and rollback.

### 1.4 Versioned analytics foundation (local, unapplied)

Recorded event-memory ablation (2026-09-06):
Matched corrected movement is now complete: `docs/analytics-movement-result-20260906.md`;
plan `docs/analytics-movement-candidate-plan-20260906.json`, runner
`scripts/proof/run_movement_candidate.py` and its tests. Full coverage runner
`scripts/proof/replay_movement_coverage.py`, sampled compatibility
`scripts/proof/audit_movement_source_sample.py`, saved-vector review
`scripts/proof/review_movement_vectors.py`, and independent point reviewer
`scripts/proof/review_movement_candidate.mjs` retain create-only results under
`movement-coverage-*`, `movement-source-audit-*`, `official-movement-*`,
`movement-vector-review-*` and `movement-candidate-review-*`. Primary fails
the both-fold gate; no deployment. Separate incident public-routing observations
under `public-routing-20260906-incident` are not xG acceptance evidence.
Full-input recovery checkpoint: `docs/analytics-input-recovery-checkpoint-20260906.md`.
Finishing/shooter-talent preservation detail:
`docs/analytics-finishing-talent-preservation-20260906.md`. The additive
`data-pipeline/tests/test_legacy_finishing_uncertainty_diagnostics.py` isolates
legacy multiplier/cap and uncertainty arithmetic without loading model artifacts.
The final scoped receipt is `finishing-talent-preservation-20260906-final-tests.xml`
under proof results. These diagnostics reproduce existing behavior and an
uncertainty-centering mismatch; they do not accept a new talent model or change
production. Shooting percentage, finishing relative to neutral xG, talent
multipliers and downstream forecast uncertainty remain separate obligations.
`scripts/proof/finishing_quantity_contract.py` is an additive offline structural
contract with `test_finishing_quantity_contract.py`; it distinguishes SOG and xG
exposure, observed ratios, count-rate multipliers and identity odds effects, and
rejects mechanical double application. See
`docs/analytics-finishing-quantity-contract-20260906.md` and the scoped
`finishing-quantity-contract-20260906-tests.xml` receipt. This is not a fitted
talent model, source-availability proof or production acceptance gate.
Saved shooter-identity evidence replay:
`scripts/proof/replay_shooter_evidence.py`, its dedicated tests, and
`scripts/proof/results/shooter-evidence-replay-20260906-full/`. See
`docs/analytics-shooter-evidence-replay-20260906.md`. This replays an older
secondary model and reconciles observed-shot player totals; it is not a new
talent fit, constant finishing multiplier, future-exposure forecast or promotion.
Forward shooter/movement experiment declaration:
`docs/analytics-forward-shooter-movement-plan-20260906.json` fixes a three-stage
forward holdout using the frozen movement model, an earlier-only conditional
map, then later shooter-effect fitting. The deterministic helper is
`scripts/proof/forward_shooter_split.py` with its dedicated tests; the create-only
runner is `scripts/proof/run_forward_shooter_movement.py`. All movement inputs
remain intact. This is not pooled cross-fitting, an untouched final test,
constant talent-multiplier estimation or production authorization.
Execution history: `docs/analytics-forward-shooter-execution-20260906.md`.
The first attempt stopped before fitting on a hash-domain implementation error;
its runner and evidence remain intact. `run_forward_shooter_movement_v2.py`
corrects raw-body versus adapted-envelope verification without changing the
statistical plan, with author and genuine frozen-source regression tests.
Completed fitted result: `docs/analytics-forward-shooter-result-20260906.md` and
`scripts/proof/results/official-forward-shooter-movement-20260906-retry1/`.
The shooter candidate failed its declared accuracy guard in both folds; it is
not promoted. Neutral xG, finishing quantities and downstream gates remain
distinct, with original inputs and evidence preserved.
Next no-fit diagnostic specification:
`docs/analytics-forward-shooter-decomposition-plan-20260906.md`. It separates
map-pipeline, global-adjustment and shooter-increment losses on identical
frozen-probability bands, calendar months and prior-SOG context, retaining
sparse and unknown cells. This is loss accounting, not causal attribution,
refitting or acceptance.
Implementation: `scripts/proof/decompose_forward_shooter.py`, with author and
independent Python tests. Independent point review:
`scripts/proof/review_forward_shooter_decomposition.mjs` and its tests. The
create-only run retains four-source identity checks and a fixed whole-game
bootstrap; point review is not an independent bootstrap or fitted-model review.
Completed diagnostic and independent review:
`docs/analytics-forward-shooter-decomposition-result-20260906.md`, with outputs
under `forward-shooter-decomposition-20260906-full` and
`forward-shooter-decomposition-review-20260906-full`. Calibration-stage losses
remain the next research priority; the fitted candidate remains rejected.
Calibration stability study declaration:
`docs/analytics-calibration-stability-plan-20260906.json`. It fixes calendar
blocks within the original calibration periods, the saved initial map and
earlier-only expanding-map updates. Raw movement inputs and model/settings are
unchanged. Outer validation is not used for this study's fitting or scoring;
integrity verification may access its bytes, and these historical cohorts are
not newly blinded. No policy or model is accepted by declaration alone.
Study implementation: `scripts/proof/run_calibration_stability.py`, author tests,
and `scripts/proof/test_calibration_stability_review.py` (including a genuine
frozen-source first-block replay). Independent results checker:
`scripts/proof/review_calibration_stability.mjs` and its tests. Outputs use
create-only `official-calibration-stability-*` directories; starting execution
does not establish predictive improvement.
Completed result: `docs/analytics-calibration-stability-result-20260906.md` and
`official-calibration-stability-20260906-full`, independently checked by
`calibration-stability-review-20260906-full`. Both aggregate point guards passed;
log-loss intervals favor expanding history, Brier remains uncertain and monthly
weaknesses persist. No production or downstream model acceptance.
Bounded-memory calibration execution gate:
`docs/analytics-bounded-calibration-execution-20260906.md`, with additive
`scripts/proof/bounded_conditional_calibration.py`, author and independent
review tests, and `scripts/proof/prove_bounded_conditional.py` with its tests.
The frozen dense calibrator remains intact. Chunked evaluation preserves the
statistical objective without dropping history or increasing its design-cell
budget. Execution parity is not predictive improvement or model acceptance;
extended fitting requires a separate declaration after this gate passes.
Completed numerical proof: `docs/analytics-bounded-calibration-result-20260906.md`
and `scripts/proof/results/bounded-conditional-proof-20260906-full/`.
Saved-map replay and synthetic allocation stress passed; no real-cohort model
was fitted. Regression receipt: `bounded-conditional-20260906-suite.xml`.
Full-period calibration transfer declaration:
`docs/analytics-calibration-transfer-plan-20260906.json`. It freezes the original
movement raw model and full-calibration initial map, then updates only from
strictly earlier dates for every original outer-validation calendar month.
New runner `scripts/proof/run_calibration_transfer.py` and author/independent
Python tests retain source, chronology, fit, inference and scorecard evidence.
Independent point checker: `scripts/proof/review_calibration_transfer.mjs` and
its tests. Create-only outputs use `official-calibration-transfer-*` directories.
This is adaptive retrospective evaluation, not untouched or verified-as-of
testing. A started run is not completion, improved accuracy or model acceptance.
Completed fitted result: `docs/analytics-calibration-transfer-result-20260906.md`
and `official-calibration-transfer-20260906-full`. Both declared point guards
passed; aggregate fixed-fit intervals favor expanding calibration, while
retrospective selection and historical availability limitations remain.
No production, finishing or FPAR acceptance follows automatically.
Independent completed review: `calibration-transfer-review-20260906-full`;
full offline regression receipt: `calibration-transfer-20260906-suite.xml`.
Prior-SOG source-fidelity diagnostic:
`docs/analytics-prior-sog-fidelity-plan-20260906.md` declares an all-event,
no-fit reconstruction of immediate raw predecessor state and residual accounting.
`scripts/proof/prior_sog_fidelity.py` and author/independent tests separate known
boundaries from missing owner facts and preserve the no-cutoff prior-SOG meaning.
`scripts/proof/audit_prior_sog_fidelity.py` and its tests produce create-only
`prior-sog-fidelity-*` evidence with fixed predictions; no model or serving change.
Completed result: `docs/analytics-prior-sog-fidelity-result-20260906.md` and
`prior-sog-fidelity-20260906-full`. All evaluated prior states match raw-source
semantics; timing-era discontinuities and delayed-penalty contexts remain
diagnostic leads, not established causes or accepted model corrections.
Offline regression receipt: `prior-sog-fidelity-20260906-suite.xml`.

`docs/analytics-timing-era-audit-plan-20260906.md` fixes the original eligible
development-era population for a no-fit raw clock/composition audit.
`scripts/proof/audit_timing_eras.py` and its author/independent tests retain signed
coordinates, unknown actor comparisons, raw predecessor states, targets and source
hashes. Create-only `timing-era-audit-*` results are descriptive evidence, not a
new model or production correction. Later-era event bodies remain outside scope.
Completed: `timing-era-audit-20260906-full` and independent
`timing-era-review-20260906-full`; findings in
`docs/analytics-timing-era-audit-result-20260906.md`. All original eligible rows
reconcile; the timing/outcome discontinuity remains descriptive, not a proven
source-system cause. Offline regression receipt: `timing-era-audit-20260906-suite.xml`.

`docs/analytics-timing-candidate-plan-20260906.md` declares a single earlier-only
monthly calibration extension: four ridge-shrunk timing offsets, retaining the
original raw model, conditional slopes and all existing inputs. Experimental
engine `scripts/proof/timing_conditional_calibration.py`, runner
`scripts/proof/run_timing_candidate.py`, and author/independent tests are new
contracts; frozen baselines remain unchanged. Create-only
`official-timing-candidate-*` evidence is adaptive development, not model/FPAR
acceptance. Original subgroup scorecards and separate timing scorecards are retained.
Completed result: `official-timing-candidate-20260906-full`; independent review:
`timing-candidate-review-20260906-full`. Both fold-level loss guards pass, with
remaining subgroup bias and some earlier-period regressions explicitly retained
in `docs/analytics-timing-candidate-result-20260906.md`. Offline regression:
`timing-candidate-20260906-suite.xml`. This does not advance production or FPAR acceptance.
Solo no-fit follow-up: `scripts/proof/audit_timing_shrinkage.py` and its focused
tests; results `timing-shrinkage-audit-20260906-full`, documented in
`docs/analytics-timing-shrinkage-result-20260906.md`. This separates saved
training residuals consistent with ridge shrinkage from train/test differences;
it neither retunes the candidate nor claims a causal explanation or new accuracy gain.
Single-factor follow-up: `docs/analytics-timing-ridge10-plan-20260906.md`;
new `timing_conditional_calibration_ridge10.py` and `run_timing_ridge10.py`
under `scripts/proof`, with focused regression tests and a separate Node replay.
Only extra timing ridge changes from 100 to 10. Create-only
`official-timing-ridge10-*` results compare directly against the preserved
ridge-100 candidate; they do not replace prior evidence or authorize publication.
Completed: `official-timing-ridge10-20260906-full`, both fold loss guards pass;
findings and remaining regressions: `docs/analytics-timing-ridge10-result-20260906.md`.
Separate implementation replay: `timing-ridge10-review-20260906-full`.
Regression receipt: `timing-ridge10-20260906-suite.xml`.
Composed offline candidate: `data-pipeline/projections/xg_candidate_inference.py`;
full-vector replay and 18 hash-pinned bundles in `composed-xg-replay-20260907-full`.
All 241113 validation events preserve raw scores exactly and final calibrated
scores within floating-point rounding. See `docs/analytics-composed-xg-replay-20260907.md`.
This is retrospective inference parity, not production or FPAR acceptance.
Player finishing bridge: `scripts/proof/compose_player_finishing.py`, tested by
`test_compose_player_finishing.py`; completed source-bound event/player ledgers
in `composed-player-finishing-20260907-full`. See
`docs/analytics-composed-player-finishing-20260907.md`. These are eligible-event
descriptive quantities, not official complete actuals, fitted talent, or forecasts.
Exposure reconciliation: `scripts/proof/reconcile_finishing_exposure.py` and
`test_reconcile_finishing_exposure.py`; result `finishing-exposure-reconciliation-20260907-full`
enumerates captured events absent from the model, affected players and explicit
exclusion reasons. See `docs/analytics-finishing-exposure-reconciliation-20260907.md`.
Quarantined captures are not promoted to official actuals or model training.
Development SOG review: `collect_development_sog_reports.py`,
`collect_development_award_narratives.py`, `review_development_sog_reports.py`,
and additive `review_development_sog_v2.py` under `scripts/proof`.
The exact-snapshot statistical review supports 37 games / 38 non-shot credited
goals; two games remain unresolved. All original source gates/cohorts are retained.
The additive `scripts/proof/partition_reviewed_goal_credit.py` and its tests keep
official goal credits distinct from shot-event conversions and require complete
PL/raw goal, shot and miss actor/type/period/clock correspondence. The verified
36-game sidecar is offline, not a feature export or model activation; see
`docs/analytics-reviewed-goal-credit-partition-20260907.md` for the additional
unidentified-report-shooter exclusion and remaining feature replay gates.
The reviewed-source feature reconstruction and additive score-origin correction
are documented in `docs/analytics-reviewed-feature-reconstruction-20260907.md`.
Use its corrected v2 artifact, not the preserved first run with unknown score.
This is offline feature evidence, not candidate inference or model acceptance.
The subsequent frozen-bundle inference is recorded separately in
`docs/analytics-recovered-xg-evaluation-20260907.md` and
`scripts/proof/results/recovered-xg-evaluation-20260907-full`. All recovered
feature rows were scored, with original/recovered/expanded metrics kept distinct;
remaining bias prevents treating this as model acceptance or a release.
The follow-up timing/strength/goalie-presence diagnostic is documented in
`docs/analytics-expanded-timing-diagnostic-20260907.md`; its completed retry
preserves unknown goalie groups and shows remaining within-situation timing bias.
The subsequent raw-prefix and bounded official-report clock checks are in
`docs/analytics-raw-followup-clock-audit-20260907.md`. Saved gaps matched raw
clocks; no timestamp correction, model fit or production activation followed.
The subsequent single declared 90-day timing-adaptation experiment is described
in `docs/analytics-recent-timing-result-20260907.md`. Both original-fold loss
guards pass, but residual timing bias and a later-fold band regression remain;
the new comparator is offline and not a replacement for the deployed model.
The subsequent prequential loss-gate comparison was rejected as a replacement
because it worsened both original-fold losses relative to that recent comparator.
See `docs/analytics-timing-loss-gate-result-20260907.md`; negative evidence is
preserved and no production change followed.
The stronger ungated recent candidate subsequently passed full-vector composed
replay: `docs/analytics-recent-candidate-replay-20260907.md`. Dated sidecars and
the offline inference wrapper preserve the complete input schema and reproduce
the saved experiment; they are not deployed services or model acceptance.
The residual-concentration diagnosis and single bounded-influence prior test are
recorded in `docs/analytics-bounded-timing-prior-result-20260907.md`. The new prior
is not promoted: it narrowly fails the first-fold Brier guard and has band-level
trade-offs. The verified ridge-recent reference and negative evidence remain intact.
The executable consolidated evidence checkpoint is
`scripts/proof/check_current_xg_checkpoint.py`, documented in
`docs/analytics-current-xg-checkpoint-20260907.md`. It revalidates candidate/replay,
rejected alternatives and static input coverage without granting model, FPAR or
production acceptance. Successful execution is explicitly distinct from release.
See `docs/analytics-development-sog-review-20260907.md` for report captures,
source hashes, preserved first review and model/finishing integration boundaries.
Canonical source/input gate: `scripts/proof/check_analytics_input_coverage.py`
and `docs/analytics-input-coverage-ledger-20260907-v9.json`; original v1/v2/v3/v4/v5/v6/v7/v8 ledgers
are retained and superseded. Tests include `scripts/proof/test_analytics_input_coverage.py`
and normal-suite `data-pipeline/tests/test_analytics_scope_coverage.py`.
New offline components `pre_shot_history.py` and `fixed_feature_transform.py`
under projections have dedicated tests plus `test_movement_transform_integration.py`.
Independent movement review is `test_pre_shot_movement_review.py`.
Zone/quality recovery adds `pre_shot_zone_context.py`, its original-function
comparison tests and independent `test_pre_shot_zone_context_review.py`.
The declared matched experiment is `docs/analytics-zone-context-plan-20260906.json`
with `scripts/proof/run_zone_context_candidate.py` and its tests; create-only
results live under `official-zone-context-*`. Starting a run is not acceptance.
Completed zone result: `docs/analytics-zone-context-result-20260906.md`; primary
failed, with independent score and sampled source-vector reviews retained.
New `pre_shot_penalty_context.py` preserves recorded annotations, not active PP
clocks; author and independent tests accompany it. New
`conditional_calibration_shape.py` is an offline, partially pooled calibration
candidate with separate tests, not a serving replacement. Recovery specifications:
`docs/analytics-powerplay-input-recovery-20260906.md`,
`docs/analytics-shift-rink-recovery-spec-20260906.md`, and
`docs/analytics-conditional-shape-proposal-20260906.md`.
Penalty source proof: `scripts/proof/audit_penalty_source_sample.py` and
`penalty-source-audit-20260906-systematic100/report.json`. Conditional fitting
uses `run_conditional_shape_candidate.py`, its tests and the separately declared
`docs/analytics-conditional-shape-plan-20260906.json`; independent point review
is `review_conditional_shape_candidate.mjs` with its own tests. These add no
automatic serving or acceptance path.
Conditional matched result: `docs/analytics-conditional-shape-result-20260906.md`;
point guard passes with explicit uncertainty and no acceptance. Retained venue/
on-ice sources are inventoried in `docs/analytics-retained-venue-shift-inventory-20260906.md`;
the separate PL parser proposal is `docs/analytics-pl-onice-parser-proposal-20260906.md`.
The approved evidence-only pilot is implemented in `pl_onice_membership.py`;
author and independent tests accompany it. Create-only proof output
`pl-onice-pilot-20260906-retained45/` preserves raw cells, membership mappings and
unmatched rows; it does not authorize causal features or inferred shift times.
See `docs/analytics-pl-onice-pilot-result-20260906.md`.
Full recorded-penalty coverage now lives under
`penalty-full-coverage-20260906-development/`, generated by
`scripts/proof/audit_penalty_full_coverage.py`. All 541,067 movement-eligible
event keys are retained; the result document is
`docs/analytics-penalty-full-coverage-result-20260906.md`. No active PP-clock or
accuracy claim follows from this extraction proof.
Frozen pre-fit declaration:
`docs/analytics-recorded-penalty-candidate-plan-20260906.json` preserves the
movement inputs and fixes an additive recorded-annotation ablation. This is a
declaration, not permission to publish or serve the resulting model.
Its additive input adapter is now implemented in
`data-pipeline/projections/recorded_penalty_features.py`, with author and
independent tests. It preserves the entire movement vector, joins recorded
annotations by exact event identity, binds the full audit and replay-equivalence
receipts, and retains explicit unknown states. It does not reconstruct active
penalty clocks or provide serving authorization.
The create-only experiment runner is
`scripts/proof/run_recorded_penalty_candidate.py`, with author and independent
runner tests. It checks both folds' resource bounds before fitting, preserves
the frozen controls, and writes separate original-context and penalty-context
diagnostics. `scripts/proof/review_recorded_penalty_candidate.mjs` and its tests
provide independent saved-point review; neither script is a production job.
The completed run is `official-recorded-penalty-20260906-full/`, with independent
review in `recorded-penalty-review-20260906-full/`. The declared improvement guard
failed on the later fold; this candidate is not accepted and production is
unchanged. See `docs/analytics-recorded-penalty-result-20260906.md` for comparisons,
calibration weaknesses, verification boundaries and the next no-fit analysis.
The no-fit matched-shot diagnostic utility is
`scripts/proof/decompose_recorded_penalty.py`, with author and independent tests.
It anchors all model comparisons to frozen-control probability bands, retains
prior-shot and recorded-annotation states, and decomposes proper-loss changes
into raw changes and the difference of calibration effects. It neither fits a
model nor authorizes production changes; observed sparse cells remain explicit.
Completed output: `recorded-penalty-decomposition-20260906-full/`; interpretation
and reproduction are in `docs/analytics-recorded-penalty-decomposition-20260906.md`.
The later-fold raw probabilities already regress, so calibration alone does not
explain the failed candidate. No model was fitted or promoted by this analysis.
Independent point/membership review is implemented by
`scripts/proof/review_recorded_penalty_decomposition.mjs` with dedicated tests;
completed evidence is `recorded-penalty-decomposition-review-20260906-full/`.
Verified local preservation receipt:
`scripts/proof/results/analytics-input-recovery-checkpoint-20260906-2041/receipt.json`.
It duplicates selected working-tree source and explicitly listed evidence roots,
including penalty coverage/candidate, reusable-feature and offline-bundle proofs,
and this decomposition/review. Originals remain; this is not off-machine backup.
This inventory pointer and the result report's preservation/next-step addendum
postdate the snapshot. Loose root-level JUnit receipts remain separately retained.
Local candidate packaging: `projections/offline_xg_bundle.py` binds named
inputs, saved transform/model, conditional calibrator, runtime and code hashes;
author/independent tests and `scripts/proof/prove_offline_xg_bundle.py` accompany it.
`offline-xg-bundle-proof-20260906-full/` verifies both saved validation folds,
reversed batches and sampled singleton requests, without a serving hook.
See `docs/analytics-offline-bundle-result-20260906.md` for the exact boundary.
Read-only feature reuse is in `projections/verified_movement_reuse_v2.py` with
dedicated tests and `scripts/proof/prove_verified_movement_reuse_v2.py`;
`verified-movement-reuse-v2-*` receipts compare full rows against fresh replay.
Completed comparison: `docs/analytics-verified-feature-reuse-result-20260906.md`;
exact equivalence passed, with faster local execution but higher peak memory.
Initial v1 sources and `verified-movement-reuse-fast-20260906/` remain preserved.
Movement calibration and subgroup weaknesses are documented in
`docs/analytics-movement-diagnostic-20260906.md`; no subgroup patch is deployed.
Additional audits: `docs/analytics-legacy-serving-audit-20260906.md` and
`docs/analytics-model-dependency-audit-20260906.md`; diagnostics are
`scripts/proof/test_legacy_serving_diagnostics.py` (XML receipt in results)
and `scripts/proof/reproduce_legacy_rebound_index.py`.
Original-input recovery now includes a separate, non-serving pair-geometry module
`data-pipeline/projections/pre_shot_movement.py` and its tests. It preserves raw
lateral/angular change and elapsed-time units alongside legacy-style composites;
it does not establish event eligibility, fit a model, or replace production inputs.
Parallel source audit: `docs/feature_parity_audit-20260906.md`, executable
`scripts/proof/feature_parity_audit_tests.py`, and its create-only receipt
`scripts/proof/results/feature-parity-audit-tests-20260906.xml`. These retain
caller-buffer, event-state, orientation and PP-age defect witnesses, not fixes.
Completed result: `docs/analytics-event-memory-result-20260906.md` (primary fails
the both-fold guard). `docs/analytics-legacy-input-parity-20260906.md` preserves
original feature intent and documents delivery defects. The AST inventory runner
`scripts/proof/audit_legacy_xg_inputs.py` and executable legacy diagnostics retain
all literal shot-record fields and both old training lists without loading models.
`data-pipeline/projections/event_memory_features.py` adds strict-prefix shot/event
counts, prior-attempt geometry and observed strength-spell age. These are recorded
event proxies, not tracking, possession, shifts or adjudicated penalty age. The
fixed plan is `docs/analytics-event-memory-plan-20260906.json`; the create-only
source-replay/fitting runner is `scripts/proof/run_event_memory_candidate.py`,
with matching feature/runner tests. Outputs use `official-event-memory-*` under
`scripts/proof/results/`; independent point/bin review is
`scripts/proof/review_event_memory.mjs`. All old models and reservations remain
frozen; completion does not authorize serving.

Public-method/file study and independent applications (2026-09-06):
`docs/analytics-method-checkpoint-20260906.md` is the combined result and next-step
entry point. `scripts/proof/review_method_challengers.mjs` plus matching Node
tests independently recompute point scores/bins and source closure into
`scripts/proof/results/method-challenger-review-20260906-1755/`. Saved test
receipts live at `scripts/proof/results/method-verification-20260906.ERLcq5/`.
The create-only `scripts/proof/archive_method_checkpoint.py` duplicates selected
current working-tree bytes and these new evidence roots, preserving earlier
archives. Its receipt is
`scripts/proof/results/analytics-method-checkpoint-20260906-1755/receipt.json`;
this is local preservation, not a new Git commit or off-machine backup.
`docs/analytics-moneypuck-schema-inspection-20260906.md` records a full read of
the pinned local explanatory dictionary, not training-data use. The bounded
scanner `scripts/proof/inspect_moneypuck_dictionary.py` and matching tests
produce `scripts/proof/results/moneypuck-dictionary-inspection-*/inspection.json`.
`docs/analytics-public-method-gap-20260906.md` retains the broader primary-source
gap matrix and completed strength-specialist comparison. Its new candidate,
runner/tests and fixed plan use `strength_partition_candidate.py`,
`run_strength_partition_candidate.py`, and
`docs/analytics-strength-partition-plan-20260906.json`; complete outputs live
under `scripts/proof/results/official-strength-partition-*/`.

The additive static-horizon FPAR adapter is
`packages/shared/src/utils/fparFoundation.ts`, with focused tests and
`docs/analytics-fpar-foundation-adapter-20260906.md`. It calls ScoringCalculator,
requires a full bound verifier and feasible joint replacement allocation, and
is not exported for serving. Synthetic proofs are not validated live FPAR.

Daily-engine missing-xG/read-population correction and nightly fail-closed
task/output reconciliation are documented in
`docs/analytics-live-model-gap-20260906.md` and
`docs/analytics-nightly-forecast-health-20260906.md`, with new
`test_daily_projection_xg_availability.py` and `test_nightly_projection_health.py`.
Old source is archived; current source deliberately withholds unverified team
exposure and reuse and must not be automatically rolled out.

Identity-conditioned event forecast experiment (2026-09-06):
`data-pipeline/projections/identity_probability.py` fits bounded, earlier-period
shooter/goalie logit effects with explicit shrinkage and an identity-free control.
It is not neutral xG or a causal talent estimate and must not become the goalie
evaluation baseline. Target-free prediction inputs reject same-day/fit-game use;
unseen or unavailable actors have no learned identity effect. Its fixed plan is
`docs/analytics-identity-probability-plan-20260906.json`. The source/feature/actor
and JSON-inference replay plus independent sparse objective/KKT audit live in
`scripts/proof/run_identity_probability.py`, with matching pipeline/proof tests.
Create-only real outputs use `scripts/proof/results/official-identity-probability-*/`.
This lane does not overwrite previous neutral models or prospective reservations.
The first attempt failed its numerical convergence gate before validation
scoring. Separate `identity_probability_v2.py`, `run_identity_probability_v2.py`,
their tests and `docs/analytics-identity-probability-v2-plan-20260906.json` preserve
the exact likelihood, penalties, bounds and raw-gradient threshold while fixing
numerical scaling. The calibration-only diagnosis and v2 replay are create-only
`official-identity-probability-v2-*` outputs; v1 bytes remain frozen.

Fixed prequential calibration challenger (2026-09-06):
`data-pipeline/projections/prequential_calibration.py` supplies a pure bounded
rolling intercept fit with a two-day simulated label lag, one state per game
date, explicit sparse-history fallback and immutable history/state hashes.
`scripts/proof/run_prequential_calibration.py` replays original official source
and feature cohorts, verifies pinned raw/map vectors, independently reconstructs
every history window and scalar optimum, tests future-label perturbation and
retains all original scorecard subgroups plus monthly diagnostics. Its declaration
is `docs/analytics-prequential-calibration-plan-20260906.json`; create-only outputs
use `scripts/proof/results/official-prequential-calibration-*/`. Matching tests
cover lag/window boundaries, duplicates, source/vector drift and state tampering.
Historical availability is simulated, not proven. No old experiment, raw model,
actual, future reservation, serving path or hosted database is modified.
The separate conservative challenger in
`data-pipeline/projections/selective_calibration.py` adds a fixed game-residual
uncertainty-scaled L1 penalty with a Bernoulli variance floor; this regularizer
does not assert confidence coverage. Its source-bound runner and independent
variance/solver audit are `scripts/proof/run_selective_calibration.py`, with
matching pipeline/proof tests and
`docs/analytics-selective-calibration-plan-20260906.json`. Create-only outputs
use `scripts/proof/results/official-selective-calibration-*/` and preserve the
first challenger as a scored comparison even when its guard fails.
Both completed challengers failed their fixed no-regression guard. The combined
`docs/analytics-adaptive-calibration-result-20260906.md` explains the measured
losses and remaining gates; `analytics-adaptive-calibration-index-20260906.json`
in the same directory binds the full runs, plans, code and test receipts.
`docs/analytics-adaptive-calibration-review-20260906.json` retains the separate
JavaScript point-score/bin and consumed-file review. Verification outputs are
also bound alongside `docs/analytics-adaptive-calibration-integrity-20260906.json`,
which freshly rehashes all 62 separately named prior/result/archive pins.
Verification output directories are
`scripts/proof/results/prequential-verification-20260906-1630/` and
`scripts/proof/results/selective-verification-20260906-1650/`, including the
test-only fixture correction and prior-pin check notes.
`docs/analytics-adaptive-calibration-archive-20260906.json` describes a verified
additive working-tree byte snapshot and evidence duplicate, with originals
retained; it does not claim a new Git commit, runtime bundle or remote backup.

Overnight handoff (2026-09-06):
`docs/analytics-overnight-handoff-20260906.md` links verified local results,
preserved research and the remaining ordered source/calibration/forecast gates.
`docs/analytics-overnight-integrity-20260906.json` records a final read-only
SHA-256 comparison of 62 named prior/result/archive pins and binds its three
input manifests. It is not a new experiment, nested-review rerun, runtime bundle
or model/FPAR acceptance. No original evidence was rewritten.
`docs/analytics-overnight-bound-integrity-20260906.json` separately records a
subsequent byte-for-byte rehash of all 15,626 actor-review-bound files; it does
not rerun model fits, inference or semantic ledger review.

Additive actor/exposure diagnostics (2026-09-06):
`data-pipeline/projections/player_goalie_attribution.py` preserves exact selected
event/model membership, game-roster team identity and separate shooter/defending-
goalie accounting. Goalies taking shots remain shooters; empty net is not a
goalie actor; unknown presence and contradictions stay unavailable. Aggregation
retains season/type/role and team stints, marks incomplete totals NULL and labels
known subtotals. Eligible attempts and roster listing never become GP, TOI or
per-60 exposure. No official actual or fantasy scoring is changed.
`scripts/proof/run_actor_attribution.py` and its fixed diagnostic plan replay
original body/receipts through unchanged source gates/features and pinned JSON
model/map inference before actor accounting. New create-only evidence lives in
`scripts/proof/results/official-actor-attribution-*/`; failed runs retain partial
files and an affirmative failure marker. No database or serving adapter is used.
`scripts/proof/review_actor_attribution.py` independently joins the diagnostic
receipts back to raw source actors and game rosters, rebuilds actor/team-stint
ledgers and NULL availability, and retains goalie-state accounting partitions.
Its review and verified local archive are create-only; they do not refit models
or promote the diagnostic to official actuals, TOI, forecasts or FPAR.
`scripts/proof/inspect_actor_goalie_gaps.py` additively inventories the original
withheld events and same-clock penalty-shot markers. Missing versus different
drawn-player IDs remain distinct. Raw event/context hashes and unpaired special
codes are retained; this inspection does not reinterpret frozen features,
reassign goalies, change probabilities or resolve the original unavailable rows.

Additive model/publication diagnostic proof (2026-09-06):
`scripts/local_model_publication_e2e.py` binds the complete shape checkpoint,
re-evaluates its selected JSON probability map on every validation event, and
forms complete game-level diagnostics separated by season and game type.
Its only admitted metric is `disposable_local_development_game_xg_diagnostic`:
transport validation is not model/foundation acceptance, a player metric,
official actuals, serving promotion or fantasy scoring.
`scripts/proof/run_local_model_publication.mjs` provisions only new ownership-
labeled tmpfs PostgreSQL/PostgREST containers and a loopback gateway, then removes
only those owned fixtures. It retains attempts, worker logs, synthetic local
tokens, source hashes, diagnostic candidates, rejected copies, result/health and
cleanup under a new `scripts/proof/results/local-model-publication-*/` directory.
`scripts/proof/read_model_publication.ts` exercises the actual unchanged
TypeScript reader, exact value roundtrip, stale NULLs, scope isolation and
controlled faults on real local responses. No new serving export or hosted
schema is introduced; the existing unapplied publication SQL is used verbatim.
`data-pipeline/tests/test_local_model_publication.py` covers exact event
membership, scope, original-preserving withholding, freshness and promotion
rejection. This diagnostic is off the draft/request hot path; the fixture's
bounded connection pool and paginated reads are not a draft-night load proof.
The first launcher and failed `local-model-publication-20260906-1103` attempt
remain unchanged: the legacy `--tmpfs` inspection shape stopped setup before
model data or publication SQL ran, and owned infrastructure was removed.
`scripts/proof/run_local_model_publication_v2.mjs` uses explicit `--mount`
configuration and `local_tmpfs_contract.mjs` to require matching bounded config,
inspection and live kernel mount evidence. Its nine Node tests reject persistent,
missing, duplicate, unbounded and inconsistent mounts. The Python/reader proof
is reused byte-for-byte; this is an infrastructure-only correction.
The v2 attempt `local-model-publication-20260906-1107` retains successful live
tmpfs verification but no usable published host port on the internal network;
it also stops before model/database setup and preserves cleanup evidence.
`run_local_model_publication_v3.mjs` uses a task-owned bridge with explicit,
verified loopback host ports (not an egress-firewall claim) and TCP readiness.
`local_port_contract.mjs` and its eight Node tests reject missing, external,
duplicate, unassigned or invalid host bindings. Both earlier launchers remain
byte-pinned; the model, publisher, SQL and reader are unchanged.
The v3 attempt `local-model-publication-20260906-1110` retains all four successful
model/reader batches, withholding/rollback and database rejection phases. It
failed its test's overly narrow HTTP-403 expectation: PostgREST returned the
correct anonymous-role HTTP 401 / PostgreSQL 42501 table-permission denial.
All owned fixtures were removed. The original Python and all three launchers
remain unchanged. `local_model_publication_e2e_v2.py` and infrastructure v4 use
`local_access_denial.py` to require the exact role/status/SQLSTATE/table/operation
envelope; invalid JWT errors cannot count as access-denial proof. The versioned
test correction leaves model/aggregation function bodies, SQL, clients and the
actual TypeScript reader unchanged. New tests verify that boundary explicitly.
Infrastructure v4 / proof v2 completed on two fresh owned fixtures in
`local-model-publication-20260906-1119` and `local-model-publication-20260906-1122`.
`record_local_model_publication_checkpoint.py` independently re-aggregates the
retained event predictions, binds complete native/reader/security/cleanup evidence,
and archives both successes plus all three failures. It creates a new local
duplicate, retaining originals. No candidate or foundation gate is promoted.

Additive shape-calibration experiment (2026-09-06):
`docs/analytics-calibration-shape-plan-20260906.json` predeclares four new
calibration-period-only mappings against the preserved sigmoid/group-beta
references. `data-pipeline/projections/calibration_shape.py` implements clipped
isotonic, plateau-midpoint PCHIP and regularized monotone piecewise-logit maps,
with/without the existing pre-outcome context dimensions. Its
`calibration_shape_experiment.py` runner replays the unchanged source export,
reuses pinned JSON raw models, verifies every calibration/validation reference,
then writes all six-candidate scorecards and create-only evidence under
`scripts/proof/results/official-calibration-shape-experiment-20260906/`.
`packages/shared/src/utils/calibrationShape.ts` is an offline-only independent
scorer (not serving-exported); `scripts/proof/score_calibration_shape.mjs`
bridges bounded JSON input/output for full-validation Python/TypeScript parity.
Matching Python tests are `test_calibration_shape.py`,
`test_calibration_shape_typescript.py` and `test_calibration_shape_experiment.py`.
This is adaptive already-inspected development, not a new untouched test or
acceptance. All preceding model/code/evidence files and reservations remain intact.
The additive `scripts/proof/record_calibration_shape_checkpoint.py` preserves a
complete health-pinned review under `official-calibration-shape-review-20260906/`
and independently checks every member of new local source/evidence archives
under `analytics-calibration-shape-checkpoint-*`. Its matching proof tests cover
candidate/bin/pair/subgroup completeness and create-only failure behavior.
No archived source or prior review generator is modified.
The completed shape comparison is documented in
`docs/analytics-calibration-shape-result-20260906.md` and its compact result index.
The full generated review stays with local evidence rather than tracked docs;
all candidates remain available and foundation acceptance remains withheld.

Additive calibration refinement (2026-09-06):
`docs/analytics-calibration-plan-20260906.json` fixes a five-calibrator budget
on the already-inspected earlier-development folds. New
`data-pipeline/projections/calibration_candidate.py` fits calibration-period-only
raw/logit-sigmoid/isotonic/beta/context-offset beta maps with JSON inference;
missing versus unseen context is retained explicitly.
`portable_context_model.py` exports freshly fitted numeric binary trees and
independently reconstructs the feature design and predictions without loading
pickle/joblib. `calibration_experiment.py` source-replays the unchanged export,
checks the prior model's train statistics and prediction vectors, and writes
create-only JSON model/calibrator/parity/scorecard evidence. Their matching
`tests/test_calibration_candidate.py`, `tests/test_portable_context_model.py`,
and `tests/test_calibration_experiment.py` are synthetic contract regressions.
New experiment output belongs under a separate
`scripts/proof/results/official-calibration-experiment-20260906/` directory;
completion requires its affirmative health receipt. No serving integration,
existing evidence replacement, later-period test reuse, or FPAR acceptance.

`packages/shared/src/utils/portableXg.ts` is an offline-only TypeScript JSON
scorer, deliberately absent from the shared serving barrel; its tests cover
thresholds, unknown/missing indicators, nonpublishing contracts and malformed
artifacts. `scripts/proof/verify_portable_xg.mjs` independently checks the full
calibration raw and validation five-calibrator populations against a pinned
completed Python experiment health receipt, directly streaming the unchanged
feature export. It writes create-only proof artifacts under
`scripts/proof/results/official-calibration-typescript-parity-20260906/`.
This validates model portability, not TypeScript PBP parsing, hosted serving,
prospective quality or FPAR acceptance.
`scripts/proof/verify_portable_xg.test.mjs` exercises the independent proof's
complete synthetic population, pinned evidence, altered predictions/membership,
failure markers and create-only output behavior.
Both real runs completed; `docs/analytics-calibration-result-20260906.md` records
the measured improvement and remaining failures, and
`docs/analytics-calibration-result-index-20260906.json` pins their receipts.
The complete large machine review lives byte-preserved with local artifacts at
`scripts/proof/results/official-calibration-review-20260906/review.json`.
`scripts/proof/record_calibration_checkpoint.py` generates that bound review and
archives only the three new evidence roots plus committed source using the
unchanged prior archive-verification helpers; its matching
`scripts/proof/test_record_calibration_checkpoint.py` covers scope/failure retention.
New local archive output uses
`scripts/proof/results/analytics-calibration-checkpoint-20260906-*/` with a
tracked `docs/analytics-calibration-checkpoint-archive-20260906.json` receipt.

Current acceptance is tracked in `docs/ANALYTICS_ACCEPTANCE.md`; legacy row
counts and model labels elsewhere in this inventory are not revalidated by this
implementation. The new service-only publication/canonical migrations remain
unapplied. `acquisition/canonical_events.py`, `event_observation_service.py` and
`collect_observations.py` capture immutable official PBP observations without
rewriting legacy raw shots. `monitoring/canonical_corpus.py` validates scoped,
checksummed export parts and compares exact source revisions;
`final_game_evidence.py` checks final totals without inventing missing events.
Frozen proof summaries live in `docs/analytics-corpus-full-proof-20260906.json`
(all 1394 stored games) and the earlier conflict-enriched sample. Matching here
means identity/totals checks, not model-ready source or feature acceptance.
The independent schedule collector `monitoring/schedule_coverage.py` separately
captures every week in an explicit date window, validates daily/week totals and
compares terminal game identities with both stored sources. Its 61-receipt frozen
replay confirms no whole games missing for the captured season; see
`docs/analytics-schedule-proof-20260906.json`. This does not clear event conflicts.

`monitoring/collect_toi_receipts.py` collects a complete official skater summary
population plus raw player game-log receipts and frozen stored-game rows.
`projections/verified_toi_publication.py` builds explicit available/withheld
candidates. `server/src/services/AnalyticsReadModelService.ts` is a background
reader feeding actual dashboard/detail consumers only when
`ANALYTICS_TOI_PUBLICATIONS_ENABLED=true`; the default remains false. The web
hooks refresh versioned values and clear stale values while refreshing.

Landing loaders no longer write approximate TOI derived from rounded averages.
Per-game loaders preserve unavailable TOI as unavailable, withhold new incomplete
rows and propagate failure health through their callers. Historical traded-player
GP can come from a validated complete official summary, not summed ambiguous
team totals. Strict raw-to-derived receipt binding is implemented and replayed:
940 expected players, 939 available, one withheld for an extra stored appearance.
The replay did not change any of its 953 frozen input files or freshen old sources.

Native PostgreSQL race and actual Python publisher → PostgREST → TypeScript
reader proofs are recorded under `docs/analytics-native-*-races-20260906.json`
and `docs/analytics-local-publication-e2e-20260906.json`. The latter uses a clearly
labeled proposed correction on a disposable local copy, never a production row
change. The large raw-evidence payload failed at a 512 MiB database memory limit
and passed at 2 GiB; hosted capacity remains an explicit rollout gate.
`docs/analytics-evidence-archive-20260906.json` identifies the ignored local archive
of frozen source receipts, scoped exports and replay/integration artifacts.
Future TOI collection defaults to strict catalog provenance (explicit project,
season, observation window, matching row digests and per-part byte hashes), or
two identical complete ordered REST reads. Provenance-bearing offline replay
requires original catalog evidence or retains a validated frozen REST receipt;
it never claims a new online read. Legacy inputs remain explicitly non-catalog.
Local era/playoff exclusion and xG refresh safeguards have exact rollback
captures, isolated SQL checks and narrow input/population rejection. None of the
new migrations has been rolled out.

The complete methods/input preservation map is
`docs/analytics-method-preservation-20260906.md`: database, organization and the
whole model pipeline remain in scope, not just flurry. Full raw observations and
prior artifacts are retained. `acquisition/observed_sequences.py` extracts strict
source-bound consecutive-attempt chains; `monitoring/sequence_coverage.py`
audits the complete scheduled population offline. `projections/sequence_value.py`
implements independently authored conditioned sequence/rebound mathematics;
`sequence_shadow.py` is shared by both actual Python processing paths but only
attaches nonpublishable diagnostics and never replaces existing live columns.
`docs/analytics-sequence-methods-20260906.md` records definitions and limitations.

Historical official PBP also exists in `raw_nhl_data` (distinct from the historical
bulk-import derived shots). `monitoring/archive_source_receipt.py` checks exact
official URL, original fetch time and legacy semantic JSON hashes;
`archive_revision_comparison.py` compares preserved old/new source revisions.
A nine-game sample passed, not a full historical corpus. Source/raw byte archives
and the complete season sequence report are identified in
`docs/analytics-sequence-archive-proof-20260906.json`. Full corpus freeze, source
rights, feature/cutoff lineage and chronological acceptance remain separate gates.

`projections/chronological_split.py` is a pure manifest planner, not a trainer.
It pins exact source/event/feature membership, explicit calendar boundaries and
reasoned exclusions. A prospective reservation additionally pins its prior data
manifest and caller-supplied frozen pipeline/criteria digests; it cannot certify
historical availability, untouched history or model quality. Tests are synthetic.

The legacy `scripts/nhl_archive/fetch_pbp.py` writer now checks exact requested
games and structural PBP/boxscore pairing. It refuses corrected existing actuals
until versioned storage can retain both revisions, and preserves the original
PBP fetch timestamp when filling NULL boxscore evidence through the new service-
only `citrus_fill_archive_boxscore` RPC. Its migration `20260906050736` remains
unapplied; absent RPCs fail closed without an unguarded update fallback. This legacy table
does not supply independent boxscore observation times. Health is not full
official-stat adjudication; source revisions and all existing artifacts remain.
`docs/analytics-archive-writer-proof-20260906.md` records the actual large-payload
REST test, exact conditional-update semantics and deployment ordering.

The local on-ice and GAR replacement guards (`20260906044353` and
`20260906044310`) retain captured legacy formulas while refusing invalid/empty
replacement candidates. Native concurrent-source/output tests and exact rollback
captures are documented in their `docs/analytics-*-guard-proof-20260906.md`
records. Their locks and guard coverage are not hosted-load or model-quality
acceptance; both migrations are unapplied.

`docs/analytics-writer-lineage-audit-20260906.md` holds exact live SQL writer
definitions and confirmed shared-output permission risks. The unapplied
`20260906022414_restrict_shared_analytics_writes.sql` removes ordinary-account
writes to global GSAx and projections while preserving reads/service writes;
actual staging rollback proof is recorded there. No production data was changed.

### 1.5 Current isolated analytics evidence and model experiments

All paths below are additive. Ignored `scripts/proof/results/` evidence is local,
not a remote backup; manifests and proof summaries are tracked in `docs/`.
Earlier source files, actuals, old models and prior reservations are not replaced.

| Evidence / implementation | Location and role |
|---|---|
| Frozen official historical sources | `scripts/proof/results/historical-official-freeze-20260906/`: original PBP bodies, receipts, schedule and quarantine inventory |
| First neutral export and actual retrospective fit | `official-neutral-features-20260906/` and `official-neutral-experiment-20260906/` under results; `projections/compact_feature_export.py`, `verified_export_experiment.py`, `chronological_fit.py`, `chronological_experiment.py`, `probability_scorecard.py`; result and proof in `docs/analytics-first-neutral-experiment-*-20260906.*` |
| First experiment coverage and future reservation | `official-neutral-coverage-20260906.json`, `official-neutral-prospective-reservation-20260906/`; `projections/prospective_reservation.py`. A reservation is not an observed future result or automatic acceptance |
| Completed experiment preservation archive | `docs/analytics-completed-experiment-archive-20260906.json` binds the local source/evidence archive and independently checked membership; originals remain in place |
| Goal/SOG statistical exceptions | `docs/analytics-goal-sog-http-adjudications-20260906-v1.json`, `projections/frozen_http_goal_sog_adjudication.py`: exact reviewed source overlays, not changes to old frozen cohorts |
| Retained historical report representations | `scripts/proof/results/historical-feature-reports-20260906/` and `historical-report-v2-replay-20260906.json`; `projections/report_feature_source_v2.py`, `scripts/proof/replay_report_v2.py`, `docs/analytics-report-v2-review-20260906.md`. Explicit historical aliases and terminal-marker interpretation preserve all raw rows; correspondence is not training approval |
| Earlier-development model variant | `projections/development_feature_export.py`, `development_experiment.py`, `development_replay.py`; `docs/analytics-development-ablation-plan-20260906.json` and `analytics-development-methods-20260906.md`. Source-replayed earlier chronological feature/calibration experiment, not a replacement production model |
| Composed database pipeline fixture | `scripts/proof/test_analytics_composed_nightly_{fixture,isolated,native}.mjs`, `scripts/proof/captures/composed_{helpers,views}_20260906.json`; `docs/analytics-native-composed-nightly-20260906.json` and `analytics-composed-nightly-20260906.md`. Actual captured dependency execution with explicit remaining boundaries, disposable only |

The enhanced feature output is `scripts/proof/results/official-development-features-20260906/`.
The expanded native database run additionally has
`docs/analytics-native-composed-expanded-20260906.json`; neither replaces the
earlier narrower proof or claims model-inference acceptance.

The exact legacy cell dependency extension adds
`scripts/proof/test_analytics_composed_nightly_cells.mjs` and three append-only
`scripts/proof/captures/composed_legacy_{features,columns,keys_fold}_20260906_*.json`
catalog captures. `docs/analytics-native-composed-cells-20260906.json` records
native execution with no successful tail stubs but explicitly synthetic fitted
cells/rink knots and unexecuted v5 inference. No hosted data was changed.

`docs/analytics-nullable-xg-consumers-20260906.md` records the corrected nullable
dashboard season-xG contract and its draft-kit/card/browse consumers. Official
actuals are unchanged; upstream model/coverage acceptance is not inferred.

`projections/development_result.py` and `tests/test_development_result.py` add a
create-only result wrapper that replays frozen source membership again, binds
all completed artifacts, predictions and calibrator lineage, and applies the
declared shortlist without fitting or deserializing a model. Result evidence is
separate at `scripts/proof/results/official-development-result-20260906/`.
The actual result and complete selected-model subgroup/reliability review are
tracked in `docs/analytics-development-result-20260906.md` and
`docs/analytics-development-result-proof-20260906.json`. Selection is not serving
acceptance; all complete predictor scorecards remain in the original experiment.
`scripts/proof/archive_development_checkpoint.py` creates an additive scoped
source/evidence duplicate and streams every archive member through independent
hash and membership verification without extraction or model loading. Its
regressions are `data-pipeline/tests/test_development_archive.py`; prior archives
remain separately retained. A local duplicate is not a remote backup.
The completed checkpoint is bound by
`docs/analytics-development-checkpoint-archive-20260906.json`: selected source
at commit `359414341d96108cc459a0a1efd80a34976c0d79` plus the four new evidence
roots, every member checked without extraction. Originals and prior archives
remain unchanged; the archive receipt itself necessarily postdates its archive.

`projections/development_shortlist.py` applies only the frozen earlier-fold
selection rule to caller-verified completed scorecards. Its manifest pin is the
export manifest, not the source schedule; the two are deliberately distinct.
`projections/replacement_pool_contract.py` and its adjacent tests validate a
complete one-position, common-horizon fantasy-points pool without scoring or
database access. `docs/analytics-replacement-pool-contract-20260906.md` records
its limits and the still-unintegrated legacy replacement-ranking defects.
Neither module is FPAR, a roster optimizer, or serving acceptance.

Each new Python module has an adjacent `data-pipeline/tests/test_*.py` contract
suite. Full foundation/consumer/model acceptance still lives in
`docs/ANALYTICS_ACCEPTANCE.md`; partial source or concurrency success does not
override those gates. The preservation map and causal feature plan retain every
reviewed research/input family, including currently unavailable ones.

---

## 2. Historical data archives

### 2.1 MoneyPuck multi-season shot data — the xG training corpus

2026-09-06 audit caveat: the historical and working CSVs documented below are
absent from the checked Mac locations. Older sizes, row counts and quality labels
below are historical documentation, not revalidated evidence. The user excluded
MoneyPuck files from new training; published ideas may inform independently
implemented Citrus methods. `docs/analytics-training-lineage-20260906.md` records
current byte hashes, source discovery and missing split/calibrator/source
provenance. Existing artifacts are preserved; no new quality claim follows.

**Canonical copy** (referenced by `data/TRAINING_DATA_MANIFEST.md`):
- `C:\Users\garre\Downloads\shots_2018-2024.csv` — 447 MB, 786,244 rows, NHL seasons 2018-19 through 2024-25
- Source: `https://peter-tanner.com/moneypuck/downloads/shots_2018-2024.zip`
- Modified: 2026-02-17 22:48 (last download)

**Per-season MoneyPuck zips** (all in Downloads):
- `shots_2017.zip` (19 MB) → unzipped at `shots_2017/shots_2017.csv` (64 MB) — **2017-18 season**, separate from the bundled 2018-2024
- `shots_2018.zip` / `shots_2019.zip` / `shots_2020.zip` / `shots_2021.zip` / `shots_2022.zip` — individual season zips (probably superseded by the bundle but kept)
- `shots_2023.zip` (multiple copies: original, ` (1)`, ` (2)`) — duplicates, oldest dated Jan 7 2025
- `shots_2024.zip` (multiple copies: original, ` (1)`, ` (2)`) — duplicates
- `shots_2025.zip` + `shots_2025 (1).zip` (~6-7 MB each, Dec 2025) — partial 2025-26 MoneyPuck dumps

**Coverage that matters:** 2017-18 through 2024-25 = 8 NHL seasons of MoneyPuck-grade shots (~900K-1M rows total if you concat 2017 + 2018-2024).

### 2.2 Trained model artifacts

**Canonical models live at:** `data-pipeline/models/` (committed to git)

The following table preserves historical labels and claims, not newly verified
training lineage or quality. Byte-preservation and current provenance limits are
recorded in `docs/analytics-training-lineage-20260906.md`; new first-party
experiments are indexed separately in §1.5 and never overwrite these artifacts.

| File | Size | Purpose | Trained on |
|---|---|---|---|
| `xg_model_moneypuck.joblib` | ~2.5 MB | **Production xG model (v3)** | 786K MoneyPuck (2018-2024) + 77K Citrus PbP (2025-26). AUC 0.817. See commit `d6be75d`. |
| `xg_model_moneypuck_v2.joblib` | — | xG v2 (predecessor) | Earlier training run |
| `xg_model.joblib` | — | xG v1 / legacy | Legacy |
| `xa_model.joblib` | — | Expected assists model | — |
| `rebound_model.joblib` | — | Rebound xG model (component of xG v3) | — |
| `xg_shot_type_calibration.joblib` | — | Per-shot-type isotonic calibration | Commit `6e18851` |
| `model_features_moneypuck.joblib` / `model_features_moneypuck_v2.joblib` / `model_features.joblib` | — | Feature column lists (must match production-time order) | — |
| `moneypuck_xg_features.joblib` / `rebound_model_features.joblib` / `xa_model_features.joblib` | — | Per-model feature lists | — |
| `last_event_category_encoder.joblib` / `last_event_category_encoder_v2.joblib` | — | sklearn LabelEncoder for `last_event_category` | — |
| `pass_zone_encoder.joblib` | — | sklearn LabelEncoder for pass zones (PRE-SHOT MOAT feature) | — |
| `shot_type_encoder.joblib` | — | sklearn LabelEncoder for shot types | — |
| `player_shooting_talent.joblib` | — | Per-player Bayesian shooting-talent priors | — |

### 2.3 Working-data CSVs (committed to repo `data/`)

| File | Size | Purpose | Status |
|---|---|---|---|
| `data/shots_full_features_2025.csv` | 25 MB | Citrus PbP-derived 2025-26 shots used as training input | **Active** — refreshed via `scripts/utilities/export_raw_shots_csv.py --training` |
| `data/our_shots_2025.csv` | 9.9 MB | Same shots as above, alternate export | Likely **duplicate**; verify before removing |
| `data/moneypuck_shots_2025.csv.csv` | 22 MB | MoneyPuck's 2025-26 partial-season dump | Comparison reference. Note doubled `.csv.csv` extension (filename quirk) |
| `data/matched_shots_2025.csv` | 1.3 MB | Citrus shots matched to MoneyPuck shots for accuracy validation | Validation artifact |
| `data/nhl-schedule-2025.csv` | 324 KB | NHL 2025-26 schedule | Reference |
| `data/MoneyPuck_Shot_Data_Dictionary.CSV` | 15 KB | MoneyPuck schema reference | Reference |
| `data/TRAINING_DATA_MANIFEST.md` | 2 KB | Documents the training data workflow | Reference |
| `data/goalie_*.csv`, `data/player_*comparison.csv`, `data/shot_level_stats.csv`, `data/player_gar_components_raw.csv` | Various | Validation comparison artifacts | Mixed |

### 2.4 Repo-root prod database exports (UNTRACKED)

The `chunk_*.sql` and `prod_*.sql` files at the repo root of `citrus-league-storm-main/` and `citrus-league-storm-staging/`:

| File | Size | Purpose |
|---|---|---|
| `prod_data.sql` | 150 KB | Prod data export — small / metadata only |
| `prod_data_inserts.sql`, `prod_data_inserts_clean.sql` | 628 KB each | Prod INSERT statements (current state) |
| `prod_schema.sql` | 708 KB | Prod schema dump |
| `prod_stats_all.sql`, `prod_stats_all_clean.sql` | **100 MB each** | Full stats data dump |
| `chunk_player_directory.sql` / `chunk_player_season_stats.sql` / `chunk_player_talent_metrics.sql` / `chunk_player_ros_projections.sql` / `chunk_goalie_gsax_primary.sql` / `chunk__header.sql` | 0.5-1 MB each | Per-table SQL chunks for staging-load |
| `chunk_player_projected_stats.sql` | **97 MB** | The biggest projection-data dump |

**These files are 2025-only snapshots** — not historical. Created 2026-04-26 to support `staging-deploy.yml`'s `04-load-stats-data.mjs` PostgREST loader. **They are gitignored implicitly** (not committed) and should move to `data/exports/` per the reorg plan.

---

## 3. Pipeline scripts inventory

### 3.1 Active pipelines (referenced by GitHub workflows or cron)

Workflows in `.github/workflows/`:
- **`main.yml`** — Nightly Projection Batch, daily 7 AM UTC: runs `data-pipeline/projections/nightly_projection_batch.py --season 2025`
- **`playoff-sync.yml`** — Playoff result + bracket sync (active during playoffs)
- **`rls-audit.yml`** — Periodic RLS verification
- **`ci.yml`** — Build + test on every PR
- **`deploy-preview.yml`** — Preview deployments
- **`production-deploy.yml`** — Prod deploy on tag/release
- **`staging-deploy.yml`** — Staging deploy on push to `staging` or `staging-setup`
- **`schema-snapshot.yml`** — Sundays 09:00 UTC + manual: read-only `pg_dump --schema-only` of prod + `cron.job` manifest via `scripts/ops/dump-prod-schema.sh` → `supabase/schema/prod_schema.sql`, `prod_cron.sql`; opens a `chore/schema-snapshot-<date>` PR when they differ. Needs secret `PROD_DB_URL` (direct URL).
- **`draft-scorecard.yml`** — Draft Latency Scorecard, Mondays 12:00 UTC: runs `data-pipeline/monitoring/draft_latency_scorecard.py` (read-only) over the `draft_latency_scorecard` view (migration `20260901233000`; per-draft autopick deadline→commit p50/p95/max, autopick share, picks/min, duration; `security_invoker`, SELECT for `service_role` only). Fails the run when a draft breaches the CLAUDE.md autopick p95 ≤ 1000 ms target. Cloud Monitoring side of the same audit item (§B-8/§B-9): `infra/gcp/monitoring/` (log-based metrics, alert policies, "Citrus Draft Mandate" dashboard, `apply-monitoring.sh`).

NPM scripts in `package.json` (root):
- `dev`, `dev:server`, `dev:all`, `build`, `build:server`, `build:all`, `test`, `test:server`, `lint`, `deploy`, `firebase` — standard development
- `validate-migration` / `validate-all-migrations` / `test-migrations` — wraps `scripts/validate-migration.ts` and `scripts/test-migrations.ts`
- `gen:scoring` / `gen:scoring:check` — wraps `scripts/gen-scoring-defaults.mjs`: regenerates (or verifies) `data-pipeline/scoring/scoring_defaults.py` and `docs/generated/SCORING_DEFAULTS.md` from `packages/shared/src/constants/scoringDefaults.json`, the single source of the default scoring weights

### 3.2 `data-pipeline/` directory (17 active production scripts)

| Subdirectory | Files | Role |
|---|---|---|
| `acquisition/` | 13 files | NHL API ingestion: `data_acquisition.py`, `data_scraping_service.py`, `fetch_nhl_stats_from_landing*.py`, `ingest_live_raw_nhl.py`, `ingest_nhl_playoff_bracket.py`, `ingest_playoff_schedule.py`, `ingest_raw_nhl.py`, `ingest_shiftcharts.py`, `populate_team_stats.py`, `scrape_live_nhl_stats.py`, `scrape_per_game_nhl_stats.py`, `sync_playoff_results.py` |
| `projections/` | 9 files | Projection generation: `build_player_season_stats.py`, `calculate_daily_projections.py`, `fantasy_projection_pipeline.py`, **`nightly_projection_batch.py` (cron entry)**, `projection_uncertainty.py`, `quantify_monte_carlo_impact.py`, `quantify_uncertainty_impact.py`, `run_daily_projections.py`, `sync_ppp_from_gamelog.py` |
| `scoring/` | 5 files | `calculate_matchup_scores.py`, `reconcile_player_stats.py`, `run_daily_pbp_processing.py`, `simulate_matchups.py`, **`scoring_defaults.py` (generated — do not edit; `npm run gen:scoring`)** |
| `monitoring/` | 12 files | Health/freshness checks: `alerting.py`, `audit_projection_accuracy.py`, `check_data_freshness.py`, `draft_latency_scorecard.py` (weekly Mandate scorecard over the `draft_latency_scorecard` view), `health_check_server.py`, `monitor_data_scraping.py`, `monitor_proxy_health.py`, `run_midnight_update.py`, `verify_data_integrity.py`, `verify_projection_pipeline.py` + 2 test files |
| `draftkit/` | 1 script + `blurbs/` | `load_blurbs.py` — validates hand-written Draft Kit copy and upserts `draft_kit_blurbs` through the service role. Dry-run by default; `--apply` writes. Every CHECK constraint in the migration is re-implemented locally so an error names the file and line instead of surfacing as a PostgREST 23514. `blurbs/` holds the source `.md` files plus `_TEMPLATE.md` and a README; files starting with `_` are skipped |
| `utils/` | 4 files | `citrus_request.py` (NHL API throttle), `proxy_health.py`, `proxy_manager.py` (100-IP rotation), `supabase_rest.py` (DB client) |
| `debug/` | 14 files | One-off `check_*.py` / `audit_*.py` / `find_*.py` / `fix_*.py` / `verify_*.py` McDavid-and-similar scripts. **Keep but reorganize** — these are the reference forensics scripts |
| `tests/` | (count not enumerated) | Pipeline unit tests |
| `models/` | 18 .joblib files | See §2.2 above |
| `Dockerfile`, `docker-compose.yml`, `requirements.txt`, `_bootstrap.py`, `__init__.py` | — | Pipeline runtime |

### 3.3 `scripts/` directory (mixed — many one-offs)

**At root** (37+ files): mostly TS/SQL one-offs created during platform development
- TS migration helpers: `apply-migration.ts`, `audit_rls.ts`, `validate-migration.ts`, `test-migrations.ts`, `verify-and-add-profile-columns.sql`, `validate-all-migrations`, `verify-staging-tables.ts`, `scan-pipeline-tables.ts`, `verify-roster-integrity.ts`, `verify-games-remaining.ts`, `test-lineup-integration.ts`
- Data setup: `fetch-nhl-players.ts`, `fetch-nhl-schedule.ts`, `import-schedule-from-csv.ts`, `import-schedule-from-excel.ts`, `populate-nhl-teams-and-normalize.ts`
- Migration application: `add-profile-columns.sql`, `ensure-profile-columns.sql`, `fix-profiles-table.sql`, `find-my-league-id.sql`
- "NUKE" scripts (DESTRUCTIVE, kept for reference): `nuke-all-draft-data.sql`, `nuke-all-teams-comprehensive.sql`, `nuke-and-reset-teams.sql`, `delete-all-draft-data.sql`, `complete-draft-reset.sql`, `cleanup-duplicate-teams*.sql`, `quick-reset-by-email.sql`, `reset-league-teams.sql`, `reset-user-profile.sql`
- Testing: `test-team-insert.sql`, `test-teams-visibility.sql`, `backfill-daily-rosters.ts`, `check_draft_freeze.ts`

**Subdirectories:**
- `scripts/utilities/` — **38 Python scripts** including the production-critical `train_xg_v3.py`, `export_raw_shots_csv.py`, `populate_raw_shots.py`, `calculate_*.py`, `feature_calculations.py`. **Many are one-off debug** — see audit §2 for ACTIVE/UTILITY/ORPHAN classification per script.
- `scripts/staging/` — 7 files (`01-mark-migrations-applied.sql`, `02-create-gcp-secrets.md`, `03-setup-ci-secrets.md`, `04-load-stats-data.mjs`, `05-load-reference-data.mjs`, `06-verify-staging-ready.mjs`, `07-fix-missing-auth-trigger.sql`, `08-copy-prod-playoff-data.sql`, `audit-cross-schema-ddl.mjs`, plus `KNOWN_GAPS.md`, `README.md`, `ROLLBACK_RUNBOOK.md`)
- `scripts/maintenance/` — 1 file (`archive_to_csv.py`)
- `scripts/shell/` — 2 files (`RUN_FULL_BACKTEST.bat`, `RUN_FULL_BACKTEST.sh`)
- `scripts/load-test/` — performance testing

### 3.4 `supabase/` directory

- `migrations/` — **284 migration files** (timestamp-prefixed, from 2024-12 through 2026-05). All applied per `supabase_migrations.schema_migrations`.
- `functions/` — 6 edge functions: `_shared/`, `demo-matchup-cache/`, `draft-autopick/`, `fetch-spreads/`, `pipeline-deadman/`, `stormy-chat/`
- `seed.sql`, `seeds/`, `templates/`, `tests/` — standard Supabase scaffolding
- `config.toml` — Supabase project config
- `schema/` — prod schema record. `production_snapshot_20260813.sql` is the hand-taken one (retire it once the first `schema-snapshot.yml` PR merges); `prod_schema.sql` + `prod_cron.sql` are the weekly generated pair (see §3.1).

---

## 4. Database schema reference

See §1.2 for the full table-by-table inventory in prod. **Critical schema quirks:**

- `raw_shots.season` column exists but is **NULL on every row** — derive season from `game_id` prefix (first 4 chars).
- `player_shifts.season`, `player_toi_by_situation.season` — same pattern.
- `goalie_gar` has no `season` column (single-cohort).
- `goalie_gsax_primary` is empty in prod (0 rows) but has 82 rows in staging — origin unclear.
- `player_gar_components` defensive components (`evd_gar_per_60`, `ppd_gar_per_60`, `penalty_gar_per_60`) are **0.0 league-wide** — pipeline gap.
- `raw_shots` shooter-shift-context columns (`shooter_time_on_ice`, `shooting_team_average_time_on_ice`, `time_difference_since_change`) are **NULL on every row** — extractor's upstream calculator returns None despite the columns being in the INSERT list (Phase 0 / 0d-pre #2 fix). The three defender-geometry columns (`distance_to_nearest_defender`, `skaters_in_screening_box`, `nearest_defender_to_net_distance`) were **dropped 2026-05-07** (Phase 0 / 0d-pre #1) — NHL public PBP feed has no defender coordinates; v2 unlock paths in `apps/web/docs/GAPS_AND_FUTURE_CAPABILITIES.md` § 1.
- `raw_shots.shot_type` is **NULL on ~0.92% of rows** — source-data reality, not a loader defect. NHL PBP feed records `typeCode` (506/507) without a sub-type for some shots; MoneyPuck propagates the NULL. Audited 2026-05-19 on the Phase 0a season=2024 load (1,105 NaN of 119,870 CSV rows). The loader passes these through as NULL rather than imputing to `'unknown'` to avoid conflating "feed didn't classify" with a future intentional `'unknown'` category. Same pattern expected on the remaining 7 historical seasons and on live 2025-26 scraper output. Any analytics filtering on `shot_type` should account for this fraction (not raised to a GAPS entry — no platform-side unlock path, this is the upstream source as-is).
- `raw_shots` goals and shots-on-goal counts run **~6-11% higher than NHL.com headline totals** for the same player-season. MoneyPuck includes empty-net goals and shootout shots that NHL.com's main scoring tables typically exclude. Verified 2026-05-19 against three player-seasons: McDavid 2022-23 (staging 71G vs NHL.com 64G), Ovechkin 2018-19 (55G vs 51G), MacKinnon 2023-24 (55G vs 51G; 451 SOG vs 405). Pattern is consistent in direction (always higher), small in magnitude, and matches the documented MoneyPuck convention. Any analytics that reports goal or SOG totals against an NHL.com-style baseline should disclose the convention difference. Not a load defect.

### Phase 0c quirks (moat feature population)

- **MoneyPuck intra-bucket insertion order ≠ NHL sortOrder, era-dependent.** For same-game same-player same-shot-type shot buckets, MoneyPuck's file order does not track NHL's `sortOrder` within the bucket. The era probe (40 games, 5/season × 8 seasons, 2026-07-26) showed coord-mismatch counts of 2 in 2024 vs 113 in 2021 as evidence of the divergence. **Order-based NHL→DB matching is forbidden.** Phase 0c uses time-bridge matching (NHL→CSV by MoneyPuck game-seconds, CSV→DB via unique constraint by provenance). See `scripts/utilities/replay_pbp_for_moat.py`.
- **MoneyPuck `xCord`/`yCord` use a "shooter attacks positive x" convention** that flips sign relative to NHL's raw physical coordinates depending on attacking side. The `raw_shots` unique constraint `(game_id, player_id, shot_x, shot_y, shot_type_code)` is **valid CSV→DB** (0a loaded these exact CSVs — provenance) and **invalid NHL→DB** (a POC in 2026-07-26 got 17/90 matches on game 2024020001 attempting to match NHL raw coords to DB rows via the unique constraint). `arena_adjusted_x_abs`/`y_abs` DO match `|NHL_shot_x|`/`|NHL_shot_y|` within ±10 units in ~99.8% of pairs — used as the coord-verification backstop in `replay_pbp_for_moat.py` to guard against wrong-net-side mispairings (deltas of 60-140 units).
- **MoneyPuck game-seconds convention** (verified 2026-07-26 across reg-season/playoff/multi-OT): `time = (period-1)*1200 + seconds_into_period` for ALL periods including reg-OT (5-min → time in [3600, 3900]) and playoff-OT (20-min → time in [3600, 4800]). NHL's `timeInPeriod` (`"MM:SS"`) + `periodDescriptor.number` inverts trivially. `1200` is arbitrary MoneyPuck bookkeeping (20-minutes'-worth of slot regardless of actual period length) — do not assume it equals the physical period duration.
- **MoneyPuck excludes shootout shots from `shots_*.csv` by design.** Reg-season shootout events (period=5, `time_in_period="00:00"`, `periodDescriptor.periodType="SO"`) are present in NHL PBP but not MoneyPuck. `replay_pbp_for_moat.py` filters these out before match/count so they do not consume the unmatched-cap.
- **Per-season `has_pass_before_shot` capture density** (era probe, 40 games, 5/season × 8 seasons):

  | season | has_pass rate |
  |---|---|
  | 2017 | 3.2% |
  | 2018 | 6.3% |
  | 2019 | 7.6% |
  | 2020 | 6.5% |
  | 2021 | 3.9% |
  | 2022 | 5.5% |
  | 2023 | 7.2% |
  | 2024 | 9.0% |

  Monotonic improvement in NHL PBP capture over time; **2021 is an unexplained dip** (open question pending full-season 0c data). Cross-era comparisons of moat-derived metrics (pass_quality_score, goalie_movement_score, etc.) MUST account for capture-density differences — the same player's average moat scores in 2017 are structurally lower not because they made fewer setup passes but because fewer of them were captured.
- **`passer_id` fallback to `eventOwnerTeamId` when previous event lacks `playerId`.** Pre-existing behavior from live scraper (`data_acquisition.py` lines 322-327). For events like hits, blocks, penalties whose `details` carries `hittingPlayerId`/`blockingPlayerId` instead of `playerId`, the pass-detection code falls back to the team_id. Downstream consumers joining `passer_id` against `player_directory` will get orphan joins on these fallback rows (team_id ≈ 1..32, distinguishable from player_ids ≈ 84xxxxx). Documented so consumers can filter.

- **NHL PBP payload drift after `gameState=OFF`, and the duplication trap on naive refresh.** NHL revises play-by-play content after games settle (coord nudges of 1-3 units, playerId corrections on hit/block events, event insertions or removals when scoring gets overturned or credited to a different player). The live scraper captures at scrape-time, so `raw_shots` for live-era games reflects the payload as-it-was-then, not the current NHL API answer. Evidence from the 2026-07-26 parity audit on 49 live-era games: 9 prod rows had no partner in a naive unique-constraint join against a fresh NHL API extraction of the same games — a mix of dedupe-collapsed §16 buckets and likely settled-content changes.

    **The trap:** the shot-coverage reconciler (`data-pipeline/monitoring/reconcile_shot_coverage.py`) is content-blind — it fires on `no_payload`, `stale_payload` (gameState-not-terminal), or `no_shots`, but NEVER on "same game, coords nudged 2 units by NHL post-facto." A settled-content refresh through the normal extract → `_save_shots_to_database` → `on_conflict=(game_id, player_id, shot_x, shot_y, shot_type_code)` path DOES NOT OVERWRITE drifted rows: a coord nudge changes the unique-constraint key, so the "same" shot lands as a NEW row beside the stale one. Result: duplicated shots on any subsequent naive reprocess. Same mechanism for playerId corrections.

    **Safe refresh patterns** (either, not both):
    1. Per-game DELETE-then-INSERT: `BEGIN; DELETE FROM raw_shots WHERE game_id = N; INSERT ... SELECT ... FROM extraction; COMMIT` — atomic, guarantees no residue.
    2. Event-identity match: UPDATE by `(game_id, event_id, sort_order)` instead of the coord-tuple unique constraint. NHL `event_id`/`sort_order` are stable across API refetches for the same physical event; the unique-constraint columns are not. `event_id` is now populated on all 119,766/119,766 prod 2025 rows, so this path is available if the refresher opts into it.

    Never naive-reprocess through the live path expecting `merge-duplicates` to overwrite. It won't.

---

## 5. Other related repos / directories (NOT canonical)

These are the parts of the entropy that the audit surfaced. **They should NOT be considered canonical** for any current data:

| Path | Status | Action |
|---|---|---|
| `C:\Users\garre\Documents\_archive\citrus-pre-monorepo\citrus-league-storm\` | **ARCHIVED 2026-05-05** (R6) — Dec 2024 pre-monorepo repo. Has `data/`, `dist/`, `assets/`, `android/`, `ios/`, plus 14 `.joblib` files at root and ~30 design-decision MD files | See `_archive/citrus-pre-monorepo/README_ARCHIVED.md` for the lineage map + filename collision warning |
| `C:\Users\garre\Documents\_archive\citrus-pre-monorepo\downloads\` | **ARCHIVED 2026-05-05** (R6) — pre-monorepo repo backup zips (`citrus-league-storm-main-master.zip`, `citrus-league-storm-main (1).zip`) plus the extracted master copy | Same archive, same README |
| `C:\Users\garre\Documents\citrus-league-storm-main\` | Current main worktree | **CANONICAL** for prod-deploy work |
| `C:\Users\garre\Documents\citrus-league-storm-staging\` | Staging worktree (this doc lives here) | Active for staging |
| `C:\Users\garre\Documents\citrus-league-storm-phase45\` | Phase 4-5 worktree | Active for player-dashboard work |
| `C:\Users\garre\citrus-league-storm-main\` | Stub directory with only `logs/` | Likely orphan; out-of-scope for R6 — investigate in a follow-up |
| `C:\Users\garre\Documents\citrus-draft-elixir\` | Separate Elixir-based draft project | Not part of current Citrus product. Independent decision |
| `C:\Users\garre\.cursor\worktrees\citrus-league-storm__Workspace_` | Cursor IDE worktree | IDE artifact; ignore |

---

## 6. Update protocol

Foundation tools (2026-09-06): `data-pipeline/monitoring/metric_identity.py`
is a read-only JSON snapshot reconciler. It fingerprints both inputs and
quarantines missing/duplicate/conflicting shot identities without rewriting
probabilities. `docs/ANALYTICS_ACCEPTANCE.md` records live evidence separately
from local tests and tracks the remaining foundation/metric gates.
`monitoring/shot_replay_guard.py` now runs before coordinate deduplication in
both acquisition save paths. Existing revisions, removed/ambiguous events and
coordinate collisions are quarantined by raising before write; partial saves
also raise instead of continuing to apparently complete aggregates. This is a
preflight barrier, not a concurrent/atomic replacement protocol.

Unapplied migration `20260906005705_analytics_versioned_publication_contract.sql`
defines service-only, RLS-enabled `analytics_source_snapshots`,
`analytics_metric_batches`, `analytics_metric_values`, and
`analytics_publications`. Payload hashes, exact version/population metadata,
availability reasons, source observation/cutoff timestamps and immutable
publication events preserve evidence separately from current serving tables.
No reader switch is included. Test runner: `scripts/test_analytics_publication.mjs`
(isolated PGlite, temporary dependency only; no application dependency added).
`projections/analytics_publication.py` prepares deterministic immutable batches,
resumes interrupted inserts and publishes only after preparation. The
`verified_toi_publication.py` adapter includes frozen official receipts, stored
rows and reconciliation reasons. `server/src/services/AnalyticsPublicationService.ts`
is the background consumer adapter: exact variant/version matching, expected
entity verification and explicit freshness expiry. These adapters are not enabled
in production jobs or legacy readers pending rollout.

Canonical source observations (UNAPPLIED): migration `20260906013428` adds
service-only immutable `analytics_event_observations` and sealed
`analytics_event_observation_sets`. `acquisition/canonical_events.py` preserves
raw source coordinates, nullable context and event identity;
`event_observation_service.py` retains correction revisions and resumes partial
inserts before sealing. Quarantine is retained in the immutable source payload.
`acquisition/collect_observations.py` is a read-only official-feed collector with
real observation timestamps, per-request receipts and affirmative health counts.
The conflict-game manifest is `docs/analytics-conflict-game-manifest-20260906.json`;
live receipt files are outside Git at
`/private/tmp/citrus-official-observations-20260906-0211` (ephemeral, not an archive).
SQL fixtures run through `scripts/test_canonical_observations.mjs`.
`scripts/test_analytics_races.mjs` requires an explicitly selected empty local
Postgres database; it refuses remote hosts. Its native execution is currently
blocked by the desktop sandbox's shared-memory restriction, not certified by
the single-connection PGlite tests.

**When adding a new data artifact, update this doc:**

1. **New table** → add to §1.2 with row count + writer script + size
2. **New historical archive file** → add to §2.1 with size + source URL + last download
3. **New trained model** → add to §2.2 with training data + AUC/metric + commit hash
4. **New committed CSV in `data/`** → add to §2.3
5. **New active workflow / cron** → add to §3.1
6. **New pipeline script** → add to §3.2 or §3.3 with classification (production / utility / debug)

**When deprecating:**
- Mark inline as `[DEPRECATED YYYY-MM-DD: reason]`
- Don't delete from this doc — keep as historical record

**When the schema changes** (migration applied):
- Update §4 if the change creates a new schema quirk worth flagging
- Otherwise the migration file in `supabase/migrations/` is the source of truth

---

## What this doc IS NOT

- **Not the full audit** — see `apps/web/docs/DATA_ORGANIZATION_AUDIT.md` for the comprehensive findings + categorization matrix + reorg plan
- **Not the migration log** — `supabase/migrations/` is the source of truth for schema history
- **Not the pipeline runbook** — see `data-pipeline/` and `OPERATIONS.md` / `ENGINEERING.md`
