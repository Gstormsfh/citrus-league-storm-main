#!/usr/bin/env python3
"""
analyze_moneypuck_calibration.py
Analyze MoneyPuck's xG calibration to understand their scale and features.
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# Load MoneyPuck data
print("=" * 80)
print("MONEYPUCK xG CALIBRATION ANALYSIS")
print("=" * 80)
print()

df = pd.read_csv('data/moneypuck_shots_2025.csv.csv')
print(f"Total shots: {len(df):,}")
print()

# xG Statistics
print("xGoal (xG) Distribution:")
print(df['xGoal'].describe())
print()

print("xG Percentiles:")
for p in [50, 75, 90, 95, 99, 99.9]:
    val = df['xGoal'].quantile(p/100)
    count = (df['xGoal'] >= val).sum()
    print(f"  {p}th percentile: {val:.4f} ({count:,} shots)")

print()
print("High xG Shots:")
print(f"  xG > 0.3: {(df['xGoal'] > 0.3).sum():,} shots ({100*(df['xGoal'] > 0.3).sum()/len(df):.2f}%)")
print(f"  xG > 0.2: {(df['xGoal'] > 0.2).sum():,} shots ({100*(df['xGoal'] > 0.2).sum()/len(df):.2f}%)")
print(f"  xG > 0.1: {(df['xGoal'] > 0.1).sum():,} shots ({100*(df['xGoal'] > 0.1).sum()/len(df):.2f}%)")
print(f"  xG > 0.5: {(df['xGoal'] > 0.5).sum():,} shots ({100*(df['xGoal'] > 0.5).sum()/len(df):.2f}%)")
print(f"  Max xG: {df['xGoal'].max():.4f}")
print()

# Feature Analysis
print("Key Features Available:")
print(f"  shotDistance: {df['shotDistance'].notna().sum():,} values")
print(f"    Range: {df['shotDistance'].min():.1f} - {df['shotDistance'].max():.1f} feet")
print(f"    Mean: {df['shotDistance'].mean():.1f} feet")
print()

print(f"  shotAngle: {df['shotAngle'].notna().sum():,} values")
print(f"    Range: {df['shotAngle'].min():.1f} - {df['shotAngle'].max():.1f} degrees")
print(f"    Mean: {abs(df['shotAngle']).mean():.1f} degrees (absolute)")
print()

print(f"  shotRebound: {df['shotRebound'].sum():,} rebounds ({100*df['shotRebound'].mean():.1f}%)")
print(f"  shotRush: {df['shotRush'].sum():,} rush shots ({100*df['shotRush'].mean():.1f}%)")
print(f"  shotOnEmptyNet: {df['shotOnEmptyNet'].sum():,} empty net shots")
print()

print("Last Event Categories:")
print(df['lastEventCategory'].value_counts().head(10))
print()

# Analyze high xG shots
print("=" * 80)
print("HIGH xG SHOT ANALYSIS (xG > 0.3)")
print("=" * 80)
high_xg = df[df['xGoal'] > 0.3].copy()
print(f"Found {len(high_xg):,} shots with xG > 0.3")
print()

if len(high_xg) > 0:
    print("Characteristics of high xG shots:")
    print(f"  Average distance: {high_xg['shotDistance'].mean():.1f} feet")
    print(f"  Average angle: {abs(high_xg['shotAngle']).mean():.1f} degrees")
    print(f"  Rebound rate: {100*high_xg['shotRebound'].mean():.1f}%")
    print(f"  Rush rate: {100*high_xg['shotRush'].mean():.1f}%")
    print(f"  Empty net rate: {100*high_xg['shotOnEmptyNet'].mean():.1f}%")
    print()
    
    print("Top 20 highest xG shots:")
    top_shots = high_xg.nlargest(20, 'xGoal')[
        ['shotDistance', 'shotAngle', 'shotAngleAdjusted', 'xGoal', 'shotRebound', 
         'shotRush', 'shotOnEmptyNet', 'lastEventCategory', 'goal']
    ]
    print(top_shots.to_string(index=False))
    print()

# Distance vs xG relationship
print("=" * 80)
print("DISTANCE vs xG RELATIONSHIP")
print("=" * 80)
distance_bins = [0, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100]
df['distance_bin'] = pd.cut(df['shotDistance'], bins=distance_bins)
distance_xg = df.groupby('distance_bin')['xGoal'].agg(['mean', 'max', 'count'])
print(distance_xg)
print()

# Angle vs xG relationship
print("=" * 80)
print("ANGLE vs xG RELATIONSHIP")
print("=" * 80)
angle_bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
df['angle_bin'] = pd.cut(abs(df['shotAngle']), bins=angle_bins)
angle_xg = df.groupby('angle_bin')['xGoal'].agg(['mean', 'max', 'count'])
print(angle_xg)
print()

# Compare to our current calibration
print("=" * 80)
print("CALIBRATION COMPARISON")
print("=" * 80)
print("MoneyPuck:")
print(f"  Mean xG: {df['xGoal'].mean():.4f}")
print(f"  Median xG: {df['xGoal'].median():.4f}")
print(f"  Max xG: {df['xGoal'].max():.4f}")
print(f"  Actual goal rate: {100*df['goal'].mean():.2f}%")
print()

print("Our current model (estimated):")
print("  Mean xG: ~0.20 (after calibration)")
print("  Max xG: ~0.50 (capped)")
print("  Need to scale up by factor of ~{:.2f}x".format(df['xGoal'].max() / 0.5))
print()

print("=" * 80)
print("RECOMMENDATIONS")
print("=" * 80)
print("1. Remove or significantly reduce the 0.50 cap on xG")
print("2. Increase calibration scale factor to match MoneyPuck's range")
print("3. Ensure slot shots (distance < 25ft, angle < 30deg) can reach 0.3+ xG")
print("4. Very close shots (distance < 10ft) should reach 0.5-0.9 xG")
print("5. Consider using MoneyPuck data for training/validation")
print()

