# Citrus Pipeline Inventory, 2026-09-03

Scope: every runnable entry point under `scripts/`, `data-pipeline/`, `data_pipeline/`, plus the two
schedulers that drive them (GitHub Actions in `.github/workflows/`, pg_cron in production
`iezwazccqqrhrjupxzvf`) and the Windows task installers in `ops/windows/`. All production reads were
`SELECT` only. No code file was edited; every proposed change is a diff in section 5.

Method: static grep for `SupabaseRest.upsert/insert/update/delete` and `.from('t').select(...)` call sites,
`cron.job` and `cron.job_run_details` from production, `integrity_check_results` and `ops_ci_runs` for run
evidence, and `ast.parse` over all 131 non-test Python files (0 syntax failures).

Line-number provenance: numbers are from the working tree on 2026-09-03, which is HEAD `962ea416` (branch
`ops/sentry-error-monitoring`) plus other agents' uncommitted edits in 106 files. Seven cited files differ
from HEAD: `apps/web/src/services/StormyService.ts`, `server/src/routes/matchups.ts`,
`server/src/services/LineupService.ts`, `server/src/services/PlayerDashboardService.ts`,
`server/src/routes/players.ts`, `data-pipeline/monitoring/critical_table_checks.py`,
`scripts/utilities/populate_player_directory.py`. Every finding in those files was re-checked against HEAD;
HEAD line numbers for the load-bearing ones: `StormyService.ts:694,826` (bad `position`/`status` selects),
`matchups.ts:130` (`matchup_simulations`), `PlayerDashboardService.ts:480` (`vopa_score, avg_toi_per_game`),
`players.ts:439` (`coreColumns`), `critical_table_checks.py:535` (`CHECKS`) and `:655` (`main`),
`populate_player_directory.py:382` (upsert) and `:506` (`main`), `LineupService.ts:749` (`roster_status`).

---

## 0. TL;DR

1. `data_pipeline` is a git-tracked symlink to `data-pipeline/` (mode `120000`, added in commit `dce7077c`). Not a duplicate. Zero duplicated bytes; nothing to diff. 88 of the 91 importing files also load `data-pipeline/_bootstrap.py`, which makes the symlink redundant for them; the only live consumers are two inline `python -c` snippets in `playoff-sync.yml:97-98,113-114`.
2. The serving tables have TWO writer planes: 21 GitHub workflows and 44 pg_cron jobs. The pg_cron plane is the one actually landing writes on `player_talent_metrics` (08:58 UTC), `player_season_stats` (08:55), `player_projected_stats` (09:05), `player_ros_projections` (08:50) and `player_gar_components` (08:35); every `max(updated_at)` matches a cron minute exactly.
3. Root cause for every dead column in section E: `public.rebuild_player_talent_metrics()` runs `delete from player_talent_metrics where season = p_season` then re-inserts 8 columns. All 940 rows have `created_at = 2026-09-03 08:58:00`. `vopa_score`, `avg_toi_per_game`, `gp_last_10`, `roster_status`, `is_ir_eligible`, `positional_*` are wiped nightly no matter what Python writes.
4. 24 of the 44 pg_cron jobs call a function that no migration defines (29 functions once helpers are counted), including `nightly_xg_pipeline`, `rebuild_player_season_stats` and `rebuild_player_talent_metrics`. They exist only in production and in the hand-taken `supabase/schema/production_snapshot_20260813.sql`. The `prod_schema.sql` / `prod_cron.sql` files that `DATA_INVENTORY.md:163` and `schema-snapshot.yml` describe do not exist in the repo.
5. `data-pipeline/monitoring/critical_table_checks.py` declares 13 checks and has never run: no workflow calls its `main()`, and none of its 13 check names appear among 18,599 `integrity_check_results` rows.
6. `main.yml` (Nightly Projection Batch) reported `success` today after 39 seconds with summary "No remaining games found. Exiting." It selects `current_season()` = 2025; pg_cron selects `get_projection_target_season()` = 2026. Two season rules, one table.
7. Three live app queries select what does not exist: `server/src/routes/demoMatchup.ts:215` (9 `projected_*` columns on `player_season_stats`), `apps/web/src/services/StormyService.ts:852,983` (`position`, `status` on `player_directory`), `server/src/routes/matchups.ts:137` (table `matchup_simulations`, absent from every schema).
8. `refresh-player-directory.yml` has no `report-run` step. Season 2026 `source_last_fetched_at` max is `2026-08-07 16:37`; pg_cron check `player_directory_target_season` has logged `fail` every day (last: 2026-09-03 10:10, "26 days" stale).
9. 10 of 18 hourly freshness checks are at `warning` right now and route to `CITRUS_ALERT_SLACK_WEBHOOK`; `check_data_invariants.py:17-21` documents that webhook as unset. Nothing pages.
10. Highest-value moves, in order: rewrite the talent-metrics rebuild as a column-scoped upsert; capture the 29 unversioned functions into a migration; wire `critical_table_checks.py` into `data-invariants.yml`; add `report-run` to `refresh-player-directory.yml`; fix the three bad selects.

---

## 1. `data-pipeline/` vs `data_pipeline/` verdict

**Verdict: one directory, two names. `data-pipeline/` is canonical. `data_pipeline` is a symlink and should go, after the two inline snippets in `playoff-sync.yml` that resolve `data_pipeline` through the CWD are given an `import _bootstrap` line (diff in 5.9).**

Evidence:

| Claim | Evidence |
|---|---|
| `data_pipeline` is a symlink, not a directory | `ls -la` at repo root: `data_pipeline -> data-pipeline`; `readlink data_pipeline` = `data-pipeline` |
| It is tracked by git as a symlink | `GIT_OPTIONAL_LOCKS=0 git ls-files -s data_pipeline` = `120000 f834a163... data_pipeline` |
| Introduced once, never changed | `git log --follow -- data_pipeline` shows one commit: `dce7077c Restructure into platform-ready monorepo architecture` |
| Why it exists | `data-pipeline/_bootstrap.py:3-6`: Python module names cannot contain hyphens; imports are spelled `data_pipeline.*` |
| Second mechanism for the same problem | `data-pipeline/_bootstrap.py:20-24` registers a synthetic `data_pipeline` package pointing at the hyphenated directory |
| Who uses which | 91 non-test files contain `from data_pipeline`; 88 of them also `import _bootstrap`. The 3 that do not: `scripts/utilities/calculate_goalie_gsax.py:34-35`, `calculate_goalie_rebound_control.py:33-34`, `calculate_shooting_talent.py:32-33`. Each inserts `<repo>/data-pipeline` on `sys.path` and then imports `data_pipeline.utils.season_config`, which resolves only if the repo root (holding the symlink) is also importable. `data-pipeline/monitoring/alerting.py:35` matches the grep but is a docstring, not code. `data-pipeline/projections/fantasy_projection_pipeline.py:50` also imports without bootstrap, but its header at line 3 says `CATEGORY: UNWIRED` and it imports a module `apply_qoc_adjustments` that does not exist anywhere in the repo. |
| Which workflows still need the symlink | Only `playoff-sync.yml:97-98` and `:113-114`: `sys.path.insert(0, 'data-pipeline')` followed directly by `from data_pipeline.utils.supabase_rest import ...` with no `import _bootstrap`. Under `python -c`, `sys.path[0]` is the CWD (repo root), so the import resolves through the symlink. Every other inline block adds `import _bootstrap` (`refresh-player-directory.yml:88-89,137-138`, `injury-status-sync.yml:144-145`), and every `python data-pipeline/<x>.py` entry point does so at module top (`critical_table_checks.py:50-51`, `fetch_injury_status.py:83-84`). |
| The one place that says "do not rename" | `.github/workflows/main.yml:22-25` comment: "A symlink `data_pipeline -> data-pipeline` exists at the repo root ... Do not rename". `nightly_projection_batch.py` itself imports `_bootstrap`, so the comment is stale for `main.yml`; it is accurate only for `playoff-sync.yml`. |
| Already on the cleanup list | `docs/CLEANUP_PLAYBOOK.md:66-73` ("Python package-name shims (two mechanisms for one problem)") |
| Windows risk | `_bootstrap.py:5-6`: the symlink breaks on Windows checkouts without developer mode; `ops/windows/*.ps1` run Python on Windows |

What Garrett should know: the pytest suite on CI runs with `working-directory: data-pipeline` (`ci.yml:147`) and `tests/conftest.py:60,95` loads `_bootstrap`, so tests do not depend on the symlink either. The retirement path is in section 5, item 9.

---

## 2. Entry-point inventory

Legend for **Health signal**: **Y** = a successful run asserts something about what it wrote (row count, freshness, or a post-write read-back); **N** = only fails loudly on exception, or exits 0 after writing nothing; **Log** = writes a row to `ops_ci_runs` or `integrity_check_results` so absence is detectable.

"Last write observed" is `max(updated_at)` or equivalent from production on 2026-09-03 (UTC), or "n/a" where the table has no timestamp column.

### 2A. Python entry points driven by GitHub Actions

| Script | Writes (file:line) | Trigger | Cadence | Health signal | Last write observed |
|---|---|---|---|---|---|
| `data-pipeline/projections/nightly_projection_batch.py` | `player_projected_stats` upsert `:524`; `rebuild_ros_projections` RPC (header `:8-9`) | `main.yml:41` | daily 07:00 UTC (`main.yml:5`) | **N + Log**. `main.yml:46-54` writes `ops_ci_runs`; today's row: status `success`, 39 s, summary "No remaining games found. Exiting." (`nightly_projection_batch.py:700-702` returns before any write when `nhl_games` has no future rows for `current_season()` = 2025). No assertion that anything was written. | `player_projected_stats` 2026-09-03 09:05:00 (that is pg_cron `rebuild-projected-stats`, not this script) |
| `scripts/utilities/populate_player_directory.py` | `player_directory` upsert `:542` | `refresh-player-directory.yml:69` | daily 08:15 UTC (`:24`) | **Y, no Log**. Post-step asserts per-season row floor (`:81-127`) and runs one orphan check (`:129-148`, does not fail on WARN). No `report-run`, so a red run is invisible to the DB. | season 2025: 2026-08-27 19:05; season 2026 `source_last_fetched_at`: 2026-08-07 16:37 (`updated_at` 2026-09-01 10:10 is pg_cron `heal_directory_for_rostered_players`, not this script) |
| `data-pipeline/acquisition/fetch_injury_status.py` | `player_talent_metrics` upsert `:532` (`roster_status`, `is_ir_eligible`, `roster_status_source`, `roster_status_updated_at`) | `injury-status-sync.yml:116` | **none**: cron commented out (`:61-62`), `workflow_dispatch` only | **Y** (assert step `:130-170` reads back `roster_status_source` and fails if the newest write is over 60 min old) | production: `roster_status` non-null on 0 of 940 rows, `roster_status_source` non-null on 0 (rebuild wipes it; see section 3) |
| `data-pipeline/monitoring/check_data_freshness.py` | `integrity_check_results` via REST POST `:328` | `data-freshness-check.yml:75` | hourly (`:25`) | **Log**. Exit 1 on WARN does not fail the job (`:54-80`); only exit >= 2 fails. | 2026-09-03 14:20 (18 `freshness_*` rows, 10 at `warning`) |
| `data-pipeline/monitoring/check_data_invariants.py` | `integrity_check_results` insert `:217` | `data-invariants.yml:103,105` | daily 11:40 UTC (`:46`) + push | **Y + Log**. Fails build on any invariant failure; `report-run` at `:112-120`. 34 `invariant_*` rows per run, all `pass` at 15:11 today. | 2026-09-03 15:11 |
| `data-pipeline/monitoring/check_serving_path_provenance.py` | none (source scan) | `data-invariants.yml:82` | same | Y (fails on violation) | n/a |
| `data-pipeline/monitoring/reconcile_shot_coverage.py` | heals via `backfill_from_raw_payloads.py` helpers (`:50-51`), so `raw_shots` / `raw_nhl_data` | `shot-coverage-reconciler.yml:52-53` with `--heal --max-heal 15` | daily 11:00 UTC (`:18`) | N (exit 0/1 on gap count; no `report-run`) | `raw_shots` 2026-07-30 15:58 |
| `data-pipeline/monitoring/reconcile_playoff_game_stats.py` | none found by grep | `playoff-reconciliation.yml:54` | hourly (`:15`) | N (alerts only) | n/a |
| `data-pipeline/monitoring/draft_latency_scorecard.py` | none (reads view) | `draft-scorecard.yml:68` | Mondays 12:00 UTC (`:21`) | Y (fails when p95 > target) | n/a |
| `data-pipeline/acquisition/ingest_playoff_schedule.py` | `nhl_games` upsert `:181` | `playoff-sync.yml:77` | `*/15 * * 4-6 *` (`:7`) | N | `nhl_games` 2026-08-21 05:00 |
| `data-pipeline/acquisition/ingest_nhl_playoff_bracket.py` | `nhl_playoff_seeds` `:156`, `nhl_playoff_series` `:224`, `nhl_pipeline_meta` `:232` | `playoff-sync.yml:82` | same | N | seeds 2026-05-04; series 2026-08-10 |
| `data-pipeline/acquisition/sync_playoff_results.py` | `nhl_games` update `:79`, `nhl_playoff_series` update `:149`, `nhl_pipeline_meta` `:181`, RPC `score_playoff_series_picks` `:170` | `playoff-sync.yml:88` | same | N | see above |
| `scripts/nhl_archive/build_manifest.py`, `fetch_pbp.py`, `extract_rebuild.py`, `backfill_playoff_stats.py` | `nhl_games` `:159`; `raw_nhl_data` `:118`; `raw_shots_rebuild` (`REBUILD_TABLE` at `extract_rebuild.py:62`; table now lives in schema `attic`); RPC `record_rebuild_audit` | `nhl-archive.yml:80,132,198,230` | `workflow_dispatch` only (`:19`) | N | n/a |

Note on `playoff-sync.yml:77,82,88`: `--season 2025` is hardcoded three times. It will sync the wrong playoffs in April 2027 unless changed.

### 2B. GitHub Actions that call the API server (no Python)

| Workflow | Calls | Cadence | Writes (server handler) | Health signal |
|---|---|---|---|---|
| `daily-roster-lock.yml:40-42` | `POST /api/scheduled/lock-completed-days` | hourly (`:17`) | `fantasy_daily_rosters` (route in `server/src/routes/scheduled.ts`) | N (HTTP 200 only) |
| `daily-roster-snapshot.yml:49-51` | `POST /api/scheduled/roster-snapshot-today` | daily 08:00 UTC (`:26`) | `fantasy_daily_rosters` | N |
| `daily-waiver-process.yml:24,30,36` | `waiver-process`, `trade-review-sweep`, `matchup-sweep` | `10 * * * *` (`:14`) | waivers, trades, matchups | N |
| `citrus-news-generate.yml:61-64` | `POST /api/scheduled/generate-news` | every 6 h (`:23`) | `citrus_news` | N (a detector error is a `::warning::`, run still green, `:76-78`) |

`fantasy_daily_rosters` last write 2026-09-03 16:19; `citrus_news` last `created_at` 2026-08-25 22:25 (840 rows).

### 2C. pg_cron writers in production (SQL plane)

Source: `cron.job` (44 jobs, all `active`). All 44 reported `succeeded` on every run in the last 7 days (`cron.job_run_details`). "succeeded" here means the function returned; it says nothing about rows.

| Job (schedule UTC) | Function | Writes | In a migration? | Health signal |
|---|---|---|---|---|
| `nightly-xg-pipeline` (08:35) | `nightly_xg_pipeline()` | `player_gar_components`, `goalie_gsax_primary`, `nhl_game_arena`; calls `refresh_xg_season_layer`, `citrus_repair_shift_clocks`, `record_rebuild_audit` | **no** (named only in a comment at `20260826130000_nightly_pipeline_scores_our_model.sql:6`) | N (returns 1 row) |
| `rebuild-player-identity` (08:10) | `rebuild_player_identity()` | `nhl_player_identity` | **no** | N |
| `refresh-player-rollups` (08:20) | `refresh_player_rollups()` | calls `record_rebuild_audit` | **no** | N |
| `rebuild-ros-projections` (08:50) | `rebuild_ros_projections(get_projection_target_season())` | `player_ros_projections` (1055 rows, all season 2026) | yes (2 migrations) | N |
| `rebuild-player-season-stats` (08:55) | `rebuild_player_season_stats(get_current_season())` | `player_season_stats`: `delete ... where season = p_season` then insert; `x_assists` hardcoded `0` | **no** | N |
| `rebuild-talent-metrics` (08:58) | `rebuild_player_talent_metrics(get_current_season())` | `player_talent_metrics`: `delete` then insert of `season, player_id, xg_per_60, xg_rating, roster_status, is_ir_eligible, updated_at, last_updated` only | **no** | N |
| `rebuild-projected-stats` (09:05) | `rebuild_player_projected_stats(get_projection_target_season())` | `player_projected_stats`: `delete ... where season = p_season` then insert of 36 columns | yes (2 migrations) | N |
| `populate-weekly-stats-daily` (06:30), `-monday` (07:00 Mon) | `run_weekly_stats_populate()` | `player_weekly_stats` | **no** | N |
| `player-directory-freshness` (10:10) | `log_player_directory_freshness()` | `player_directory` (via `heal_directory_for_rostered_players`), `integrity_check_results` | **no** | Log (currently `fail`) |
| `optimize-best-ball-rosters` (06:00) | `optimize_best_ball_daily_rosters` | `fantasy_daily_rosters` | yes | N |
| `auto-fix-integrity` (04:00) | `auto_fix_integrity_issues()` | `team_lineups` | yes | Log |
| `data-integrity-check` (every 6 h) | `check_data_integrity()` | `integrity_check_results` (41 rows per run) | yes | Log |
| 16 `log_*` monitors (`audit_trail_integrity`, `boxscore_reconciliation`, `cron_job_health`, `matchup_score_calibration`, `monitor_liveness`, `pipeline_coverage`, `pool_scoring_integrity`, `scoring_config_divergence`, `season_boundary`, `security_anomalies`, `security_drift`, `stat_column_parity`, `weekly_stats_vs_source`, `waiver_priority_integrity`, `xg_chain_integrity`, `xg_integrity_v2`) | | `integrity_check_results` | only `log_security_drift`, `log_pool_scoring_integrity` are in migrations | Log |
| remaining 13 jobs (draft, trades, waivers, retention, vacuum, pg_stat reset) | | draft/trade/waiver tables | mostly yes | N |

Functions with **no migration** (grep of `supabase/migrations/*.sql` for a `function ... <name>` definition returned nothing; 29 in total): `nightly_xg_pipeline`, `rebuild_player_season_stats`, `rebuild_player_talent_metrics`, `rebuild_player_identity`, `refresh_player_rollups`, `run_weekly_stats_populate`, `log_player_directory_freshness`, `refresh_xg_season_layer`, `record_rebuild_audit`, `check_stats_layer_freshness`, `log_pipeline_coverage`, plus `log_audit_trail_integrity`, `log_boxscore_reconciliation`, `log_cron_job_health`, `run_data_retention`, `log_matchup_score_calibration`, `log_monitor_liveness`, `log_scoring_config_divergence`, `log_season_boundary`, `log_security_anomalies`, `log_stat_column_parity`, `log_weekly_stats_vs_source`, `log_waiver_priority_integrity`, `log_xg_chain_integrity`, `log_xg_integrity_v2`, `refresh_reverse_standings_waiver_order`, `check_monitor_liveness`, `heal_directory_for_rostered_players`, `check_player_directory_freshness`. All of these appear only in `supabase/schema/production_snapshot_20260813.sql`. 24 of the 44 `cron.job` rows call one of them.

### 2D. Long-running daemon and Windows tasks

| Script | Writes | Trigger | Health signal | Last write observed |
|---|---|---|---|---|
| `data-pipeline/acquisition/data_scraping_service.py` | via imports: `raw_nhl_data`, `raw_shots`, `player_game_stats`, `player_shifts_official` (header `:8`); RPCs `aggregate_player_playoff_stats_live` `:596`, `score_all_playoff_roster_pools` `:601`, `update_playoff_series_from_games` `:607` | Windows Scheduled Task `CitrusDataScrapingService` at boot (`ops/windows/install_data_scraping_service.ps1:20,44`) or Docker (`data-pipeline/docker-compose.yml`) | `health_check_server.py` HTTP `:8888` (Dockerfile `:49`); no DB row | `player_game_stats` 2026-08-21 03:52; `raw_nhl_data` 2026-08-11 05:17; `player_shifts_official` 2026-08-26 11:04 |
| `ops/windows/install_tasks.ps1:16-18` registers `CitrusLiveIngest`, `CitrusLiveExtract`, `CitrusSeasonRollupHourly` | | at boot / hourly | none | **Dead paths**: `run_ingest_live.ps1:16` runs `<root>/ingest_live_raw_nhl.py`, `run_season_rollup.ps1:16` runs `<root>/build_player_season_stats.py`; neither file exists at repo root (they live under `data-pipeline/`). `run_extractor_live.ps1` was renamed `DISABLED_run_extractor_live.ps1`, so `install_tasks.ps1:17` points at a missing file. |
| `data-pipeline/acquisition/scrape_live_nhl_stats.py` (no `__main__`) | `nhl_games` update `:197` | imported by daemon | N | `nhl_games` 2026-08-21 |
| `data-pipeline/acquisition/scrape_per_game_nhl_stats.py` | `player_game_stats` upsert `:732` | imported by daemon | N | 2026-08-21 |
| `data-pipeline/scoring/run_daily_pbp_processing.py`, `calculate_matchup_scores.py` | RPC `update_all_matchup_scores` `:707`, `verify_matchup_scores` `:661,967` | imported by daemon (`data_scraping_service.py:575,731`) | Y for matchup scores (verify RPC) | n/a |

### 2E. Manual writers of production tables (no scheduler references them)

| Script | Writes | Header says | Last write observed |
|---|---|---|---|
| `data-pipeline/projections/build_player_season_stats.py` | `player_season_stats` `:196`, `player_talent_metrics` `:417` | ACTIVE | superseded by pg_cron rebuild (08:55) |
| `data-pipeline/projections/calculate_daily_projections.py` | `projection_cache` `:2548`, `player_talent_metrics` `:3075` (inside `persist_vopa_audit`, which has zero callers) | "imported by nightly_projection_batch.py" | `projection_cache` 1461 rows, no timestamp column |
| `data-pipeline/projections/run_daily_projections.py` | same as batch; tries to import `sync_rosters` and `populate_gp_last_10_metric` from `<self dir>/scripts/utilities` (`:663`, `:802`), a path that does not exist, so both silently skip | manual | n/a |
| `data-pipeline/acquisition/fetch_nhl_stats_from_landing.py` / `_fast.py` | `player_season_stats` `:582` / `:567` | manual catch-up | superseded by pg_cron |
| `data-pipeline/acquisition/ingest_raw_nhl.py`, `ingest_shiftcharts.py`, `backfill_shifts.py`, `backfill_shifts_html.py`, `ingest_live_raw_nhl.py` | `raw_nhl_data` `:230`; `player_shifts_official` `:95`; `player_shifts_official` `:216` + RPC `record_shift_quality` `:219` | manual / daemon | 2026-08-11 / 2026-08-26 |
| `data-pipeline/acquisition/data_acquisition.py` | `raw_shots` `:2107`, `raw_player_stats` `:4448`, `player_names` `:3211` (**table does not exist**) | manual | `raw_player_stats` 2025-12-10 |
| `data-pipeline/acquisition/populate_team_stats.py` (no `__main__`) | `team_stats` `:178` | manual | 2026-01-09 (32 rows) |
| `data-pipeline/draftkit/load_blurbs.py` | `draft_kit_blurbs` `:374` | manual `--apply` | never (0 rows; table created by `20260902090000`) |
| `data-pipeline/scoring/simulate_matchups.py` | `matchup_simulations` `:2232` (**table does not exist**) | UTILITY | never |
| `scripts/utilities/calculate_gar_regression.py` | `player_gar_components` `:364` | manual | superseded by pg_cron 08:35 |
| `scripts/utilities/calculate_goalie_gar.py`, `calculate_goalie_gsax.py`, `calculate_goalie_rebound_control.py` | `goalie_gar` `:381`, `goalie_gsax` `:486`, `goalie_rebound_control` `:364` | manual | 2025-12-18 / 2026-01-04 / 2025-12-18 (freshness SLA at `warning` for all three) |
| `scripts/utilities/populate_gp_last_10_metric.py` | `player_talent_metrics` `:241` (`gp_last_10`, `roster_status`) | header `:6` says "scheduled daily"; no scheduler references it | wiped nightly |
| `scripts/utilities/sync_rosters.py` | `player_directory` `:473` (`eligible_positions` `:494-516`) | only caller is `run_daily_projections.py:805` via the broken path | `eligible_positions` populated on 10 of 820 season-2026 rows |
| `scripts/utilities/populate_league_averages.py` | RPC `populate_league_averages` `:171` | manual | `league_averages` 2026-01-05 (6 rows; freshness `warning`) |
| `scripts/utilities/load_historical_shots_csv.py`, `populate_goalie_names_from_api.py`, `process_xg_stats.py`, `backfill_missing_shots.py` | `raw_shots` `:534` / update `:132` / delete `:226`; `raw_nhl_data` update `:100` | manual | |
| `scripts/utilities/replay_pbp_for_moat.py`, `transfer_moat_to_prod.py`, `populate_player_names_from_api.py` | `phase0c_progress` `:405` (schema `attic`), `_moat_transfer` `:283` (**does not exist**), `player_names` `:181` (**does not exist**) | one-off | |
| `scripts/maintenance/archive_to_csv.py` | `TRUNCATE TABLE raw_shots RESTART IDENTITY` `:170`, `DELETE FROM raw_nhl_data` `:230` via psycopg2 | manual; **destructive** | |
| `scripts/drills/*.py` | RPCs `process_faab_waivers_for_league`, `calculate_ppg_standings`, `calculate_roto_standings`, `populate_player_weekly_stats` | manual drills | |
| TS: `scripts/backfill-daily-rosters.ts:156`, `verify-roster-integrity.ts:143` | `fantasy_daily_rosters` | manual `tsx` | |
| TS: `scripts/populate-nhl-teams-and-normalize.ts:70,84,104` | `nhl_teams`, `players`, `nhl_games` | manual | `nhl_teams` 2026-08-11; `players` 2025-11-28 |
| TS: `scripts/test-lineup-integration.ts:63`, `scripts/load-test/provision-test-accounts.ts:114` | `team_lineups`; `league_memberships` (**does not exist**) | manual | |
| mjs: `scripts/staging/04-load-stats-data.mjs`, `05-load-reference-data.mjs`, `06-verify-staging-ready.mjs`, `db-push.mjs`, `gen-scoring-defaults.mjs` | staging loaders; `gen-scoring-defaults.mjs` writes `data-pipeline/scoring/scoring_defaults.py` (checked by `ci.yml:663`) | manual / CI check | |

### 2F. Monitoring scripts with no scheduler at all

`monitor_data_scraping.py`, `verify_data_integrity.py`, `verify_projection_pipeline.py`, `audit_projection_accuracy.py` each carry a header saying "scheduled monitoring" (lines 3-8 of each) and are referenced by nothing in `.github/workflows/`, `ops/`, or `docker-compose.yml`. `critical_table_checks.py` header `:6` says "daily cron (post nightly_projection_batch.py)"; only one of its functions is imported, by `refresh-player-directory.yml:139`, and its `main()` (`:714`) is never invoked. `monitoring/test_proxy_system.py` is a test file outside `tests/`.

### 2G. `scripts/_deprecated/` and `scripts/_one_offs/`

`_deprecated/` (7 files): `extractor_job.py` (header `:3` `CATEGORY: DEPRECATED`, superseded per `:6-8`; wrote `player_directory` `:406`, `player_game_stats` `:710`), four TS loaders (`fetch-nhl-players.ts:162` writes `players`; `fetch-nhl-schedule.ts:176`, `import-schedule-from-csv.ts:336`, `import-schedule-from-excel.ts:345` write `nhl_games`), `delete-all-draft-data.sql`, `README.md`. Inbound references: only a comment at `scripts/utilities/backfill_from_raw_payloads.py:124` and the disabled `ops/windows/DISABLED_run_extractor_live.ps1:16`. Nothing imports from it. **Can go**, after `ops/windows/install_tasks.ps1:17` stops referencing the extractor.

`_one_offs/` (3 files): `r4_classify_scripts.py` (the generator of the `CITRUS-CLASSIFICATION` headers present in 127 files), `phase0_pre6a_pilot.py`, `phase0_6c_drain_loop.sh`. Zero inbound references. **Can go**, or keep `r4_classify_scripts.py` if the headers are to be regenerated.

---

## 3. Columns the app reads that nothing writes (or that are erased after being written)

Verified by reading the production null map on 2026-09-03 and tracing writers by grep. "Writer" means a code path that assigns the column; "effective" means it survives the nightly pg_cron rebuild.

### 3A. `player_talent_metrics` (940 rows, all season 2025, all recreated 2026-09-03 08:58:00)

| Column | App reader (file:line) | Non-null / true in prod | Nominal writer | Why it is empty |
|---|---|---|---|---|
| `vopa_score` | `server/src/services/PlayerDashboardService.ts:138,464`; `apps/web/src/hooks/usePlayerDashboard.ts:97` | 0 of 940 | none. `calculate_vopa_score()` at `calculate_daily_projections.py:2908` has zero callers; `persist_vopa_audit()` at `:2999` writes `positional_*` only and also has zero callers | never written, and the nightly `delete`+`insert` in `rebuild_player_talent_metrics()` would erase it anyway |
| `avg_toi_per_game` | `PlayerDashboardService.ts:138,464`; `playerAdvancedMetrics.ts` | 0 of 940 | none: the string appears in no `.py` under `data-pipeline/` or `scripts/` | never written |
| `positional_replacement_level`, `positional_std_dev` | `PlayerDashboardService.ts:464` | 0 of 940 | `persist_vopa_audit()` `:3060-3067` (no callers) | never called; erased nightly |
| `gp_last_10` | `apps/web/src/integrations/supabase/types.ts` only (3 refs) | 0 non-zero of 940 (default `0`) | `scripts/utilities/populate_gp_last_10_metric.py:241`, reachable only through `run_daily_projections.py:666` whose `sys.path` insert at `:663` points at a directory that does not exist | import fails silently (`:668-669`), and erased nightly |
| `is_likely_to_play` | `types.ts` only | 0 true | same script | same |
| `roster_status`, `is_ir_eligible` | `server/src/services/LineupService.ts:526,879`; `apps/web/src/utils/playerStatsHelper.ts`; `HockeyPlayerCard.tsx`; `SlotPickerMenu.tsx` (34 to 43 refs) | 0 of 940 / 0 true | `fetch_injury_status.py:532` (workflow cron disabled, `injury-status-sync.yml:61-62`); `populate_gp_last_10_metric.py:184` (reads NHL keys that do not exist, per `fetch_injury_status.py:22-27`) | not scheduled; and `rebuild_player_talent_metrics()` carries `roster_status` forward with `select ... from player_talent_metrics t where t.player_id = m.player_id order by season desc limit 1` AFTER deleting the only season present, so it resolves to NULL every night |
| `roster_status_source`, `roster_status_updated_at` | `injury-status-sync.yml:150-157` (the workflow's own assertion) | 0 of 940 | `fetch_injury_status.py:500-503` | erased nightly; the assert step would fail on any run after 08:58 UTC even if the sync had worked |
| `ros_projection_xg`, `talent_adjusted_xg_per_60`, `vopa_calculation_date` | none | 0 | none / `persist_vopa_audit` | dead columns |

The IR slot (`is_ir_eligible`) and player news (`roster_status`) features are therefore inert in production, exactly as `fetch_injury_status.py:16-19` describes, and will stay inert until the rebuild stops deleting rows.

### 3B. `player_projected_stats`, season 2026 (66,024 rows, the only season pg_cron rewrites)

Written nightly by `rebuild_player_projected_stats()` with 36 columns; the app reads more than that.

| Column | App reader | Season 2026 state | Nominal writer |
|---|---|---|---|
| `confidence_score` | `server/src/routes/players.ts:482`; `apps/web/src/utils/queryColumns.ts:117`; `HockeyPlayerCard.tsx` (26 refs) | NULL on 66,024 of 66,024 | Python `nightly_projection_batch.py:461` only |
| `shrinkage_weight`, `finishing_multiplier`, `opponent_adjustment` | `players.ts:480-481`; `queryColumns.ts:117` | NULL on all | Python `:459-460` only |
| `dynamic_confidence`, `likely_low`, `likely_high` | `queryColumns.ts:117`; `HockeyPlayerCard.tsx` (23 to 31 refs) | NULL on all | Python only (season 2025 has 19,353 non-null) |
| `starter_confirmed` | `players.ts:485`; `HockeyPlayerCard.tsx`; `PlayerCard.tsx` (23 refs) | false on all (default) | Python `:465` |
| `projected_xg` | `players.ts:479` | 0 on all (`NOT NULL DEFAULT 0`) | Python |
| `injury_status` | `server/src/services/ScoresService.ts`; `packages/shared/src/types/scores.ts` | `'healthy'` on all (column default) | `nightly_projection_batch.py:315-318` reads table `player_injuries`, which does not exist in any schema, so `fetch_injury_report()` always returns `{}` (`:328-331`) |
| `game_start_time` | | NULL on all seasons | none |

### 3C. Schema mismatches: app selects columns or tables that do not exist

| Call site | Selects | Reality | Effect |
|---|---|---|---|
| `server/src/routes/demoMatchup.ts:215-217` | `projected_goals, projected_assists, projected_sog, projected_blocks, projected_ppp, projected_shp, projected_hits, projected_pim, total_projected_points` from `player_season_stats` | none of the 9 exist on `player_season_stats` (49 columns, verified via `information_schema.columns`) | PostgREST rejects the select; `:235` does `playerStats = (statsResult.data ?? [])` with no error check, so `/api/demo/matchup` ships empty stats. Introduced by `b3e7497b` (2026-08-24). |
| `apps/web/src/services/StormyService.ts:852` | `player_id, full_name, position, team_abbrev, status` from `player_directory` | `player_directory` has `position_code`, no `position`, no `status` | `Promise.allSettled` + `?? []` swallow it; Stormy sees no players. Since `d616ac47` (2026-04-18). |
| `apps/web/src/services/StormyService.ts:983-985` | `player_id, full_name, position` | same | same |
| `server/src/routes/matchups.ts:137` | table `matchup_simulations` | does not exist in any schema (`pg_class` check) | route `/api/matchups/league/:id/simulations` returns `handleError` on every call; `WinProbabilityBar.tsx` consumer never gets data. Writer `simulate_matchups.py:2232` writes the same missing table. |

### 3D. Sparse, not empty

| Column | Reader | State | Writer |
|---|---|---|---|
| `player_directory.eligible_positions` | `apps/web/src/hooks/usePreloadedPlayers.ts:289`; `server/src/services/BestBallService.ts:65`; `server/src/services/LineupService.ts:200`; `PlayerPool.tsx:403` (69 refs) | season 2026: 10 of 820; season 2025: 787 of 1089 | only `sync_rosters.py:494-516`, reachable only via the broken path in `run_daily_projections.py:802-805`; `populate_player_directory.py` does not set it |
| `player_season_stats.x_assists` | none | 0 on all 9,413 rows | hardcoded `0` in `rebuild_player_season_stats()` ("see comment above") |
| `player_season_stats.x_goals` | `usePreloadedPlayers.ts:374` | 0 or NULL on 126 of 1,063 season-2025 rows | `coalesce(x.xg, 0)` from `player_xg_season` in the rebuild; acceptable |

---

## 4. Tables with no monitoring invariant

Monitoring that exists: 18 tables in the freshness matrix (`data-pipeline/monitoring/freshness_sla.py:89-305`), 34 correctness invariants from `check_data_invariants.py` (shift / TOI / xG / GAR chain), 16 pg_cron `log_*` monitors, and the 13 declared-but-never-run checks in `critical_table_checks.py:591-637`.

| Table | Written by | Freshness SLA? | Correctness invariant? | Gap |
|---|---|---|---|---|
| `player_talent_metrics` | pg_cron 08:58; 4 Python scripts | yes (`freshness_sla.py:200`, watches `last_updated`, 168 h) | **none** | freshness passes every day because the rebuild stamps `now()`; nothing checks that any column other than `xg_per_60` is populated. The 940-row all-NULL state has been invisible to every monitor. |
| `player_projected_stats` | pg_cron 09:05; Python batch | yes (`:181`) | only `critical_table_checks.py:559` freshness xref, never run | no check that `confidence_score` / `starter_confirmed` / `projected_xg` are populated for the target season; no check that the row count matches `player_directory x nhl_games` |
| `player_season_stats` | pg_cron 08:55 | yes (`:159`) | pg_cron `stat_column_parity`, `stats_layer_freshness` | no check that `team_abbrev` / `position_code` resolve (21 to 24 NULL on season 2025) |
| `player_directory` | workflow + pg_cron heal | yes (`:167`) + pg_cron `player_directory_target_season` (currently `fail`) | `critical_table_checks.py:486` count-in-range, never run | `eligible_positions` coverage unchecked; the pg_cron `fail` has no consumer that pages |
| `player_ros_projections` | pg_cron 08:50 | yes (`:192`) | none | no row-count or non-zero-points check |
| `player_weekly_stats` | pg_cron 06:30 | **no** | pg_cron `weekly_stats_vs_source` | no freshness |
| `nhl_games` | daemon, playoff workflows | yes (`:101`) | `critical_table_checks.py:447` orphan check, never run | no check that the upcoming season's schedule is loaded before `rebuild_player_projected_stats` needs it |
| `fantasy_daily_rosters` | 2 workflows + pg_cron | yes (`:257`, skipped offseason) | pg_cron `fantasy_daily_rosters_sync_today` | ok |
| `citrus_news` | `generate-news` every 6 h | **no** | none | 840 rows, last 2026-08-25; a broken detector is a `::warning::` (`citrus-news-generate.yml:76-78`) |
| `draft_kit_blurbs` | manual `load_blurbs.py` | **no** | none | 0 rows; the Draft Kit page reads it (`apps/web` 1 file) |
| `team_stats` | `populate_team_stats.py` (no `__main__`) | **no** | none | 32 rows, last 2026-01-09; read by `nightly_projection_batch.py` (`fetch_team_defense_stats`) |
| `projection_cache` | `calculate_daily_projections.py:2548` | **no** (no timestamp column) | none | 1,461 rows, unknowable age |
| `nhl_pipeline_meta` | playoff scripts | **no** (no timestamp column) | none | 4 rows |
| `nhl_playoff_series`, `nhl_playoff_seeds` | playoff workflows | **no** | none | 15 / 16 rows; seasonal |
| `nhl_teams`, `players` | manual TS | **no** | none | `players` last 2025-11-28 (801 rows); app reads `nhl_teams` in 3 files |
| `raw_player_stats` | `data_acquisition.py:4448` | **no** | none | 15,801 rows, last 2025-12-10 |
| `integrity_check_results` | everything | pg_cron `monitor_liveness` watches 5 prefixes (`check_monitor_liveness()`): `freshness_%`, `xg_integrity_v2`, `security_drift`, `pipeline_coverage`, `stats_layer_freshness` | | `invariant_%` rows (the daily invariants workflow) and the 13 `critical_table_checks` names are **not** in the liveness list; if `data-invariants.yml` stops running, nothing notices |
| `ops_ci_runs` | `report-run` in 5 of 21 workflows (`ci.yml`, `data-invariants.yml`, `main.yml`, `production-deploy.yml`, `schema-snapshot.yml`) | n/a | n/a | 16 workflows, including `refresh-player-directory.yml`, `injury-status-sync.yml`, `data-freshness-check.yml`, `shot-coverage-reconciler.yml`, all four curl workflows, leave no row |

---

## 5. Consolidation plan, ranked by risk reduction per hour

Each item is independent. Effort is my estimate; "risk" is what the item stops from happening again.

### 5.1 Stop `rebuild_player_talent_metrics()` from deleting every column it does not own (1 h, highest)

Risk removed: the nightly wipe that makes `roster_status`, `is_ir_eligible`, `vopa_score`, `gp_last_10` and every future column on this table impossible to populate. Also captures a function that today exists only in production.

New file `supabase/migrations/20260904000000_talent_metrics_rebuild_preserves_columns.sql`:

```sql
-- rebuild_player_talent_metrics() was `delete ... where season = p_season` followed
-- by an insert of 8 columns. Every other column (roster_status written by
-- fetch_injury_status.py, gp_last_10, vopa_score, positional_*) was erased at
-- 08:58 UTC daily. Observed 2026-09-03: all 940 rows had created_at = 08:58:00
-- and every non-xG column NULL. This version owns only xg_per_60 / xg_rating and
-- deletes only players that fell out of the TOI set.
create or replace function public.rebuild_player_talent_metrics(p_season integer)
 returns table(rows_written integer, rated integer, below_toi_floor integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_rows int; v_rated int; v_floor int;
begin
  create temp table _tm on commit drop as
  with toi as (
    select pgs.player_id,
           sum(coalesce(pgs.nhl_toi_seconds,0))::numeric as toi_sec
      from player_game_stats pgs
     where substring(pgs.game_id::text,1,4)::int = p_season
       and substring(pgs.game_id::text,5,2) = '02'
       and not pgs.is_goalie
     group by 1
  ),
  xg as (
    select player_id, sum(xg)::numeric as xg
      from player_xg_season
     where season = p_season and game_type = 'regular'
     group by 1
  )
  select t.player_id,
         round(t.toi_sec/60.0, 2) as toi_minutes,
         case when t.toi_sec > 0
              then round(coalesce(x.xg,0) * 3600.0 / t.toi_sec, 4)
              else 0 end as xg_per_60
    from toi t left join xg x on x.player_id = t.player_id
   where t.toi_sec > 0;

  update _tm set xg_per_60 = 0 where xg_per_60 < 0;

  -- Only players who no longer have regular-season TOI this season leave.
  delete from player_talent_metrics ptm
   where ptm.season = p_season
     and not exists (select 1 from _tm m where m.player_id = ptm.player_id);

  insert into player_talent_metrics (season, player_id, xg_per_60, xg_rating,
                                     updated_at, last_updated)
  select p_season, m.player_id, m.xg_per_60,
         case when m.toi_minutes < 200 then null
              when m.xg_per_60 <  0.30 then 'Low'
              when m.xg_per_60 <  0.60 then 'Below Avg'
              when m.xg_per_60 <  0.90 then 'Average'
              when m.xg_per_60 <  1.20 then 'Above Avg'
              else 'Elite' end,
         now(), now()
    from _tm m
  on conflict (player_id, season) do update
     set xg_per_60    = excluded.xg_per_60,
         xg_rating    = excluded.xg_rating,
         updated_at   = now(),
         last_updated = now();

  get diagnostics v_rows = row_count;
  select count(*) filter (where xg_rating is not null),
         count(*) filter (where xg_rating is null)
    into v_rated, v_floor
    from player_talent_metrics where season = p_season;
  return query select v_rows, v_rated, v_floor;
end;
$function$;

revoke all on function public.rebuild_player_talent_metrics(integer) from public;
grant all on function public.rebuild_player_talent_metrics(integer) to service_role;
```

Precondition to verify before applying: a unique constraint on `(player_id, season)` exists (every Python writer already upserts `on_conflict="player_id,season"`, `fetch_injury_status.py:532`, `calculate_daily_projections.py:3075`, `populate_gp_last_10_metric.py:241`).

### 5.2 Capture the 29 production-only functions into a migration (2 h)

Risk removed: the SQL writer plane is unrecoverable from the repo today. `schema-snapshot.yml` was meant to produce `supabase/schema/prod_schema.sql` and `prod_cron.sql` (`DATA_INVENTORY.md:163`, `:208`) but `ls supabase/schema/` shows only `production_snapshot_20260813.sql`.

Command (read-only against prod; output is the migration body):

```sql
select pg_get_functiondef(p.oid) || E';\n'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'nightly_xg_pipeline','rebuild_player_season_stats','rebuild_player_identity','refresh_player_rollups',
     'run_weekly_stats_populate','log_player_directory_freshness','refresh_xg_season_layer',
     'record_rebuild_audit','check_stats_layer_freshness','log_pipeline_coverage',
     'log_audit_trail_integrity','log_boxscore_reconciliation','log_cron_job_health',
     'run_data_retention','log_matchup_score_calibration','log_monitor_liveness',
     'check_monitor_liveness','log_scoring_config_divergence','log_season_boundary',
     'log_security_anomalies','log_stat_column_parity','log_weekly_stats_vs_source',
     'log_waiver_priority_integrity','log_xg_chain_integrity','log_xg_integrity_v2',
     'refresh_reverse_standings_waiver_order','heal_directory_for_rostered_players',
     'check_player_directory_freshness')
 order by p.proname;
```

Save as `supabase/migrations/20260904001000_capture_pg_cron_functions_as_applied.sql`, prefixed with a comment that it is a capture of production state on 2026-09-03 (same pattern as `20260903031600_scale_audit_indexes_as_applied.sql`). Then confirm `schema-snapshot.yml` has the `PROD_DB_URL` secret it needs (`DATA_INVENTORY.md:163`); its `report-run` step exists (`schema-snapshot.yml:133`) but no `Schema Snapshot` row appears in `ops_ci_runs`.

**Amendment 2026-09-03 17:30Z (verified against prod, read-only).** The premise above was measured against the repo only. Against `supabase_migrations.schema_migrations` on production, 38 of the 41 functions that cron jobs call DO have a history row; only `expire_stale_trade_offers` and `process_all_faab_waivers` have none (`integrity_check_results` is a table, not a function). The real defect is wider: prod history holds 450 versions, the repo holds 383 files, and only 41 versions appear in both. 409 history rows have no file (MCP / dashboard applies); 342 files have no history row (psql / SQL-editor applies, or never applied). Writing a fresh capture migration for 28 functions would add a 451st version to one side only. Done instead: `scripts/ops/dump-prod-schema.sh` now also writes `supabase/schema/prod_migration_history.sql` (every history row, full statements) and `schema-snapshot.yml` commits it with the schema and cron manifests, so the reconciliation has both halves in git. Blocked on the `PROD_DB_URL` repository secret (no `Schema Snapshot` row in `ops_ci_runs` as of 17:30Z). The 5.1 fix above ships with its own same-day capture and is the only new migration file this session adds for functions.

### 5.3 Run `critical_table_checks.py` from the daily invariants workflow (30 min)

Risk removed: 13 written checks that have never executed, including `player_game_stats_nhl_columns_populated` (PAGE), `player_game_stats_no_orphan_game_ids` (PAGE), `player_directory_count_in_range`.

```diff
--- a/.github/workflows/data-invariants.yml
+++ b/.github/workflows/data-invariants.yml
@@ -103,6 +103,22 @@
             python data-pipeline/monitoring/check_data_invariants.py --ignore "$IGNORE" 2>&1 | tee /tmp/invariants.log
           else
             python data-pipeline/monitoring/check_data_invariants.py 2>&1 | tee /tmp/invariants.log
           fi
 
+      # critical_table_checks.py declares 13 checks (raw_shots, player_game_stats,
+      # player_directory, player_gar_components, freshness xref). Until this step
+      # existed nothing invoked its main(): none of its check names had ever
+      # appeared in integrity_check_results. Exit 2 (any FAIL) fails the job;
+      # exit 1 (WARN only) annotates and continues, mirroring the freshness job.
+      - name: Run critical table checks
+        env:
+          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
+          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
+          CITRUS_ALERT_SLACK_WEBHOOK: ${{ secrets.CITRUS_ALERT_SLACK_WEBHOOK }}
+          CITRUS_ALERT_PAGERDUTY_KEY: ${{ secrets.CITRUS_ALERT_PAGERDUTY_KEY }}
+        shell: bash
+        run: |
+          set +e
+          python data-pipeline/monitoring/critical_table_checks.py 2>&1 | tee -a /tmp/invariants.log
+          code=${PIPESTATUS[0]}
+          set -e
+          if [ "$code" -ge 2 ]; then echo "::error::critical_table_checks FAIL"; exit "$code"; fi
+          if [ "$code" -eq 1 ]; then echo "::warning::critical_table_checks reported WARN"; fi
+
       # One row in public.ops_ci_runs (last line of the checker's output as the
```

Follow-up in the same PR: add `('invariant_%', 'data-invariants.yml (daily)', 30.0, ...)` and `('raw_shots_%', 'critical_table_checks (daily)', 30.0, ...)` rows to the `values` list inside `check_monitor_liveness()` so silence is detected.

### 5.4 Add `report-run` to `refresh-player-directory.yml` and `injury-status-sync.yml` (20 min)

Risk removed: the one daily writer that has been failing since 2026-08-07 leaves no trace in the database; Garrett learns about it from a stale-directory symptom 27 days later.

```diff
--- a/.github/workflows/refresh-player-directory.yml
+++ b/.github/workflows/refresh-player-directory.yml
@@ -66,4 +66,4 @@
           VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
           SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
           PYTHONUNBUFFERED: '1'
-        run: python -u scripts/utilities/populate_player_directory.py
+        run: python -u scripts/utilities/populate_player_directory.py 2>&1 | tee /tmp/directory.log
 
@@ -146,3 +146,15 @@
           # WARNs after the refresh indicate edge cases (IR/AHL/etc) that
           # need separate investigation per audit §10.7.
           "
+
+      # One row in public.ops_ci_runs so a red directory refresh is visible
+      # through the Supabase MCP. Never fails the job. See docs/RUNBOOKS/CI_TELEMETRY.md.
+      - name: Report run
+        if: always()
+        continue-on-error: true
+        uses: ./.github/actions/report-run
+        with:
+          status: ${{ job.status }}
+          log-file: /tmp/directory.log
+          supabase-url: ${{ secrets.VITE_SUPABASE_URL }}
+          service-role-key: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

Note: the context line at `:147` contains a section sign (U+00A7) in the file; reproduce it from the file when applying. Apply the identical `Report run` block to `injury-status-sync.yml`, `data-freshness-check.yml`, `shot-coverage-reconciler.yml` (with their own `tee` targets).

### 5.5 Fix the three selects that reference columns or tables that do not exist (30 min)

```diff
--- a/server/src/routes/demoMatchup.ts
+++ b/server/src/routes/demoMatchup.ts
@@ -213,7 +213,7 @@
       supabaseAdmin
         .from('player_season_stats')
         .select(
-          'player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, nhl_plus_minus, nhl_toi_seconds, goalie_gp, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_save_pct, nhl_gaa, nhl_shutouts, projected_goals, projected_assists, projected_sog, projected_blocks, projected_ppp, projected_shp, projected_hits, projected_pim, total_projected_points',
+          'player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, nhl_plus_minus, nhl_toi_seconds, goalie_gp, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_save_pct, nhl_gaa, nhl_shutouts',
         )
         .in('player_id', playerIds),
```

Also at `demoMatchup.ts:235`, check `statsResult.error` before assigning, so the next schema drift is a 500 rather than an empty array. If the demo page needs projections, read them from `player_ros_projections` (which has `total_projected_points`, `projected_goals`, etc.).

```diff
--- a/apps/web/src/services/StormyService.ts
+++ b/apps/web/src/services/StormyService.ts
@@ -849,7 +849,7 @@
 
         if (playerIds.length > 0) {
           const [playersRes, statsRes] = await Promise.allSettled([
-            sb.from('player_directory').select('player_id, full_name, position, team_abbrev, status').in('player_id', playerIds),
+            sb.from('player_directory').select('player_id, full_name, position_code, team_abbrev').in('player_id', playerIds),
             sb.from('player_playoff_stats').select('*').in('player_id', playerIds),
           ]);
 
@@ -980,7 +980,7 @@
             if (ranked.length > 0) {
               const namesRes = await sb
                 .from('player_directory')
-                .select('player_id, full_name, position')
+                .select('player_id, full_name, position_code')
                 .in('player_id', ranked.map(x => x.row.player_id));
```

Then rename `position` to `position_code` in the `PlayerDirRow` type and the two consumers at `:858-870` and `:986-990`, and read `roster_status` from `player_talent_metrics` if a status is needed.

For `server/src/routes/matchups.ts:131-155` (`matchup_simulations`), either create the table (there is no migration for it; `simulate_matchups.py:2232` needs it too) or remove the route and `WinProbabilityBar.tsx`. Recommendation: remove until the Monte Carlo writer is scheduled; today it is `CATEGORY: UTILITY`, manual.

### 5.6 Fix the two broken `sys.path` inserts in `run_daily_projections.py` (10 min)

Risk removed: `sync_rosters` (writes `eligible_positions`) and `populate_gp_last_10_metric` silently skip on every manual run.

```diff
--- a/data-pipeline/projections/run_daily_projections.py
+++ b/data-pipeline/projections/run_daily_projections.py
@@ -663,3 +663,4 @@
-        scripts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts", "utilities")
+        _repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
+        scripts_dir = os.path.join(_repo_root, "scripts", "utilities")
         if scripts_dir not in sys.path:
             sys.path.insert(0, scripts_dir)
@@ -802,3 +803,4 @@
-        scripts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts", "utilities")
+        _repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
+        scripts_dir = os.path.join(_repo_root, "scripts", "utilities")
         if scripts_dir not in sys.path:
             sys.path.insert(0, scripts_dir)
```

Better: move `eligible_positions` derivation into `populate_player_directory.py`, which already runs daily, and delete the roster-sync step here.

### 5.7 Point `fetch_injury_report()` at the table that exists (15 min)

```diff
--- a/data-pipeline/projections/nightly_projection_batch.py
+++ b/data-pipeline/projections/nightly_projection_batch.py
@@ -314,16 +314,17 @@
     try:
         injuries = db.select(
-            "player_injuries",
-            select="player_id,status",
-            limit=500
+            "player_talent_metrics",
+            select="player_id,roster_status",
+            filters=[("roster_status", "not.is", "null")],
+            limit=1000
         )
         
         injury_map = {}
         if injuries:
             for inj in injuries:
-                injury_map[inj["player_id"]] = inj.get("status", "healthy")
+                injury_map[inj["player_id"]] = inj.get("roster_status") or "healthy"
```

`player_injuries` does not exist in any schema; the current code always lands in the `except` at `:329-331` and reports every player healthy. This only matters once 5.1 lets `roster_status` survive and `injury-status-sync.yml:61-62` is uncommented.

### 5.8 Decide the season rule once (30 min)

`nightly_projection_batch.py` uses `current_season()` (= 2025 today, `season_config.py:88`) and exits on an empty schedule; pg_cron `rebuild-projected-stats` uses `get_projection_target_season()` (= 2026) and has already written 66,024 rows for 2026-09-29 onward. Either give the Python batch a `--target-season` path that mirrors `get_projection_target_season()`, or retire the Python batch and let `main.yml` run only `check`-type steps. Until decided, `main.yml` will report green with no writes every night until 2026-09-29.

### 5.9 Retire the `data_pipeline` symlink and the three `scripts/utilities` bare imports (30 min)

```diff
--- a/scripts/utilities/calculate_goalie_gsax.py
+++ b/scripts/utilities/calculate_goalie_gsax.py
@@ -33,3 +33,4 @@
 _REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
 sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
+import _bootstrap  # noqa: F401,E402  registers the data_pipeline package alias
 from data_pipeline.utils.season_config import CURRENT_SEASON  # noqa: E402
```

Same one-line addition at `calculate_goalie_rebound_control.py:33-34` and `calculate_shooting_talent.py:32-33`. Then the two inline snippets:

```diff
--- a/.github/workflows/playoff-sync.yml
+++ b/.github/workflows/playoff-sync.yml
@@ -96,2 +96,3 @@
           sys.path.insert(0, 'data-pipeline')
+          import _bootstrap
           from data_pipeline.utils.supabase_rest import SupabaseRest
@@ -112,2 +113,3 @@
           sys.path.insert(0, 'data-pipeline')
+          import _bootstrap
           from data_pipeline.utils.supabase_rest import SupabaseRest
```

Then update the stale comment at `main.yml:22-25` and remove the symlink with `git rm data_pipeline` in a PR whose CI runs `pytest` and `main.yml` and `playoff-sync.yml` via `workflow_dispatch`. Checklist item already exists at `docs/CLEANUP_PLAYBOOK.md:66-73`.

### 5.10 Remove the dead Windows task installer (10 min)

`ops/windows/install_tasks.ps1:16-18` registers tasks that run `<root>/ingest_live_raw_nhl.py`, `run_extractor_live.ps1` (renamed to `DISABLED_run_extractor_live.ps1`), and `<root>/build_player_season_stats.py`. None of those paths exist. If the tasks are still registered on Garrett's machine they retry every minute up to 999 times (`:22`). Proposed: `git rm ops/windows/install_tasks.ps1 ops/windows/run_ingest_live.ps1 ops/windows/run_season_rollup.ps1 ops/windows/DISABLED_run_extractor_live.ps1` and run `ops/windows/uninstall_tasks.ps1` once on the host. Keep `install_data_scraping_service.ps1` (path at `:20` is correct).

### 5.11 Correct `playoff-sync.yml` hardcoded season (5 min)

```diff
--- a/.github/workflows/playoff-sync.yml
+++ b/.github/workflows/playoff-sync.yml
@@ -74,3 +74,3 @@
-          python data-pipeline/acquisition/ingest_playoff_schedule.py --start "$START" --end "$END" --season 2025
+          python data-pipeline/acquisition/ingest_playoff_schedule.py --start "$START" --end "$END"
```

and drop `--season 2025` at `:82` and `:88`, letting each script default to `current_season()` as `fetch_injury_status.py:547-550` does. Verify each script's `argparse` default before applying.

### 5.12 Retire `scripts/_deprecated/` and `scripts/_one_offs/` (10 min)

`git rm -r scripts/_deprecated scripts/_one_offs` after 5.10 lands (the only live reference is `DISABLED_run_extractor_live.ps1:16`). Keep `scripts/_one_offs/r4_classify_scripts.py` only if the classification headers are to be regenerated.

### 5.13 Bring `DATA_INVENTORY.md` back to true (15 min)

Stale lines observed: `:156` says `main.yml` runs `--season 2025` (removed; `main.yml:35-41`); `:160` lists `deploy-preview.yml` (no such file in `.github/workflows/`); `:163` and `:208` describe `prod_schema.sql` / `prod_cron.sql` (not in `supabase/schema/`); `:171` says 17 active production scripts (this inventory counts 13 Python entry points under GitHub Actions plus 1 daemon). Section 3.1 should list all 21 workflows and the 44 pg_cron jobs, or point here.

---

## 6. What I could not verify

1. **GitHub Actions run history.** No network from this session and `ops_ci_runs` began on 2026-09-03 04:29 UTC (earliest row). I cannot state how many times `refresh-player-directory.yml` has failed since 2026-08-07 or why; the evidence is indirect: `player_directory` season 2026 `source_last_fetched_at` max `2026-08-07 16:37:27` (a manual-run time, not the 08:15 cron minute) and the pg_cron `player_directory_target_season` check at `fail` daily since at least 2026-08-12.
2. **Whether the Windows tasks are registered on Garrett's machine.** Only the installer scripts are visible.
3. **Whether the `data_scraping_service.py` daemon is running anywhere.** Its tables last changed 2026-08-11 to 2026-08-26; offseason, so absence of writes is expected. `health_check_server.py` exposes HTTP only, no DB row.
4. **Whether `CITRUS_ALERT_SLACK_WEBHOOK` is set as a GitHub secret.** `check_data_invariants.py:17-21` and `data-freshness-check.yml:47-50` say it is unset; secrets are not readable from the repo.
5. **Runtime behaviour of any script.** Rule 2 forbade running them; all claims about "silently skips" or "always lands in except" come from reading the code plus the schema (`player_injuries`, `matchup_simulations`, `player_names`, `_moat_transfer`, `league_memberships` absent from `pg_class`; `<pipeline>/projections/scripts/utilities` absent from the filesystem).
6. **The exact insert list of `rebuild_player_projected_stats()` versus its migrations.** The live definition has 36 columns; `20260901150000_industry_standard_default_scoring.sql:354,367-369` suggests a later revision touching `projected_goals_against`. Season 2026 rows show `projected_gaa` and `projected_save_pct` non-null on all 66,024 rows although the live function body does not name them, so a default, trigger or newer body may exist. I did not resolve this.
7. **`nhl_games.status`, `period`, `period_time`, `game_time`, `series_game_number`** (read in 14 app files) are written by the daemon's `scrape_live_nhl_stats.py:197` during games; I could not confirm coverage in the offseason.
8. **Row-level correctness of pg_cron `succeeded`.** `cron.job_run_details.return_message` is "1 row" for every function-call job; it carries no row counts.

