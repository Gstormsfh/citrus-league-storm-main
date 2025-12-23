#!/usr/bin/env python3
"""
verify_flurry_inputs.py

Verify that all required inputs for flurry adjustment are properly populated.
"""

import pandas as pd
import numpy as np

def verify_flurry_inputs(csv_path='data/our_shots_2025.csv'):
    """Verify all required inputs for flurry adjustment."""
    print("=" * 80)
    print("VERIFYING FLURRY ADJUSTMENT INPUTS")
    print("=" * 80)
    
    # Load data
    print(f"\n📁 Loading data from: {csv_path}")
    try:
        df = pd.read_csv(csv_path)
        print(f"✅ Loaded {len(df):,} shots")
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        return False
    
    # Required columns for flurry adjustment
    # Check for xG column (could be xG_Value, xg_value, xg_value, etc.)
    xg_col = None
    for col in ['xG_Value', 'xg_value', 'xg_Value', 'xG_value', 'predicted_xg']:
        if col in df.columns:
            xg_col = col
            break
    
    required_columns = {
        'game_id': 'Game ID',
        'team_code': 'Team Code (shooting team)',
        'period': 'Period number',
        'time_in_period': 'Time in period (MM:SS format)',
        'time_since_last_event': 'Time since last event (seconds)',
    }
    
    if xg_col:
        required_columns[xg_col] = 'Base xG value'
    else:
        required_columns['xG_Value'] = 'Base xG value (MISSING - checking alternatives)'
    
    print("\n" + "=" * 80)
    print("COLUMN PRESENCE CHECK")
    print("=" * 80)
    
    all_present = True
    for col, description in required_columns.items():
        if col in df.columns:
            print(f"✅ {col:30s} ({description}) - PRESENT")
        else:
            print(f"❌ {col:30s} ({description}) - MISSING")
            all_present = False
    
    if not all_present:
        print("\n❌ Some required columns are missing!")
        return False
    
    print("\n" + "=" * 80)
    print("DATA QUALITY CHECK")
    print("=" * 80)
    
    # Check for missing values
    print("\n📊 Missing Values:")
    for col, description in required_columns.items():
        missing = df[col].isna().sum()
        missing_pct = (missing / len(df)) * 100
        if missing > 0:
            print(f"  ⚠️  {col:30s}: {missing:6,} missing ({missing_pct:5.2f}%)")
        else:
            print(f"  ✅ {col:30s}: No missing values")
    
    # Check data types and formats
    print("\n📊 Data Type & Format Check:")
    
    # game_id: Should be integer
    if df['game_id'].dtype in ['int64', 'int32', 'float64']:
        print(f"  ✅ game_id: {df['game_id'].dtype} (valid)")
    else:
        print(f"  ⚠️  game_id: {df['game_id'].dtype} (expected integer)")
    
    # team_code: Should be string
    if df['team_code'].dtype == 'object':
        print(f"  ✅ team_code: {df['team_code'].dtype} (valid)")
        unique_teams = df['team_code'].nunique()
        print(f"     Unique teams: {unique_teams}")
    else:
        print(f"  ⚠️  team_code: {df['team_code'].dtype} (expected string)")
    
    # period: Should be integer
    if df['period'].dtype in ['int64', 'int32', 'float64']:
        print(f"  ✅ period: {df['period'].dtype} (valid)")
        periods = sorted(df['period'].unique())
        print(f"     Periods: {periods}")
    else:
        print(f"  ⚠️  period: {df['period'].dtype} (expected integer)")
    
    # time_in_period: Should be string in MM:SS format
    if df['time_in_period'].dtype == 'object':
        # Check format
        sample_times = df['time_in_period'].dropna().head(10)
        valid_format = sample_times.str.contains(r'^\d{1,2}:\d{2}$', na=False).all()
        if valid_format:
            print(f"  ✅ time_in_period: String in MM:SS format (valid)")
        else:
            print(f"  ⚠️  time_in_period: String but may not be in MM:SS format")
            print(f"     Sample values: {sample_times.tolist()[:5]}")
    else:
        print(f"  ⚠️  time_in_period: {df['time_in_period'].dtype} (expected string MM:SS)")
    
    # time_since_last_event: Should be numeric (seconds)
    if df['time_since_last_event'].dtype in ['int64', 'int32', 'float64']:
        print(f"  ✅ time_since_last_event: {df['time_since_last_event'].dtype} (valid)")
        zero_count = (df['time_since_last_event'] == 0).sum()
        zero_pct = (zero_count / len(df)) * 100
        print(f"     Zero values: {zero_count:,} ({zero_pct:.1f}%) - OK for first shots")
        non_zero = df[df['time_since_last_event'] > 0]['time_since_last_event']
        if len(non_zero) > 0:
            print(f"     Non-zero range: {non_zero.min():.2f}s to {non_zero.max():.2f}s")
    else:
        print(f"  ⚠️  time_since_last_event: {df['time_since_last_event'].dtype} (expected numeric)")
    
    # xG column: Should be numeric between 0 and 1
    if xg_col and xg_col in df.columns:
        if df[xg_col].dtype in ['int64', 'int32', 'float64']:
            print(f"  ✅ {xg_col}: {df[xg_col].dtype} (valid)")
            xg_range = (df[xg_col].min(), df[xg_col].max())
            print(f"     Range: {xg_range[0]:.4f} to {xg_range[1]:.4f}")
            if xg_range[1] > 1.0:
                print(f"     ⚠️  Warning: Some xG values > 1.0 (will be capped)")
            negative = (df[xg_col] < 0).sum()
            if negative > 0:
                print(f"     ⚠️  Warning: {negative} negative xG values")
        else:
            print(f"  ⚠️  {xg_col}: {df[xg_col].dtype} (expected numeric)")
    else:
        print(f"  ❌ xG column: NOT FOUND (checked: xG_Value, xg_value, predicted_xg)")
    
    # Check for rows that would be valid for flurry detection
    print("\n" + "=" * 80)
    print("FLURRY DETECTION READINESS")
    print("=" * 80)
    
    valid_for_flurry = (
        df['game_id'].notna() &
        df['team_code'].notna() &
        df['period'].notna() &
        df['time_in_period'].notna() &
        (df['_time_seconds'] > 0 if '_time_seconds' in df.columns else True)
    )
    
    valid_count = valid_for_flurry.sum()
    valid_pct = (valid_count / len(df)) * 100
    
    print(f"\n✅ Shots ready for flurry detection: {valid_count:,} ({valid_pct:.1f}%)")
    print(f"⚠️  Shots that will be skipped: {len(df) - valid_count:,} ({(100-valid_pct):.1f}%)")
    
    if valid_pct < 95:
        print("\n⚠️  Warning: Less than 95% of shots are ready for flurry detection")
        print("   This may indicate data quality issues")
    
    # Sample data check
    print("\n" + "=" * 80)
    print("SAMPLE DATA CHECK")
    print("=" * 80)
    
    print("\nSample of shots (first 5):")
    sample_cols = ['game_id', 'team_code', 'period', 'time_in_period', 'time_since_last_event']
    if xg_col:
        sample_cols.append(xg_col)
    if all(col in df.columns for col in sample_cols):
        print(df[sample_cols].head().to_string())
    else:
        print("⚠️  Some columns missing for sample display")
        print(f"   Available: {[c for c in sample_cols if c in df.columns]}")
        print(f"   Missing: {[c for c in sample_cols if c not in df.columns]}")
    
    # Check for potential flurries
    print("\n" + "=" * 80)
    print("POTENTIAL FLURRY DETECTION")
    print("=" * 80)
    
    # Parse time to seconds for analysis
    def parse_time_to_seconds(time_str):
        if pd.isna(time_str) or ':' not in str(time_str):
            return 0
        try:
            parts = str(time_str).split(':')
            return int(parts[0]) * 60 + int(parts[1])
        except:
            return 0
    
    df_check = df[valid_for_flurry].copy()
    df_check['_time_seconds'] = df_check['time_in_period'].apply(parse_time_to_seconds)
    
    # Group by game, team, period and check for shots within 3 seconds
    flurry_candidates = 0
    for (game_id, team_code, period), group in df_check.groupby(['game_id', 'team_code', 'period']):
        if len(group) < 2:
            continue
        group_sorted = group.sort_values('_time_seconds')
        for i in range(1, len(group_sorted)):
            time_diff = group_sorted.iloc[i]['_time_seconds'] - group_sorted.iloc[i-1]['_time_seconds']
            if 0 < time_diff <= 3.0:
                flurry_candidates += 1
    
    print(f"\n📊 Potential flurry sequences detected: {flurry_candidates:,}")
    print(f"   (Shots within 3 seconds of previous shot, same team/game/period)")
    
    print("\n" + "=" * 80)
    print("✅ VERIFICATION COMPLETE")
    print("=" * 80)
    
    return True

if __name__ == "__main__":
    verify_flurry_inputs()

