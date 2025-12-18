#!/usr/bin/env python3
"""
Deep analysis of MoneyPuck's xG model using their own features.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

print("=" * 80)
print("DEEP ANALYSIS: MONEYPUCK xG MODEL")
print("=" * 80)

# Load MoneyPuck data
mp = pd.read_csv('data/moneypuck_shots_2025.csv.csv')
print(f"\nLoaded {len(mp):,} MoneyPuck shots")

# Prepare MoneyPuck features to predict their own xG
# This tells us which features they use in their model
mp_feature_candidates = [
    # Core shot features
    'shotDistance', 'shotAngle', 'shotAngleAdjusted',
    # Context features
    'shotRebound', 'shotRush', 'shotOnEmptyNet',
    # Last event features
    'lastEventCategory', 'lastEventShotAngle', 'lastEventShotDistance',
    'distanceFromLastEvent', 'timeSinceLastEvent', 'speedFromLastEvent',
    # Situation features
    'homeSkatersOnIce', 'awaySkatersOnIce', 'awayEmptyNet', 'homeEmptyNet',
    # Time/period
    'period', 'time',
    # Team context
    'shootingTeamCode', 'defendingTeamCode'
]

# Check which features exist and have data
available_mp_features = []
for feat in mp_feature_candidates:
    if feat in mp.columns:
        non_null = mp[feat].notna().sum()
        if non_null > len(mp) * 0.9:  # At least 90% populated
            available_mp_features.append(feat)
            print(f"  ✅ {feat:40s} {non_null:,} values")

print(f"\nFound {len(available_mp_features)} usable MoneyPuck features")

# Prepare data for modeling
X_mp = mp[available_mp_features].copy()
y_mp = mp['xGoal'].copy()

# Handle missing values and convert categorical
for col in X_mp.columns:
    if X_mp[col].dtype == 'object':
        # Encode categorical (like lastEventCategory, team codes)
        X_mp[col] = pd.Categorical(X_mp[col]).codes
    if X_mp[col].isna().any():
        X_mp[col] = X_mp[col].fillna(X_mp[col].median())

# Train model using MoneyPuck's own features
print("\n" + "=" * 80)
print("TRAINING MODEL ON MONEYPUCK'S FEATURES")
print("=" * 80)

X_train, X_test, y_train, y_test = train_test_split(X_mp, y_mp, test_size=0.2, random_state=42)

rf_model = RandomForestRegressor(n_estimators=200, max_depth=10, random_state=42, n_jobs=-1)
rf_model.fit(X_train, y_train)

y_pred = rf_model.predict(X_test)
mae = mean_absolute_error(y_test, y_pred)
r2 = r2_score(y_test, y_pred)

print(f"\nModel Performance (predicting MoneyPuck xG from their features):")
print(f"  MAE: {mae:.4f}")
print(f"  R²: {r2:.4f}")
print(f"\n  This shows how well we can replicate their model!")

# Feature importance
print("\n" + "=" * 80)
print("MONEYPUCK FEATURE IMPORTANCE")
print("=" * 80)

feature_importance = list(zip(available_mp_features, rf_model.feature_importances_))
feature_importance.sort(key=lambda x: x[1], reverse=True)

for feat, importance in feature_importance:
    print(f"  {feat:40s} {importance:.4f} ({importance*100:.1f}%)")

# Compare with what we extract
print("\n" + "=" * 80)
print("OUR FEATURES vs MONEYPUCK FEATURES")
print("=" * 80)

our = pd.read_csv('data/our_shots_2025.csv')

comparison = {
    'shotDistance': ('distance', '✅ We have'),
    'shotAngle': ('angle', '✅ We have'),
    'shotAngleAdjusted': ('angle', '⚠️  We have angle, but not adjusted'),
    'shotRebound': ('is_rebound', '✅ We have'),
    'shotRush': ('is_rush', '✅ We have'),
    'shotOnEmptyNet': ('is_empty_net', '✅ We have'),
    'lastEventCategory': ('last_event_category', '✅ We have'),
    'lastEventShotAngle': ('last_event_shot_angle', '✅ We have'),
    'lastEventShotDistance': ('last_event_shot_distance', '✅ We have'),
    'distanceFromLastEvent': ('distance_from_last_event', '✅ We have'),
    'timeSinceLastEvent': ('time_since_last_event', '✅ We have'),
    'speedFromLastEvent': ('speed_from_last_event', '✅ We have'),
    'homeSkatersOnIce': ('home_skaters_on_ice', '✅ We have'),
    'awaySkatersOnIce': ('away_skaters_on_ice', '✅ We have'),
    'period': ('period', '✅ We have'),
    'time': ('time_remaining_seconds', '✅ We have (different format)'),
}

print("\nFeature mapping:")
for mp_feat, (our_feat, status) in comparison.items():
    has_it = our_feat in our.columns if our_feat else False
    print(f"  {mp_feat:30s} -> {our_feat:30s} {status if has_it else '❌ Missing'}")

# Identify what we're missing
print("\n" + "=" * 80)
print("WHAT WE'RE MISSING")
print("=" * 80)

missing = []
for mp_feat in available_mp_features:
    if mp_feat in comparison:
        our_feat = comparison[mp_feat][0]
        if our_feat not in our.columns:
            missing.append((mp_feat, our_feat))
    else:
        missing.append((mp_feat, None))

if missing:
    print("\nFeatures MoneyPuck uses that we don't extract:")
    for mp_feat, our_feat in missing:
        print(f"  {mp_feat}")
        if our_feat:
            print(f"    -> Should extract as: {our_feat}")
else:
    print("\n✅ We extract all key features MoneyPuck uses!")

# Analyze shotAngleAdjusted - this might be important
print("\n" + "=" * 80)
print("ANALYZING shotAngleAdjusted")
print("=" * 80)

if 'shotAngleAdjusted' in mp.columns and 'shotAngle' in mp.columns:
    print(f"\nshotAngle range: {mp['shotAngle'].min():.2f} to {mp['shotAngle'].max():.2f}")
    print(f"shotAngleAdjusted range: {mp['shotAngleAdjusted'].min():.2f} to {mp['shotAngleAdjusted'].max():.2f}")
    print(f"\nDifference analysis:")
    diff = mp['shotAngle'] - mp['shotAngleAdjusted']
    print(f"  Mean difference: {diff.mean():.2f}")
    print(f"  Max difference: {diff.max():.2f}")
    print(f"  When different: {(diff != 0).sum():,} shots ({(diff != 0).sum()/len(mp)*100:.1f}%)")
    
    # Check if it's just absolute value
    if (mp['shotAngleAdjusted'] == mp['shotAngle'].abs()).all():
        print("\n  ✅ shotAngleAdjusted = abs(shotAngle) - we can calculate this!")
    else:
        print("\n  ⚠️  shotAngleAdjusted is more complex - needs investigation")

print("\n" + "=" * 80)
print("RECOMMENDATIONS")
print("=" * 80)
print("\n1. We extract most key features MoneyPuck uses")
print("2. Main gap: shotAngleAdjusted (likely just abs(angle))")
print("3. We should retrain our model using MoneyPuck xG as target")
print("4. Our model should match MoneyPuck's scale better after retraining")

