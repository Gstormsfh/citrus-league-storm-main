#!/usr/bin/env python3
"""
Verify critical pre-run checks:
1. Std Dev NULL/0 handling
2. Date comparison logic (< vs <=)
"""

import re
import sys

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")

print("\n" + "="*80)
print("CRITICAL PRE-RUN VERIFICATION")
print("="*80 + "\n")

# Check 1: Std Dev NULL/0 handling
print("[1] Checking Std Dev NULL/0 handling in calculate_daily_projections.py...")
with open("calculate_daily_projections.py", "r", encoding="utf-8") as f:
    content = f.read()
    
    # Check for offensive Z-Score calculation
    if "if pos_std_dev_fpts_60 is not None and pos_std_dev_fpts_60 > 0:" in content:
        print("  [OK] Offensive Z-Score: NULL/0 check found")
    else:
        print("  [ERROR] Offensive Z-Score: Missing NULL/0 check!")
    
    # Check for defensive Z-Score calculation
    if "defensive_value_60_z = defensive_value_60_raw / pos_std_dev_fpts_60" in content:
        # Check if it's protected
        defensive_check = "if pos_std_dev_fpts_60 is not None and pos_std_dev_fpts_60 > 0:" in content
        if defensive_check:
            print("  [OK] Defensive Z-Score: NULL/0 check found")
        else:
            print("  [WARNING] Defensive Z-Score: Division found but may not be protected")
    else:
        print("  [WARNING] Defensive Z-Score: Calculation not found")

# Check 2: Date comparison logic
print("\n[2] Checking Date Comparison Logic in backtest_vopa_model_fast.py...")
with open("backtest_vopa_model_fast.py", "r", encoding="utf-8") as f:
    content = f.read()
    
    # Check for strict < comparison (correct)
    strict_less_than = len(re.findall(r"if log_date < game_date:", content))
    less_equal = len(re.findall(r"if log_date <= game_date:", content))
    
    if strict_less_than > 0:
        print(f"  [OK] Found {strict_less_than} instance(s) of strict '<' comparison (CORRECT)")
    else:
        print("  [ERROR] No strict '<' comparison found!")
    
    if less_equal > 0:
        print(f"  [WARNING] Found {less_equal} instance(s) of '<=' comparison (DATA LEAKAGE RISK!)")
    else:
        print("  [OK] No '<=' comparisons found (SAFE)")

print("\n" + "="*80)
print("VERIFICATION COMPLETE")
print("="*80 + "\n")

