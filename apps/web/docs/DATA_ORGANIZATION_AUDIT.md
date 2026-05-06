# Data Organization Audit + Reorganization Plan

**Date:** 2026-05-05
**Trigger:** The historical-data location hunt took unexpected effort because data lives in scattered locations. Before adding 7 seasons of new data, we organize what's there.
**Constraint:** **READ-ONLY audit + organization plan. No data deletion, no table drops, no file moves until Garrett approves.** This doc is the proposal; execution waits for sign-off.
**Companion:** `DATA_INVENTORY.md` at repo root (canonical "where data lives" reference).

---

## TL;DR

The Citrus data ecosystem has accumulated significant entropy across **5+ repo directories**, **~1.5 GB of historical CSV data scattered across `Downloads/`** with multiple duplicates, **two Supabase projects** with several orphan-suspected tables, and **>70 scripts spanning `data-pipeline/`, `scripts/utilities/`, `scripts/staging/`, and the repo root** with unclear active-vs-orphan status.

**The reorganization recommendation is conservative:**
1. **Don't delete anything in Phase 1.** Move + archive + document.
2. **One canonical worktree** (`citrus-league-storm-main/`) gets the cleaned-up structure. Other worktrees stay as-is until they're rebased.
3. **The `Downloads/` historical CSVs move to `data-pipeline/data/historical/`** (gitignored) so they're proximate to the training scripts that reference them.
4. **Repo-root `prod_*.sql` + `chunk_*.sql` files move to `data/exports/`** (gitignored) so they're discoverable for staging-deploy but don't pollute the root.
5. **Orphan-suspected Supabase tables get audited via grep** before any drops.
6. **Canonical scripts get tagged in-source** with `# ACTIVE: referenced by .github/workflows/main.yml` headers; orphans stay but get tagged `# ORPHAN-SUSPECTED: last referenced YYYY-MM-DD`.

Every move has a paired before/after location. Rollback is `git mv -k` reversal or `git restore`. **No deletions** in Phase 1 of the reorg.

---

## §1 — Comprehensive inventory

### §1.1 Local file system — Citrus directories discovered

| Path | Purpose | Status | Last modified |
|---|---|---|---|
| `C:\Users\garre\Documents\citrus-league-storm-main\` | Current main worktree (canonical) | **ACTIVE** | 2026-05-04+ |
| `C:\Users\garre\Documents\citrus-league-storm-staging\` | Staging-setup worktree | **ACTIVE** | 2026-05-04+ |
| `C:\Users\garre\Documents\citrus-league-storm-phase45\` | Phase 4-5 worktree (player dashboard) | **ACTIVE** | 2026-05-04 |
| `C:\Users\garre\Documents\citrus-league-storm\` | Pre-monorepo repo (mobile-app era, Dec 2024) | **HISTORICAL** | 2024-12-22 |
| `C:\Users\garre\citrus-league-storm-main\` | Stub directory with only `logs/` subdir | **ORPHAN** | 2025-04-11 |
| `C:\Users\garre\Documents\citrus-draft-elixir\` | Separate Elixir-based draft project | **NOT-CITRUS-DATA** | (independent project) |
| `C:\Users\garre\.cursor\worktrees\citrus-league-storm__Workspace_` | Cursor IDE worktree | IDE-artifact | — |
| `C:\Users\garre\Downloads\citrus-league-storm-main-master\` | Pre-monorepo repo backup (extracted zip) | **HISTORICAL** | 2024-12-22 |

### §1.2 `Downloads/` historical-data inventory

**MoneyPuck shot data files** (canonical source for xG training):

| File | Size | Modified | Status |
|---|---|---|---|
| `shots_2017.csv` (extracted) + `shots_2017.zip` (19 MB) | 64 MB | 2026-02-17 | **HISTORICAL** — 2017-18 NHL season (NOT in the bundled 2018-2024) |
| `shots_2018-2024.csv` (extracted) + `shots_2018-2024.zip` (126 MB) + `shots_2018-2024/shots_2018-2024.csv` (extracted folder) | 447 MB × 2 + 126 MB | 2026-02-17 | **CANONICAL training data** — 786,244 rows, 2018-19 → 2024-25 |
| `shots_2018.zip` / `shots_2019.zip` / `shots_2020.zip` / `shots_2021.zip` / `shots_2022.zip` | ~13-19 MB each | 2026-02-17 | **DUPLICATE** — these are individual-season versions of what's in shots_2018-2024 |
| `shots_2023.csv` (Jan 7 2025 mtime) + `shots_2023.zip` + `shots_2023 (1).csv` (Dec 14 2024 mtime) + `shots_2023 (1).zip` + `shots_2023 (2).zip` | ~67 MB CSV × 2, ~20 MB zip × 3 | various | **DUPLICATE** — multiple downloads of the same MoneyPuck 2023-24 zip |
| `shots_2024 (1).csv` + `shots_2024 (1).zip` + `shots_2024 (2).zip` + `shots_2024.zip` (Dec 10 2024) | ~66 MB CSV, ~20 MB zip × 3, plus 6.1 MB old version | various | **DUPLICATE** — multiple downloads, oldest from before season completed |
| `shots_2025.zip` (Dec 9) + `shots_2025 (1).zip` (Dec 17) | 6.1 MB / 7.2 MB | 2025-12 | **STALE** — partial-season MoneyPuck 2025-26 dumps. Superseded by Citrus's own PbP for current-season data |

**Total Downloads MoneyPuck volume:** ~1.4 GB across ~15 files, with significant duplication. After dedup: ~600-700 MB unique data covering 2017-18 → 2024-25 = **8 NHL seasons**.

### §1.3 Repo data files

**Committed `data/` directory** (in every worktree, identical content):
- 5 working CSVs (2025-tagged), 1 reference dictionary, 1 manifest, 4 small comparison artifacts (~58 MB total)
- See `DATA_INVENTORY.md` §2.3

**Untracked at repo root** (`citrus-league-storm-main/` only — staging worktree has the smaller `chunk_*.sql` subset):
- `prod_data.sql` (150 KB), `prod_data_inserts.sql` (628 KB), `prod_data_inserts_clean.sql` (628 KB), `prod_schema.sql` (708 KB), `prod_stats_all.sql` (100 MB), `prod_stats_all_clean.sql` (100 MB)
- `chunk__header.sql`, `chunk_goalie_gsax_primary.sql`, `chunk_player_directory.sql`, `chunk_player_projected_stats.sql` (97 MB), `chunk_player_ros_projections.sql`, `chunk_player_season_stats.sql`, `chunk_player_talent_metrics.sql`
- All created **2026-04-26 23:32** (single dump session). Used by `scripts/staging/04-load-stats-data.mjs`. **Not in `.gitignore`** but not tracked.

**Models** (`data-pipeline/models/`, committed): 18 .joblib files. See `DATA_INVENTORY.md` §2.2.

**OLD `citrus-league-storm/` repo** — has additional artifacts at root:
- `xg_model.joblib`, `xa_model.joblib`, `rebound_model.joblib`, `xg_model_moneypuck.joblib`, `moneypuck_xg_predictor.joblib` (the last one is **NOT in current repo's `data-pipeline/models/`**)
- `player_gar_components.csv`, `shift_api_sample_legacy_api____shiftcharts.json`
- `data/moneypuck_shots_2023.csv` (69 MB) + `data/moneypuck_shots_2024.csv` (69 MB) — full-season MoneyPuck CSVs that aren't in the current monorepo

### §1.4 Both Supabase projects — table inventory

**prod (`iezwazccqqrhrjupxzvf`):** 88 application tables in `public` schema. See `DATA_INVENTORY.md` §1.2 for the full storage-sorted list.

**Tables flagged for orphan analysis:**

| Table | Rows | Status | Concern |
|---|---|---|---|
| `player_shifts_official` | 198,988 (verified by COUNT) | **CONFIRMED ACTIVE** *(R5 §7.6)* | Daily writes via `data-pipeline/acquisition/ingest_shiftcharts.py`; read by `simulate_matchups.py` + `extractor_job.py`. Earlier "list_tables=0" reading was a tool false-signal, not a real data state. |
| `raw_player_stats` | 15,489 | **RLS-DISABLED** | Source unclear; never seen in app queries; advisory flagged |
| `staging_2024_skaters` | 4,600 | **RLS-DISABLED + LIKELY-ORPHAN** | Naming suggests 2024-25 staging that was never cleaned up |
| `staging_2025_skaters` | 3,945 | **RLS-DISABLED + LIKELY-ORPHAN** | Same |
| `staging_2024_goalies` | 515 | **RLS-DISABLED + LIKELY-ORPHAN** | Same |
| `staging_2025_goalies` | 390 | **RLS-DISABLED + LIKELY-ORPHAN** | Same |
| `team_stats` | 32 | **RLS-DISABLED** | App-data flavor; possibly used somewhere |
| `players` (lowercase, 801 rows) | 801 | **RLS-DISABLED** | Distinct from the regular Supabase `auth.users`/`profiles` flow. Source unclear |
| `public.public.players` | 0 / -1 (-1 means never analyzed) | **DROPPED 2026-05-05** *(R5 disposition)* | Was a malformed-migration artifact. Removed via `supabase/migrations/20260505200000_drop_legacy_public_players_table.sql` with self-defending row-count guard. |
| `2025_Skaters` | 0 / -1 | **LIKELY-ORPHAN** | Capital-letter name suggests a one-off CSV import that never got cleaned up |
| `integrity_check_results` | 68,693 (current) | **CONFIRMED ACTIVE** *(R5 §7.4)* | Production integrity logging since 2026-01-16. 5 distinct check types, daily writes through 2026-05-06. Writers: `verify_data_integrity.py`, `reconcile_player_stats.py`, plus stored procs in `20260116000003_create_integrity_checks.sql` + `20260402000000_repair_stale_team_lineups.sql`. RLS-protected (commissioner-only view). |
| `team_lineups_backup_log` | 0 | **EMPTY** | Defined but never written; may be unused safety-net |

**staging (`jjgspcpvqaiitloglxbb`):** mostly empty mirror; **`goalie_gsax_primary` has 82 rows here vs 0 in prod** — likely from an earlier staging-load test that wasn't synchronized to prod.

### §1.5 Pipeline scripts — active vs orphan classification

**Active production pipelines** (verifiable via .github/workflows or package.json):
- `data-pipeline/projections/nightly_projection_batch.py` — invoked by `main.yml` cron
- `scripts/validate-migration.ts`, `scripts/test-migrations.ts` — invoked by package.json
- `scripts/staging/04-load-stats-data.mjs`, `05-load-reference-data.mjs`, `06-verify-staging-ready.mjs` — invoked by `staging-deploy.yml`
- `data-pipeline/acquisition/sync_playoff_results.py` — likely invoked by `playoff-sync.yml`
- `data-pipeline/scoring/run_daily_pbp_processing.py`, `data-pipeline/scoring/calculate_matchup_scores.py` — likely invoked by scoring pipeline (verify in workflows)

**Production-utility scripts** (referenced by other production scripts but not directly cron'd):
- `data-pipeline/utils/citrus_request.py`, `proxy_health.py`, `proxy_manager.py`, `supabase_rest.py` — imported by acquisition scripts
- `scripts/utilities/populate_raw_shots.py`, `process_xg_stats.py`, `feature_calculations.py`, `calculate_player_toi.py`, `populate_player_directory.py` — referenced by data-acquisition flow
- `data-pipeline/projections/build_player_season_stats.py`, `calculate_daily_projections.py`, `fantasy_projection_pipeline.py` — referenced by `nightly_projection_batch.py`
- `data-pipeline/projections/projection_uncertainty.py`, `quantify_monte_carlo_impact.py`, `quantify_uncertainty_impact.py` — likely referenced; verify

**Training pipeline** (manual / on-demand):
- `scripts/utilities/train_xg_v3.py` — primary xG model trainer (per TRAINING_DATA_MANIFEST.md)
- `scripts/utilities/train_xg_calibration.py` — calibration model
- `scripts/utilities/export_raw_shots_csv.py` — exports prod shots to training CSV
- `scripts/utilities/calculate_shooting_talent.py`, `calculate_gar_components.py`, `calculate_gar_regression.py`, `calculate_goalie_gar.py`, `calculate_goalie_gsax.py`, `calculate_goalie_rebound_control.py` — model + derived-table generators
- `scripts/utilities/model_trainer.py`, `xa_model_trainer.py`, `enhanced_flurry_adjustment.py`, `process_xg_stats.py`

**Analysis / utility scripts** (less clear status):
- `scripts/utilities/backfill_missing_shots.py` — gap-filler; one-off when needed
- `scripts/utilities/backtest_vopa_model.py` — model validation
- `scripts/utilities/deep_analyze_moneypuck_model.py` — analysis tool
- `scripts/utilities/show_feature_importance.py`, `validate_xg_accuracy.py`, `validation_utils.py`, `visualization_utils.py` — analysis/visualization
- `scripts/utilities/zone_heatmap.py`, `create_xg_heatmap.py` — visualization
- `scripts/utilities/populate_*.py` (`populate_and_verify_league_averages`, `populate_goalie_names_from_api`, `populate_gp_last_10_metric`, `populate_league_averages`, `populate_player_names_from_api`, `populate_weekly_stats`) — one-off seeders, mostly used during initial rollout
- `scripts/utilities/run_projections_with_progress.py`, `run_shiftcharts_with_progress.py`, `run_week_projections.py` — manual pipeline runners
- `scripts/utilities/sync_rosters.py`, `extractor_job.py` — orchestrators

**Scripts at `scripts/` root** (37 files, mostly one-off):
- TS migration helpers (some active per package.json)
- "NUKE" scripts (DESTRUCTIVE; KEEP for reference, audit before reuse)
- Setup TS scripts (`fetch-nhl-players.ts`, `populate-nhl-teams-and-normalize.ts`) — likely used during initial setup
- SQL one-offs (`fix-profiles-table.sql`, `find-my-league-id.sql`, `quick-reset-by-email.sql`, etc.) — should be archived

**Debug scripts** (`data-pipeline/debug/`, 14 files): `audit_mcdavid_data.py`, `check_*.py`, `find_*.py`, `fix_*.py`, `verify_*.py`. Useful for forensics. **Keep as-is, mark as debug-tooling not production.**

---

## §2 — Categorization

For brevity, the full per-artifact classification table lives implicitly in §1. Here are the **categorical buckets**:

### ACTIVE (in current production use)
- All 6 GitHub workflows (`ci.yml`, `deploy-preview.yml`, `main.yml`, `playoff-sync.yml`, `production-deploy.yml`, `rls-audit.yml`, `staging-deploy.yml`)
- `data-pipeline/projections/nightly_projection_batch.py` (cron)
- `data-pipeline/utils/*` (imported by all data-pipeline scripts)
- `data-pipeline/acquisition/*` (NHL ingest pipeline)
- `data-pipeline/scoring/*` (scoring pipeline)
- `data-pipeline/monitoring/*` (alerting + freshness)
- `data-pipeline/models/*.joblib` (production xG/xA/rebound models)
- `scripts/utilities/train_xg_v3.py`, `export_raw_shots_csv.py`, `calculate_*.py` (training + derived-table flow)
- `scripts/staging/04-08*.mjs/sql` + `audit-cross-schema-ddl.mjs` (staging deploy)
- `scripts/validate-migration.ts`, `test-migrations.ts`, `apply-migration.ts` (npm scripts)
- All `supabase/migrations/*` (284 files, all applied per `schema_migrations`)
- All `supabase/functions/*` (6 edge functions, deployed)
- Active prod tables: every table with rows >0 except the orphan-suspected ones below
- `data/shots_full_features_2025.csv`, `data/our_shots_2025.csv`, `data/moneypuck_shots_2025.csv.csv`, `data/MoneyPuck_Shot_Data_Dictionary.CSV`, `data/TRAINING_DATA_MANIFEST.md`
- `C:\Users\garre\Downloads\shots_2018-2024.csv` (referenced by manifest)

### HISTORICAL (legitimate archive — keep but organize)
- `C:\Users\garre\Downloads\shots_2017.csv` + `shots_2017.zip` (2017-18 season, NOT covered by 2018-2024 bundle)
- `C:\Users\garre\Downloads\shots_2018-2024.zip` (zip of the canonical CSV — keep as backup)
- `C:\Users\garre\Documents\citrus-league-storm\` (pre-monorepo repo — historical reference, especially the doc archive of `BACKEND_GUIDE.md`, `EXPECTED_GOALS_EXPLAINED.md`, `GAR_IMPLEMENTATION_SUMMARY.md`, etc.)
- `C:\Users\garre\Downloads\citrus-league-storm-main-master\` (pre-monorepo repo backup — superseded by current monorepo, but keep zip)
- Repo-root `prod_*.sql` and `chunk_*.sql` (current prod export from 2026-04-26 — useful for staging reset or rollback reference)

### DUPLICATE (same data in multiple places — pick canonical)
- `shots_2018.zip`, `shots_2019.zip`, `shots_2020.zip`, `shots_2021.zip`, `shots_2022.zip` — superseded by `shots_2018-2024.zip` bundle. **Recommendation: keep the bundle, archive the singletons** (move to `Downloads/_archive/` or delete after Garrett sign-off)
- `shots_2023.zip`, `shots_2023 (1).zip`, `shots_2023 (2).zip` — pick the freshest mtime, archive others
- `shots_2024.zip`, `shots_2024 (1).zip`, `shots_2024 (2).zip` — same
- `shots_2018-2024.csv` and `shots_2018-2024/shots_2018-2024.csv` — second is the extraction of the first; keep one
- `data/our_shots_2025.csv` and `data/shots_full_features_2025.csv` — same row count (76,878). Likely redundant; **verify column-set equality** before declaring dup
- `data/moneypuck_shots_2025.csv.csv` — note the doubled extension. Either rename or document the quirk
- Old `citrus-league-storm/` repo's `data/moneypuck_shots_2023.csv` + `2024.csv` — superseded by Downloads version in shots_2018-2024 bundle

### ORPHAN (no longer referenced; investigate before action)
- `C:\Users\garre\citrus-league-storm-main\` (only `logs/` directory) — find out what wrote logs there
- Supabase tables: `2025_Skaters`, `players` (lowercase), `public.public.players` (broken name), `staging_2024_skaters`, `staging_2024_goalies`, `staging_2025_skaters`, `staging_2025_goalies`, `raw_player_stats`, `team_stats`, `team_lineups_backup_log`, `integrity_check_results` (uncertain but large)
- `scripts/utilities/` one-off populate scripts that were used during initial rollout but probably aren't called anymore
- TS scripts at `scripts/` root: `fetch-nhl-players.ts`, `populate-nhl-teams-and-normalize.ts`, `fetch-nhl-schedule.ts`, `import-schedule-from-csv.ts`, `import-schedule-from-excel.ts` — likely setup-era one-offs

### OBSOLETE (known dead — propose deletion AFTER review)
- `citrus-league-storm/` old repo — the Dec 2024 mobile-app-first version; predates current architecture entirely. **Don't delete the directory yet** but `.git`-archive it eventually
- `Downloads/citrus-league-storm-main-master.zip` — pre-monorepo repo zip; superseded by current monorepo
- Per-season individual `shots_201X.zip` files in Downloads when the bundle covers them
- `(1)` / `(2)` browser-duplicate downloads of same shots zip

### UNKNOWN (need investigation)
- `player_shifts_official` row-count mystery (198K vs 0)
- `goalie_gsax_primary` 82 rows in staging vs 0 in prod
- `players` lowercase table (801 rows, RLS off)
- `team_stats` (32 rows, RLS off)
- `integrity_check_results` (65K rows, writer unknown)

---

## §3 — Proposed canonical organization

### §3.1 Repo structure (within the current monorepo)

**No changes to existing committed structure.** The current layout (`apps/`, `server/`, `packages/`, `data-pipeline/`, `scripts/`, `supabase/`, `docs/`, `infra/`, `data/`) is sound. Reorg is **inside specific directories** and at the **repo root for untracked dumps**.

### §3.2 Repo-root cleanup

Move untracked SQL dumps from repo root to `data/exports/`:

| BEFORE | AFTER |
|---|---|
| `chunk__header.sql` | `data/exports/2026-04-26-staging-load/chunk__header.sql` |
| `chunk_goalie_gsax_primary.sql` | `data/exports/2026-04-26-staging-load/chunk_goalie_gsax_primary.sql` |
| `chunk_player_directory.sql` | `data/exports/2026-04-26-staging-load/chunk_player_directory.sql` |
| `chunk_player_projected_stats.sql` | `data/exports/2026-04-26-staging-load/chunk_player_projected_stats.sql` |
| `chunk_player_ros_projections.sql` | `data/exports/2026-04-26-staging-load/chunk_player_ros_projections.sql` |
| `chunk_player_season_stats.sql` | `data/exports/2026-04-26-staging-load/chunk_player_season_stats.sql` |
| `chunk_player_talent_metrics.sql` | `data/exports/2026-04-26-staging-load/chunk_player_talent_metrics.sql` |
| `prod_data.sql`, `prod_data_inserts.sql`, `prod_data_inserts_clean.sql`, `prod_schema.sql`, `prod_stats_all.sql`, `prod_stats_all_clean.sql` | `data/exports/2026-04-26-prod-snapshot/` (one folder per dump session) |
| (new) `data/exports/.gitignore` | `*\n!.gitignore` (gitignore everything except this file) |

**Update reference:** `scripts/staging/04-load-stats-data.mjs` if it hard-codes any path — verify and edit.

### §3.3 Historical training data (Downloads → repo)

The intent in `TRAINING_DATA_MANIFEST.md` is that `shots_2018-2024.csv` lives at `data/shots_2018-2024.csv` (gitignored). Currently it lives in `Downloads/`. Proposal:

| BEFORE | AFTER |
|---|---|
| `C:\Users\garre\Downloads\shots_2018-2024.csv` | `<repo>/data-pipeline/data/historical/shots_2018-2024.csv` (gitignored) |
| `C:\Users\garre\Downloads\shots_2017.csv` (singleton 2017-18 season) | `<repo>/data-pipeline/data/historical/shots_2017.csv` (gitignored) |
| `C:\Users\garre\Downloads\shots_2025*.zip` (partial-season MoneyPuck dumps) | `data/exports/moneypuck-2025/` (gitignored) — for comparison/validation use |
| `Downloads/shots_201X.zip` (per-season standalones, 2018-2022) | Keep in `Downloads/_archive/` OR delete (Garrett's call). Bundle covers them |
| `Downloads/shots_2023*.zip` and `shots_2024*.zip` duplicates | Pick freshest, archive others |

**Why move to `data-pipeline/data/historical/`** (not `data/historical/` at repo root):
- Co-located with `train_xg_v3.py` which expects them at the path (currently `data/shots_2018-2024.csv` per manifest — **needs path update if moved**)
- Stays out of the web app's `data/` namespace
- `data-pipeline/` is already the "pipeline-only" subtree; historical training data fits

**Alternative:** keep at `data/historical/` to match the manifest's existing path. Tradeoff: web-app developers see hockey training data they don't need. **Recommendation: `data-pipeline/data/historical/`** + update the manifest.

**Update references:**
- `scripts/utilities/train_xg_v3.py` line 40: `MP_HISTORICAL = DATA_DIR / "shots_2018-2024.csv"`
- `data/TRAINING_DATA_MANIFEST.md`: rewrite to reflect new path

### §3.4 Models — already canonical, just document

`data-pipeline/models/` is the canonical models location. **No moves needed.**

The OLD `citrus-league-storm/` repo's root-level `.joblib` files are superseded by the current `data-pipeline/models/` versions. Once the OLD repo is archived (§3.6), the old `.joblib` files go with it.

The Downloads `citrus-league-storm-main-master/` extracted folder has its own outdated `.joblib` set — same story; archive with the parent zip.

### §3.5 Scripts — tag in source, no moves

Scripts mostly already live in the right place. The reorg work is **headers + classification, not paths**:

| Action | Target |
|---|---|
| Add `# ACTIVE: invoked by .github/workflows/main.yml` header | `data-pipeline/projections/nightly_projection_batch.py` |
| Add `# ACTIVE: imported by data-pipeline/acquisition/*` header | `data-pipeline/utils/*` files |
| Add `# UTILITY: manual run; last invoked YYYY-MM-DD` header | one-off `scripts/utilities/populate_*.py` scripts |
| Add `# ORPHAN-SUSPECTED: last referenced in commit XXXX YYYY-MM-DD` header | `scripts/` root TS one-offs |
| Add `# DEBUG-ONLY: forensics tooling, not invoked by pipeline` header | `data-pipeline/debug/*` |
| Add `# DESTRUCTIVE: data-loss possible — review before reuse` header | `scripts/nuke-*.sql`, `delete-all-draft-data.sql`, etc. |

Optional folder reorg (lower priority):
- `scripts/_one_offs/` for obvious one-time setup scripts (could leave them at root)
- `scripts/_destructive/` for the nuke/reset scripts

### §3.6 Other Citrus directories outside the monorepo

| Directory | Action | Recommendation |
|---|---|---|
| `C:\Users\garre\Documents\citrus-league-storm\` (Dec 2024 pre-monorepo) | **Archive in place.** Add a `README_ARCHIVED.md` at its root explaining "this was the pre-monorepo era; do not modify; current code lives at `citrus-league-storm-main`." Keep accessible for documentation reference (the dozens of MD files have historical context) | Archive |
| `C:\Users\garre\citrus-league-storm-main\` (only `logs/` directory) | **Investigate first.** What wrote logs there? Find any process still writing to it | Investigate, then likely delete |
| `C:\Users\garre\Documents\citrus-league-storm-phase45\` | Active worktree, leave alone | Keep |
| `Downloads/citrus-league-storm-main-master.zip` + extracted folder | **Move to a local archive.** `~/Documents/_archive/citrus-pre-monorepo/` — keeps it accessible without polluting Downloads | Move |

### §3.7 Supabase orphan triage (NOT delete — investigate)

For each orphan-suspected table, run a grep against the codebase (`apps/web/src/`, `server/src/`, `data-pipeline/`, `scripts/`, `supabase/migrations/`):

```bash
git grep -i "from\|FROM\|table_name=" -- "*.ts" "*.tsx" "*.py" "*.sql" "*.mjs" "*.js" | grep -iE "raw_player_stats|2025_Skaters|public\.public\.players|staging_2024_skaters|staging_2025_skaters|staging_2024_goalies|staging_2025_goalies|team_stats|team_lineups_backup_log|integrity_check_results|public\.players[^_]"
```

If a table has **zero references** anywhere in the codebase + no migrations recently touch it: candidate for documentation as ORPHAN, but **don't drop without explicit Garrett approval** (could break a one-off pipeline that runs monthly).

**For each orphan-suspected table:**
1. Document in `DATA_INVENTORY.md` §1.2 with `[ORPHAN-CANDIDATE: not referenced in codebase as of 2026-05-05]`
2. After 30 days of no use signal, propose drop in a follow-up audit
3. Drop only after Garrett signs off

---

## §4 — Documentation strategy

This is the doc-creation plan for the canonical reference.

### `DATA_INVENTORY.md` at repo root (already created in this PR)
- Sections per the prompt: Active sources, Historical archives, Pipeline scripts, Models, Schema reference, Update protocol
- Linked from `README.md` and `CLAUDE.md`
- **Update protocol** documented inline: every PR that adds data must update this doc

### `apps/web/docs/DATA_ORGANIZATION_AUDIT.md` (this doc)
- Captures the audit findings + reorg execution plan
- Used as the "before-after" record for the actual reorg PR
- Stays as historical reference after the reorg ships

### `CLAUDE.md` update
- Add a `## Data Architecture` section pointing to `DATA_INVENTORY.md`
- Note: "Before adding any new table/file/script/model, update `DATA_INVENTORY.md` in the same PR."

### `README.md` update
- Add a `## Data` section at the top linking to `DATA_INVENTORY.md`

---

## §5 — Reorganization execution plan

**Constraint reminder: NO MOVES until Garrett signs off on this plan.**

The reorg is split into 4 phases, ordered by risk (lowest first):

### Phase R1 — Documentation only (no risk)
**Time: 30 min · Risk: zero**

1. Commit `DATA_INVENTORY.md` at repo root (this PR)
2. Commit `apps/web/docs/DATA_ORGANIZATION_AUDIT.md` (this PR)
3. Update `CLAUDE.md` to reference `DATA_INVENTORY.md`
4. Update `README.md` to add a Data section

**Rollback:** `git revert` the commit. No file moves to undo.

### Phase R2 — Repo-root SQL dump cleanup (low risk)
**Time: 15 min · Risk: low (one workflow path change)**

1. `mkdir -p data/exports/2026-04-26-staging-load`
2. `mkdir -p data/exports/2026-04-26-prod-snapshot`
3. `git mv` (actually just `mv` since untracked) the chunk_*.sql to `data/exports/2026-04-26-staging-load/`
4. `mv` prod_*.sql to `data/exports/2026-04-26-prod-snapshot/`
5. Add `data/exports/.gitignore` with `*\n!.gitignore`
6. Find any `scripts/staging/*.mjs` that hard-codes the dump path; update reference
7. Run `staging-deploy.yml` workflow once on staging-setup branch to verify

**Rollback:** `mv` files back to repo root, revert the workflow path change. The files are untracked, so no Git operations needed.
**Validation:** `npm run --workspace=staging staging:verify` passes (or whatever the staging-load verification is); `staging-deploy.yml` succeeds in CI.

### Phase R3 — Local file reorg (medium risk; only affects local FS, not deployment)
**Time: 45 min · Risk: medium (path updates needed)**

1. `mkdir -p <repo>/data-pipeline/data/historical`
2. `mv C:\Users\garre\Downloads\shots_2018-2024.csv <repo>/data-pipeline/data/historical/`
3. `mv C:\Users\garre\Downloads\shots_2017.csv <repo>/data-pipeline/data/historical/` (after extraction from zip if needed)
4. Update `scripts/utilities/train_xg_v3.py` line 40: `MP_HISTORICAL = ROOT / "data-pipeline" / "data" / "historical" / "shots_2018-2024.csv"`
5. Update `data/TRAINING_DATA_MANIFEST.md` to reflect new paths
6. Add `data-pipeline/data/historical/.gitignore` with `*\n!.gitignore`
7. Manually run `python scripts/utilities/train_xg_v3.py --dry-run` (or quick smoke test) to verify the path works
8. Don't delete the Downloads/ originals yet — keep for 30 days as safety net

**Rollback:** Move files back to Downloads/, revert the script + manifest changes.
**Validation:** A test run of `train_xg_v3.py` loads the historical CSV from the new location.

### Phase R4 — Script header tagging (low risk; informational only)
**Time: 1-2 hours · Risk: low (no functional change)**

For each script in `data-pipeline/` and `scripts/utilities/`:
1. Add a docstring/header indicating ACTIVE / UTILITY / DEBUG-ONLY / ORPHAN-SUSPECTED / DESTRUCTIVE classification
2. Reference the workflow / cron / parent script that invokes it (for ACTIVE)
3. Last-invoked timestamp where verifiable (for UTILITY)

**Rollback:** Revert the commit (no behavioral change).
**Validation:** `npm run lint` and `pytest data-pipeline/tests/` still pass.

### Phase R5 — Orphan triage (read-only investigation)
**Time: 2-3 hours · Risk: zero (investigation only)**

For each orphan-suspected Supabase table:
1. `git grep -i "<table_name>"` across entire monorepo
2. Document references found (or absence) in `DATA_INVENTORY.md`
3. **No drops** in this phase. Only documentation.
4. After 30+ days of "ORPHAN-CANDIDATE" status with no usage signal, propose a separate drop PR

For local orphan directories (`C:\Users\garre\citrus-league-storm-main\` stub, etc.):
1. Check `lsof` / process monitor for any active write
2. If nothing's writing, document and propose deletion in a follow-up

### Phase R6 — Pre-monorepo repo archival (low risk)
**Time: 30 min · Risk: low (deferred deletion)**

1. Add `README_ARCHIVED.md` at root of `C:\Users\garre\Documents\citrus-league-storm\` explaining its archived status
2. Move `Downloads/citrus-league-storm-main-master.zip` and extracted folder to `~/Documents/_archive/citrus-pre-monorepo/`
3. **Don't delete** any of these — keep for documentation reference

---

## §6 — Discoveries to flag

Things found during the audit that triggered "huh, that's odd":

1. **`public.public.players` table** — literally named with the schema prefix in the table name. Almost certainly a malformed migration. Check `supabase/migrations/` history, propose a migration to drop it
2. **`player_shifts_official` 198K vs 0 row mystery** — pg_class says 198,110 rows; list_tables RLS-enabled says 0. Could be (a) statistics not refreshed after a load, (b) RLS blocking the count, (c) the table has rows but all under a non-public owner. Run `SELECT COUNT(*)` directly to resolve
3. **`shots_2018-2024.zip` size** (126 MB compressed → 447 MB uncompressed) consistent with MoneyPuck's published format, but the manifest lists "~447 MB" — minor doc inconsistency to fix
4. **`data/our_shots_2025.csv` and `data/shots_full_features_2025.csv`** have identical row counts (76,878). Either redundant or one is a subset. Verify with column count + checksum; pick canonical
5. **`data/moneypuck_shots_2025.csv.csv`** — doubled `.csv.csv` extension. Browser's "save as" filename quirk. Rename or document
6. **OLD `citrus-league-storm/` repo has `moneypuck_xg_predictor.joblib`** — a model artifact name not present in current `data-pipeline/models/`. Either renamed (now `xg_model_moneypuck.joblib`) or replaced by something else. Worth confirming the lineage before archival
7. **OLD repo `data/moneypuck_shots_2023.csv` and `2024.csv`** are present (69 MB each) but the current monorepo's `data/` only has `moneypuck_shots_2025.csv.csv`. Were these explicitly removed when monorepo'd? Or just lost?
8. **`scripts/utilities/` has 38 Python files** — extreme breadth for a "utilities" folder. Many look like one-offs. The classification audit (Phase R4) is needed to clean this up
9. **`data-pipeline/debug/`** has 14 forensics scripts (mostly McDavid-focused). They're useful but need a clear "this is debug tooling not pipeline" header
10. **`raw_player_stats` (15K rows, RLS-disabled)** — the name is generic enough that it might be from an early-era ingestion. Probably orphan
11. **The 7 RLS-disabled tables** — were flagged in earlier audit. Reorganization is the right time to address. Either enable RLS with public-read policies (for player-facing data) or migrate the data into RLS-enabled tables
12. **284 migrations in `supabase/migrations/`** — that's a high count. Worth a periodic squash-and-replace exercise (low priority; not blocker)
13. **`scripts/staging/04-load-stats-data.mjs`** uses the chunk_*.sql files. **Path will break if we move them in Phase R2** — must update simultaneously
14. **The training data manifest** points to `data/shots_2018-2024.csv` but the file lives in `Downloads/`. Either the manifest path was always aspirational, or someone copied the file once. Verify by running `train_xg_v3.py` against current paths to see what actually works

---

## §7 — Honest disclosures

- **Read-only audit.** No file moves, no table drops, no destructive operations performed. This is a proposal.
- **The `Downloads/` count of duplicates is approximate.** I listed every shots_*.zip and shots_*.csv I could find but exact mtimes + sizes weren't all confirmed.
- **The `scripts/utilities/` ACTIVE/UTILITY/DEBUG-ONLY classification is heuristic.** A grep against the entire codebase + cron logs would tighten it; that's Phase R4 work.
- **Workflow-script mapping is partial.** I read `main.yml` and `staging-deploy.yml` directly. The other 5 workflows (`ci.yml`, `deploy-preview.yml`, `playoff-sync.yml`, `production-deploy.yml`, `rls-audit.yml`) I inferred the script references for; full audit needs to read each workflow file.
- **The OLD `citrus-league-storm/` repo's history was not git-logged.** It might contain commits that aren't in the current monorepo.
- **`infra/` directory** showed in main worktree `ls` output but didn't exist in the staging worktree at audit time. This suggests it's tracked but not present in the worktree; likely a worktree-checkout staleness, not a real difference.

---

## What this audit enables next

1. **Garrett reviews this proposal** — flags any moves they object to or want different
2. **Phase R1 ships first** (pure documentation; no risk)
3. **Phases R2-R6 ship in order** with each phase's validation gate before the next starts
4. **After all phases land**, Phase 0 (historical CSV → Supabase backfill, multi-season) executes against the cleaned-up foundation
5. **The reorg is documented**, future contributors find data + scripts where they expect them, and the next data audit takes hours instead of days

---
---

## §7 — R5 Orphan Triage Findings (2026-05-05)

Read-only investigation. No moves, drops, or renames executed. Output is recommendations for follow-up commits.

### §7.1 ORPHAN-SUSPECTED triage results — all 4 confirmed orphan

`grep -rIE` across the entire monorepo (excluding `node_modules`, `dist`, `.git`) for each script across `*.ts`, `*.tsx`, `*.mjs`, `*.js`, `*.json`, `*.yml`, `*.yaml`, `*.md`, `*.py`. Results:

| Script | Real-code references | Documentation references | Self-references | Status |
|---|---|---|---|---|
| `scripts/fetch-nhl-players.ts` | **0** | 2 (audit docs only) | 1 (R4 helper manifest) | **CONFIRMED ORPHAN** |
| `scripts/fetch-nhl-schedule.ts` | **0** | 2 (audit docs only) | 1 (R4 helper) + 1 self-docstring | **CONFIRMED ORPHAN** |
| `scripts/import-schedule-from-csv.ts` | **0** | 2 (audit docs only) | 1 (R4 helper) + 1 self-docstring | **CONFIRMED ORPHAN** |
| `scripts/import-schedule-from-excel.ts` | **0** | 2 (audit docs only) | 1 (R4 helper) + 1 self-docstring | **CONFIRMED ORPHAN** |

**Zero invocations from any production code, workflow, or sibling script.** Self-references inside each script's own docstring (`Run with: npx tsx scripts/foo.ts`) are not real references.

**Recommendation: move all 4 to `scripts/_deprecated/` with a `README.md` documenting:**
- Why each was created (setup-era seeding for nhl_teams / nhl_games / players tables)
- What replaced them (Python equivalents in `data-pipeline/acquisition/`):
  - `fetch-nhl-players.ts` → superseded by `data-pipeline/acquisition/data_acquisition.py` + `scripts/utilities/populate_player_directory.py`
  - `fetch-nhl-schedule.ts` → superseded by `data-pipeline/acquisition/ingest_playoff_schedule.py` + the schedule-discovery logic inside `data_scraping_service.py`
  - `import-schedule-from-csv.ts` → ad-hoc setup tool, no canonical replacement (one-time use case)
  - `import-schedule-from-excel.ts` → ad-hoc setup tool, no canonical replacement (one-time use case)
- That each script's classification header should be updated to `# CATEGORY: DEPRECATED` with a `SUPERSEDED BY:` line

### §7.2 DESTRUCTIVE consolidation findings — 12 distinct, near-duplicate identified

Direct `diff` comparison of the 12 DESTRUCTIVE scripts:

#### Confirmed near-duplicate

**`scripts/delete-all-draft-data.sql` ≈ `scripts/nuke-all-draft-data.sql`** — functionally near-identical:
- Both: `DELETE FROM public.draft_picks` and `DELETE FROM public.draft_order`
- Difference: the leagues UPDATE
  - `delete-`: `UPDATE public.leagues SET draft_status = 'not_started'` (writes to every league, including those already at 'not_started')
  - `nuke-`: `UPDATE public.leagues SET draft_status = 'not_started' WHERE draft_status IN ('in_progress', 'completed')` (only writes to leagues that need the change)

The `nuke-` version is slightly safer (smaller write surface, idempotent re-run). **Recommendation: retain `nuke-all-draft-data.sql` as canonical; mark `delete-all-draft-data.sql` as deprecated-duplicate via header note + move to `scripts/_deprecated/`.**

**Header correction note:** my R4 classification header for both scripts incorrectly listed writes to `draft_events`, `draft_picks_v2`, `draft_queues` — but the actual SQL only touches `draft_picks`, `draft_order`, `leagues`. The Writes: line should be corrected when the deprecated move happens. (Header is aspirational about scope — actual scope is narrower.)

#### Confirmed NOT duplicates — different scopes

**`scripts/nuke-all-teams-comprehensive.sql` vs `scripts/nuke-and-reset-teams.sql`:**
- `nuke-all-teams-comprehensive.sql` — investigates teams across **ALL leagues** with no scoping. Reports + cleans.
- `nuke-and-reset-teams.sql` — scoped to a single `'YOUR_LEAGUE_ID'::uuid` placeholder. Operator fills in. AI teams deleted, user teams kept. DELETE is **commented out** by default — operator must uncomment.
- **Different use cases. Keep both.**

**`scripts/cleanup-duplicate-teams.sql` vs `scripts/cleanup-duplicate-teams-simple.sql`:**
- `cleanup-duplicate-teams.sql` — scoped to a single league via `'YOUR_LEAGUE_ID'::uuid` placeholder. Looks for `team_name LIKE 'AI Team %'`. DELETE commented out.
- `cleanup-duplicate-teams-simple.sql` — same logic but **NO league scoping** (operates across all leagues). Different output format.
- **Different scopes. Keep both.**

#### Recommendation summary for the 12 destructive scripts

| Script | Disposition |
|---|---|
| `nuke-all-draft-data.sql` | **Keep** — canonical |
| `delete-all-draft-data.sql` | **Move to `scripts/_deprecated/`** (near-duplicate; nuke- is canonical) |
| `nuke-all-teams-comprehensive.sql` | **Keep** — distinct scope (cross-league investigation) |
| `nuke-and-reset-teams.sql` | **Keep** — distinct scope (single-league with safety placeholder) |
| `complete-draft-reset.sql` | **Keep** — adds league draft-state reset on top of data wipe |
| `cleanup-duplicate-teams.sql` | **Keep** — single-league scoped |
| `cleanup-duplicate-teams-simple.sql` | **Keep** — all-leagues scoped |
| `quick-reset-by-email.sql` | **Keep** — distinct user-scope use case |
| `reset-league-teams.sql` | **Keep** — single-league reset preserving league row |
| `reset-user-profile.sql` | **Keep** — user-profile-specific |
| `data-pipeline/debug/fix_mcdavid_games.py` | **Keep in place** with current DESTRUCTIVE header — historical incident reference |
| `data-pipeline/debug/fix_stuck_pbp_games.py` | **Keep in place** with current DESTRUCTIVE header — historical incident reference |

**Recommendation on isolation:** all destructive scripts already carry prominent CITRUS-CLASSIFICATION DESTRUCTIVE headers with RECOVERY notes. Moving the kept set to `scripts/_destructive/` would add isolation but also break the simple `scripts/foo.sql` paths used in operator manuals + READMEs. **Don't move them** — the headers do the work.

### §7.3 Supabase mystery #1 — `public.public.players` resolved

Investigation:
- pg_class confirms a table with the literal name `public.players` lives in schema `public`. It carries:
  - 2 columns: `id bigint NOT NULL`, `created_at timestamptz NOT NULL`
  - A primary-key index `public.players_pkey`
  - A sequence `public.players_id_seq`
  - `estimated_rows = -1` (never analyzed → effectively empty)
  - No comment, no triggers
- **No migration file in `supabase/migrations/` creates a table with this literal name.** `git grep -E "public\.public\.players|\\\"public\\.players\\\""` returned zero hits.
- The table is vestigial — likely an artifact of an early-era migration that mishandled schema-qualification (e.g., `CREATE TABLE "public.players"` instead of `CREATE TABLE public.players`). Or it was created via the Supabase dashboard UI with an accidental dot in the name.
- The canonical players table is `player_directory` (938 rows, 2025 season).

**Recommendation:** create a follow-up migration `YYYYMMDDHHMMSS_drop_legacy_public_players_table.sql` that issues:
```sql
DROP TABLE IF EXISTS public."public.players" CASCADE;
DROP SEQUENCE IF EXISTS public."public.players_id_seq" CASCADE;
```
The CASCADE handles any FK references (none expected since the table is empty and unused). **Do not execute** this migration via this audit; it's a separate write PR for Garrett review.

### §7.4 Supabase mystery #2 — `integrity_check_results` resolved

**NOT an orphan. Active production logging table.**

Investigation:
- 68,693 rows spanning **2026-01-16 → 2026-05-06** (today)
- 5 distinct `check_name` values, all legitimate integrity invariants:
  - `missing_players_check` — 59,241 rows. Scans rosters/lineups for player_ids not in player_directory.
  - `phantom_players_check` — 4,673 rows. Inverse — flags player_ids that reference non-existent records.
  - `fantasy_daily_rosters_sync_today` — 3,271 rows. Daily roster-sync verification.
  - `team_lineups_vs_draft_picks_count` — 1,497 rows. Invariant check.
  - `repair_stale_team_lineups` — 11 rows from 2026-04-02 (one-time repair audit trail).
- Latest write 2026-05-06 — actively logging today.

**Writers identified:**
- `data-pipeline/monitoring/verify_data_integrity.py` — Python pipeline check (already documented in R4 header)
- `data-pipeline/scoring/reconcile_player_stats.py` — reconciliation logging (already documented)
- **Multiple SQL functions inside `supabase/migrations/20260116000003_create_integrity_checks.sql`** — the migration itself defines stored procedures that INSERT INTO integrity_check_results. Trigger-driven.
- `supabase/migrations/20260402000000_repair_stale_team_lineups.sql` — the one-time repair migration logs to this table.
- `supabase/migrations/20260402000001_add_team_lineups_integrity_trigger.sql` — installs a trigger on team_lineups that writes here on certain edits.
- RLS policy added by `supabase/migrations/20260206000001_security_hardening_soc_compliance.sql` — commissioner-only view.

**Recommendation:** leave as-is. Active and healthy. Update the audit's earlier flag in §1.4 (which marked this table as `CHECK USAGE`) to **CONFIRMED ACTIVE — production integrity logging**.

### §7.5 Supabase mystery #3 — `data/moneypuck_shots_2025.csv.csv` doubled extension resolved

Investigation:
- One consumer: `scripts/utilities/deep_analyze_moneypuck_model.py` hardcodes the path `pd.read_csv('data/moneypuck_shots_2025.csv.csv')`.
- Zero scripts CREATE the file via writes — it was downloaded manually (browser save quirk: MoneyPuck's zipped download `shots_2025.csv.zip` unzips to `shots_2025.csv`, then was renamed to `moneypuck_shots_2025.csv` via a tool that re-appended the extension, OR the original zip contained a file already named with `.csv` and was unzipped to a directory + the user double-clicked through which added another extension).
- **NOT a script bug.** No fix to the data pipeline needed.

**Recommendation:**
1. Rename the file: `data/moneypuck_shots_2025.csv.csv` → `data/moneypuck_shots_2025.csv` (single extension)
2. Update the one consumer line in `scripts/utilities/deep_analyze_moneypuck_model.py`
3. Single small follow-up commit; can ride along with R6 or a later cleanup PR

### §7.6 Bonus mystery resolved — `player_shifts_official` 198K vs 0 row discrepancy

Investigation:
- Direct `SELECT COUNT(*) FROM player_shifts_official` returns **198,988 rows** (matches pg_class estimate of 198,110 within ANALYZE staleness margin).
- The earlier "list_tables returned 0" finding was **a false signal from the Supabase MCP's list_tables tool** — likely a tool-side caching or RLS-perspective rendering issue. The table is fully populated and ACTIVE.
- Writers: `data-pipeline/acquisition/ingest_shiftcharts.py` (production scraper, upserts via `shift_id`), with `data_scraping_service.py` orchestrating + `scripts/utilities/run_shiftcharts_with_progress.py` as a manual wrapper.
- Readers: `data-pipeline/scoring/simulate_matchups.py` (uses shift overlap for matchup correlation), `scripts/utilities/extractor_job.py` (validates shifts present before allowing further processing — comments call this "MOST ACCURATE shifts source, 21.76 min/game for top players"), `scripts/scan-pipeline-tables.ts` (inventory tool).
- Created by migration `20251219100000_create_player_shifts_official.sql`.

**Recommendation:** close this mystery. The table is healthy production data; the audit's earlier flag in §1.4 should be updated to **CONFIRMED ACTIVE — official NHL shift charts (~199K rows, daily writes)**. The list_tables tool's 0 reading was a tool artifact, not a data integrity issue.

### §7.7 Summary of R5 dispositions

For Garrett review before any execution:

| Item | Recommendation | Risk |
|---|---|---|
| 4 ORPHAN-SUSPECTED scripts | Move to `scripts/_deprecated/` + README documenting supersession | Low — no consumers exist |
| `delete-all-draft-data.sql` | Move to `scripts/_deprecated/` (near-duplicate of `nuke-all-draft-data.sql`) | Low — operators use `nuke-` |
| Other 11 destructive scripts | Keep in place; current DESTRUCTIVE headers are sufficient isolation | None — pure docs |
| `public.public.players` | New migration to DROP via `supabase/migrations/` | Low — table is empty + unused |
| `integrity_check_results` | Update audit flag to CONFIRMED ACTIVE; no code change | None |
| `moneypuck_shots_2025.csv.csv` | Rename to single-`.csv` + update 1 line in `deep_analyze_moneypuck_model.py` | Low |
| `player_shifts_official` mystery | Update audit flag to CONFIRMED ACTIVE; no code change | None |

**Header metadata correction needed (low-priority):**
- Both `delete-all-draft-data.sql` and `nuke-all-draft-data.sql` headers list Writes including `draft_events, draft_picks_v2, draft_queues` — actual SQL only touches `draft_picks, draft_order, leagues`. Correct in the helper manifest at next refresh.

### §7.8 What R5 did NOT do

- No file moves, renames, or deletions executed
- No SQL DROP / DELETE / UPDATE statements run
- No header rewrites or classification changes (those would happen in a follow-up commit if Garrett approves the dispositions above)
- No scripts/_deprecated/ directory created yet (waiting on approval)

Garrett review gate before any of the §7.7 dispositions execute.

**Update (2026-05-05): All 7 dispositions executed via commit `c2893b0`. R5 is closed.**

---
---

## §8 — Investigation 1: xG Model Lineage (2026-05-05)

The Dec 2024 pre-monorepo repo at `C:\Users\garre\Documents\citrus-league-storm\` carries `moneypuck_xg_predictor.joblib` plus 13 other model artifacts at the repo root. Before R6 archives that repo, this investigation establishes whether the Dec 2024 artifacts are precursors of the current production xG v3 model (lineage chain) or independent experimental attempts.

### §8.1 Inventory comparison

**Dec 2024 repo `.joblib` artifacts at the root:**
- `xg_model.joblib` — 213 KB
- `xg_model_moneypuck.joblib` — 747 KB *(same filename as current monorepo's, different artifact)*
- `moneypuck_xg_predictor.joblib` — **11 MB**
- `rebound_model.joblib` — 598 KB
- `xa_model.joblib` — 273 KB
- `last_event_category_encoder.joblib`, `model_features.joblib`, `model_features_moneypuck.joblib`, `moneypuck_xg_features.joblib`, `pass_zone_encoder.joblib`, `player_shooting_talent.joblib`, `rebound_model_features.joblib`, `shot_type_encoder.joblib`, `xa_model_features.joblib`

**Current monorepo `data-pipeline/models/`** (committed via R3-aware reorg):
- `xg_model_moneypuck.joblib` (production v3) + `xg_model_moneypuck_v2.joblib` (predecessor)
- `xg_model.joblib` (legacy v1) + `xg_shot_type_calibration.joblib`
- `xa_model.joblib`, `rebound_model.joblib`, `player_shooting_talent.joblib`
- Plus 11 feature/encoder support files

### §8.2 Architecture comparison

Direct introspection of the loaded model objects:

| Property | **Dec 2024 `moneypuck_xg_predictor.joblib`** | **Current `xg_model_moneypuck.joblib` (v3)** |
|---|---|---|
| Library | sklearn (`RandomForestRegressor`) | XGBoost (`XGBClassifier`) |
| Objective | Regression (predict MoneyPuck's continuous `xGoal`) | `binary:logistic` (predict actual `is_goal` Y/N) |
| `n_features_in_` | **5** | **31** |
| Feature list | `our_distance`, `our_angle`, `our_is_rebound`, `our_is_slot_shot`, `our_has_pass` | full v3 list including the 7 pass-context moat features (`pass_quality_score`, `pass_immediacy_score`, `goalie_movement_score`, `pass_zone_encoded`, `pass_lateral_distance`, `pass_to_net_distance`, `has_pass_before_shot`) plus 24 context features |
| `n_estimators` | 200 | 1,000 |
| `max_depth` | 10 | 7 |
| Disk size | ~11 MB (RF artifacts are large) | ~2.5 MB (XGBoost compact format) |
| sklearn version | 1.7.2 (artifact dates Dec 2024) | n/a (XGBoost native) |

**Conclusion:** these are **fundamentally different model architectures**, not iterations of the same model.

### §8.3 Training-script comparison

**Dec 2024:** `retrain_xg_with_moneypuck.py` at the Dec 2024 repo root:
- Header docstring: *"Retrain xG model using MoneyPuck xG values as the target. This creates a model that learns to predict MoneyPuck's xG given our extracted features."*
- Imports `XGBRegressor` (regression target)
- Loads `data/matched_shots_2025.csv` — only ~41,000 shots
- Target column: `mp_xGoal` (MoneyPuck's xG, not actual goal outcomes)
- This is a **mimicry / reverse-engineering** approach: train Citrus's feature extraction to predict MoneyPuck's xG output.

The Dec 2024 repo also has:
- `retrain_optimized.py`, `retrain_final_optimized.py` — iterative variants of the same mimicry approach
- `reverse_engineer_moneypuck_xg.py` — explicitly named for the reverse-engineering goal
- `compare_xg_variants.py`, `analyze_moneypuck_xg.py`, `deep_analyze_moneypuck_model.py` — exploratory analysis tools

**Current:** `scripts/utilities/train_xg_v3.py` (per R3 update):
- Header docstring: *"Trains on ~863K real NHL shots"* with `XGBClassifier` predicting `is_goal`
- Target: `is_goal` boolean (real outcome)
- Sources: 786K MoneyPuck historical (2018-2024) + 77K Citrus PBP 2025-26
- This is a **direct outcome-prediction** approach: train on actual goals, not predicted xG.

### §8.4 Lineage assessment — INDEPENDENT, NOT A CHAIN

The Dec 2024 model and current v3 model differ on every meaningful axis:

1. **ML framework:** sklearn → XGBoost
2. **Model type:** Regressor → Classifier
3. **Target:** predicted MoneyPuck xG → actual goal outcome
4. **Feature count:** 5 → 31 (6× expansion, including 7 brand-new pass-context features)
5. **Training data scale:** 41K → 863K (21× increase)
6. **Training data scope:** single-season matched-with-MoneyPuck → 7-season MoneyPuck bulk + Citrus PBP

These are not parameter updates or feature additions on the same architecture; they're a different paradigm entirely.

**The thematic lineage** (always trying to predict goals well using MoneyPuck-inspired features) is intact. **The architectural lineage** (a chain where v_n+1 inherits from v_n's parameters) is broken.

The Dec 2024 era was the **experimental exploration phase**:
- Multiple retrain scripts (`retrain_xg_with_moneypuck`, `retrain_optimized`, `retrain_final_optimized`) suggest iterative architecture tinkering
- 30+ MD files in the Dec 2024 repo document the empirical comparison (FINAL_RESULTS_SUMMARY.md catalogs 4 xG variants with shot-level R² and player-season R² metrics)
- The "Talent-Adjusted xG +37% improvement" finding documented in FINAL_RESULTS_SUMMARY.md *did* inform the v3 architecture (current v3 includes `shooting_talent_adjusted_xg` and `flurry_adjusted_xg` columns in `raw_shots`)

The current era (post-monorepo, v3) consolidated the design lessons (talent adjustment, flurry adjustment, the 7-feature pass-context moat from PBP) into a single XGBoost classifier trained on a 21× larger corpus.

### §8.5 Implications for R6 archival

**The Dec 2024 repo is an EXPERIMENTAL EXPLORATION ARCHIVE, not a production lineage anchor.**

Practical disposition implications:
- **The trained `.joblib` artifacts in the Dec 2024 repo are NOT production lineage.** They are experimental precursors with different architectures + targets. Loading them via `joblib.load()` produces a useable RF regressor predicting MoneyPuck's xG, which is a DIFFERENT thing than the current v3 classifier predicting `is_goal`.
- **The 30+ MD files in the Dec 2024 repo ARE valuable historical reference** documenting the empirical exploration (FINAL_RESULTS_SUMMARY, EXPECTED_GOALS_EXPLAINED, FEATURE_IMPACT_COMPARISON, GAR_IMPLEMENTATION_SUMMARY, GSAX_FINAL_SUMMARY). They explain WHY v3 is shaped the way it is.
- **The training scripts (`retrain_xg_with_moneypuck.py`, etc.) are valuable** as documentation of the experimentation path, but should NOT be re-run against current data — they target an architecture (RandomForestRegressor predicting MoneyPuck xG) that's been superseded.

**Recommendation for R6:**

Archive the Dec 2024 repo with framing as **"experimental ML exploration archive (Dec 2024 era), preserved for design-decision reproducibility."** The README_ARCHIVED.md should:

- State explicitly: "These models are NOT production lineage. Production xG v3 is `data-pipeline/models/xg_model_moneypuck.joblib` in the monorepo, with a different architecture (XGBClassifier vs RandomForestRegressor) and target (actual goals vs MoneyPuck xG mimicry)."
- Index the valuable design-decision MD files: which ones explain talent adjustment, which explain flurry adjustment, which explain the GAR component layout. Future reads of v3 model code can refer back to these for "why we shaped it this way."
- Note that the .joblib artifacts are sklearn 1.7.2 — pinned version; any attempt to load in newer sklearn will warn (already verified during this investigation).
- Cross-link to `data/TRAINING_DATA_MANIFEST.md` and `scripts/utilities/train_xg_v3.py` in the current monorepo for the current state-of-the-art training pipeline.

### §8.6 Honest disclosures

- **`monitor_model_performance.py` and other Dec 2024 retrain variants** weren't deeply inspected (only `retrain_xg_with_moneypuck.py` was read in full). It's possible one of the variants used XGBoost — but the canonical `moneypuck_xg_predictor.joblib` artifact loads as `RandomForestRegressor`, so the architectural break is established.
- **The `xg_model_moneypuck.joblib` filename collision** (Dec 2024 has 747 KB version, current has ~2.5 MB v3 version) creates risk if anyone accidentally copies between repos. Worth surfacing — the filename is the same, the content is incompatible. Mitigation already in place: each repo's models live in its own `data-pipeline/models/` (current) or repo-root (Dec 2024); no cross-contamination path.
- **No new code, no migrations, no data writes** during this investigation. Read-only inspection of model metadata via `joblib.load()` and Python introspection.

---
---

## §9 — R6 Archive Execution (2026-05-05)

Per Garrett's R6 approval, the Dec 2024 pre-monorepo repo was moved to `~/Documents/_archive/citrus-pre-monorepo/` along with the Downloads-era backup zips. The framing is **experimental ML exploration archive** (per Investigation 1 in §8) — NOT production model lineage.

### §9.1 Files moved

| Before | After |
|---|---|
| `~/Documents/citrus-league-storm/` | `~/Documents/_archive/citrus-pre-monorepo/citrus-league-storm/` |
| `~/Downloads/citrus-league-storm-main-master.zip` | `~/Documents/_archive/citrus-pre-monorepo/downloads/citrus-league-storm-main-master.zip` |
| `~/Downloads/citrus-league-storm-main-master/` (extracted folder) | `~/Documents/_archive/citrus-pre-monorepo/downloads/citrus-league-storm-main-master/` |
| `~/Downloads/citrus-league-storm-main (1).zip` | `~/Documents/_archive/citrus-pre-monorepo/downloads/citrus-league-storm-main (1).zip` |

Internal structure preserved (no flattening, no rename of internal files).

### §9.2 Pre-archive grep clean

`grep -rIE` across all 3 active worktrees (`citrus-league-storm-main`, `citrus-league-storm-staging`, `citrus-league-storm-phase45`) for any reference to the old `~/Documents/citrus-league-storm/` path. Results:

- **citrus-league-storm-main:** 0 references
- **citrus-league-storm-phase45:** 0 references
- **citrus-league-storm-staging:** 6 references — **all in audit documentation** (`apps/web/docs/DATA_ORGANIZATION_AUDIT.md` describing the path that was about to move + `DATA_INVENTORY.md` §5 listing it as "OLD pre-monorepo repo, archive — see audit reorg plan"). No functional code dependencies.

The DOC references update as part of this commit (DATA_INVENTORY.md §5 + this §9 section).

### §9.3 README_ARCHIVED.md authored at archive root

A `README_ARCHIVED.md` lives at `~/Documents/_archive/citrus-pre-monorepo/README_ARCHIVED.md` carrying all 5 points from the R6 spec:

1. **Explicit non-lineage statement** — these `.joblib` artifacts are NOT production lineage, with the side-by-side architecture comparison (sklearn RF Regressor with 5 features vs XGBoost Classifier with 31 features) directly cited from §8.2 of this audit.
2. **Pointer to current production model** — `citrus-league-storm-main/data-pipeline/models/xg_model_moneypuck.joblib`, with full specs (XGBoost classifier, 31 features, 863K training rows, AUC 0.817, training entrypoint at `scripts/utilities/train_xg_v3.py`).
3. **Index of valuable design-decision MD files** preserved in the archive (12 highlighted with one-line summaries: `EXPECTED_GOALS_EXPLAINED.md`, `FINAL_RESULTS_SUMMARY.md`, `FEATURE_IMPACT_COMPARISON.md`, `GAR_IMPLEMENTATION_SUMMARY.md`, `GSAX_FINAL_SUMMARY.md`, `GAR_SHIFT_TRACKING_ANALYSIS.md`, `CALIBRATION_IMPROVEMENTS.md`, `ENHANCE_FEATURE_EXTRACTION_PLAN.md`, `EXECUTE_FEATURE_POPULATION.md`, `BRAINSTORM_LAST_EVENT_FIX.md`, `COMPLETE_PIPELINE_EXPLANATION.md`, `DATA_PIPELINE_MASTER_GUIDE.md`).
4. **Cross-links to current artifacts that absorbed the thematic lineage** — `data/TRAINING_DATA_MANIFEST.md`, `scripts/utilities/train_xg_v3.py`, `data-pipeline/data/historical/shots_2018-2024.csv`, plus the prod tables (`raw_shots`'s `shooting_talent_adjusted_xg` / `flurry_adjusted_xg` / `expected_rebound_probability` / `created_expected_goals` columns; `player_gar_components` schema; `goalie_gsax*` family).
5. **Filename collision warning** — both archive and active monorepo carry `xg_model_moneypuck.joblib` / `rebound_model.joblib` / `xa_model.joblib` / `xg_model.joblib` plus several encoder/feature joblibs. Different architectures, NOT interchangeable. The README enumerates each colliding filename and tells operators to always reference by full path.

The README also includes a "When to revisit this archive" section covering onboarding, debugging, disaster recovery, and the explicit "NEVER import or copy artifacts from this archive into the active monorepo without explicit retraining" rule.

### §9.4 What R6 did NOT do

- **The `~/citrus-league-storm-main/` user-root stub directory** (only contains `logs/`) was left in place. R6 scoped to the Dec 2024 repo + Downloads zips per the original plan; this stub is a separate ORPHAN candidate captured in `DATA_INVENTORY.md` §5 for follow-up investigation.
- **The Downloads-era `shots_*.zip` files** (the per-season MoneyPuck zips kept as backups by R3) remain in `~/Downloads/` per Garrett's R3 directive: "leave the .zip files in Downloads UNTOUCHED... cleanup happens AFTER we've validated the canonical location works for actual training runs over multiple weeks."
- **No git history rewriting.** The Dec 2024 repo had its own .git directory which moved with it to the archive. The history is preserved inside the archive but not merged into the active monorepo.
- **No README copy committed inside the active monorepo.** The README_ARCHIVED.md lives only at the archive root — discoverable via filesystem navigation. The active monorepo's `DATA_INVENTORY.md` §5 + this audit §9 are the in-repo discoverability hooks.

R6 closes the reorganization. Phases R1-R6 + Investigation 1 + R5 dispositions all complete.

---

## §10. Player Directory Orphan Investigation (2026-05-06)

### §10.1 Origin

The R7-2 baseline run (see `apps/web/docs/R7_2_BASELINE.md`) flagged
`raw_shots_no_orphan_player_ids` as **WARN** with 3 of 200 sampled
recent `player_id` values missing from `player_directory` for any
season. Sample IDs:

| `player_id` | shots in `raw_shots` | first shot | last shot |
|---|---|---|---|
| 8485406 | 26 | 2026-04-08 | 2026-05-05 |
| 8484509 | 17 | 2026-02-01 | 2026-05-01 |
| 8483731 | 27 | 2026-04-08 | 2026-05-05 |

All three are taking shots in late-2025-26 / playoff games but have no
`player_directory` row, breaking the implicit FK that downstream UI
queries depend on.

### §10.2 Identity (NHL API)

Fetched from `https://api-web.nhle.com/v1/player/{id}/landing` on
2026-05-06:

| ID | Name | Pos | Team | # | Born | Draft | NHL career |
|---|---|---|---|---|---|---|---|
| 8485406 | **Porter Martone** | RW | PHI | 94 | 2006-10-26 | 2025 R1 P6 (PHI) | Debuted 2025-26, 8 GP, 2G+1A |
| 8484509 | **Josh Samanski** | C | EDM | 81 | 2002-03-22 | undrafted | Debuted 2025-26, 5 GP, 1G+1A |
| 8483731 | **Alex Bump** | LW | PHI | 20 | 2003-11-20 | 2022 R5 P133 (PHI) | Debuted 2025-26, 4 GP, 1G+0A |

All three are **2025-26 NHL debutants** — late-season call-ups whose
first NHL appearance came after the last `player_directory` refresh
(which writes `updated_at = 2026-04-17` on extant rows, ~18 days before
the audit was run).

### §10.3 Refresh-script analysis

The canonical refresh script is
`scripts/utilities/populate_player_directory.py` (CITRUS-CLASSIFICATION:
ACTIVE; last logic touch 2026-03-01 fixing ARI→UTA team code in commit
`77d5b4c`).

Three-source discovery flow:

1. **`raw_shots` scan** — collect distinct `player_id`, `passer_id`,
   `goalie_id` values from existing shot rows.
2. **`player_toi_by_situation` scan** — collect distinct `player_id`
   from time-on-ice rows.
3. **NHL API team rosters** — `/roster/{team}/current` for all 32
   teams (uses the snapshot at call time).

For each discovered ID it then calls `/player/{id}/landing` to fetch
metadata and `db.upsert("player_directory", ..., on_conflict="season,player_id")`
— so it **does** insert new rows, not only update existing ones.

### §10.4 Verdict — data-source gap, not a script bug

The script is **correctly designed** — it would have inserted these
three players if it had run any time after they appeared in `raw_shots`.
The orphan situation arises from **execution timing**:

- The script is **manual / season-turnover only** — not present in any
  `.github/workflows/*.yml` cron, not invoked by any other production
  script.
- It last produced any write on **2026-04-17**.
- All three orphans accumulated `raw_shots` rows between 2026-04-08 and
  2026-05-05 — i.e., the relevant `raw_shots` rows were ingested
  **after** the last refresh, so the discovery scan from a later run
  would now pick them up.
- The 18-day staleness was already flagged independently by R7-3 (see
  `R7_3_BASELINE.md` — `player_directory` shows 444h vs 48h threshold).

### §10.5 Fix plan

#### Immediate (one-time, near-zero cost)

Re-run the existing script. It will:

  1. Discover the 3 orphan IDs from `raw_shots` (Step 1 of its flow).
  2. Fetch metadata for each via `/player/{id}/landing`.
  3. Insert new rows `(season=20252026, player_id, full_name, ...)`
     via the existing upsert.

```bash
# From repo root:
python scripts/utilities/populate_player_directory.py
```

No code change required. Estimated wall-clock: 5-10 minutes for the
full 32-team roster sweep + per-player API calls. Expected post-run
state: `player_directory` row count grows by ≥3 (more if other recent
debutants are also missing); `R7-2 raw_shots_no_orphan_player_ids`
flips from WARN to PASS on the next baseline run.

#### Permanent — ops cadence (zero code change)

Schedule the existing script to run on a cron alongside the existing
data-pipeline jobs. Recommended cadence: **daily during the regular
season**, **weekly during offseason** — matches the player_directory
freshness SLA (48h in-season per R7-3 freshness matrix). Implementation
options:

- Add a step to the existing `nightly_projection_batch.py` cron (least
  invasive).
- Add a dedicated GitHub Actions workflow alongside `staging-deploy.yml`
  in `.github/workflows/` (more visible, easier to audit).

The choice doesn't affect Phase 0; it is a separate ops task.

#### Optional — defense in depth (small code change)

Add a `verify_directory_coverage` post-step that runs after every
`raw_shots` write (e.g., at the tail of the data acquisition pipeline)
to detect new orphans within the same job run rather than waiting for
the next directory refresh. Logic: `SELECT DISTINCT player_id FROM
raw_shots WHERE created_at > <last_run_ts>` join-anti
`player_directory` on `(20252026, player_id)`. If non-empty, surface as
a warning in `integrity_check_results` (mirrors the R7-2 check pattern,
already wired in via `critical_table_checks.py`).

This is **optional polish** — the daily cron from the previous bullet
covers the operational gap. Defer unless directory-staleness becomes a
recurring incident pattern.

### §10.6 Phase 0 inclusion plan

The orphan fix slots into **Phase 0d** (pipeline gap fixes) — see
`PHASE_0_EXECUTION_PLAN.md`:

  1. Run `populate_player_directory.py` immediately to clear the
     baseline 3 orphans (and any others the 200-sample didn't surface).
  2. Add the daily/weekly cron as part of 0d's pipeline-fixes commit.
  3. Re-run R7-2 baseline post-Phase-0; expect
     `raw_shots_no_orphan_player_ids` to flip from WARN to PASS.

Phase 0a (historical CSV load) brings in 786K MoneyPuck shots covering
2018-19 through 2024-25 — **all of those rows reference `player_id`
values that won't exist in `player_directory` either** unless we
pre-populate historical seasons. The `populate_player_directory.py`
flow as it stands keys on `(season, player_id)` and discovers from
`raw_shots` — so running it after 0a will discover historical IDs and
upsert them with the correct historical-season key. Sequence inside 0d:

  - 0d-step-1: Run `populate_player_directory.py` for 2025-26 (clears
    current orphans).
  - 0d-step-2: After 0a completes, re-run `populate_player_directory.py`
    — it picks up the historical IDs and writes one row per
    `(historical_season, player_id)` tuple. Expected directory growth:
    on the order of 5,000-7,000 rows (rough estimate: ~1,000 active
    players per season × 7 historical seasons, minus overlap from
    multi-season careers).
  - 0d-step-3: Schedule the cron.

The directory orphan fix is therefore **gated on Phase 0a** for the
historical-season portion, not a blocker for Phase 0a starting.

### §10.7 Open questions

1. **Are there older historical orphans we haven't surfaced yet?** The
   R7-2 sample size was 200; the population is 99K. Phase 0 § 0d-step-1
   should run a full-population orphan scan (not sampled) and document
   the count before the upsert, so we have a hard number for how many
   historical IDs the directory was missing.
2. **Does the script's `/roster/{team}/current` source cover IR /
   AHL-recall edge cases?** Players currently on IR or recently
   reassigned to AHL may not appear on `current` rosters. If the
   discovery-via-`raw_shots` path catches them downstream, the
   roster-step gap is harmless. If not, switch the third source from
   `/roster/{team}/current` to `/roster/{team}/{season}/all`.
3. **Should `player_directory` carry an explicit FK to `raw_shots`?**
   Currently it's an implicit join; adding the FK would let us catch
   orphans at insert time on the `raw_shots` side. Out of scope for
   Phase 0; consider for a post-Phase-0 schema-tightening pass.
