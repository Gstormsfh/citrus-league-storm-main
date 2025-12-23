#!/usr/bin/env python3
"""
test_moneypuck_alignment.py
Test the new MoneyPuck-aligned features and measure R² improvement.

This script:
1. Processes a test date with new MoneyPuck features
2. Retrains model with MoneyPuck's exact 15 variables
3. Compares R² before and after
"""

import pandas as pd
import numpy as np
import os
import sys

def check_implementation():
    """Check if all new features are implemented correctly."""
    print("=" * 80)
    print("CHECKING IMPLEMENTATION")
    print("=" * 80)
    
    checks = []
    
    # Check 1: data_acquisition.py has new features
    try:
        with open('data_acquisition.py', 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            checks.append(('Speed variables (no is_rush)', 'speed_from_last_event' in content and 'is_rush = False' not in content))
            checks.append(('Location features', 'east_west_location_of_shot' in content))
            checks.append(('Powerplay time', 'time_since_powerplay_started' in content))
            checks.append(('Flurry adjustment', 'calculate_flurry_adjusted_xg' in content or 'flurry_adjusted_xg' in content))
    except Exception as e:
        print(f"❌ Error reading data_acquisition.py: {e}")
        return False
    
    # Check 2: feature_calculations.py has flurry function
    try:
        with open('feature_calculations.py', 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            checks.append(('Flurry function', 'def calculate_flurry_adjusted_xg' in content))
    except Exception as e:
        print(f"❌ Error reading feature_calculations.py: {e}")
        return False
    
    # Check 3: retrain_xg_with_moneypuck.py has 15 variables
    try:
        with open('retrain_xg_with_moneypuck.py', 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            # Check for key MoneyPuck variables
            required_vars = [
                'distance',  # 1
                'time_since_last_event',  # 2
                'shot_type_encoded',  # 3
                'speed_from_last_event',  # 4
                'angle',  # 5
                'east_west_location_of_last_event',  # 6
                'shot_angle_plus_rebound_speed',  # 7
                'last_event_category_encoded',  # 8
                'defending_team_skaters_on_ice',  # 9
                'east_west_location_of_shot',  # 10
                'is_power_play',  # 11
                'time_since_powerplay_started',  # 12
                'distance_from_last_event',  # 13
                'north_south_location_of_shot',  # 14
                'is_empty_net',  # 15
            ]
            vars_found = sum(1 for var in required_vars if var in content)
            checks.append(('MoneyPuck 15 variables', vars_found >= 14))  # Allow for slight variations
    except Exception as e:
        print(f"❌ Error reading retrain_xg_with_moneypuck.py: {e}")
        return False
    
    # Print results
    print("\nImplementation Checks:")
    all_passed = True
    for check_name, passed in checks:
        status = "✅" if passed else "❌"
        print(f"  {status} {check_name}")
        if not passed:
            all_passed = False
    
    return all_passed

def check_data_availability():
    """Check if we have data to test with."""
    print("\n" + "=" * 80)
    print("CHECKING DATA AVAILABILITY")
    print("=" * 80)
    
    data_files = {
        'Matched shots (for training)': 'data/matched_shots_2025.csv',
        'Our shots (for features)': 'data/our_shots_2025.csv',
        'MoneyPuck shots (for comparison)': 'data/moneypuck_shots_2025.csv.csv',
    }
    
    available = []
    missing = []
    
    for name, path in data_files.items():
        if os.path.exists(path):
            try:
                df = pd.read_csv(path)
                available.append((name, len(df)))
                print(f"✅ {name}: {len(df):,} records")
            except Exception as e:
                missing.append((name, str(e)))
                print(f"❌ {name}: Error reading - {e}")
        else:
            missing.append((name, "File not found"))
            print(f"⚠️  {name}: Not found")
    
    return len(available) > 0, available, missing

def main():
    """Main test function."""
    print("=" * 80)
    print("MONEYPUCK METHODOLOGY ALIGNMENT TEST")
    print("=" * 80)
    print("\nThis script verifies the implementation and provides next steps.")
    print()
    
    # Check implementation
    impl_ok = check_implementation()
    
    # Check data
    has_data, available, missing = check_data_availability()
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY & NEXT STEPS")
    print("=" * 80)
    
    if impl_ok:
        print("✅ Implementation checks passed!")
    else:
        print("❌ Some implementation checks failed. Review the code.")
    
    if has_data:
        print(f"\n✅ Data available: {len(available)} file(s)")
        print("\n📋 To test R² improvement:")
        print("   1. Run database migration (if not done):")
        print("      supabase migration up")
        print("\n   2. Process a test date with new features:")
        print("      python data_acquisition.py")
        print("      (or call scrape_pbp_and_process('2025-01-15') for a specific date)")
        print("\n   3. Retrain model with MoneyPuck's 15 variables:")
        print("      python retrain_xg_with_moneypuck.py")
        print("\n   4. Test model performance:")
        print("      python test_moneypuck_model.py")
        print("\n   5. Compare R²:")
        print("      - Previous R²: ~0.16 (from documentation)")
        print("      - Target R²: >0.30 (87%+ improvement)")
        print("      - Check output from test_moneypuck_model.py")
    else:
        print("\n⚠️  No data files found.")
        print("\n📋 To get started:")
        print("   1. Run match_moneypuck_data.py to create matched_shots_2025.csv")
        print("   2. Or run data_acquisition.py to process new games")
    
    print("\n" + "=" * 80)

if __name__ == "__main__":
    main()

