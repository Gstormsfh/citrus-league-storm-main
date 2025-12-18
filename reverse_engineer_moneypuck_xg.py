#!/usr/bin/env python3
"""
Reverse engineer MoneyPuck's xG model by analyzing feature importance
and building a model to predict their xG values.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score, mean_squared_error
import joblib

print("=" * 80)
print("REVERSE ENGINEERING MONEYPUCK xG MODEL")
print("=" * 80)

# Load matched data
df = pd.read_csv('data/matched_shots_2025.csv')
print(f"\nLoaded {len(df):,} matched shots")

# Prepare features - use our extracted features to predict MoneyPuck's xG
feature_cols = [
    'our_distance', 'our_angle', 'our_is_rebound', 'our_is_slot_shot',
    'our_is_power_play', 'our_score_differential', 'our_has_pass',
    'our_pass_lateral_distance', 'our_pass_to_net_distance',
    'our_pass_zone_encoded', 'our_pass_immediacy_score',
    'our_goalie_movement_score', 'our_pass_quality_score'
]

# Check which features we have
available_features = [f for f in feature_cols if f in df.columns]
print(f"\nAvailable features: {len(available_features)}")
print(f"  {available_features}")

# Prepare data
X = df[available_features].copy()
y = df['mp_xGoal'].copy()

# Handle missing values
for col in X.columns:
    if X[col].isna().any():
        if 'pass' in col.lower() or 'zone' in col.lower():
            X[col] = X[col].fillna(0)
        else:
            X[col] = X[col].fillna(X[col].median())

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

print(f"\nTraining data: {len(X_train):,} shots")
print(f"Test data: {len(X_test):,} shots")

# Train Random Forest to understand feature importance
print("\n" + "=" * 80)
print("TRAINING MODEL TO PREDICT MONEYPUCK xG")
print("=" * 80)

rf_model = RandomForestRegressor(n_estimators=200, max_depth=10, random_state=42, n_jobs=-1)
rf_model.fit(X_train, y_train)

# Evaluate
y_pred = rf_model.predict(X_test)
mae = mean_absolute_error(y_test, y_pred)
rmse = np.sqrt(mean_squared_error(y_test, y_pred))
r2 = r2_score(y_test, y_pred)

print(f"\nModel Performance:")
print(f"  MAE: {mae:.4f}")
print(f"  RMSE: {rmse:.4f}")
print(f"  R²: {r2:.4f}")

# Feature importance
print("\n" + "=" * 80)
print("FEATURE IMPORTANCE (What MoneyPuck values most)")
print("=" * 80)

feature_importance = list(zip(available_features, rf_model.feature_importances_))
feature_importance.sort(key=lambda x: x[1], reverse=True)

for feat, importance in feature_importance:
    print(f"  {feat:40s} {importance:.4f} ({importance*100:.1f}%)")

# Analyze what features MoneyPuck might be using that we don't have
print("\n" + "=" * 80)
print("ANALYZING MISSING FEATURES")
print("=" * 80)

# Load full MoneyPuck data to see all their features
mp_full = pd.read_csv('data/moneypuck_shots_2025.csv.csv')

# Features MoneyPuck has that might affect xG
mp_potential_features = [
    'shotDistance', 'shotAngle', 'shotAngleAdjusted', 'shotRebound', 'shotRush',
    'shotOnEmptyNet', 'lastEventCategory', 'lastEventShotAngle', 'lastEventShotDistance',
    'distanceFromLastEvent', 'timeSinceLastEvent', 'speedFromLastEvent',
    'shootingTeamCode', 'defendingTeamCode', 'period', 'time',
    'homeSkatersOnIce', 'awaySkatersOnIce', 'awayEmptyNet', 'homeEmptyNet'
]

print("\nMoneyPuck features that might affect xG:")
for feat in mp_potential_features:
    if feat in mp_full.columns:
        non_null = mp_full[feat].notna().sum()
        if non_null > 0:
            print(f"  {feat:40s} {non_null:,} values ({100*non_null/len(mp_full):.1f}%)")

# Compare with our features
print("\n" + "=" * 80)
print("FEATURE GAP ANALYSIS")
print("=" * 80)

our_full = pd.read_csv('data/our_shots_2025.csv')

print("\nFeatures MoneyPuck has that we might be missing:")
missing_features = []
for feat in mp_potential_features:
    if feat in mp_full.columns:
        # Check if we have equivalent
        our_equiv = None
        if feat == 'shotDistance':
            our_equiv = 'distance' if 'distance' in our_full.columns else None
        elif feat == 'shotAngle':
            our_equiv = 'angle' if 'angle' in our_full.columns else None
        elif feat == 'shotRebound':
            our_equiv = 'is_rebound' if 'is_rebound' in our_full.columns else None
        elif feat == 'shotRush':
            our_equiv = 'is_rush' if 'is_rush' in our_full.columns else None
        elif feat == 'shotOnEmptyNet':
            our_equiv = 'is_empty_net' if 'is_empty_net' in our_full.columns else None
        
        if not our_equiv or our_equiv not in our_full.columns:
            missing_features.append(feat)
            print(f"  {feat}")

print(f"\nTotal missing key features: {len(missing_features)}")

# Save model for later use
joblib.dump(rf_model, 'moneypuck_xg_predictor.joblib')
joblib.dump(available_features, 'moneypuck_xg_features.joblib')
print(f"\n✅ Saved model to moneypuck_xg_predictor.joblib")

