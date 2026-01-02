#!/usr/bin/env python3
"""
run_full_diagnostics.py

Master Diagnostic Runner - Orchestrates all diagnostic modules
Generates comprehensive diagnostic report for the projection system

Usage:
    python run_full_diagnostics.py [season] [start_date] [end_date] [test_date]
    
    Default season: 2025
    Default start_date: 30 days ago
    Default end_date: today
    Default test_date: today
"""

from dotenv import load_dotenv
import os
import sys
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Any

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest
from backtest_vopa_model import (
    backtest_vopa_model,
    get_default_scoring_settings
)
from diagnostic_validation import (
    calculate_xg_log_loss,
    calculate_xg_auc,
    run_time_slice_test
)
from diagnostic_calibration import (
    check_vopa_positional_calibration,
    calculate_delta_fenwick_shooting,
    analyze_shot_location_discrepancies
)
from diagnostic_integrity import (
    detect_projection_outliers,
    validate_stat_combinations,
    audit_data_leakage
)

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)


def supabase_client() -> SupabaseRest:
    """Create Supabase client."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def generate_diagnostic_report(
    db: SupabaseRest,
    season: int,
    start_date: date,
    end_date: date,
    test_date: date
) -> Dict[str, Any]:
    """
    Run all diagnostic modules and generate comprehensive report.
    
    Returns:
        Dict with all diagnostic results and summary
    """
    print(f"\n{'='*80}")
    print(f"COMPREHENSIVE DIAGNOSTIC FRAMEWORK")
    print(f"{'='*80}")
    print(f"Season: {season}")
    print(f"Backtest Date Range: {start_date.isoformat()} to {end_date.isoformat()}")
    print(f"Test Date: {test_date.isoformat()}")
    print(f"{'='*80}\n")
    
    scoring_settings = get_default_scoring_settings()
    
    all_results = {}
    
    # Layer 1: Statistical Correlation & Error Metrics
    print(f"\n{'#'*80}")
    print(f"# LAYER 1: STATISTICAL CORRELATION & ERROR METRICS")
    print(f"{'#'*80}\n")
    
    backtest_results = backtest_vopa_model(db, start_date, end_date, season, scoring_settings)
    all_results["backtest"] = backtest_results
    
    # Layer 2: Descriptive vs. Predictive Validation
    print(f"\n{'#'*80}")
    print(f"# LAYER 2: DESCRIPTIVE VS. PREDICTIVE VALIDATION")
    print(f"{'#'*80}\n")
    
    log_loss_results = calculate_xg_log_loss(db, season)
    all_results["log_loss"] = log_loss_results
    
    auc_results = calculate_xg_auc(db, season)
    all_results["auc"] = auc_results
    
    time_slice_results = run_time_slice_test(db, test_date, season, scoring_settings)
    all_results["time_slice"] = time_slice_results
    
    # Layer 3: Positional & Contextual Calibration
    print(f"\n{'#'*80}")
    print(f"# LAYER 3: POSITIONAL & CONTEXTUAL CALIBRATION")
    print(f"{'#'*80}\n")
    
    vopa_calibration = check_vopa_positional_calibration(
        db, start_date, end_date, season, scoring_settings
    )
    all_results["vopa_calibration"] = vopa_calibration
    
    dfsh_results = calculate_delta_fenwick_shooting(db, season)
    all_results["dfsh"] = dfsh_results
    
    location_analysis = analyze_shot_location_discrepancies(db, season)
    all_results["location_analysis"] = location_analysis
    
    # Layer 4: Data Integrity Guardrails
    print(f"\n{'#'*80}")
    print(f"# LAYER 4: DATA INTEGRITY GUARDRAILS")
    print(f"{'#'*80}\n")
    
    outlier_results = detect_projection_outliers(
        db, test_date, season, scoring_settings
    )
    all_results["outliers"] = outlier_results
    
    stat_validation = validate_stat_combinations(
        db, test_date, season, scoring_settings
    )
    all_results["stat_validation"] = stat_validation
    
    leakage_audit = audit_data_leakage(
        db, test_date, season, scoring_settings
    )
    all_results["leakage_audit"] = leakage_audit
    
    # Generate Summary Report
    print(f"\n{'='*80}")
    print(f"DIAGNOSTIC SUMMARY REPORT")
    print(f"{'='*80}\n")
    
    # Statistical Metrics Summary
    if "backtest" in all_results and "error" not in all_results["backtest"]:
        backtest = all_results["backtest"]
        print(f"STATISTICAL METRICS:")
        print(f"  Pearson Correlation (r): {backtest.get('correlation_vopa_actual', 0.0):.4f}")
        if backtest.get("correlation_ci_lower"):
            print(f"    95% CI: [{backtest['correlation_ci_lower']:.4f}, {backtest['correlation_ci_upper']:.4f}]")
        print(f"  Mean Absolute Error: {backtest.get('mean_absolute_error', 0.0):.2f} points")
        if backtest.get("brier_score"):
            print(f"  Brier Score (Goalie Wins): {backtest['brier_score']:.4f}")
        print()
    
    # Descriptive Validation Summary
    if "auc" in all_results and "error" not in all_results["auc"]:
        auc = all_results["auc"]
        if "models" in auc:
            best_auc = max(
                (model_data["auc"] for model_data in auc["models"].values() if "auc" in model_data),
                default=0.0
            )
            print(f"DESCRIPTIVE VALIDATION:")
            print(f"  Best AUC: {best_auc:.4f}")
            if best_auc > 0.8:
                print(f"    Status: ✅ Excellent (AUC > 0.8)")
            elif best_auc > 0.7:
                print(f"    Status: ✓ Good (AUC > 0.7)")
            else:
                print(f"    Status: ⚠️  Needs Improvement (AUC <= 0.7)")
            print()
    
    # Predictive Validation Summary
    if "time_slice" in all_results and "error" not in all_results["time_slice"]:
        time_slice = all_results["time_slice"]
        print(f"PREDICTIVE VALIDATION:")
        print(f"  Time-Slice Correlation: {time_slice.get('correlation', 0.0):.4f}")
        if time_slice.get("leakage_detected"):
            print(f"    Status: ⚠️  DATA LEAKAGE DETECTED")
            print(f"    Reason: {time_slice.get('leakage_reason', 'Unknown')}")
        else:
            print(f"    Status: ✅ No data leakage detected")
        print()
    
    # Calibration Summary
    if "vopa_calibration" in all_results and "error" not in all_results["vopa_calibration"]:
        calibration = all_results["vopa_calibration"]
        if calibration.get("calibration_issue"):
            print(f"CALIBRATION:")
            print(f"  Status: ⚠️  CALIBRATION ISSUE DETECTED")
            print(f"  Reason: {calibration.get('calibration_reason', 'Unknown')}")
        else:
            print(f"CALIBRATION:")
            print(f"  Status: ✅ No significant calibration issues")
        print()
    
    # Integrity Summary
    if "outliers" in all_results and "error" not in all_results["outliers"]:
        outliers = all_results["outliers"]
        print(f"DATA INTEGRITY:")
        print(f"  Outliers Detected: {outliers.get('n_outliers', 0)}")
        if outliers.get("n_outliers", 0) > 0:
            print(f"    Status: ⚠️  Review flagged projections")
        else:
            print(f"    Status: ✅ No significant outliers")
    
    if "stat_validation" in all_results and "error" not in all_results["stat_validation"]:
        stat_val = all_results["stat_validation"]
        if stat_val.get("n_invalid", 0) > 0:
            print(f"  Invalid Stat Combinations: {stat_val.get('n_invalid', 0)}")
            print(f"    Status: ⚠️  Review flagged projections")
        else:
            print(f"  Invalid Stat Combinations: 0")
            print(f"    Status: ✅ All stat combinations valid")
    
    if "leakage_audit" in all_results and "error" not in all_results["leakage_audit"]:
        leakage = all_results["leakage_audit"]
        if leakage.get("leakage_detected"):
            print(f"  Data Leakage: ⚠️  DETECTED")
        else:
            print(f"  Data Leakage: ✅ None detected")
    
    print()
    
    # Actionable Recommendations
    print(f"{'='*80}")
    print(f"ACTIONABLE RECOMMENDATIONS")
    print(f"{'='*80}\n")
    
    recommendations = []
    
    # Check correlation threshold
    if "backtest" in all_results and "error" not in all_results["backtest"]:
        corr = all_results["backtest"].get("correlation_vopa_actual", 0.0)
        if corr < 0.45:
            recommendations.append(f"Correlation ({corr:.4f}) below target (0.45) - review model assumptions")
        elif corr > 0.6:
            recommendations.append(f"Correlation ({corr:.4f}) is excellent - model is performing well")
    
    # Check AUC threshold
    if "auc" in all_results and "error" not in all_results["auc"]:
        auc = all_results["auc"]
        if "models" in auc:
            best_auc = max(
                (model_data["auc"] for model_data in auc["models"].values() if "auc" in model_data),
                default=0.0
            )
            if best_auc < 0.7:
                recommendations.append(f"AUC ({best_auc:.4f}) below target (0.7) - review xG model features")
    
    # Check for calibration issues
    if "vopa_calibration" in all_results and "error" not in all_results["vopa_calibration"]:
        if all_results["vopa_calibration"].get("calibration_issue"):
            recommendations.append("Review positional weightings in league_averages table")
    
    # Check for location discrepancies
    if "location_analysis" in all_results and "error" not in all_results["location_analysis"]:
        discrepancies = all_results["location_analysis"].get("discrepancies", [])
        if len(discrepancies) > 0:
            recommendations.append("Review xG model spatial categorical variables for location discrepancies")
    
    # Check for outliers
    if "outliers" in all_results and "error" not in all_results["outliers"]:
        if all_results["outliers"].get("n_outliers", 0) > 0:
            recommendations.append("Review flagged outlier projections for data quality issues")
    
    # Check for leakage
    if "leakage_audit" in all_results and "error" not in all_results["leakage_audit"]:
        if all_results["leakage_audit"].get("leakage_detected"):
            recommendations.append("Review projection code to ensure no game-day data is used")
    
    if recommendations:
        for i, rec in enumerate(recommendations, 1):
            print(f"{i}. {rec}")
    else:
        print("✅ No critical issues detected - system is performing well")
    
    print(f"\n{'='*80}\n")
    
    return all_results


def main():
    """Main execution function."""
    db = supabase_client()
    
    # Parse command line arguments
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except:
            season = 2025
    else:
        season = 2025
    
    if len(sys.argv) > 2:
        try:
            start_date = datetime.fromisoformat(sys.argv[2]).date()
        except:
            start_date = date.today() - timedelta(days=30)
    else:
        start_date = date.today() - timedelta(days=30)
    
    if len(sys.argv) > 3:
        try:
            end_date = datetime.fromisoformat(sys.argv[3]).date()
        except:
            end_date = date.today()
    else:
        end_date = date.today()
    
    if len(sys.argv) > 4:
        try:
            test_date = datetime.fromisoformat(sys.argv[4]).date()
        except:
            test_date = date.today()
    else:
        test_date = date.today()
    
    # Run full diagnostics
    results = generate_diagnostic_report(db, season, start_date, end_date, test_date)
    
    print(f"\n{'='*80}")
    print(f"FULL DIAGNOSTIC COMPLETE")
    print(f"{'='*80}\n")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

