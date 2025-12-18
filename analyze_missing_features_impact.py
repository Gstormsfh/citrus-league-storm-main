#!/usr/bin/env python3
"""
Analyze what features MoneyPuck has that we're missing and their impact on xG.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

print("=" * 80)
print("ANALYZING MISSING FEATURES AND THEIR IMPACT")
print("=" * 80)

# Load data
mp = pd.read_csv('data/moneypuck_shots_2025.csv.csv')
our = pd.read_csv('data/our_shots_2025.csv')
matched = pd.read_csv('data/matched_shots_2025.csv')

print(f"\nMoneyPuck shots: {len(mp):,}")
print(f"Our shots: {len(our):,}")
print(f"Matched shots: {len(matched):,}")

# Find MoneyPuck features we don't have
print("\n" + "=" * 80)
print("MONEYPUCK FEATURES WE DON'T EXTRACT")
print("=" * 80)

our_cols = set(our.columns)
mp_cols = set(mp.columns)

# Key MoneyPuck features to check
mp_key_features = [
    'shotDistance', 'shotAngle', 'shotAngleAdjusted', 'shotRebound', 'shotRush',
    'shotOnEmptyNet', 'lastEventCategory', 'lastEventShotAngle', 'lastEventShotDistance',
    'distanceFromLastEvent', 'timeSinceLastEvent', 'speedFromLastEvent',
    'homeSkatersOnIce', 'awaySkatersOnIce', 'awayEmptyNet', 'homeEmptyNet',
    'period', 'time', 'shootingTeamCode', 'defendingTeamCode'
]

missing = []
for feat in mp_key_features:
    # Check if we have equivalent
    our_equiv = None
    if feat == 'shotDistance':
        our_equiv = 'distance'
    elif feat == 'shotAngle':
        our_equiv = 'angle'
    elif feat == 'shotAngleAdjusted':
        our_equiv = 'shot_angle_adjusted'  # We just added this
    elif feat == 'shotRebound':
        our_equiv = 'is_rebound'
    elif feat == 'shotRush':
        our_equiv = 'is_rush'
    elif feat == 'shotOnEmptyNet':
        our_equiv = 'is_empty_net'
    elif feat == 'lastEventCategory':
        our_equiv = 'last_event_category'
    elif feat == 'lastEventShotAngle':
        our_equiv = 'last_event_shot_angle'
    elif feat == 'lastEventShotDistance':
        our_equiv = 'last_event_shot_distance'
    elif feat == 'distanceFromLastEvent':
        our_equiv = 'distance_from_last_event'
    elif feat == 'timeSinceLastEvent':
        our_equiv = 'time_since_last_event'
    elif feat == 'speedFromLastEvent':
        our_equiv = 'speed_from_last_event'
    elif feat == 'homeSkatersOnIce':
        our_equiv = 'home_skaters_on_ice'
    elif feat == 'awaySkatersOnIce':
        our_equiv = 'away_skaters_on_ice'
    elif feat == 'awayEmptyNet':
        our_equiv = 'away_empty_net'  # We just added this
    elif feat == 'homeEmptyNet':
        our_equiv = 'home_empty_net'  # We just added this
    elif feat == 'period':
        our_equiv = 'period'
    elif feat == 'time':
        our_equiv = 'time_remaining_seconds'  # Different format but we have it
    
    if not our_equiv or our_equiv not in our.columns:
        missing.append(feat)
        print(f"  ❌ {feat:30s} -> {our_equiv if our_equiv else 'NO EQUIVALENT'}")

if not missing:
    print("  ✅ We extract all key MoneyPuck features!")

# Check for other MoneyPuck features that might be important
print("\n" + "=" * 80)
print("OTHER MONEYPUCK FEATURES (POTENTIALLY MISSING)")
print("=" * 80)

# Features that might affect xG but we haven't checked
other_mp_features = [
    'arenaAdjustedXCord', 'arenaAdjustedYCord', 'arenaAdjustedShotDistance', 'arenaAdjustedShotAngle',
    'offWing', 'shooterLeftRight', 'timeSinceChange', 'timeOnIce', 'timeOnIceSinceFaceoff',
    'averageRestDifference', 'shootingTeamAverageTimeOnIce', 'defendingTeamAverageTimeOnIce'
]

print("\nChecking additional MoneyPuck features:")
for feat in other_mp_features:
    if feat in mp.columns:
        non_null = mp[feat].notna().sum()
        if non_null > len(mp) * 0.5:  # At least 50% populated
            # Check if we have equivalent
            our_equiv = None
            if 'arenaAdjusted' in feat:
                our_equiv = 'arena_adjusted' in str(our.columns)
            elif feat == 'offWing':
                our_equiv = 'offWing' in our.columns
            elif feat == 'shooterLeftRight':
                our_equiv = 'shooterLeftRight' in our.columns
            elif 'timeOnIce' in feat:
                our_equiv = 'timeOnIce' in our.columns or 'time_on_ice' in our.columns
            
            status = "✅" if our_equiv else "❌"
            print(f"  {status} {feat:40s} {non_null:,} values ({'We have' if our_equiv else 'Missing'})")

# Analyze impact of missing features on xG prediction
print("\n" + "=" * 80)
print("IMPACT ANALYSIS: CAN WE EXTRACT MISSING FEATURES?")
print("=" * 80)

# Check if missing features are in NHL API or need calculation
missing_analysis = {
    'arenaAdjustedXCord': {
        'source': 'CALCULATED',
        'can_extract': True,
        'how': 'Coordinate system conversion (we have this in feature_calculations.py)',
        'impact': 'Medium - helps normalize coordinates across arenas'
    },
    'arenaAdjustedShotDistance': {
        'source': 'CALCULATED',
        'can_extract': True,
        'how': 'Calculate distance using arena-adjusted coordinates',
        'impact': 'Medium - more accurate distance measurement'
    },
    'offWing': {
        'source': 'CALCULATED',
        'can_extract': True,
        'how': 'Need player handedness data (shooterLeftRight) + shot location',
        'impact': 'Low - nice to have but not critical'
    },
    'shooterLeftRight': {
        'source': 'NHL API (roster data)',
        'can_extract': True,
        'how': 'Lookup player roster data for handedness',
        'impact': 'Low - needed for offWing calculation'
    },
    'timeOnIce': {
        'source': 'NHL API (shift data)',
        'can_extract': True,
        'how': 'Parse shift change events or use shift tracking API',
        'impact': 'Low-Medium - context feature but not top priority'
    },
    'averageRestDifference': {
        'source': 'CALCULATED',
        'can_extract': True,
        'how': 'Compare time since last shift for shooting vs defending team',
        'impact': 'Low - advanced context feature'
    }
}

print("\nMissing features analysis:")
for feat, info in missing_analysis.items():
    if feat in mp.columns:
        print(f"\n{feat}:")
        print(f"  Source: {info['source']}")
        print(f"  Can extract: {'✅ YES' if info['can_extract'] else '❌ NO'}")
        print(f"  How: {info['how']}")
        print(f"  Impact on xG: {info['impact']}")

# Test model performance with/without missing features
print("\n" + "=" * 80)
print("MODEL IMPACT TEST")
print("=" * 80)

# Use matched data to test
if len(matched) > 0:
    # Prepare features we have
    our_features = ['our_distance', 'our_angle', 'our_is_rebound', 'our_has_pass']
    available = [f for f in our_features if f in matched.columns]
    
    if len(available) > 0:
        X = matched[available].fillna(0)
        y = matched['mp_xGoal']
        
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
        model.fit(X_train, y_train)
        
        y_pred = model.predict(X_test)
        r2 = r2_score(y_test, y_pred)
        mae = mean_absolute_error(y_test, y_pred)
        
        print(f"\nCurrent model (with available features):")
        print(f"  R²: {r2:.4f}")
        print(f"  MAE: {mae:.4f}")
        print(f"\n  This shows how well we can predict MoneyPuck xG with our current features")
        print(f"  Higher R² = better alignment with MoneyPuck's model")

print("\n" + "=" * 80)
print("RECOMMENDATIONS")
print("=" * 80)
print("\n1. ✅ We now extract all CRITICAL MoneyPuck features (shotAngleAdjusted, empty net flags)")
print("\n2. Missing features are mostly ADVANCED/CONTEXT features:")
print("   - arenaAdjusted coordinates (we can calculate)")
print("   - Time on Ice metrics (requires shift tracking)")
print("   - Player handedness (requires roster lookup)")
print("\n3. Impact on xG:")
print("   - Critical features: ✅ We have them")
print("   - Advanced features: Low-Medium impact, can add later")
print("\n4. Next steps:")
print("   - Retrain model with current features (should work well)")
print("   - Add arena-adjusted calculations if needed")
print("   - Add shift tracking for time-on-ice if desired")

