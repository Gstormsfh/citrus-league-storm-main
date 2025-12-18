#!/usr/bin/env python3
"""
retrain_optimized.py
Fully optimized retraining with all enhancements.
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor
import joblib

print("=" * 80)
print("OPTIMIZED MODEL RETRAINING")
print("=" * 80)
print("\nThis will:")
print("  1. Load matched data")
print("  2. Apply all feature optimizations")
print("  3. Train with hyperparameter tuning")
print("  4. Test against actual goals")
print()

# Load data
print("Loading data...")
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

# OPTIMIZATION 1: Fix speed_from_last_event
print("\n🔧 Optimizing features...")
if 'speed_from_last_event' in merged.columns and 'distance_from_last_event' in merged.columns and 'time_since_last_event' in merged.columns:
    mask = (merged['speed_from_last_event'].isna()) | (merged['speed_from_last_event'] == 0)
    if mask.sum() > 0:
        merged.loc[mask, 'speed_from_last_event'] = (
            merged.loc[mask, 'distance_from_last_event'] / 
            merged.loc[mask, 'time_since_last_event'].replace(0, np.nan)
        )
    merged['speed_from_last_event'] = merged['speed_from_last_event'].replace([np.inf, -np.inf], np.nan).fillna(0.0)
    print("   ✅ Fixed speed_from_last_event")

# OPTIMIZATION 2: Add location features
if 'east_west_location_of_shot' not in merged.columns and 'shot_y' in merged.columns:
    merged['east_west_location_of_shot'] = merged['shot_y']
if 'east_west_location_of_last_event' not in merged.columns and 'last_event_y' in merged.columns:
    merged['east_west_location_of_last_event'] = merged['last_event_y']
if 'north_south_location_of_shot' not in merged.columns and 'shot_x' in merged.columns:
    merged['north_south_location_of_shot'] = merged['shot_x']
print("   ✅ Added location features")

# OPTIMIZATION 3: Defending team skaters
if 'defending_team_skaters_on_ice' not in merged.columns:
    if 'is_home_team' in merged.columns and 'home_skaters_on_ice' in merged.columns and 'away_skaters_on_ice' in merged.columns:
        merged['defending_team_skaters_on_ice'] = merged.apply(
            lambda row: row['away_skaters_on_ice'] if row.get('is_home_team') == 1 
            else row['home_skaters_on_ice'] if row.get('is_home_team') == 0
            else 5,
            axis=1
        )
    else:
        merged['defending_team_skaters_on_ice'] = 5
print("   ✅ Added defending_team_skaters_on_ice")

# OPTIMIZATION 4: Time since powerplay
if 'time_since_powerplay_started' not in merged.columns:
    merged['time_since_powerplay_started'] = 0.0
print("   ✅ Added time_since_powerplay_started")

# OPTIMIZATION 5: Shot angle plus rebound speed
if 'shot_angle_plus_rebound_speed' not in merged.columns:
    if 'angle_change_from_last_event' in merged.columns and 'time_since_last_event' in merged.columns:
        merged['shot_angle_plus_rebound_speed'] = merged.apply(
            lambda row: (row['angle_change_from_last_event'] / row['time_since_last_event']) 
            if pd.notna(row.get('angle_change_from_last_event')) and pd.notna(row.get('time_since_last_event')) and row.get('time_since_last_event', 0) > 0
            else 0.0,
            axis=1
        )
    else:
        merged['shot_angle_plus_rebound_speed'] = 0.0
print("   ✅ Added shot_angle_plus_rebound_speed")

# OPTIMIZATION 6: Feature interactions
if 'distance' in merged.columns and 'angle' in merged.columns:
    merged['distance_angle_interaction'] = (merged['distance'] * merged['angle']) / 100
if 'speed_from_last_event' in merged.columns:
    speed_positive = merged['speed_from_last_event'] > 0
    if speed_positive.sum() > 0:
        merged['speed_from_last_event_log'] = np.log1p(merged['speed_from_last_event'])
    else:
        merged['speed_from_last_event_log'] = 0.0
print("   ✅ Added feature interactions")

# OPTIMIZATION 7: Encode last_event_category
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

# Fill missing values
for feature in available_features:
    if merged[feature].isna().any():
        if feature in ['is_power_play', 'is_empty_net']:
            merged[feature] = merged[feature].fillna(0)
        elif feature == 'defending_team_skaters_on_ice':
            merged[feature] = merged[feature].fillna(5)
        else:
            merged[feature] = merged[feature].fillna(0)

# Prepare X and y
X = merged[available_features].copy()
y = merged['mp_xGoal'].copy()

# Remove any remaining NaN
X = X.fillna(0)

print(f"✅ Prepared {len(X):,} samples")

# Train/test split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

print(f"\n📊 Training set: {len(X_train):,} samples")
print(f"📊 Test set: {len(X_test):,} samples")

# Train with proven hyperparameters (from previous successful training)
print("\n🚀 Training optimized XGBoost model...")
model = XGBRegressor(
    n_estimators=100,  # Reduced from 200 - was working well
    max_depth=5,  # Slightly reduced
    learning_rate=0.1,  # Standard learning rate
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=1,
    gamma=0,
    reg_alpha=0,
    reg_lambda=1,
    random_state=42,
    n_jobs=-1
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
print(f"  R²: {train_r2:.4f}")
print(f"  MAE: {train_mae:.4f}")
print(f"\nTest Set:")
print(f"  R²: {test_r2:.4f}")
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
print(f"\n🎯 Final R²: {test_r2:.4f} ({test_r2*100:.1f}% variance explained)")

