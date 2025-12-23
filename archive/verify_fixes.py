#!/usr/bin/env python3
"""
verify_fixes.py

Verify that the fixes for speed_from_last_event, time_since_powerplay_started,
and distance_from_last_event are working correctly.
"""

import pandas as pd
import numpy as np

def verify_fixes(csv_path='data/our_shots_2025.csv'):
    """Verify fixes are working."""
    print("=" * 80)
    print("VERIFYING FIXES FOR 'NEEDS ATTENTION' ITEMS")
    print("=" * 80)
    
    # Load data
    print(f"\n📁 Loading data from: {csv_path}")
    try:
        df = pd.read_csv(csv_path)
        print(f"✅ Loaded {len(df):,} shots")
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        return False
    
    total_shots = len(df)
    
    # ============================================================================
    # FIX 1: speed_from_last_event
    # ============================================================================
    print("\n" + "=" * 80)
    print("FIX 1: speed_from_last_event")
    print("=" * 80)
    
    if 'speed_from_last_event' in df.columns:
        missing = df['speed_from_last_event'].isna().sum()
        missing_pct = (missing / total_shots) * 100
        present_pct = 100 - missing_pct
        
        zeros = (df['speed_from_last_event'] == 0).sum()
        zeros_pct = (zeros / total_shots) * 100
        non_zero_pct = 100 - zeros_pct - missing_pct
        
        print(f"\n📊 Coverage:")
        print(f"   ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
        print(f"   ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
        print(f"   📊 Non-zero: {non_zero_pct:6.2f}% ({total_shots - missing - zeros:,} shots)")
        print(f"   🔢 Zero values: {zeros_pct:6.2f}% ({zeros:,} shots)")
        
        if present_pct >= 99.0:
            print(f"\n✅ PASS: speed_from_last_event is present for {present_pct:.1f}% of shots")
        else:
            print(f"\n❌ FAIL: speed_from_last_event is only present for {present_pct:.1f}% of shots")
        
        if non_zero_pct > 0:
            non_zero = df[df['speed_from_last_event'] > 0]['speed_from_last_event']
            print(f"\n📈 Non-zero speed statistics:")
            print(f"   Min: {non_zero.min():.4f}")
            print(f"   Max: {non_zero.max():.4f}")
            print(f"   Mean: {non_zero.mean():.4f}")
            print(f"   Median: {non_zero.median():.4f}")
    else:
        print("\n❌ Column 'speed_from_last_event' NOT FOUND")
    
    # ============================================================================
    # FIX 2: time_since_powerplay_started
    # ============================================================================
    print("\n" + "=" * 80)
    print("FIX 2: time_since_powerplay_started")
    print("=" * 80)
    
    if 'time_since_powerplay_started' in df.columns:
        missing = df['time_since_powerplay_started'].isna().sum()
        missing_pct = (missing / total_shots) * 100
        present_pct = 100 - missing_pct
        
        zeros = (df['time_since_powerplay_started'] == 0).sum()
        zeros_pct = (zeros / total_shots) * 100
        non_zero_pct = 100 - zeros_pct - missing_pct
        
        print(f"\n📊 Coverage:")
        print(f"   ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
        print(f"   ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
        print(f"   📊 Non-zero: {non_zero_pct:6.2f}% ({total_shots - missing - zeros:,} shots)")
        print(f"   🔢 Zero values: {zeros_pct:6.2f}% ({zeros:,} shots)")
        
        if present_pct >= 99.0:
            print(f"\n✅ PASS: time_since_powerplay_started is present for {present_pct:.1f}% of shots")
        else:
            print(f"\n❌ FAIL: time_since_powerplay_started is only present for {present_pct:.1f}% of shots")
        
        if non_zero_pct > 0:
            non_zero = df[df['time_since_powerplay_started'] > 0]['time_since_powerplay_started']
            print(f"\n📈 Non-zero powerplay time statistics:")
            print(f"   Min: {non_zero.min():.2f}s")
            print(f"   Max: {non_zero.max():.2f}s")
            print(f"   Mean: {non_zero.mean():.2f}s")
            print(f"   Median: {non_zero.median():.2f}s")
            
            # Check correlation with is_power_play
            if 'is_power_play' in df.columns:
                pp_shots = df[df['is_power_play'] == 1]
                pp_with_time = pp_shots[pp_shots['time_since_powerplay_started'] > 0]
                print(f"\n📊 Powerplay shots analysis:")
                print(f"   Total powerplay shots: {len(pp_shots):,}")
                print(f"   Powerplay shots with time > 0: {len(pp_with_time):,} ({len(pp_with_time)/len(pp_shots)*100:.1f}%)")
        else:
            print(f"\n⚠️  WARNING: All values are zero (no powerplay tracking detected)")
            print(f"   This might be expected if:")
            print(f"   - Data was processed before fix was applied")
            print(f"   - No shots occurred during powerplays")
            print(f"   - Powerplay tracking needs further improvement")
    else:
        print("\n❌ Column 'time_since_powerplay_started' NOT FOUND")
    
    # ============================================================================
    # FIX 3: distance_from_last_event
    # ============================================================================
    print("\n" + "=" * 80)
    print("FIX 3: distance_from_last_event")
    print("=" * 80)
    
    if 'distance_from_last_event' in df.columns:
        missing = df['distance_from_last_event'].isna().sum()
        missing_pct = (missing / total_shots) * 100
        present_pct = 100 - missing_pct
        
        zeros = (df['distance_from_last_event'] == 0).sum()
        zeros_pct = (zeros / total_shots) * 100
        non_zero_pct = 100 - zeros_pct - missing_pct
        
        print(f"\n📊 Coverage:")
        print(f"   ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
        print(f"   ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
        print(f"   📊 Non-zero: {non_zero_pct:6.2f}% ({total_shots - missing - zeros:,} shots)")
        print(f"   🔢 Zero values: {zeros_pct:6.2f}% ({zeros:,} shots)")
        
        if present_pct >= 99.0:
            print(f"\n✅ PASS: distance_from_last_event is present for {present_pct:.1f}% of shots")
        else:
            print(f"\n❌ FAIL: distance_from_last_event is only present for {present_pct:.1f}% of shots")
        
        if non_zero_pct > 0:
            non_zero = df[df['distance_from_last_event'] > 0]['distance_from_last_event']
            print(f"\n📈 Non-zero distance statistics:")
            print(f"   Min: {non_zero.min():.2f}ft")
            print(f"   Max: {non_zero.max():.2f}ft")
            print(f"   Mean: {non_zero.mean():.2f}ft")
            print(f"   Median: {non_zero.median():.2f}ft")
    else:
        print("\n❌ Column 'distance_from_last_event' NOT FOUND")
    
    # ============================================================================
    # SUMMARY
    # ============================================================================
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    fixes_status = []
    
    if 'speed_from_last_event' in df.columns:
        speed_present = (df['speed_from_last_event'].notna().sum() / total_shots) * 100
        fixes_status.append(('speed_from_last_event', speed_present >= 99.0))
    
    if 'time_since_powerplay_started' in df.columns:
        pp_present = (df['time_since_powerplay_started'].notna().sum() / total_shots) * 100
        fixes_status.append(('time_since_powerplay_started', pp_present >= 99.0))
    
    if 'distance_from_last_event' in df.columns:
        dist_present = (df['distance_from_last_event'].notna().sum() / total_shots) * 100
        fixes_status.append(('distance_from_last_event', dist_present >= 99.0))
    
    print(f"\n📊 Fix Status:")
    for fix_name, status in fixes_status:
        status_icon = "✅" if status else "❌"
        print(f"   {status_icon} {fix_name}")
    
    all_passed = all(status for _, status in fixes_status)
    
    if all_passed:
        print(f"\n✅ ALL FIXES VERIFIED: All features are present for ≥99% of shots")
    else:
        print(f"\n⚠️  SOME FIXES NEED ATTENTION: Some features are missing")
        print(f"   Note: If data was processed before fixes were applied, re-process data")
    
    print("\n" + "=" * 80)
    print("✅ VERIFICATION COMPLETE")
    print("=" * 80)
    
    return all_passed

if __name__ == "__main__":
    verify_fixes()

