#!/usr/bin/env python3
"""
r4_classify_scripts.py — One-time helper that injects CITRUS-CLASSIFICATION
headers into every Python / TS / SQL / MJS pipeline script per the R4 phase
of the data reorg (apps/web/docs/DATA_ORGANIZATION_AUDIT.md).

Idempotent: if a file already contains "CITRUS-CLASSIFICATION", it's skipped.

Usage (from repo root):
    python scripts/_one_offs/r4_classify_scripts.py [--dry-run]

Categories applied:
- ACTIVE: invoked by .github/workflows/, package.json, or imported by ACTIVE
- UTILITY: manual operator tool, kept available
- DEBUG-ONLY: forensics tooling, not invoked by any pipeline
- ORPHAN-SUSPECTED: no clear references found, R5 should resolve
- DEPRECATED: confirmed orphan, moved to scripts/_deprecated/ (R5 disposition)
- DESTRUCTIVE: writes/deletes that could damage prod data — extreme caution
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# ── Classification manifest ─────────────────────────────────────────
# Format: relative_path: (category, purpose, invoked, reads, writes, extra)
# extra is a free-form "notes" line shown for DESTRUCTIVE / ORPHAN-SUSPECTED.

HEADERS: dict[str, tuple[str, str, str, str, str, str]] = {

    # ── data-pipeline/acquisition/ ──────────────────────────────────
    "data-pipeline/acquisition/data_acquisition.py": (
        "ACTIVE",
        "Master scraper module — fetches PBP from NHL API and derives raw_shots feature columns (xG, pre-shot context, shooting talent)",
        "imported by data_scraping_service.py + scripts/utilities/populate_raw_shots.py",
        "NHL public API (api-web.nhle.com), models/*.joblib, raw_nhl_data",
        "raw_shots, raw_nhl_data",
        "",
    ),
    "data-pipeline/acquisition/data_scraping_service.py": (
        "ACTIVE",
        "Long-running scraper service: parallel live sync + nightly PBP processing with 100-IP rotation",
        "long-running daemon (Dockerized; deployed separately from web/api)",
        "NHL public API",
        "raw_nhl_data, raw_shots, player_game_stats, player_shifts_official",
        "",
    ),
    "data-pipeline/acquisition/fetch_nhl_stats_from_landing.py": (
        "ACTIVE",
        "Fetch per-game player stats from NHL landing endpoint (canonical NHL stats)",
        "imported by data_scraping_service.py + scrape_per_game_nhl_stats.py",
        "NHL public API (game landing endpoint)",
        "player_game_stats (nhl_* columns), goalie_gsax inputs",
        "",
    ),
    "data-pipeline/acquisition/fetch_nhl_stats_from_landing_fast.py": (
        "ACTIVE",
        "Fast/parallel variant of fetch_nhl_stats_from_landing.py for batch backfill",
        "scripts/utilities/backfill_missing_shots.py + manual catch-up runs",
        "NHL public API",
        "player_game_stats",
        "",
    ),
    "data-pipeline/acquisition/ingest_live_raw_nhl.py": (
        "ACTIVE",
        "Producer: discover games via NHL schedule, ingest LIVE/CRIT play-by-play",
        "imported by data_scraping_service.py",
        "NHL schedule + game-center API",
        "raw_nhl_data",
        "",
    ),
    "data-pipeline/acquisition/ingest_nhl_playoff_bracket.py": (
        "ACTIVE",
        "Populate NHL playoff bracket (seeds + series) from NHL API",
        ".github/workflows/playoff-sync.yml (cron */15 * * * *)",
        "NHL playoff endpoint",
        "nhl_playoff_seeds, nhl_playoff_series",
        "",
    ),
    "data-pipeline/acquisition/ingest_playoff_schedule.py": (
        "ACTIVE",
        "Fetch + insert NHL playoff game schedule",
        ".github/workflows/playoff-sync.yml (cron */15 * * * *)",
        "NHL schedule API",
        "nhl_games",
        "",
    ),
    "data-pipeline/acquisition/ingest_raw_nhl.py": (
        "ACTIVE",
        "Phase-1 fast parallel raw data ingestion from NHL API",
        "imported by data_scraping_service.py + acquisition orchestrators",
        "NHL public API",
        "raw_nhl_data",
        "",
    ),
    "data-pipeline/acquisition/ingest_shiftcharts.py": (
        "ACTIVE",
        "Ingest official NHL shift charts (per-shift intervals)",
        "imported by data_scraping_service.py + manual catch-up",
        "NHL shiftcharts endpoint",
        "player_shifts_official",
        "",
    ),
    "data-pipeline/acquisition/populate_team_stats.py": (
        "UTILITY",
        "Aggregate team defensive metrics from player_game_stats for matchup-difficulty calc",
        "manual run; not in any workflow",
        "player_game_stats",
        "team_stats (RLS-disabled — see audit)",
        "",
    ),
    "data-pipeline/acquisition/scrape_live_nhl_stats.py": (
        "ACTIVE",
        "Unified live-game stats scraper (Genesis-Data-Day hardened)",
        "imported by data_scraping_service.py",
        "NHL public API",
        "player_game_stats, nhl_games",
        "",
    ),
    "data-pipeline/acquisition/scrape_per_game_nhl_stats.py": (
        "ACTIVE",
        "Per-game stats scraper for batch backfill",
        "manual catch-up + scripts/utilities/backfill_missing_shots.py",
        "NHL public API",
        "player_game_stats",
        "",
    ),
    "data-pipeline/acquisition/sync_playoff_results.py": (
        "ACTIVE",
        "Sync playoff series wins + scoring during playoff window",
        ".github/workflows/playoff-sync.yml (cron */15 * * * *)",
        "nhl_playoff_series, player_game_stats",
        "nhl_playoff_series.wins, matchup_scoring_snapshots",
        "",
    ),

    # ── data-pipeline/projections/ ──────────────────────────────────
    "data-pipeline/projections/build_player_season_stats.py": (
        "ACTIVE",
        "Roll up per-game stats into season totals",
        "imported by nightly_projection_batch.py",
        "player_game_stats",
        "player_season_stats",
        "",
    ),
    "data-pipeline/projections/calculate_daily_projections.py": (
        "ACTIVE",
        "Compute daily fantasy projections (Citrus Projections 2.0 with Bayesian shrinkage + finishing talent)",
        "imported by nightly_projection_batch.py",
        "player_season_stats, player_talent_metrics, league_averages, models/*.joblib",
        "player_projected_stats, projection_cache",
        "",
    ),
    "data-pipeline/projections/fantasy_projection_pipeline.py": (
        "ACTIVE",
        "Top-level fantasy projection pipeline orchestrator (physical → fantasy translation)",
        "imported by nightly_projection_batch.py + run_daily_projections.py",
        "projection_cache, leagues.scoring_settings",
        "fantasy_matchup_lines",
        "",
    ),
    "data-pipeline/projections/nightly_projection_batch.py": (
        "ACTIVE",
        "Cron entrypoint for nightly projection refresh",
        ".github/workflows/main.yml (cron 0 7 * * * — daily 7am UTC / 2am ET)",
        "raw_shots, player_season_stats, player_talent_metrics",
        "player_projected_stats, projection_cache",
        "",
    ),
    "data-pipeline/projections/projection_uncertainty.py": (
        "ACTIVE",
        "Add uncertainty bands (Monte Carlo style) to point projections",
        "imported by calculate_daily_projections.py",
        "player_projected_stats",
        "player_projected_stats (uncertainty columns)",
        "",
    ),
    "data-pipeline/projections/quantify_monte_carlo_impact.py": (
        "UTILITY",
        "Analysis: quantify how much MC simulation changes projections vs point estimate",
        "manual run; backtest tool",
        "player_projected_stats",
        "(reports — no DB writes)",
        "",
    ),
    "data-pipeline/projections/quantify_uncertainty_impact.py": (
        "UTILITY",
        "Analysis: quantify uncertainty band impact on lineup decisions",
        "manual run; backtest tool",
        "player_projected_stats",
        "(reports)",
        "",
    ),
    "data-pipeline/projections/run_daily_projections.py": (
        "ACTIVE",
        "Manual entrypoint for daily projection run (mirrors nightly_projection_batch with progress UI)",
        "manual operator run",
        "(same as nightly_projection_batch)",
        "(same as nightly_projection_batch)",
        "",
    ),
    "data-pipeline/projections/sync_ppp_from_gamelog.py": (
        "ACTIVE",
        "Sync power-play points (ppp) from per-game gamelog to player_season_stats",
        "imported by nightly_projection_batch.py",
        "player_game_stats",
        "player_season_stats.ppp",
        "",
    ),

    # ── data-pipeline/scoring/ ──────────────────────────────────────
    "data-pipeline/scoring/calculate_matchup_scores.py": (
        "ACTIVE",
        "Compute fantasy matchup scores from player game logs and league scoring settings",
        "imported by run_daily_pbp_processing.py + simulate_matchups.py",
        "player_game_stats, leagues.scoring_settings",
        "matchups, matchup_scoring_snapshots",
        "",
    ),
    "data-pipeline/scoring/reconcile_player_stats.py": (
        "ACTIVE",
        "Reconcile NHL official stats against PBP-derived stats; surface discrepancies",
        "imported by run_daily_pbp_processing.py",
        "player_game_stats (nhl_* and citrus-derived columns)",
        "integrity_check_results",
        "",
    ),
    "data-pipeline/scoring/run_daily_pbp_processing.py": (
        "ACTIVE",
        "Daily PBP-processing orchestrator: ingest → derive → score",
        "data_scraping_service.py nightly cycle",
        "raw_nhl_data",
        "raw_shots, player_game_stats, matchup_scoring_snapshots",
        "",
    ),
    "data-pipeline/scoring/simulate_matchups.py": (
        "UTILITY",
        "Simulate fantasy matchups under hypothetical lineups for backtest / what-if",
        "manual analytical run",
        "player_projected_stats, leagues",
        "(reports)",
        "",
    ),

    # ── data-pipeline/monitoring/ ───────────────────────────────────
    "data-pipeline/monitoring/alerting.py": (
        "ACTIVE",
        "Centralized alert dispatch (Discord webhook + log)",
        "imported by check_data_freshness.py + verify_*.py",
        "(env vars — webhook URLs)",
        "Discord channel + stderr",
        "",
    ),
    "data-pipeline/monitoring/audit_projection_accuracy.py": (
        "ACTIVE",
        "Backtest projection accuracy vs actual results (per-position MAE)",
        "manual + scheduled monitoring",
        "player_projected_stats, player_game_stats",
        "(reports — no DB writes)",
        "",
    ),
    "data-pipeline/monitoring/check_data_freshness.py": (
        "ACTIVE",
        "Verify all critical tables have updated_at within freshness SLA; alert on stale",
        "manual + scheduled monitoring + alerting.py",
        "every analytical table's updated_at",
        "alerts (no DB writes)",
        "",
    ),
    "data-pipeline/monitoring/health_check_server.py": (
        "ACTIVE",
        "HTTP /health endpoint for Cloud Run / Docker liveness checks",
        "containerized service",
        "(in-memory state)",
        "(HTTP 200/500)",
        "",
    ),
    "data-pipeline/monitoring/monitor_data_scraping.py": (
        "ACTIVE",
        "Monitor scraper completeness — flag missing games or low row counts",
        "scheduled monitoring",
        "raw_nhl_data, raw_shots, player_game_stats",
        "alerts",
        "",
    ),
    "data-pipeline/monitoring/monitor_proxy_health.py": (
        "ACTIVE",
        "Monitor 100-IP proxy rotation health — flag dead proxies",
        "imported by data_scraping_service.py",
        "(proxy pool config)",
        "alerts + proxy-pool state",
        "",
    ),
    "data-pipeline/monitoring/run_midnight_update.py": (
        "ACTIVE",
        "Midnight update orchestrator: refresh roster_assignments, fantasy_daily_rosters",
        "scheduled (likely cron)",
        "team_lineups, leagues",
        "fantasy_daily_rosters, roster_assignments",
        "",
    ),
    "data-pipeline/monitoring/test_proxy_system.py": (
        "DEBUG-ONLY",
        "Manual proxy-rotation smoke test",
        "ad-hoc when debugging proxy issues",
        "(proxy pool)",
        "stdout",
        "",
    ),
    "data-pipeline/monitoring/verify_data_integrity.py": (
        "ACTIVE",
        "Cross-table integrity checks (orphan player_ids, FK violations, NULL rates)",
        "scheduled monitoring",
        "every analytical table",
        "integrity_check_results",
        "",
    ),
    "data-pipeline/monitoring/verify_projection_pipeline.py": (
        "ACTIVE",
        "End-to-end verification of projection pipeline outputs",
        "scheduled + post-deploy",
        "player_projected_stats, projection_cache",
        "alerts (no DB writes)",
        "",
    ),

    # ── data-pipeline/utils/ ────────────────────────────────────────
    "data-pipeline/utils/citrus_request.py": (
        "ACTIVE",
        "Throttled NHL API client with retries + proxy rotation",
        "imported by EVERY data-pipeline/acquisition/* script",
        "NHL public API",
        "(returns parsed JSON)",
        "",
    ),
    "data-pipeline/utils/proxy_health.py": (
        "ACTIVE",
        "Per-proxy health tracking (success rate, response time)",
        "imported by proxy_manager.py + monitor_proxy_health.py",
        "(proxy pool state)",
        "(in-memory state)",
        "",
    ),
    "data-pipeline/utils/proxy_manager.py": (
        "ACTIVE",
        "100-IP proxy rotation manager — picks healthy proxy per request",
        "imported by citrus_request.py",
        "(proxy pool config)",
        "(returns proxy URL)",
        "",
    ),
    "data-pipeline/utils/supabase_rest.py": (
        "ACTIVE",
        "Supabase REST API client for pipeline writes (service-role JWT)",
        "imported by EVERY data-pipeline write path",
        "(env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)",
        "(any Supabase table)",
        "",
    ),

    # ── data-pipeline/debug/ ────────────────────────────────────────
    "data-pipeline/debug/audit_mcdavid_data.py": (
        "DEBUG-ONLY",
        "Forensics: audit McDavid's data across raw_shots / player_game_stats / season totals",
        "ad-hoc when investigating data integrity",
        "raw_shots, player_game_stats, player_season_stats",
        "stdout",
        "",
    ),
    "data-pipeline/debug/check_game_2025020818.py": (
        "DEBUG-ONLY",
        "Forensics: inspect a specific game (2025020818) from a past investigation",
        "kept for reference; one-off",
        "raw_nhl_data, raw_shots",
        "stdout",
        "",
    ),
    "data-pipeline/debug/check_goals_data.py": (
        "DEBUG-ONLY",
        "Forensics: verify goals data across tables",
        "ad-hoc",
        "player_game_stats, raw_shots",
        "stdout",
        "",
    ),
    "data-pipeline/debug/check_mcdavid_game.py": (
        "DEBUG-ONLY",
        "Forensics: inspect McDavid's recent game records",
        "ad-hoc",
        "player_game_stats, raw_shots",
        "stdout",
        "",
    ),
    "data-pipeline/debug/check_nhl_games.py": (
        "DEBUG-ONLY",
        "Forensics: nhl_games table sanity check",
        "ad-hoc",
        "nhl_games",
        "stdout",
        "",
    ),
    "data-pipeline/debug/check_nhl_games_schema.py": (
        "DEBUG-ONLY",
        "Forensics: dump nhl_games column-level schema",
        "ad-hoc",
        "information_schema",
        "stdout",
        "",
    ),
    "data-pipeline/debug/check_nhl_landing_endpoint.py": (
        "DEBUG-ONLY",
        "Forensics: check NHL landing endpoint shape for a sample game",
        "ad-hoc",
        "NHL public API",
        "stdout",
        "",
    ),
    "data-pipeline/debug/check_team_abbrev.py": (
        "DEBUG-ONLY",
        "Forensics: verify team abbreviation consistency",
        "ad-hoc",
        "nhl_teams, team_mapping_config",
        "stdout",
        "",
    ),
    "data-pipeline/debug/find_all_mcdavid_mismatches.py": (
        "DEBUG-ONLY",
        "Forensics: cross-reference McDavid stats sources, find mismatches",
        "ad-hoc",
        "player_game_stats, raw_shots, NHL official stats",
        "stdout",
        "",
    ),
    "data-pipeline/debug/find_missing_game.py": (
        "DEBUG-ONLY",
        "Forensics: locate games scraped but not stat-extracted (or vice versa)",
        "ad-hoc",
        "raw_nhl_data, player_game_stats",
        "stdout",
        "",
    ),
    "data-pipeline/debug/fix_mcdavid_games.py": (
        "DESTRUCTIVE",
        "One-off fix: re-derive McDavid's specific games (writes to player_game_stats)",
        "manual fix during a past data integrity incident — DO NOT re-run blindly",
        "raw_shots, raw_nhl_data",
        "player_game_stats (UPDATEs McDavid rows)",
        "RECOVERY: prod backups; 7-day PITR available via Supabase. Verify scope before re-run.",
    ),
    "data-pipeline/debug/fix_stuck_pbp_games.py": (
        "DESTRUCTIVE",
        "One-off fix: re-process games stuck in raw_nhl_data without stats extraction",
        "manual fix during a past data integrity incident",
        "raw_nhl_data",
        "raw_shots, player_game_stats (UPDATEs)",
        "RECOVERY: prod backups; check raw_nhl_data.processed flag scope before re-run.",
    ),
    "data-pipeline/debug/verify_demo_league_complete.sql": (
        "DEBUG-ONLY",
        "SQL forensics: verify demo league has expected fixture data",
        "ad-hoc, run via Supabase SQL Editor",
        "leagues, teams, draft_picks, team_lineups",
        "stdout",
        "",
    ),
    "data-pipeline/debug/verify_mcdavid_final.py": (
        "DEBUG-ONLY",
        "Forensics: final verification step for McDavid data after a fix",
        "ad-hoc",
        "player_game_stats, raw_shots, player_season_stats",
        "stdout",
        "",
    ),

    # ── scripts/utilities/ training + canonical tools ───────────────
    "scripts/utilities/train_xg_v3.py": (
        "ACTIVE",
        "Train xG v3 model on 786K MoneyPuck + 77K Citrus PBP shots (XGBoost, AUC 0.817)",
        "manual operator run after raw_shots refresh; produces models/xg_model_moneypuck.joblib",
        "data-pipeline/data/historical/shots_2018-2024.csv, data/shots_full_features_2025.csv",
        "models/xg_model_moneypuck.joblib + feature/encoder joblibs",
        "",
    ),
    "scripts/utilities/train_xg_calibration.py": (
        "ACTIVE",
        "Train per-shot-type isotonic calibration on top of xG v3 (commit 6e18851)",
        "manual operator run after train_xg_v3.py",
        "models/xg_model_moneypuck.joblib + held-out validation shots",
        "models/xg_shot_type_calibration.joblib",
        "",
    ),
    "scripts/utilities/export_raw_shots_csv.py": (
        "ACTIVE",
        "Export prod raw_shots to CSV for training / analysis (--training flag for xG v3)",
        "manual operator run before training; documented in TRAINING_DATA_MANIFEST.md",
        "raw_shots",
        "data/shots_full_features_2025.csv",
        "",
    ),
    "scripts/utilities/populate_raw_shots.py": (
        "ACTIVE",
        "Re-derive raw_shots from raw_nhl_data (drains the extraction backlog)",
        "manual operator run; imports data_acquisition.py",
        "raw_nhl_data",
        "raw_shots",
        "",
    ),
    "scripts/utilities/process_xg_stats.py": (
        "ACTIVE",
        "Compute per-player xG aggregates from raw_shots",
        "imported by player_season_stats build path",
        "raw_shots",
        "player_season_stats.x_goals + .x_assists",
        "",
    ),
    "scripts/utilities/feature_calculations.py": (
        "ACTIVE",
        "Pre-shot feature calculations (pass_quality_score, immediacy, goalie_movement)",
        "imported by data_acquisition.py",
        "raw_nhl_data PBP events",
        "raw_shots feature columns (the 7-feature moat)",
        "",
    ),
    "scripts/utilities/calculate_player_toi.py": (
        "ACTIVE",
        "Compute per-player TOI splits by game situation (5v5, PP, PK)",
        "imported by run_daily_pbp_processing.py",
        "player_shifts",
        "player_toi_by_situation",
        "",
    ),
    "scripts/utilities/calculate_shooting_talent.py": (
        "ACTIVE",
        "Compute Bayesian per-player shooting-talent priors (input to xG v3)",
        "manual run after season completes; produces models/player_shooting_talent.joblib",
        "raw_shots",
        "models/player_shooting_talent.joblib",
        "",
    ),
    "scripts/utilities/calculate_gar_components.py": (
        "ACTIVE",
        "Compute GAR component rates (EVO/EVD/PPO/PPD/PEN) per player",
        "manual run; pipeline gap noted — defensive components currently 0 league-wide",
        "raw_shots, player_shifts, player_toi_by_situation",
        "player_gar_components",
        "",
    ),
    "scripts/utilities/calculate_gar_regression.py": (
        "ACTIVE",
        "Bayesian regression of raw GAR rates toward league means",
        "imported by calculate_gar_components.py",
        "player_gar_components.*_raw",
        "player_gar_components.*_regressed",
        "",
    ),
    "scripts/utilities/calculate_goalie_gar.py": (
        "ACTIVE",
        "Compute combined goalie G-GAR (rebound control + primary GSAx components)",
        "manual run after goalie_gsax_primary + goalie_rebound_control populated",
        "goalie_gsax_primary, goalie_rebound_control",
        "goalie_gar",
        "",
    ),
    "scripts/utilities/calculate_goalie_gsax.py": (
        "ACTIVE",
        "Compute goalie GSAx (Goals Saved Above Expected) — raw + Bayesian regressed",
        "manual run after raw_shots refresh",
        "raw_shots",
        "goalie_gsax",
        "",
    ),
    "scripts/utilities/calculate_goalie_rebound_control.py": (
        "ACTIVE",
        "Compute goalie rebound-control component (AdjRP) for G-GAR model",
        "manual run; currently produces empty output (model gap noted)",
        "raw_shots",
        "goalie_rebound_control (currently empty in prod)",
        "",
    ),
    "scripts/utilities/enhanced_flurry_adjustment.py": (
        "ACTIVE",
        "Apply flurry-adjusted xG (discount consecutive shots in scoring sequences)",
        "imported by feature_calculations.py",
        "raw_shots.xg_value",
        "raw_shots.flurry_adjusted_xg",
        "",
    ),

    # ── scripts/utilities/ analysis + utilities ─────────────────────
    "scripts/utilities/backfill_missing_shots.py": (
        "UTILITY",
        "Gap-fill helper: re-fetch shots for games missing from raw_shots",
        "manual run when monitor_data_scraping flags gaps",
        "raw_nhl_data, NHL API",
        "raw_shots",
        "",
    ),
    "scripts/utilities/backtest_vopa_model.py": (
        "UTILITY",
        "Backtest VOPA (Value Over Position Average) projection model",
        "manual analytical run",
        "player_projected_stats, player_season_stats",
        "(reports)",
        "",
    ),
    "scripts/utilities/create_xg_heatmap.py": (
        "UTILITY",
        "Generate per-player xG heatmap visualizations",
        "manual visualization tool",
        "raw_shots",
        "image files (no DB writes)",
        "",
    ),
    "scripts/utilities/deep_analyze_moneypuck_model.py": (
        "UTILITY",
        "Deep analysis: compare Citrus xG model vs MoneyPuck xG on overlapping shots",
        "manual analytical run",
        "raw_shots, MoneyPuck CSVs",
        "(reports)",
        "",
    ),
    "scripts/utilities/extractor_job.py": (
        "ACTIVE",
        "Stat extraction orchestrator (raw_nhl_data → player_game_stats)",
        "imported by data_scraping_service.py",
        "raw_nhl_data",
        "player_game_stats",
        "",
    ),
    "scripts/utilities/model_trainer.py": (
        "ACTIVE",
        "Generic model trainer wrapper used by train_xg_v3.py",
        "imported by train_xg_v3.py + train_xg_calibration.py",
        "(training CSVs)",
        "(.joblib model artifacts)",
        "",
    ),
    "scripts/utilities/populate_and_verify_league_averages.py": (
        "UTILITY",
        "Populate league_averages table + verify (used as setup-era seeder)",
        "manual run; pairs with populate_league_averages.py",
        "player_season_stats",
        "league_averages",
        "",
    ),
    "scripts/utilities/populate_goalie_names_from_api.py": (
        "UTILITY",
        "Backfill goalie names into goalie_gsax / goalie_gar from NHL API",
        "one-off; ran during initial goalie data load",
        "NHL public API",
        "goalie_gsax.goalie_name, goalie_gar.goalie_name",
        "",
    ),
    "scripts/utilities/populate_gp_last_10_metric.py": (
        "ACTIVE",
        "Daily refresh of player_talent_metrics.gp_last_10 (rolling 10-game count)",
        "scheduled daily (per CLAUDE.md note: 'Updated daily by populate_gp_last_10_metric.py')",
        "player_game_stats",
        "player_talent_metrics.gp_last_10",
        "",
    ),
    "scripts/utilities/populate_league_averages.py": (
        "UTILITY",
        "Compute + populate position-specific league averages (Bayesian shrinkage baseline)",
        "manual run after season totals stabilize",
        "player_season_stats",
        "league_averages",
        "",
    ),
    "scripts/utilities/populate_player_directory.py": (
        "ACTIVE",
        "Populate canonical player_directory from NHL roster API",
        "manual run + setup-era seeder; refreshed at season turnover",
        "NHL roster API",
        "player_directory",
        "",
    ),
    "scripts/utilities/populate_player_names_from_api.py": (
        "UTILITY",
        "Backfill player names into tables that have player_id but no name (forensics-grade fix)",
        "manual; one-off-style",
        "NHL public API, player_directory",
        "various tables (depends on invocation)",
        "",
    ),
    "scripts/utilities/populate_weekly_stats.py": (
        "ACTIVE",
        "Roll up player_game_stats into player_weekly_stats (Sun-Sat windows)",
        "scheduled (currently empty target table — pipeline gap noted)",
        "player_game_stats",
        "player_weekly_stats (currently 0 rows in prod)",
        "",
    ),
    "scripts/utilities/run_projections_with_progress.py": (
        "UTILITY",
        "Manual projection run with progress bar (operator-facing wrapper)",
        "manual operator tool",
        "(same as run_daily_projections)",
        "(same as run_daily_projections)",
        "",
    ),
    "scripts/utilities/run_shiftcharts_with_progress.py": (
        "UTILITY",
        "Manual shiftchart ingest with progress bar",
        "manual operator tool",
        "NHL shiftcharts endpoint",
        "player_shifts_official",
        "",
    ),
    "scripts/utilities/run_week_projections.py": (
        "UTILITY",
        "Manual weekly projection run for a specific week range",
        "manual operator tool",
        "(same as nightly_projection_batch)",
        "(same as nightly_projection_batch)",
        "",
    ),
    "scripts/utilities/show_feature_importance.py": (
        "UTILITY",
        "Visualize XGBoost feature importance for the current xG model",
        "manual analytical tool",
        "models/xg_model_moneypuck.joblib",
        "stdout / chart",
        "",
    ),
    "scripts/utilities/sync_rosters.py": (
        "UTILITY",
        "Sync fantasy team rosters with current NHL rosters",
        "manual run when teams change",
        "team_lineups, NHL roster API",
        "team_lineups",
        "",
    ),
    "scripts/utilities/validate_xg_accuracy.py": (
        "UTILITY",
        "Validate xG model accuracy on held-out shots (reports AUC, Brier, log loss)",
        "manual run after retrain",
        "raw_shots, models/*.joblib",
        "(reports)",
        "",
    ),
    "scripts/utilities/validation_utils.py": (
        "ACTIVE",
        "Shared validation helpers (imported by validate_xg_accuracy + others)",
        "imported by validate_xg_accuracy.py",
        "(varies)",
        "(returns metrics)",
        "",
    ),
    "scripts/utilities/visualization_utils.py": (
        "UTILITY",
        "Shared chart helpers used by analytical scripts",
        "imported by create_xg_heatmap + zone_heatmap + show_feature_importance",
        "(varies)",
        "(image files)",
        "",
    ),
    "scripts/utilities/xa_model_trainer.py": (
        "ACTIVE",
        "Train xA (Expected Assists) model — sibling to xG v3",
        "manual operator run",
        "data-pipeline/data/historical/* + raw_shots",
        "models/xa_model.joblib + xa_model_features.joblib",
        "",
    ),
    "scripts/utilities/zone_heatmap.py": (
        "UTILITY",
        "Per-zone shot heatmap visualization (slot, low slot, high slot, point, boards)",
        "manual visualization tool",
        "raw_shots",
        "image files",
        "",
    ),

    # ── scripts/maintenance/ ────────────────────────────────────────
    "scripts/maintenance/archive_to_csv.py": (
        "UTILITY",
        "Archive old prod tables to CSV files (for retention / cold-storage moves)",
        "manual; preserved for retention work that isn't currently scheduled",
        "(any table)",
        "CSV files at user-specified path",
        "",
    ),

    # ── scripts/shell/ ──────────────────────────────────────────────
    "scripts/shell/RUN_FULL_BACKTEST.sh": (
        "UTILITY",
        "Full backtest harness (Linux/macOS) — runs validate_xg_accuracy + variants over multiple seasons",
        "manual operator run",
        "models/*.joblib, raw_shots",
        "(report files)",
        "",
    ),
    "scripts/shell/RUN_FULL_BACKTEST.bat": (
        "UTILITY",
        "Full backtest harness (Windows) — equivalent of RUN_FULL_BACKTEST.sh",
        "manual operator run on Windows",
        "(same as .sh)",
        "(same as .sh)",
        "",
    ),

    # ── scripts/ root TS + JS ───────────────────────────────────────
    "scripts/audit_rls.ts": (
        "ACTIVE",
        "Verify RLS is enabled on every table; fail loudly if not",
        ".github/workflows/rls-audit.yml (cron 0 13 * * 1 — Mondays 07:00 MT)",
        "Supabase information_schema",
        "stdout (CI fails on RLS-disabled tables)",
        "",
    ),
    "scripts/validate-migration.ts": (
        "ACTIVE",
        "Pre-deploy migration validator (npm run validate-migration)",
        "package.json scripts; CI gate",
        "supabase/migrations/*.sql",
        "stdout",
        "",
    ),
    "scripts/test-migrations.ts": (
        "ACTIVE",
        "End-to-end migration smoke test (npm run test-migrations)",
        "package.json scripts; CI gate",
        "supabase/migrations/*.sql",
        "stdout",
        "",
    ),
    "scripts/apply-migration.ts": (
        "UTILITY",
        "Manual migration applier with confirmation prompt",
        "manual operator tool when supabase CLI unavailable",
        "supabase/migrations/*.sql",
        "Supabase migrations table",
        "",
    ),
    "scripts/backfill-daily-rosters.ts": (
        "UTILITY",
        "Backfill fantasy_daily_rosters for a date range (gap-fill helper)",
        "manual run after migration 20260111000000 fix",
        "team_lineups, leagues",
        "fantasy_daily_rosters",
        "",
    ),
    "scripts/check_draft_freeze.ts": (
        "UTILITY",
        "Check draft freeze state for a league (debugging tool)",
        "manual run when investigating draft state",
        "leagues, draft_events",
        "stdout",
        "",
    ),
    "scripts/env.ts": (
        "ACTIVE",
        "Shared env loading + validation for TS scripts",
        "imported by every TS script in scripts/",
        "(.env files)",
        "(returns validated config)",
        "",
    ),
    # ── Deprecated (moved 2026-05-05 by R5 dispositions) ────────────
    "scripts/_deprecated/fetch-nhl-players.ts": (
        "DEPRECATED",
        "Fetch NHL player metadata (setup-era TS one-off, kept for reference)",
        "(none — moved out of scripts/ root by R5)",
        "NHL API",
        "(early-era table; not invoked)",
        "Superseded by data-pipeline/acquisition/data_acquisition.py + scripts/utilities/populate_player_directory.py. See scripts/_deprecated/README.md.",
    ),
    "scripts/_deprecated/fetch-nhl-schedule.ts": (
        "DEPRECATED",
        "Fetch NHL schedule (setup-era TS one-off, kept for reference)",
        "(none — moved out of scripts/ root by R5)",
        "NHL API",
        "(not invoked)",
        "Superseded by data-pipeline/acquisition/ingest_playoff_schedule.py + the schedule discovery in data_scraping_service.py.",
    ),
    "scripts/_deprecated/import-schedule-from-csv.ts": (
        "DEPRECATED",
        "Import schedule from CSV (one-off setup tool, kept for reference)",
        "(none — moved out of scripts/ root by R5)",
        "user-supplied CSV",
        "(not invoked)",
        "No current canonical replacement — was a one-time offline-import path during initial setup.",
    ),
    "scripts/_deprecated/import-schedule-from-excel.ts": (
        "DEPRECATED",
        "Import schedule from Excel (one-off setup tool, kept for reference)",
        "(none — moved out of scripts/ root by R5)",
        "user-supplied .xlsx",
        "(not invoked)",
        "No current canonical replacement — was a one-time offline-import path during initial setup.",
    ),
    "scripts/_deprecated/delete-all-draft-data.sql": (
        "DEPRECATED",
        "Wipe all draft data (functional near-duplicate of nuke-all-draft-data.sql)",
        "(none — moved out of scripts/ root by R5)",
        "(none)",
        "(not invoked)",
        "Superseded by scripts/nuke-all-draft-data.sql which uses a safer WHERE clause on the leagues UPDATE. See scripts/_deprecated/README.md.",
    ),
    "scripts/populate-nhl-teams-and-normalize.ts": (
        "UTILITY",
        "Populate nhl_teams + normalize team abbreviations (setup-era seeder)",
        "manual run during initial setup; team_mapping_config maintained separately",
        "NHL teams API",
        "nhl_teams, team_mapping_config",
        "",
    ),
    "scripts/scan-pipeline-tables.ts": (
        "UTILITY",
        "Inventory tables touched by data-pipeline scripts (analysis tool)",
        "manual run; useful for onboarding",
        "(static analysis of data-pipeline/)",
        "stdout",
        "",
    ),
    "scripts/test-lineup-integration.ts": (
        "UTILITY",
        "Integration smoke test for lineup state machine",
        "manual run when changing lineup logic",
        "team_lineups, leagues",
        "stdout",
        "",
    ),
    "scripts/verify-and-add-profile-columns.sql": (
        "UTILITY",
        "One-off SQL: verify + conditionally add profile columns",
        "manual run via Supabase SQL Editor",
        "profiles",
        "profiles (DDL: ADD COLUMN if missing)",
        "",
    ),
    "scripts/verify-games-remaining.ts": (
        "UTILITY",
        "Verify games_remaining column is correct on player_ros_projections",
        "manual sanity check",
        "player_ros_projections, nhl_games",
        "stdout",
        "",
    ),
    "scripts/verify-roster-integrity.ts": (
        "UTILITY",
        "Verify roster integrity invariants across team_lineups and roster_assignments",
        "manual sanity check",
        "team_lineups, roster_assignments",
        "stdout",
        "",
    ),
    "scripts/verify-staging-tables.ts": (
        "UTILITY",
        "Verify staging-environment tables match prod schema",
        "manual run during staging-deploy operator runbook",
        "Supabase staging schema",
        "stdout",
        "",
    ),

    # ── scripts/ root SQL — DESTRUCTIVE family ──────────────────────
    "scripts/nuke-all-draft-data.sql": (
        "DESTRUCTIVE",
        "Wipe all draft-related rows across all leagues",
        "manual via Supabase SQL Editor; review before run",
        "(none)",
        "draft_picks (DELETE all), draft_order (DELETE all), leagues.draft_status (UPDATE in_progress|completed → not_started)",
        "RECOVERY: Supabase 7-day PITR. Take a backup before running. Note: does NOT touch draft_events / draft_picks_v2 / draft_queues — earlier headers were aspirational; corrected per R5 §7.7 audit.",
    ),
    "scripts/nuke-all-teams-comprehensive.sql": (
        "DESTRUCTIVE",
        "Wipe all teams + cascade dependents (team_lineups, roster_assignments, etc.)",
        "manual via Supabase SQL Editor; review before run",
        "(none)",
        "teams + cascading deletes across multiple tables",
        "RECOVERY: Supabase 7-day PITR. Take a backup before running.",
    ),
    "scripts/nuke-and-reset-teams.sql": (
        "DESTRUCTIVE",
        "Wipe + recreate teams from scratch for a league",
        "manual via Supabase SQL Editor; review before run",
        "(none)",
        "teams (DELETE + INSERT)",
        "RECOVERY: PITR + manual re-seeding via populate-nhl-teams-and-normalize.ts.",
    ),
    # scripts/delete-all-draft-data.sql moved to scripts/_deprecated/ during
    # R5 dispositions (2026-05-05). Manifest entry now lives in the
    # _deprecated section above with DEPRECATED category.
    "scripts/complete-draft-reset.sql": (
        "DESTRUCTIVE",
        "Full draft reset (combination of delete-all-draft-data + reset draft state)",
        "manual via Supabase SQL Editor; review before run",
        "(none)",
        "draft_events, draft_picks, draft_order, draft_queues, leagues.draft_state",
        "RECOVERY: PITR.",
    ),
    "scripts/cleanup-duplicate-teams.sql": (
        "DESTRUCTIVE",
        "Remove duplicate teams discovered via dedupe query",
        "manual via Supabase SQL Editor; review before run",
        "teams (SELECT for dedupe)",
        "teams (DELETE duplicates)",
        "RECOVERY: PITR.",
    ),
    "scripts/cleanup-duplicate-teams-simple.sql": (
        "DESTRUCTIVE",
        "Simpler variant of cleanup-duplicate-teams.sql",
        "manual via Supabase SQL Editor; review before run",
        "teams",
        "teams (DELETE duplicates)",
        "RECOVERY: PITR.",
    ),
    "scripts/quick-reset-by-email.sql": (
        "DESTRUCTIVE",
        "Reset a single user by email (wipe their leagues/teams/picks)",
        "manual; one-off support tool",
        "auth.users",
        "Multiple tables — DELETEs scoped to one user_id",
        "RECOVERY: PITR. Verify email scope before run.",
    ),
    "scripts/reset-league-teams.sql": (
        "DESTRUCTIVE",
        "Reset teams for a single league (preserving the league row)",
        "manual via Supabase SQL Editor",
        "leagues",
        "teams, team_lineups, roster_assignments — scoped DELETEs",
        "RECOVERY: PITR.",
    ),
    "scripts/reset-user-profile.sql": (
        "DESTRUCTIVE",
        "Reset a user's profile back to default state",
        "manual support tool",
        "auth.users",
        "profiles, user-scoped writes — DELETEs/UPDATEs",
        "RECOVERY: PITR.",
    ),

    # ── scripts/ root SQL — non-destructive ─────────────────────────
    "scripts/add-profile-columns.sql": (
        "UTILITY",
        "Pre-migration: add columns to profiles (idempotent ADD COLUMN IF NOT EXISTS)",
        "manual via Supabase SQL Editor",
        "profiles",
        "profiles (DDL: ADD COLUMN)",
        "",
    ),
    "scripts/ensure-profile-columns.sql": (
        "UTILITY",
        "Idempotent variant of add-profile-columns.sql",
        "manual via Supabase SQL Editor",
        "profiles",
        "profiles (DDL: ADD COLUMN IF NOT EXISTS)",
        "",
    ),
    "scripts/find-my-league-id.sql": (
        "UTILITY",
        "Look up a user's league_id by email (debug helper)",
        "manual query during support",
        "auth.users, leagues, teams",
        "stdout",
        "",
    ),
    "scripts/fix-profiles-table.sql": (
        "UTILITY",
        "Fix profiles table schema drift (one-off DDL repair)",
        "manual via Supabase SQL Editor; one-off",
        "profiles",
        "profiles (DDL fixes)",
        "",
    ),
    "scripts/test-team-insert.sql": (
        "UTILITY",
        "Test team INSERT against current RLS policies",
        "manual debugging",
        "teams",
        "teams (test row)",
        "",
    ),
    "scripts/test-teams-visibility.sql": (
        "UTILITY",
        "Verify team visibility under different RLS contexts",
        "manual debugging",
        "teams",
        "stdout",
        "",
    ),
}


def render_header(
    category: str,
    purpose: str,
    invoked: str,
    reads: str,
    writes: str,
    extra: str,
    last_active: str,
    comment_prefix: str,
) -> str:
    bar = "─" * 60
    lines = [
        f"{comment_prefix} CITRUS-CLASSIFICATION {bar}",
        f"{comment_prefix} CATEGORY: {category}",
        f"{comment_prefix} Purpose:     {purpose}",
        f"{comment_prefix} Last active: {last_active}",
        f"{comment_prefix} Invoked:     {invoked}",
        f"{comment_prefix} Reads:       {reads}",
        f"{comment_prefix} Writes:      {writes}",
    ]
    if extra:
        lines.append(f"{comment_prefix} Note:        {extra}")
    lines.append(f"{comment_prefix} {bar}")
    return "\n".join(lines) + "\n"


def comment_prefix_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".py", ".sh"}:
        return "#"
    if suffix in {".bat"}:
        return "REM"
    if suffix in {".ts", ".js", ".mjs", ".tsx", ".jsx"}:
        return "//"
    if suffix in {".sql"}:
        return "--"
    raise ValueError(f"Unsupported extension {suffix} for {path}")


_CLASSIFICATION_SUBJECT_TOKENS = (
    # Anything that mentions the per-script header system
    "CITRUS-CLASSIFICATION",
    # R4 phase commit subjects (initial + patches)
    "R4 — classify",
    "R4: classify",
    "R4 patch",
    "classify pipeline + utility scripts",
    # R5 phase commit subjects (audit doc + dispositions)
    "R5 — orphan triage",
    "R5 — orphan",
    "R5 dispositions",
    "Last active date field",
    # Forward compatibility — any future reorg phase committing to the
    # classification system should add its subject signature here.
)


def git_last_active(rel_path: str) -> str:
    """Return YYYY-MM-DD of the most recent meaningful commit touching this
    file, skipping commits whose subject is the R4 classification work
    itself. Returns "(uncommitted)" if git has no record."""
    import subprocess
    try:
        # Walk recent commits; first whose subject isn't a classification
        # commit wins. -10 is plenty given how rarely scripts churn.
        # encoding='utf-8' is critical on Windows: git emits UTF-8, but
        # text=True without explicit encoding falls back to cp1252 which
        # mangles em-dashes and breaks subject token matching.
        result = subprocess.run(
            ["git", "log", "--format=%cs%x09%s", "-10", "--", rel_path],
            cwd=REPO_ROOT,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        out = result.stdout.strip()
        if not out:
            return "(uncommitted)"
        for line in out.splitlines():
            if "\t" not in line:
                continue
            date, subject = line.split("\t", 1)
            if any(tok in subject for tok in _CLASSIFICATION_SUBJECT_TOKENS):
                continue
            return date
        # Every recent commit was a classification commit (file unchanged
        # since classification first ran). Return oldest seen date.
        return out.splitlines()[-1].split("\t", 1)[0]
    except Exception:
        return "(unknown)"


# Match a previously-injected CITRUS-CLASSIFICATION block of any of the four
# supported comment styles, from the opening "CITRUS-CLASSIFICATION" line
# through the closing horizontal-bar line. Multiline + dotall.
import re
_BLOCK_RE = re.compile(
    r"(?:^[ \t]*(?:#|//|--|REM)[^\n]*CITRUS-CLASSIFICATION[^\n]*\n"
    r"(?:[ \t]*(?:#|//|--|REM)[^\n]*\n)+?"
    r"[ \t]*(?:#|//|--|REM)[^\n]*─{20,}[^\n]*\n)",
    re.MULTILINE,
)


def upsert_header(content: str, header: str) -> tuple[str, bool]:
    """If a CITRUS-CLASSIFICATION block is already present, replace it with
    `header` (refresh). Otherwise insert `header` after the shebang line.

    Returns (new_content, was_replaced). was_replaced=True means an existing
    block was found and refreshed; False means the file was newly classified."""
    match = _BLOCK_RE.search(content)
    if match:
        new_content = content[: match.start()] + header + content[match.end() :]
        return new_content, True
    # No existing block — insert after shebang if present, else at top
    lines = content.splitlines(keepends=True)
    if lines and lines[0].startswith("#!"):
        return "".join(lines[:1]) + header + "".join(lines[1:]), False
    return header + content, False


def main(dry_run: bool = False) -> None:
    injected = 0
    refreshed = 0
    missing = []
    for rel_path, fields in HEADERS.items():
        category, purpose, invoked, reads, writes, extra = fields
        path = REPO_ROOT / rel_path
        if not path.exists():
            missing.append(rel_path)
            continue
        prefix = comment_prefix_for(path)
        last_active = git_last_active(rel_path)
        header = render_header(category, purpose, invoked, reads, writes, extra, last_active, prefix)
        original = path.read_text(encoding="utf-8")
        new_content, was_replaced = upsert_header(original, header)
        if new_content == original:
            continue  # no change (header byte-identical to existing)
        action = "REF" if was_replaced else "INJ"
        if dry_run:
            print(f"[DRY-{action}] {category:<20s} {rel_path} (last active {last_active})")
        else:
            path.write_text(new_content, encoding="utf-8")
            print(f"[{action}] {category:<20s} {rel_path} (last active {last_active})")
        if was_replaced:
            refreshed += 1
        else:
            injected += 1
    print()
    print(f"Total entries in manifest: {len(HEADERS)}")
    print(f"Newly injected: {injected}")
    print(f"Refreshed:      {refreshed}")
    if missing:
        print(f"Missing files ({len(missing)}):")
        for p in missing:
            print(f"  - {p}")


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
