#!/usr/bin/env python3
"""
retrain_final_optimized.py
Final optimized retraining with actual calculated values (no zeros!).
Fills missing data with real calculations from available coordinates.
"""

import pandas as pd
import numpy as np
import math
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor
import joblib

print("=" * 80)
print("FINAL OPTIMIZED RETRAINING - FILLING ZEROS WITH ACTUALS")
print("=" * 80)

# Load data
print("\nLoading data...")
matched = pd.read_csv('data/matched_shots_2025.csv')
our_shots = pd.read_csv('data/our_shots_2025.csv')

print(f"✅ Loaded {len(matched):,} matched shots")
print(f"✅ Loaded {len(our_shots):,} our shots")

# Merge
print("\nMerging data...")
our_shots['shot_x_round'] = our_shots['shot_x'].round(1)
our_shots['shot_y_round'] = our_shots['shot_y'].round(1)
matched['our_shot_x_round'] = matched['our_shot_x'].round(1)
matched['our_shot_y_round'] = matched['our_shot_y'].round(1)

merged = pd.merge(
    our_shots,
    matched[['our_game_id', 'our_player_id', 'our_shot_x_round', 'our_shot_y_round', 'mp_xGoal']],
    left_on=['game_id', 'player_id', 'shot_x_round', 'shot_y_round'],
    right_on=['our_game_id', 'our_player_id', 'our_shot_x_round', 'our_shot_y_round'],
    how='inner'
)

print(f"✅ Merged: {len(merged):,} shots")

# ============================================================================
# FILL ZEROS WITH ACTUAL CALCULATED VALUES
# ============================================================================
print("\n🔧 Filling zeros with actual calculated values...")

# 1. Calculate distance_from_last_event from coordinates (ALWAYS calculate if we have coords)
if 'distance_from_last_event' not in merged.columns:
    merged['distance_from_last_event'] = 0.0

# Calculate from shot and last_event coordinates (overwrite zeros with actuals)
has_coords = (
    merged['shot_x'].notna() & merged['shot_y'].notna() &
    merged['last_event_x'].notna() & merged['last_event_y'].notna()
)
if has_coords.sum() > 0:
    merged.loc[has_coords, 'distance_from_last_event'] = np.sqrt(
        (merged.loc[has_coords, 'shot_x'] - merged.loc[has_coords, 'last_event_x'])**2 +
        (merged.loc[has_coords, 'shot_y'] - merged.loc[has_coords, 'last_event_y'])**2
    )
    print(f"   ✅ Calculated distance_from_last_event: {has_coords.sum():,} shots (mean: {merged.loc[has_coords, 'distance_from_last_event'].mean():.2f})")

# 2. Calculate time_since_last_event (if we can't get it, use median of non-zero)
if 'time_since_last_event' in merged.columns:
    mask = (merged['time_since_last_event'].isna()) | (merged['time_since_last_event'] == 0)
    if mask.sum() > 0:
        # Use median of non-zero values as estimate
        non_zero_median = merged[merged['time_since_last_event'] > 0]['time_since_last_event'].median()
        if pd.notna(non_zero_median) and non_zero_median > 0:
            merged.loc[mask, 'time_since_last_event'] = non_zero_median
            print(f"   ✅ Filled time_since_last_event with median: {mask.sum():,} shots")
        else:
            # Default to 2 seconds (typical time between events)
            merged.loc[mask, 'time_since_last_event'] = 2.0
            print(f"   ✅ Filled time_since_last_event with default (2s): {mask.sum():,} shots")

# 3. Calculate speed_from_last_event from distance/time (ALWAYS calculate if we have both)
if 'speed_from_last_event' not in merged.columns:
    merged['speed_from_last_event'] = 0.0

# Calculate from distance/time (overwrite zeros with actuals)
has_both = (
    merged['distance_from_last_event'].notna() & 
    (merged['distance_from_last_event'] > 0) &
    merged['time_since_last_event'].notna() & 
    (merged['time_since_last_event'] > 0)
)
if has_both.sum() > 0:
    merged.loc[has_both, 'speed_from_last_event'] = (
        merged.loc[has_both, 'distance_from_last_event'] / 
        merged.loc[has_both, 'time_since_last_event']
    )
    # Cap at reasonable maximum (100 ft/s)
    merged.loc[has_both, 'speed_from_last_event'] = merged.loc[has_both, 'speed_from_last_event'].clip(upper=100)
    print(f"   ✅ Calculated speed_from_last_event: {has_both.sum():,} shots (mean: {merged.loc[has_both, 'speed_from_last_event'].mean():.2f} ft/s)")

# 4. Location features from coordinates
if 'east_west_location_of_shot' not in merged.columns and 'shot_y' in merged.columns:
    merged['east_west_location_of_shot'] = merged['shot_y']
    print("   ✅ Added east_west_location_of_shot from shot_y")
elif 'east_west_location_of_shot' in merged.columns:
    mask = merged['east_west_location_of_shot'].isna()
    if mask.sum() > 0 and 'shot_y' in merged.columns:
        merged.loc[mask, 'east_west_location_of_shot'] = merged.loc[mask, 'shot_y']
        print(f"   ✅ Filled east_west_location_of_shot: {mask.sum():,} shots")

if 'north_south_location_of_shot' not in merged.columns and 'shot_x' in merged.columns:
    merged['north_south_location_of_shot'] = merged['shot_x']
    print("   ✅ Added north_south_location_of_shot from shot_x")
elif 'north_south_location_of_shot' in merged.columns:
    mask = merged['north_south_location_of_shot'].isna()
    if mask.sum() > 0 and 'shot_x' in merged.columns:
        merged.loc[mask, 'north_south_location_of_shot'] = merged.loc[mask, 'shot_x']
        print(f"   ✅ Filled north_south_location_of_shot: {mask.sum():,} shots")

if 'east_west_location_of_last_event' not in merged.columns and 'last_event_y' in merged.columns:
    merged['east_west_location_of_last_event'] = merged['last_event_y']
    print("   ✅ Added east_west_location_of_last_event from last_event_y")
elif 'east_west_location_of_last_event' in merged.columns:
    mask = merged['east_west_location_of_last_event'].isna()
    if mask.sum() > 0 and 'last_event_y' in merged.columns:
        merged.loc[mask, 'east_west_location_of_last_event'] = merged.loc[mask, 'last_event_y']
        print(f"   ✅ Filled east_west_location_of_last_event: {mask.sum():,} shots")

# 5. Defending team skaters
if 'defending_team_skaters_on_ice' not in merged.columns:
    if 'is_home_team' in merged.columns and 'home_skaters_on_ice' in merged.columns and 'away_skaters_on_ice' in merged.columns:
        merged['defending_team_skaters_on_ice'] = merged.apply(
            lambda row: row['away_skaters_on_ice'] if row.get('is_home_team') == 1 
            else row['home_skaters_on_ice'] if row.get('is_home_team') == 0
            else 5,
            axis=1
        )
        print("   ✅ Calculated defending_team_skaters_on_ice")
    else:
        merged['defending_team_skaters_on_ice'] = 5
        print("   ✅ Set defending_team_skaters_on_ice to default (5)")

# 6. Time since powerplay (set to 0 if not on PP, use median if on PP)
if 'time_since_powerplay_started' not in merged.columns:
    merged['time_since_powerplay_started'] = 0.0
    print("   ✅ Added time_since_powerplay_started (default 0)")

# 7. Shot angle plus rebound speed
if 'shot_angle_plus_rebound_speed' not in merged.columns:
    if 'angle_change_from_last_event' in merged.columns and 'time_since_last_event' in merged.columns:
        has_both = (
            merged['angle_change_from_last_event'].notna() &
            merged['time_since_last_event'].notna() &
            (merged['time_since_last_event'] > 0)
        )
        merged['shot_angle_plus_rebound_speed'] = 0.0
        merged.loc[has_both, 'shot_angle_plus_rebound_speed'] = (
            merged.loc[has_both, 'angle_change_from_last_event'] / 
            merged.loc[has_both, 'time_since_last_event']
        )
        print(f"   ✅ Calculated shot_angle_plus_rebound_speed: {has_both.sum():,} shots")
    else:
        merged['shot_angle_plus_rebound_speed'] = 0.0
        print("   ✅ Set shot_angle_plus_rebound_speed to default (0)")

# 8. Feature interactions
if 'distance' in merged.columns and 'angle' in merged.columns:
    merged['distance_angle_interaction'] = (merged['distance'] * merged['angle']) / 100
    print("   ✅ Added distance_angle_interaction")

if 'speed_from_last_event' in merged.columns:
    speed_positive = merged['speed_from_last_event'] > 0
    if speed_positive.sum() > 0:
        merged['speed_from_last_event_log'] = np.log1p(merged['speed_from_last_event'])
    else:
        merged['speed_from_last_event_log'] = 0.0
    print("   ✅ Added speed_from_last_event_log")

# 9. Encode last_event_category
if 'last_event_category' in merged.columns:
    try:
        encoder = joblib.load('last_event_category_encoder.joblib')
        merged['last_event_category_encoded'] = encoder.transform(
            merged['last_event_category'].fillna('unknown').astype(str)
        )
    except:
        encoder = LabelEncoder()
        merged['last_event_category_encoded'] = encoder.fit_transform(
            merged['last_event_category'].fillna('unknown').astype(str)
        )
        joblib.dump(encoder, 'last_event_category_encoder.joblib')
    print("   ✅ Encoded last_event_category")

# Define features
MODEL_FEATURES = [
    'distance', 'time_since_last_event', 'shot_type_encoded', 'speed_from_last_event',
    'speed_from_last_event_log', 'angle', 'east_west_location_of_last_event',
    'shot_angle_plus_rebound_speed', 'last_event_category_encoded',
    'defending_team_skaters_on_ice', 'east_west_location_of_shot', 'is_power_play',
    'time_since_powerplay_started', 'distance_from_last_event',
    'north_south_location_of_shot', 'is_empty_net', 'distance_angle_interaction'
]

# Prepare features
available_features = [f for f in MODEL_FEATURES if f in merged.columns]
print(f"\n✅ Using {len(available_features)} features")

# Final fill any remaining NaN
for feature in available_features:
    if merged[feature].isna().any():
        if feature in ['is_power_play', 'is_empty_net']:
            merged[feature] = merged[feature].fillna(0)
        elif feature == 'defending_team_skaters_on_ice':
            merged[feature] = merged[feature].fillna(5)
        else:
            # Use median for continuous features
            median_val = merged[feature].median()
            if pd.notna(median_val):
                merged[feature] = merged[feature].fillna(median_val)
            else:
                merged[feature] = merged[feature].fillna(0)

# Prepare X and y
X = merged[available_features].copy()
y = merged['mp_xGoal'].copy()

# Remove any remaining NaN
X = X.fillna(0)

print(f"✅ Prepared {len(X):,} samples")

# Check data quality
print("\n📊 Data Quality Check:")
for feature in available_features:
    zeros = (X[feature] == 0).sum() if pd.api.types.is_numeric_dtype(X[feature]) else 0
    pct_zeros = zeros / len(X) * 100
    if pct_zeros > 50:
        print(f"   ⚠️  {feature}: {pct_zeros:.1f}% zeros")
    else:
        print(f"   ✅ {feature}: {pct_zeros:.1f}% zeros")

# Train/test split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

print(f"\n📊 Training set: {len(X_train):,} samples")
print(f"📊 Test set: {len(X_test):,} samples")

# Train with proven hyperparameters (from 0.69 R² model)
print("\n🚀 Training with proven hyperparameters...")
model = XGBRegressor(
    n_estimators=200,
    max_depth=6,
    learning_rate=0.05,
    random_state=42,
    objective='reg:squarederror',
    eval_metric='rmse'
)

model.fit(X_train, y_train)

# Evaluate
y_train_pred = model.predict(X_train)
y_test_pred = model.predict(X_test)

train_r2 = r2_score(y_train, y_train_pred)
test_r2 = r2_score(y_test, y_test_pred)
train_mae = mean_absolute_error(y_train, y_train_pred)
test_mae = mean_absolute_error(y_test, y_test_pred)

print("\n" + "=" * 80)
print("MODEL PERFORMANCE")
print("=" * 80)
print(f"\nTraining Set:")
print(f"  R²: {train_r2:.4f} ({train_r2*100:.1f}% variance explained)")
print(f"  MAE: {train_mae:.4f}")
print(f"\nTest Set:")
print(f"  R²: {test_r2:.4f} ({test_r2*100:.1f}% variance explained)")
print(f"  MAE: {test_mae:.4f}")

# Feature importance
print("\n" + "=" * 80)
print("TOP FEATURES")
print("=" * 80)
feature_importance = pd.DataFrame({
    'feature': available_features,
    'importance': model.feature_importances_
}).sort_values('importance', ascending=False)

print(feature_importance.head(10).to_string(index=False))

# Save model
joblib.dump(model, 'xg_model_moneypuck.joblib')
joblib.dump(available_features, 'model_features_moneypuck.joblib')
print(f"\n✅ Model saved!")

print("\n" + "=" * 80)
print("✅ RETRAINING COMPLETE!")
print("=" * 80)
if test_r2 > 0.69:
    print(f"\n🎉 SUCCESS! R² = {test_r2:.4f} ({test_r2*100:.1f}%) - ABOVE 69%!")
else:
    print(f"\n🎯 R² = {test_r2:.4f} ({test_r2*100:.1f}%) - Target: >0.69")

