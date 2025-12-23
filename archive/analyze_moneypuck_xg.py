#!/usr/bin/env python3
"""
Analyze MoneyPuck's xG calculation to understand their approach.
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

print("=" * 80)
print("ANALYZING MONEYPUCK xG CALCULATION")
print("=" * 80)

# Load matched data
df = pd.read_csv('data/matched_shots_2025.csv')
print(f"\nLoaded {len(df):,} matched shots")

# Basic xG statistics
print("\n" + "=" * 80)
print("MONEYPUCK xG STATISTICS")
print("=" * 80)
print(df['mp_xGoal'].describe())

print("\n" + "=" * 80)
print("OUR xG vs MONEYPUCK xG COMPARISON")
print("=" * 80)
print(f"Our mean xG: {df['our_xg'].mean():.4f}")
print(f"MoneyPuck mean xG: {df['mp_xGoal'].mean():.4f}")
print(f"Mean difference: {df['xg_difference'].mean():.4f}")
print(f"Mean ratio: {df['xg_ratio'].mean():.4f}")

# Analyze which features correlate most with MoneyPuck's xG
print("\n" + "=" * 80)
print("FEATURE CORRELATION WITH MONEYPUCK xG")
print("=" * 80)

# Get all numeric columns from matched data
numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
# Remove non-feature columns
exclude_cols = ['our_game_id', 'our_player_id', 'mp_shotID', 'mp_game_id', 
                'our_shot_x', 'our_shot_y', 'mp_xCord', 'mp_yCord',
                'match_distance', 'xg_difference', 'xg_ratio', 'our_is_goal', 'mp_goal']
feature_cols = [c for c in numeric_cols if c not in exclude_cols and 'our_' in c]

correlations = []
for col in feature_cols:
    if col in df.columns and df[col].notna().sum() > 100:  # At least 100 non-null values
        corr = df[col].corr(df['mp_xGoal'])
        if not pd.isna(corr):
            correlations.append((col, corr, df[col].notna().sum()))

correlations.sort(key=lambda x: abs(x[1]), reverse=True)

print("\nTop features correlated with MoneyPuck xG:")
for col, corr, count in correlations[:15]:
    print(f"  {col:40s} {corr:7.4f}  ({count:,} values)")

# Compare our features vs MoneyPuck features
print("\n" + "=" * 80)
print("FEATURE AVAILABILITY COMPARISON")
print("=" * 80)

# Load full datasets to compare
our_full = pd.read_csv('data/our_shots_2025.csv')
mp_full = pd.read_csv('data/moneypuck_shots_2025.csv.csv')

print(f"\nOur dataset: {len(our_full):,} shots, {len(our_full.columns)} columns")
print(f"MoneyPuck dataset: {len(mp_full):,} shots, {len(mp_full.columns)} columns")

# Find features we have that MoneyPuck might use
print("\nKey features MoneyPuck has that we should check:")
mp_key_features = [
    'shotDistance', 'shotAngle', 'shotAngleAdjusted', 'shotRebound', 'shotRush',
    'shotOnEmptyNet', 'lastEventCategory', 'lastEventShotAngle', 'lastEventShotDistance',
    'shootingTeamCode', 'defendingTeamCode', 'period', 'time', 'isPlayoffGame'
]

for feat in mp_key_features:
    if feat in mp_full.columns:
        non_null = mp_full[feat].notna().sum()
        print(f"  {feat:30s} {non_null:,} values ({100*non_null/len(mp_full):.1f}%)")
        if non_null > 0:
            try:
                if mp_full[feat].dtype in [np.float64, np.int64]:
                    print(f"    Range: {mp_full[feat].min():.2f} to {mp_full[feat].max():.2f}")
                else:
                    print(f"    Type: {mp_full[feat].dtype}, Sample: {mp_full[feat].iloc[0]}")
            except:
                print(f"    Type: {mp_full[feat].dtype}")

print("\n" + "=" * 80)
print("MISSING FEATURES ANALYSIS")
print("=" * 80)

# Check what MoneyPuck has that we don't
our_cols_set = set(our_full.columns)
mp_cols_set = set(mp_full.columns)

# Find MoneyPuck columns we don't have
mp_only = mp_cols_set - our_cols_set
print(f"\nMoneyPuck columns we don't have: {len(mp_only)}")

# Categorize missing features
missing_categories = {
    'Time on Ice': [c for c in mp_only if 'TimeOnIce' in c or 'timeOnIce' in c],
    'Shot Outcomes': [c for c in mp_only if any(x in c for x in ['Froze', 'Rebound', 'Stopped', 'Continued'])],
    'Adjusted Metrics': [c for c in mp_only if 'Adjusted' in c or 'adjusted' in c],
    'Team Context': [c for c in mp_only if 'Team' in c and 'Code' not in c],
    'Other': [c for c in mp_only if not any(cat in c for cat in ['TimeOnIce', 'Froze', 'Rebound', 'Adjusted', 'Team'])]
}

for category, cols in missing_categories.items():
    if cols:
        print(f"\n{category} ({len(cols)} features):")
        for col in sorted(cols)[:10]:
            print(f"  - {col}")

print("\n" + "=" * 80)
print("RECOMMENDATIONS")
print("=" * 80)
print("\n1. Analyze MoneyPuck's xG model by:")
print("   - Building a model to predict mp_xGoal from our features")
print("   - Identifying which features MoneyPuck values most")
print("   - Understanding their feature engineering approach")
print("\n2. Extract missing features:")
print("   - Time on Ice metrics (requires shift tracking)")
print("   - Shot outcome features (look-ahead logic)")
print("   - Arena-adjusted coordinates (coordinate system conversion)")
print("\n3. Improve our model:")
print("   - Use MoneyPuck xG as target for retraining")
print("   - Add missing features to our extraction")
print("   - Calibrate to match MoneyPuck's scale")

