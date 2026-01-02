#!/usr/bin/env python3
"""
run_quick_diagnostics.py

Quick Diagnostic Runner - Runs faster diagnostic tests first
This gives you results faster while the full backtest runs separately

Usage:
    python run_quick_diagnostics.py [season]
"""

from dotenv import load_dotenv
import os
import sys
from datetime import datetime, date, timedelta

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest
from diagnostic_validation import (
    calculate_xg_log_loss,
    calculate_xg_auc
)
from diagnostic_calibration import (
    calculate_delta_fenwick_shooting
)
from diagnostic_integrity import (
    validate_stat_combinations
)

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)


def supabase_client() -> SupabaseRest:
    """Create Supabase client."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


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
    
    test_date = date.today()
    scoring_settings = {
        "skater": {"goals": 3, "assists": 2, "shots_on_goal": 0.4, "blocks": 0.5},
        "goalie": {"wins": 4, "saves": 0.2, "goals_against": -1, "shutouts": 3}
    }
    
    print(f"\n{'='*80}")
    print(f"QUICK DIAGNOSTICS (Fast Tests)")
    print(f"{'='*80}")
    print(f"Season: {season}")
    print(f"Test Date: {test_date.isoformat()}")
    print(f"\nThese tests run quickly and don't require processing all games.")
    print(f"{'='*80}\n")
    
    # 1. Descriptive Testing: Log Loss (fast - just analyzes shots)
    print("\n[1/4] Running Log Loss Analysis (xG model descriptive accuracy)...")
    sys.stdout.flush()
    log_loss_results = calculate_xg_log_loss(db, season)
    
    # 2. Descriptive Testing: AUC (fast - just analyzes shots)
    print("\n[2/4] Running AUC Analysis (xG model as classifier)...")
    sys.stdout.flush()
    auc_results = calculate_xg_auc(db, season)
    
    # 3. Delta Fenwick Shooting % (fast - just analyzes shots)
    print("\n[3/4] Running Delta Fenwick Shooting % Analysis...")
    sys.stdout.flush()
    dfsh_results = calculate_delta_fenwick_shooting(db, season)
    
    # 4. Stat Combination Validation (fast - just checks today's projections)
    print("\n[4/4] Running Stat Combination Validation...")
    sys.stdout.flush()
    stat_validation = validate_stat_combinations(
        db, test_date, season, scoring_settings
    )
    
    print(f"\n{'='*80}")
    print(f"QUICK DIAGNOSTICS COMPLETE")
    print(f"{'='*80}\n")
    print("Next step: Run the full backtest separately:")
    print("  python backtest_vopa_model.py 2025-12-01 2025-12-31 2025")
    print("\n")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

