#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cleanup_excess_files.py

Comprehensive cleanup of excess files after successful diagnostic audit.
Removes old diagnostic reports, one-time fix scripts, debug scripts, and obsolete documentation.

SAFE TO RUN - Only removes files that are clearly obsolete.
"""

import os
import sys
import glob
from pathlib import Path

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")

# Files to DELETE (one-time fixes, debug scripts, old reports)
FILES_TO_DELETE = [
    # Old diagnostic reports (keep only latest)
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_140609.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_140755.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_140918.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_141033.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_142934.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_143451.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_143552.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_143832.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_144135.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_144324.md",
    "COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_144529.md",
    # Keep: COMPREHENSIVE_DIAGNOSTIC_AUDIT_20260103_145552.md (latest)
    
    # One-time diagnostic/debug scripts
    "analyze_goalie_calibration.py",
    "check_actual_game_count.py",
    "debug_fantasy_calc_failures.py",
    "diagnose_missing_projections.py",
    "diagnose_projection_matches.py",
    "diagnose_sv_pct_issue.py",
    "diagnostic_calibration.py",
    "diagnostic_integrity.py",
    "diagnostic_validation.py",
    "find_missing_game_projections.py",
    "investigate_discrepancy.py",
    "investigate_match_rate.py",
    "quick_vopa_check.py",
    "vopa_backtest_audit.py",
    
    # One-time fix/migration scripts
    "apply_moneypuck_migration.py",
    "apply_nhl_toi_migration.py",
    "apply_qoc_adjustments.py",
    "apply_shooting_talent_to_raw_shots.py",
    "complete_moneypuck_alignment.py",
    "direct_update_ppp_shp.py",
    "final_fix_game_ppp_shp.py",
    "fix_all_missing_goalies.py",
    "fix_draft_session_id.sql",
    "retry_team_xga.py",
    "recalculate_vopa_for_existing_projections.py",
    "reingest_missing_shifts.py",
    "re_extract_game.py",
    "delete_and_reinsert.py",
    
    # Test/verification scripts (keep verify_stats_completeness.py)
    "test_boxscore_consolidation.py",
    "test_consolidation_complete.py",
    "test_league_averages.py",
    "test_get_matchup_stats_rpc.sql",
    "verify_critical_checks.py",
    "verify_no_lookahead.py",
    "verify_replacement_levels.py",
    "verify_sprint1.py",
    "verify_unmatched_players.py",
    
    # Obsolete/duplicate scripts
    "backtest_vopa_model_fast.py",  # Keep backtest_vopa_model.py
    "calculate_goalie_gsax_primary.py",  # Keep calculate_goalie_gsax.py
    "run_full_diagnostics.py",  # Replaced by comprehensive_diagnostic_audit.py
    "run_quick_diagnostics.py",  # Replaced by comprehensive_diagnostic_audit.py
    
    # Old utility scripts (replaced by better versions)
    "cleanup_all_data.py",
    "cleanup_and_reset.py",
    "get_correct_backfill_range.py",
    "ensure_data_integrity.py",
    "ensure_shifts_for_all_games.py",
    "ensure_toi_for_all_games.py",
    
    # Obsolete documentation (superseded by newer docs)
    "APPLY_MIGRATION_NOW.md",
    "BACKFILL_STATUS.md",
    "BRAINSTORM_LAST_EVENT_FIX.md",
    "CALIBRATION_IMPROVEMENTS.md",
    "DIAGNOSTIC_STANDINGS_ZEROS.md",
    "DIAGNOSE_GOALIE_DATA.sql",
    "ENHANCE_FEATURE_EXTRACTION_PLAN.md",
    "EXECUTE_FEATURE_POPULATION.md",
    "FEATURE_IMPACT_COMPARISON.md",
    "FILES_TO_SAVE.md",
    "FIX_FUTURE_DATE_PROJECTIONS.md",
    "FIXES_SUMMARY.md",
    "FULL_SEASON_AUDIT_REPORT.md",
    "FULL_SEASON_RESULTS.md",
    "FULL_SEASON_TEST_RESULTS.md",
    "G_GAR_RESULTS_SUMMARY.md",
    "GAR_IMPLEMENTATION_SUMMARY.md",
    "gsax_validation_summary.md",
    "INPUT_PERCENTAGE_SUMMARY.md",
    "LAST_EVENT_TRACKING_FIX.md",
    "MODEL_PERFORMANCE_REPORT.md",
    "MODELS_STATUS.md",
    "NEXT_STEPS.md",
    "OPTIMIZATION_SUMMARY.md",
    "PIPELINE_CLEANUP.md",  # This file itself (cleanup plan, now executing)
    "PPP_SHP_FIX_SUMMARY.md",
    "PUSH_TO_69_PERCENT_PLAN.md",
    "RESULTS_COMPARISON.md",
    "RESET_SIGNUP.md",
    "SAVE_CONFIRMATION.md",
    "SHIFT_MODEL_PLAN.md",
    "SOCKET_EXHAUSTION_FIX.md",
    "SUMMARY.md",
    "TEST_MONEYPUCK_ALIGNMENT.md",
    "TODAYS_WORK_SUMMARY.md",
    "TOI_SIMPLIFICATION_PLAN.md",
    "VALIDATION_FRAMEWORK_SUMMARY.md",
    "VERIFICATION_RESULTS.md",
    "WEEKLY_STATS_FIX_INSTRUCTIONS.md",
    "WORLD_CLASS_DIAGNOSTIC_REPORT.md",
    "WORLD_CLASS_REVIEW.md",
    "WORLD_CLASS_SYSTEM_VERIFICATION.md",
    "XG_CALIBRATION_SUMMARY.md",
    "XG_VARIANTS_COMPARISON.md",
    
    # Old SQL files
    "APPLY_MIGRATION_FIRST.sql",
    "database_audit_query.sql",
]

def main():
    """Delete excess files safely."""
    deleted = []
    not_found = []
    errors = []
    
    print("="*80)
    print("CLEANUP EXCESS FILES")
    print("="*80)
    print(f"\nFiles to delete: {len(FILES_TO_DELETE)}\n")
    
    for file_path in FILES_TO_DELETE:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                deleted.append(file_path)
                print(f"[OK] Deleted: {file_path}")
            except Exception as e:
                errors.append((file_path, str(e)))
                print(f"[ERROR] Error deleting {file_path}: {e}")
        else:
            not_found.append(file_path)
    
    print("\n" + "="*80)
    print("CLEANUP SUMMARY")
    print("="*80)
    print(f"[OK] Successfully deleted: {len(deleted)} files")
    print(f"[INFO] Not found (already deleted): {len(not_found)} files")
    print(f"[ERROR] Errors: {len(errors)} files")
    
    if deleted:
        print("\nDeleted files:")
        for f in deleted:
            print(f"  - {f}")
    
    if errors:
        print("\nErrors:")
        for f, e in errors:
            print(f"  - {f}: {e}")
    
    print("\n[OK] Cleanup complete!")

if __name__ == "__main__":
    main()

