# Citrus Data Inventory

**Last updated:** 2026-05-05 (post-R6 reorganization) · **Status:** Stable canonical structure
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
| `player_directory` / `player_season_stats` / `player_talent_metrics` / `player_gar_components` / `player_ros_projections` | 938 / 1066 / 1012 / 935 / 926 | <1 MB each | various scripts/utilities |
| `goalie_*` family | 82-197 | <200 KB each | `scripts/utilities/calculate_goalie_*.py` |

**Critical observations:**
- `player_shifts_official` has a row-count discrepancy (pg_class says 198K, list_tables says 0). Worth investigating.
- `raw_player_stats`, `staging_2024_*`, `staging_2025_*`, `team_stats`, `players` (the lowercase non-schema-qualified version), `2025_Skaters` — **all RLS-disabled** (advisory) and many appear unused in app queries. Candidates for orphan triage.
- `public.public.players` — table literally named `public.players` inside the public schema (double-schema-prefix in the name). Almost certainly an artifact of a bad migration. Flagged.
- See `apps/web/docs/DATA_ORGANIZATION_AUDIT.md` for orphan analysis details.

---

## 2. Historical data archives

### 2.1 MoneyPuck multi-season shot data — the xG training corpus

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

NPM scripts in `package.json` (root):
- `dev`, `dev:server`, `dev:all`, `build`, `build:server`, `build:all`, `test`, `test:server`, `lint`, `deploy`, `firebase` — standard development
- `validate-migration` / `validate-all-migrations` / `test-migrations` — wraps `scripts/validate-migration.ts` and `scripts/test-migrations.ts`
- `gen:scoring` / `gen:scoring:check` — wraps `scripts/gen-scoring-defaults.mjs`: regenerates (or verifies) `data-pipeline/scoring/scoring_defaults.py` and `docs/generated/SCORING_DEFAULTS.md` from `packages/shared/src/constants/scoringDefaults.json`, the single source of the default scoring weights

### 3.2 `data-pipeline/` directory (16 active production scripts)

| Subdirectory | Files | Role |
|---|---|---|
| `acquisition/` | 13 files | NHL API ingestion: `data_acquisition.py`, `data_scraping_service.py`, `fetch_nhl_stats_from_landing*.py`, `ingest_live_raw_nhl.py`, `ingest_nhl_playoff_bracket.py`, `ingest_playoff_schedule.py`, `ingest_raw_nhl.py`, `ingest_shiftcharts.py`, `populate_team_stats.py`, `scrape_live_nhl_stats.py`, `scrape_per_game_nhl_stats.py`, `sync_playoff_results.py` |
| `projections/` | 9 files | Projection generation: `build_player_season_stats.py`, `calculate_daily_projections.py`, `fantasy_projection_pipeline.py`, **`nightly_projection_batch.py` (cron entry)**, `projection_uncertainty.py`, `quantify_monte_carlo_impact.py`, `quantify_uncertainty_impact.py`, `run_daily_projections.py`, `sync_ppp_from_gamelog.py` |
| `scoring/` | 5 files | `calculate_matchup_scores.py`, `reconcile_player_stats.py`, `run_daily_pbp_processing.py`, `simulate_matchups.py`, **`scoring_defaults.py` (generated — do not edit; `npm run gen:scoring`)** |
| `monitoring/` | 11 files | Health/freshness checks: `alerting.py`, `audit_projection_accuracy.py`, `check_data_freshness.py`, `health_check_server.py`, `monitor_data_scraping.py`, `monitor_proxy_health.py`, `run_midnight_update.py`, `verify_data_integrity.py`, `verify_projection_pipeline.py` + 2 test files |
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
