#!/usr/bin/env python3
"""
Test model performance improvement with new features.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

print("=" * 80)
print("TESTING FEATURE IMPACT ON MODEL PERFORMANCE")
print("=" * 80)

# Load matched data
matched = pd.read_csv('data/matched_shots_2025.csv')
print(f"\nLoaded {len(matched):,} matched shots")

# Test with basic features (what we had before)
basic_features = [
    'our_distance',
    'our_angle',
    'our_is_rebound',
    'our_has_pass'
]

# Test with enhanced features (what we have now)
enhanced_features = [
    'our_distance',
    'our_angle',
    'our_is_rebound',
    'our_has_pass',
    # New features we just added
    'our_shot_angle_adjusted',  # If in matched data
    'our_home_empty_net',  # If in matched data
    'our_away_empty_net',  # If in matched data
]

# Check what's actually available
available_basic = [f for f in basic_features if f in matched.columns]
available_enhanced = [f for f in enhanced_features if f in matched.columns]

# Also check for other MoneyPuck-aligned features
other_features = [
    'our_time_since_last_event',
    'our_home_skaters_on_ice',
    'our_away_skaters_on_ice',
    'our_is_empty_net',
]

available_other = [f for f in other_features if f in matched.columns]

print(f"\nAvailable basic features: {len(available_basic)}")
print(f"  {available_basic}")
print(f"\nAvailable enhanced features: {len(available_enhanced)}")
print(f"  {available_enhanced}")
print(f"\nAvailable other MoneyPuck features: {len(available_other)}")
print(f"  {available_other}")

# Prepare data
X_basic = matched[available_basic].fillna(0)
X_enhanced = matched[available_basic + available_other].fillna(0)  # Use all available
y = matched['mp_xGoal'].fillna(0)

# Split
X_train_basic, X_test_basic, y_train, y_test = train_test_split(X_basic, y, test_size=0.2, random_state=42)
X_train_enhanced, X_test_enhanced, _, _ = train_test_split(X_enhanced, y, test_size=0.2, random_state=42)

# Train basic model
print("\n" + "=" * 80)
print("BASIC MODEL (Original Features)")
print("=" * 80)
model_basic = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
model_basic.fit(X_train_basic, y_train)
y_pred_basic = model_basic.predict(X_test_basic)
r2_basic = r2_score(y_test, y_pred_basic)
mae_basic = mean_absolute_error(y_test, y_pred_basic)

print(f"  R²: {r2_basic:.4f}")
print(f"  MAE: {mae_basic:.4f}")

# Train enhanced model
print("\n" + "=" * 80)
print("ENHANCED MODEL (With MoneyPuck-Aligned Features)")
print("=" * 80)
model_enhanced = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
model_enhanced.fit(X_train_enhanced, y_train)
y_pred_enhanced = model_enhanced.predict(X_test_enhanced)
r2_enhanced = r2_score(y_test, y_pred_enhanced)
mae_enhanced = mean_absolute_error(y_test, y_pred_enhanced)

print(f"  R²: {r2_enhanced:.4f}")
print(f"  MAE: {mae_enhanced:.4f}")

# Compare
print("\n" + "=" * 80)
print("IMPROVEMENT")
print("=" * 80)
r2_improvement = r2_enhanced - r2_basic
mae_improvement = mae_basic - mae_enhanced  # Lower is better

print(f"  R² improvement: {r2_improvement:+.4f} ({r2_improvement/r2_basic*100:+.1f}%)")
print(f"  MAE improvement: {mae_improvement:+.4f} ({mae_improvement/mae_basic*100:+.1f}%)")

if r2_enhanced > r2_basic:
    print(f"\n  ✅ Enhanced features improve model performance!")
else:
    print(f"\n  ⚠️  Enhanced features don't improve performance (may need more data or different features)")

print("\n" + "=" * 80)
print("FEATURE IMPORTANCE (Enhanced Model)")
print("=" * 80)
feature_importance = pd.DataFrame({
    'feature': available_basic + available_other,
    'importance': model_enhanced.feature_importances_
}).sort_values('importance', ascending=False)

print(feature_importance.to_string(index=False))

print("\n" + "=" * 80)
print("CONCLUSION")
print("=" * 80)
print("\nCurrent model can predict MoneyPuck xG with:")
print(f"  - Basic features: R² = {r2_basic:.4f} ({r2_basic*100:.1f}% of variance explained)")
print(f"  - Enhanced features: R² = {r2_enhanced:.4f} ({r2_enhanced*100:.1f}% of variance explained)")

if r2_enhanced > 0.5:
    print("\n✅ Good alignment! Model can predict >50% of MoneyPuck's xG variance")
elif r2_enhanced > 0.4:
    print("\n⚠️  Moderate alignment. Adding more features could help")
else:
    print("\n❌ Low alignment. May need to investigate feature extraction")

