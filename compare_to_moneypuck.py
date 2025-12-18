#!/usr/bin/env python3
"""
compare_to_moneypuck.py
Compare our xG predictions to MoneyPuck's xG values.
Analyze differences, patterns, and identify calibration issues.
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

def analyze_comparison(matched_file='data/matched_shots_2025.csv'):
    """
    Analyze differences between our predictions and MoneyPuck.
    """
    print("=" * 80)
    print("COMPARING OUR xG TO MONEYPUCK")
    print("=" * 80)
    print()
    
    # Load matched data
    try:
        df = pd.read_csv(matched_file)
        print(f"Loaded {len(df):,} matched shots")
    except FileNotFoundError:
        print(f"❌ Error: {matched_file} not found")
        print("   Run match_moneypuck_data.py first")
        return None
    
    # Basic statistics
    print("\n" + "=" * 80)
    print("BASIC STATISTICS")
    print("=" * 80)
    print(f"\nOur xG:")
    print(df['our_xg'].describe())
    print(f"\nMoneyPuck xG:")
    print(df['mp_xGoal'].describe())
    print(f"\nDifference (Our - MoneyPuck):")
    print(df['xg_difference'].describe())
    print()
    
    # Distribution comparison
    print("=" * 80)
    print("DISTRIBUTION COMPARISON")
    print("=" * 80)
    print("\nPercentiles:")
    percentiles = [10, 25, 50, 75, 90, 95, 99]
    print(f"{'Percentile':<12} {'Our xG':<12} {'MoneyPuck xG':<15} {'Difference':<12}")
    print("-" * 60)
    for p in percentiles:
        our_p = df['our_xg'].quantile(p/100)
        mp_p = df['mp_xGoal'].quantile(p/100)
        diff = our_p - mp_p
        print(f"{p:>2}th{'':<8} {our_p:>10.4f}   {mp_p:>10.4f}       {diff:>10.4f}")
    print()
    
    # High xG comparison
    print("High xG shots (>0.3):")
    our_high = (df['our_xg'] > 0.3).sum()
    mp_high = (df['mp_xGoal'] > 0.3).sum()
    print(f"  Our predictions: {our_high:,} ({100*our_high/len(df):.2f}%)")
    print(f"  MoneyPuck: {mp_high:,} ({100*mp_high/len(df):.2f}%)")
    print()
    
    # Analysis by distance
    print("=" * 80)
    print("ANALYSIS BY DISTANCE")
    print("=" * 80)
    distance_bins = [0, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100]
    df['distance_bin'] = pd.cut(df['our_distance'], bins=distance_bins)
    
    distance_analysis = df.groupby('distance_bin').agg({
        'our_xg': ['mean', 'max', 'count'],
        'mp_xGoal': ['mean', 'max'],
        'xg_difference': 'mean'
    }).round(4)
    
    print(distance_analysis)
    print()
    
    # Analysis by angle
    print("=" * 80)
    print("ANALYSIS BY ANGLE")
    print("=" * 80)
    angle_bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
    df['angle_bin'] = pd.cut(abs(df['our_angle']), bins=angle_bins)
    
    angle_analysis = df.groupby('angle_bin').agg({
        'our_xg': ['mean', 'max', 'count'],
        'mp_xGoal': ['mean', 'max'],
        'xg_difference': 'mean'
    }).round(4)
    
    print(angle_analysis)
    print()
    
    # Rebound analysis
    print("=" * 80)
    print("REBOUND ANALYSIS")
    print("=" * 80)
    rebound_analysis = df.groupby('our_is_rebound').agg({
        'our_xg': ['mean', 'max', 'count'],
        'mp_xGoal': ['mean', 'max'],
        'xg_difference': 'mean'
    }).round(4)
    print(rebound_analysis)
    print()
    
    # Slot shot analysis
    if 'our_is_slot_shot' in df.columns:
        print("=" * 80)
        print("SLOT SHOT ANALYSIS")
        print("=" * 80)
        slot_analysis = df.groupby(df['our_is_slot_shot'] > 0.5).agg({
            'our_xg': ['mean', 'max', 'count'],
            'mp_xGoal': ['mean', 'max'],
            'xg_difference': 'mean'
        }).round(4)
        print(slot_analysis)
        print()
    
    # Calibration curve
    print("=" * 80)
    print("CALIBRATION ANALYSIS")
    print("=" * 80)
    # Bin our predictions and compare to MoneyPuck
    xg_bins = [0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50, 1.0]
    df['our_xg_bin'] = pd.cut(df['our_xg'], bins=xg_bins)
    
    calibration = df.groupby('our_xg_bin').agg({
        'our_xg': 'mean',
        'mp_xGoal': 'mean',
        'our_is_goal': 'mean',  # Actual goal rate
        'mp_goal': 'mean',  # MoneyPuck goal rate
        'count': 'count'
    }).round(4)
    
    print("Calibration by xG bin:")
    print(f"{'Our xG Bin':<20} {'Our Mean xG':<15} {'MP Mean xG':<15} {'Our Goal Rate':<15} {'MP Goal Rate':<15} {'Count':<10}")
    print("-" * 100)
    for idx, row in calibration.iterrows():
        print(f"{str(idx):<20} {row['our_xg']:>13.4f}   {row['mp_xGoal']:>13.4f}   {row['our_is_goal']:>13.4f}   {row['mp_goal']:>13.4f}   {int(row['count']):>10,}")
    print()
    
    # Recommendations
    print("=" * 80)
    print("RECOMMENDATIONS")
    print("=" * 80)
    
    mean_diff = df['xg_difference'].mean()
    if mean_diff > 0.05:
        print(f"⚠️  We over-predict on average by {mean_diff:.4f}")
        print("   Recommendation: Reduce SCALE_FACTOR in data_acquisition.py")
    elif mean_diff < -0.05:
        print(f"⚠️  We under-predict on average by {abs(mean_diff):.4f}")
        print("   Recommendation: Increase SCALE_FACTOR in data_acquisition.py")
    else:
        print(f"✅ Average prediction is close (difference: {mean_diff:.4f})")
    
    max_our = df['our_xg'].max()
    max_mp = df['mp_xGoal'].max()
    if max_our < max_mp * 0.8:
        print(f"\n⚠️  Our max xG ({max_our:.4f}) is much lower than MoneyPuck's ({max_mp:.4f})")
        print("   Recommendation: Remove or increase the 0.50 cap in data_acquisition.py")
    
    # Check close shots
    close_shots = df[df['our_distance'] < 10]
    if len(close_shots) > 0:
        our_close_mean = close_shots['our_xg'].mean()
        mp_close_mean = close_shots['mp_xGoal'].mean()
        if our_close_mean < mp_close_mean * 0.7:
            print(f"\n⚠️  Close shots (<10ft): Our mean ({our_close_mean:.4f}) < MoneyPuck ({mp_close_mean:.4f})")
            print("   Recommendation: Boost slot shot feature or increase close shot scaling")
    
    print()
    return df

if __name__ == "__main__":
    df = analyze_comparison()
    
    if df is not None:
        print("✅ Analysis complete!")
        print("\nNext steps:")
        print("1. Review the recommendations above")
        print("2. Adjust calibration factors in data_acquisition.py")
        print("3. Retrain model if needed")
        print("4. Re-run pipeline and compare again")

