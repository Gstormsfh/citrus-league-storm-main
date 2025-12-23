#!/usr/bin/env python3
"""
cleanup_old_scripts.py

Safely moves unnecessary scripts to archive/ folder.
Run with --dry-run first to see what will be moved.
Run with --execute to actually move files.

After testing that pipeline still works, delete archive/ folder.
"""

import os
import shutil
import argparse
from pathlib import Path

# Scripts to KEEP (core pipeline + utilities)
KEEP_SCRIPTS = {
    # Master pipeline
    "run_complete_pipeline.py",
    "cleanup_old_scripts.py",
    
    # Silo 1: PBP Pipeline
    "ingest_raw_nhl.py",
    "ingest_live_raw_nhl.py",
    "extractor_job.py",
    "ingest_shiftcharts.py",
    "ensure_shifts_for_all_games.py",
    "compute_player_season_plus_minus.py",
    "populate_raw_shots.py",
    "calculate_goalie_gsax.py",
    "process_xg_stats.py",
    
    # Silo 2: Official Stats Pipeline
    "scrape_per_game_nhl_stats.py",
    
    # Shared/Support
    "supabase_rest.py",
    "build_player_season_stats.py",
    "populate_player_directory.py",
    "populate_league_averages.py",
    "verify_stats_completeness.py",
    "data_acquisition.py",
    "feature_calculations.py",
    
    # Analytics/Projections
    "calculate_daily_projections.py",
    "run_daily_projections.py",
    "fantasy_projection_pipeline.py",
    "calculate_matchup_scores.py",
    
    # XG Model
    "xa_model_trainer.py",
    "calculate_shooting_talent.py",
    "calculate_gar_components.py",
    "calculate_gar_regression.py",
    "calculate_goalie_gar.py",
    "calculate_goalie_rebound_control.py",
    "calculate_player_toi.py",
    
    # Utilities
    "zone_heatmap.py",
    "visualization_utils.py",
    "validation_utils.py",
    "export_raw_shots_csv.py",
    "create_xg_heatmap.py",
    "populate_weekly_stats.py",
}

# Patterns that indicate a script should be archived
ARCHIVE_PATTERNS = [
    "check_",
    "debug_",
    "diagnose_",
    "find_",
    "investigate_",
    "test_",
    "verify_",  # except verify_stats_completeness
    "fix_",
    "backfill_",
    "reset_",
    "force_",
    "manual_",
    "reprocess_",
    "track_",
    "monitor_",  # except monitor_ingestion
    "apply_migration",
    "compare_",
    "analyze_",
    "validate_",  # except validation_utils
    "match_moneypuck",
    "search_",
    "fetch_",  # except fetch used in pipeline
    "reverse_",
    "select_",
    "retrain_",
    "optimize_",
    "gsax_summary",
    "input_percentage",
    "pass_",
    "shot_map",
    "export_all",
    "train_",
    "update_goalie_names",
    "pull_season_data",  # use ingest_raw_nhl instead
    "resume_data",
]


def should_archive(filename: str) -> bool:
    """Determine if a file should be archived."""
    if filename in KEEP_SCRIPTS:
        return False
    
    for pattern in ARCHIVE_PATTERNS:
        if filename.startswith(pattern):
            return True
    
    # Also archive old/duplicate versions
    if "_old" in filename or "_fixed" in filename:
        return True
    
    # Archive populate_goalie_stats_from_raw_shots (replaced)
    if filename == "populate_goalie_stats_from_raw_shots.py":
        return True
    
    return False


def main():
    parser = argparse.ArgumentParser(description="Clean up old scripts")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be moved without moving")
    parser.add_argument("--execute", action="store_true", help="Actually move files to archive")
    args = parser.parse_args()
    
    if not args.dry_run and not args.execute:
        print("Please specify --dry-run or --execute")
        print("  --dry-run: See what would be moved")
        print("  --execute: Actually move files")
        return 1
    
    root = Path(__file__).parent
    archive_dir = root / "archive"
    
    if args.execute and not archive_dir.exists():
        archive_dir.mkdir()
    
    # Find all .py files in root directory
    py_files = list(root.glob("*.py"))
    
    to_archive = []
    to_keep = []
    
    for f in py_files:
        if should_archive(f.name):
            to_archive.append(f)
        else:
            to_keep.append(f)
    
    print("=" * 60)
    print("SCRIPT CLEANUP ANALYSIS")
    print("=" * 60)
    
    print(f"\nScripts to KEEP ({len(to_keep)}):")
    for f in sorted(to_keep, key=lambda x: x.name):
        print(f"  [KEEP] {f.name}")
    
    print(f"\nScripts to ARCHIVE ({len(to_archive)}):")
    for f in sorted(to_archive, key=lambda x: x.name):
        print(f"  [ARCHIVE] {f.name}")
    
    if args.execute:
        print(f"\n{'=' * 60}")
        print("MOVING FILES TO ARCHIVE...")
        print("=" * 60)
        
        moved = 0
        for f in to_archive:
            dest = archive_dir / f.name
            try:
                shutil.move(str(f), str(dest))
                print(f"  Moved: {f.name}")
                moved += 1
            except Exception as e:
                print(f"  ERROR moving {f.name}: {e}")
        
        print(f"\nMoved {moved} files to archive/")
        print("\nNext steps:")
        print("1. Test pipeline: python run_complete_pipeline.py")
        print("2. If working, delete archive/: rmdir /s archive")
    else:
        print(f"\n{'=' * 60}")
        print("DRY RUN - No files moved")
        print("Run with --execute to actually move files")
        print("=" * 60)
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
