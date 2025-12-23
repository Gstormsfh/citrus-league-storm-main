#!/usr/bin/env python3
"""
test_against_actual_goals.py
Test our xG model against ACTUAL GOALS SCORED (the real test!).
"""

import pandas as pd
import numpy as np
import joblib
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from scipy.stats import pearsonr

print("=" * 80)
print("TESTING AGAINST ACTUAL GOALS - THE REAL TEST!")
print("=" * 80)

# Load model
print("\nLoading model...")
model = joblib.load('xg_model_moneypuck.joblib')
features = joblib.load('model_features_moneypuck.joblib')
print(f"✅ Model loaded with {len(features)} features")

# Load our shot data
print("\nLoading shot data...")
our_shots = pd.read_csv('data/our_shots_2025.csv')
print(f"✅ Loaded {len(our_shots):,} shots")

# Prepare features (same as training)
print("\nPreparing features...")
# Add derived features
if 'east_west_location_of_shot' not in our_shots.columns and 'shot_y' in our_shots.columns:
    our_shots['east_west_location_of_shot'] = our_shots['shot_y']
if 'east_west_location_of_last_event' not in our_shots.columns and 'last_event_y' in our_shots.columns:
    our_shots['east_west_location_of_last_event'] = our_shots['last_event_y']
if 'north_south_location_of_shot' not in our_shots.columns and 'shot_x' in our_shots.columns:
    our_shots['north_south_location_of_shot'] = our_shots['shot_x']
if 'defending_team_skaters_on_ice' not in our_shots.columns:
    if 'is_home_team' in our_shots.columns and 'home_skaters_on_ice' in our_shots.columns and 'away_skaters_on_ice' in our_shots.columns:
        our_shots['defending_team_skaters_on_ice'] = our_shots.apply(
            lambda row: row['away_skaters_on_ice'] if row.get('is_home_team') == 1 
            else row['home_skaters_on_ice'] if row.get('is_home_team') == 0
            else 5,
            axis=1
        )
    else:
        our_shots['defending_team_skaters_on_ice'] = 5
if 'time_since_powerplay_started' not in our_shots.columns:
    our_shots['time_since_powerplay_started'] = 0.0
if 'shot_angle_plus_rebound_speed' not in our_shots.columns:
    if 'angle_change_from_last_event' in our_shots.columns and 'time_since_last_event' in our_shots.columns:
        our_shots['shot_angle_plus_rebound_speed'] = our_shots.apply(
            lambda row: (row['angle_change_from_last_event'] / row['time_since_last_event']) 
            if pd.notna(row.get('angle_change_from_last_event')) and pd.notna(row.get('time_since_last_event')) and row.get('time_since_last_event', 0) > 0
            else 0.0,
            axis=1
        )
    else:
        our_shots['shot_angle_plus_rebound_speed'] = 0.0
if 'distance_angle_interaction' not in our_shots.columns and 'distance' in our_shots.columns and 'angle' in our_shots.columns:
    our_shots['distance_angle_interaction'] = (our_shots['distance'] * our_shots['angle']) / 100
if 'speed_from_last_event_log' not in our_shots.columns and 'speed_from_last_event' in our_shots.columns:
    our_shots['speed_from_last_event_log'] = np.log1p(our_shots['speed_from_last_event'].fillna(0))

# Encode last_event_category
if 'last_event_category' in our_shots.columns and 'last_event_category_encoded' not in our_shots.columns:
    try:
        encoder = joblib.load('last_event_category_encoder.joblib')
        our_shots['last_event_category_encoded'] = encoder.transform(
            our_shots['last_event_category'].fillna('unknown').astype(str)
        )
    except:
        from sklearn.preprocessing import LabelEncoder
        encoder = LabelEncoder()
        our_shots['last_event_category_encoded'] = encoder.fit_transform(
            our_shots['last_event_category'].fillna('unknown').astype(str)
        )

# Fill missing features
for feature in features:
    if feature not in our_shots.columns:
        our_shots[feature] = 0
    else:
        our_shots[feature] = our_shots[feature].fillna(0)

# Get predictions
X = our_shots[features].fillna(0)
our_shots['predicted_xg'] = model.predict(X)

# Get actual goals
our_shots['is_goal'] = our_shots['is_goal'].fillna(0).astype(int)

print(f"✅ Prepared {len(our_shots):,} shots with predictions")

# Aggregate by game and player
print("\n" + "=" * 80)
print("AGGREGATE STATISTICS")
print("=" * 80)

# By game
game_stats = our_shots.groupby('game_id').agg({
    'predicted_xg': 'sum',
    'is_goal': 'sum'
}).reset_index()
game_stats.columns = ['game_id', 'total_xg', 'actual_goals']

print(f"\n📊 Game-level analysis ({len(game_stats)} games):")
print(f"  Total predicted xG: {game_stats['total_xg'].sum():.2f}")
print(f"  Total actual goals: {game_stats['actual_goals'].sum():.0f}")
print(f"  Average xG/game: {game_stats['total_xg'].mean():.3f}")
print(f"  Average goals/game: {game_stats['actual_goals'].mean():.3f}")
print(f"  Ratio (xG/goals): {game_stats['total_xg'].sum() / game_stats['actual_goals'].sum():.3f}")

# Calibration by xG bins
print("\n" + "=" * 80)
print("CALIBRATION ANALYSIS (xG vs Actual Goal Rate)")
print("=" * 80)

bins = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0]
our_shots['xg_bin'] = pd.cut(our_shots['predicted_xg'], bins=bins, labels=['0-0.05', '0.05-0.1', '0.1-0.15', '0.15-0.2', '0.2-0.3', '0.3-0.5', '0.5+'])

calibration = our_shots.groupby('xg_bin').agg({
    'predicted_xg': 'mean',
    'is_goal': ['mean', 'sum', 'count']
}).reset_index()
calibration.columns = ['xg_bin', 'mean_predicted_xg', 'actual_goal_rate', 'goals', 'shots']

print("\nPredicted xG Bin | Mean Predicted | Actual Goal Rate | Goals | Shots")
print("-" * 80)
for _, row in calibration.iterrows():
    print(f"{row['xg_bin']:15s} | {row['mean_predicted_xg']:13.3f} | {row['actual_goal_rate']:15.3f} | {row['goals']:5.0f} | {row['shots']:5.0f}")

# Correlation
correlation, p_value = pearsonr(our_shots['predicted_xg'], our_shots['is_goal'])
print(f"\n📈 Shot-level correlation: {correlation:.4f} (p-value: {p_value:.2e})")

# Brier score (for binary predictions)
brier_score = np.mean((our_shots['predicted_xg'] - our_shots['is_goal'])**2)
print(f"📊 Brier Score: {brier_score:.4f} (lower is better, perfect = 0)")

# Summary
print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
print(f"✅ Total shots: {len(our_shots):,}")
print(f"✅ Total predicted xG: {our_shots['predicted_xg'].sum():.2f}")
print(f"✅ Total actual goals: {our_shots['is_goal'].sum():.0f}")
print(f"✅ Calibration ratio: {our_shots['predicted_xg'].sum() / our_shots['is_goal'].sum():.3f}")
print(f"✅ Shot-level correlation: {correlation:.4f}")
print(f"✅ Brier Score: {brier_score:.4f}")

if abs(our_shots['predicted_xg'].sum() / our_shots['is_goal'].sum() - 1.0) < 0.2:
    print("\n🎉 EXCELLENT CALIBRATION! Total xG matches total goals within 20%")
else:
    print("\n⚠️  Calibration needs improvement - total xG doesn't match total goals")

