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
| `player_shifts_official` | 198,110 (pg_class) / 0 (list_tables) | **MYSTERY** | List_tables and pg_class disagree by 198K rows. Possibly a recently-loaded table with stale ANALYZE statistics |
| `raw_player_stats` | 15,489 | **RLS-DISABLED** | Source unclear; never seen in app queries; advisory flagged |
| `staging_2024_skaters` | 4,600 | **RLS-DISABLED + LIKELY-ORPHAN** | Naming suggests 2024-25 staging that was never cleaned up |
| `staging_2025_skaters` | 3,945 | **RLS-DISABLED + LIKELY-ORPHAN** | Same |
| `staging_2024_goalies` | 515 | **RLS-DISABLED + LIKELY-ORPHAN** | Same |
| `staging_2025_goalies` | 390 | **RLS-DISABLED + LIKELY-ORPHAN** | Same |
| `team_stats` | 32 | **RLS-DISABLED** | App-data flavor; possibly used somewhere |
| `players` (lowercase, 801 rows) | 801 | **RLS-DISABLED** | Distinct from the regular Supabase `auth.users`/`profiles` flow. Source unclear |
| `public.public.players` | 0 / -1 (-1 means never analyzed) | **DEFINITELY-BROKEN** | Table literally named `public.players` inside the public schema. Almost certainly an artifact of a malformed migration |
| `2025_Skaters` | 0 / -1 | **LIKELY-ORPHAN** | Capital-letter name suggests a one-off CSV import that never got cleaned up |
| `integrity_check_results` | 65,431 | **CHECK USAGE** | Large; written by some monitoring script but unclear which |
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
