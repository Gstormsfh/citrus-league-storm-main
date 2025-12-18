#!/usr/bin/env python3
"""
Complete MoneyPuck Alignment Pipeline
=====================================

This script orchestrates the complete process to align our xG model with MoneyPuck:
1. Re-extract data with new features
2. Re-match with MoneyPuck
3. Retrain xG model

Prerequisites:
- Database migration must be applied first (see NEXT_STEPS.md)
- MoneyPuck data must be in data/moneypuck_shots_2025.csv.csv
"""

import sys
import os
from datetime import datetime

print("=" * 80)
print("COMPLETE MONEYPUCK ALIGNMENT PIPELINE")
print("=" * 80)
print("\nThis script will:")
print("  1. Re-extract data with new MoneyPuck-aligned features")
print("  2. Re-match shots with MoneyPuck data")
print("  3. Retrain xG model using MoneyPuck targets")
print("\n⚠️  IMPORTANT: Make sure you've applied the database migration first!")
print("   See: supabase/migrations/20250121000001_add_angle_adjusted_and_empty_net_flags.sql")
print()

response = input("Have you applied the database migration? (yes/no): ")
if response.lower() != 'yes':
    print("\n❌ Please apply the migration first, then run this script again.")
    print("   Instructions: NEXT_STEPS.md")
    sys.exit(1)

# Step 1: Re-extract data
print("\n" + "=" * 80)
print("STEP 1: RE-EXTRACT DATA WITH NEW FEATURES")
print("=" * 80)
print("\nThis will extract all shots with new features:")
print("  - shot_angle_adjusted")
print("  - home_empty_net, away_empty_net")
print("  - shooting_team_code, defending_team_code")
print()

start_date = input("Enter start date (YYYY-MM-DD) or press Enter for 2025-10-07: ").strip()
if not start_date:
    start_date = '2025-10-07'

print(f"\nExtracting data from {start_date}...")
print("(This may take 30-60 minutes for full season)")

try:
    # Call pull_season_data function
    from pull_season_data import pull_season_data
    
    print(f"Extracting data from {start_date}...")
    result = pull_season_data(start_date=start_date, cleanup_first=False)
    
    if result is None or len(result) == 0:
        print("❌ Data extraction failed or returned no data")
        print("   Check that games exist for this date range")
        sys.exit(1)
    
    print(f"✅ Data extraction complete! Extracted {len(result):,} shots")
    
except Exception as e:
    print(f"❌ Error during extraction: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Step 2: Re-match with MoneyPuck
print("\n" + "=" * 80)
print("STEP 2: RE-MATCH SHOTS WITH MONEYPUCK")
print("=" * 80)
print("\nMatching shots using spatial index + multi-factor filters...")

try:
    import pandas as pd
    from match_moneypuck_data import match_shots
    
    print("Loading data...")
    our_shots = pd.read_csv('data/our_shots_2025.csv')
    moneypuck_shots = pd.read_csv('data/moneypuck_shots_2025.csv.csv')
    
    if our_shots is None or moneypuck_shots is None or len(our_shots) == 0 or len(moneypuck_shots) == 0:
        print("❌ Failed to load data files or files are empty")
        print("   Make sure data/our_shots_2025.csv and data/moneypuck_shots_2025.csv.csv exist")
        sys.exit(1)
    
    print(f"  Our shots: {len(our_shots):,}")
    print(f"  MoneyPuck shots: {len(moneypuck_shots):,}")
    
    print("\nMatching shots...")
    matched_df = match_shots(our_shots, moneypuck_shots, coord_tolerance=1.5)
    
    if matched_df is None or len(matched_df) == 0:
        print("❌ Matching failed or returned no matches")
        sys.exit(1)
    
    print(f"✅ Matched {len(matched_df):,} shots!")
    
except FileNotFoundError as e:
    print(f"❌ Data file not found: {e}")
    print("   Make sure you've run Step 1 (data extraction) first")
    sys.exit(1)
except Exception as e:
    print(f"❌ Error during matching: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Step 3: Retrain model
print("\n" + "=" * 80)
print("STEP 3: RETRAIN xG MODEL")
print("=" * 80)
print("\nTraining XGBoost model to predict MoneyPuck xG...")

try:
    # Import and run retrain script
    import subprocess
    result = subprocess.run(
        [sys.executable, 'retrain_xg_with_moneypuck.py'],
        capture_output=False,
        text=True
    )
    
    if result.returncode != 0:
        print("❌ Model retraining failed")
        sys.exit(1)
    
    print("✅ Model retraining complete!")
    
except Exception as e:
    print(f"❌ Error during model retraining: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Summary
print("\n" + "=" * 80)
print("✅ PIPELINE COMPLETE!")
print("=" * 80)
print("\nNext steps:")
print("  1. Review model performance in retrain_xg_with_moneypuck.py output")
print("  2. Run compare_to_moneypuck.py to analyze alignment")
print("  3. Use the new model (xg_model_moneypuck.joblib) for predictions")
print("\nYour xG model is now aligned with MoneyPuck! 🎉")

