#!/usr/bin/env python3
"""
analyze_feature_quality.py
Analyze feature distributions and identify optimization opportunities.
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt

def analyze_features():
    """Analyze feature quality and distributions."""
    print("=" * 80)
    print("FEATURE QUALITY ANALYSIS")
    print("=" * 80)
    
    # Load data
    print("\nLoading data...")
    try:
        our_shots = pd.read_csv('data/our_shots_2025.csv')
        matched = pd.read_csv('data/matched_shots_2025.csv')
        print(f"✅ Loaded {len(our_shots):,} shots")
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        return
    
    # Merge
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
    
    print(f"✅ Merged: {len(merged):,} shots with MoneyPuck xG")
    
    # MoneyPuck's 15 variables
    moneypuck_vars = {
        'distance': 'shot_x',
        'time_since_last_event': 'time_since_last_event',
        'shot_type_encoded': 'shot_type_encoded',
        'speed_from_last_event': 'speed_from_last_event',
        'angle': 'angle',
        'east_west_location_of_last_event': 'last_event_y',
        'shot_angle_plus_rebound_speed': 'shot_angle_plus_rebound_speed',
        'last_event_category_encoded': 'last_event_category',
        'defending_team_skaters_on_ice': ['home_skaters_on_ice', 'away_skaters_on_ice', 'is_home_team'],
        'east_west_location_of_shot': 'shot_y',
        'is_power_play': 'is_power_play',
        'time_since_powerplay_started': 'time_since_powerplay_started',
        'distance_from_last_event': 'distance_from_last_event',
        'north_south_location_of_shot': 'shot_x',
        'is_empty_net': 'is_empty_net',
    }
    
    print("\n" + "=" * 80)
    print("FEATURE ANALYSIS")
    print("=" * 80)
    
    issues = []
    recommendations = []
    
    # Check each feature
    for var_name, source_cols in moneypuck_vars.items():
        print(f"\n📊 {var_name}:")
        
        if isinstance(source_cols, list):
            # Derived feature
            if all(col in merged.columns for col in source_cols):
                print(f"   ✅ Source columns available: {source_cols}")
            else:
                missing = [c for c in source_cols if c not in merged.columns]
                print(f"   ❌ Missing columns: {missing}")
                issues.append(f"{var_name}: Missing source columns {missing}")
        else:
            # Direct feature
            if source_cols in merged.columns:
                values = merged[source_cols]
                
                # Check for missing values
                missing_pct = values.isna().sum() / len(values) * 100
                if missing_pct > 0:
                    print(f"   ⚠️  Missing: {missing_pct:.1f}%")
                    issues.append(f"{var_name}: {missing_pct:.1f}% missing")
                
                # Check for constant values
                if values.nunique() <= 1:
                    print(f"   ❌ Constant value (no variance)")
                    issues.append(f"{var_name}: Constant value - no predictive power")
                else:
                    print(f"   ✅ Unique values: {values.nunique()}")
                    if pd.api.types.is_numeric_dtype(values):
                        print(f"   ✅ Range: {values.min():.2f} to {values.max():.2f}")
                        print(f"   ✅ Mean: {values.mean():.2f}, Std: {values.std():.2f}")
                    else:
                        print(f"   ✅ Type: {values.dtype}")
                        print(f"   ✅ Sample values: {values.value_counts().head(5).to_dict()}")
                    
                    # Check for extreme outliers (only for numeric)
                    if pd.api.types.is_numeric_dtype(values):
                        q1, q99 = values.quantile([0.01, 0.99])
                        outliers = ((values < q1) | (values > q99)).sum()
                        if outliers > len(values) * 0.05:
                            print(f"   ⚠️  Many outliers: {outliers} ({outliers/len(values)*100:.1f}%)")
                            recommendations.append(f"{var_name}: Consider outlier clipping or transformation")
                    
                    # Check distribution
                    if values.std() == 0:
                        print(f"   ❌ Zero variance")
                        issues.append(f"{var_name}: Zero variance")
                    elif values.std() / values.mean() if values.mean() != 0 else 0 < 0.01:
                        print(f"   ⚠️  Very low variance (CV < 0.01)")
                        recommendations.append(f"{var_name}: Low variance - may need transformation")
            else:
                print(f"   ❌ Column '{source_cols}' not found")
                issues.append(f"{var_name}: Column '{source_cols}' missing")
    
    # Check speed_from_last_event specifically (had 0 importance)
    print("\n" + "=" * 80)
    print("DEEP DIVE: speed_from_last_event (0 importance)")
    print("=" * 80)
    
    if 'speed_from_last_event' in merged.columns:
        speed = merged['speed_from_last_event']
        print(f"Missing: {speed.isna().sum()} ({speed.isna().sum()/len(speed)*100:.1f}%)")
        print(f"Zero values: {(speed == 0).sum()} ({(speed == 0).sum()/len(speed)*100:.1f}%)")
        print(f"Non-zero range: {speed[speed > 0].min():.2f} to {speed[speed > 0].max():.2f}")
        print(f"Mean (non-zero): {speed[speed > 0].mean():.2f}")
        print(f"Std (non-zero): {speed[speed > 0].std():.2f}")
        
        if speed.isna().sum() > len(speed) * 0.5:
            recommendations.append("speed_from_last_event: >50% missing - calculate from distance_from_last_event / time_since_last_event")
        if (speed == 0).sum() > len(speed) * 0.8:
            recommendations.append("speed_from_last_event: >80% zeros - may need log transformation or different calculation")
    
    # Check last_event_category
    print("\n" + "=" * 80)
    print("DEEP DIVE: last_event_category (missing encoded version)")
    print("=" * 80)
    
    if 'last_event_category' in merged.columns:
        cat = merged['last_event_category']
        print(f"Missing: {cat.isna().sum()} ({cat.isna().sum()/len(cat)*100:.1f}%)")
        print(f"Unique categories: {cat.nunique()}")
        print(f"Top categories:")
        print(cat.value_counts().head(10))
        recommendations.append("last_event_category: Ensure encoding is applied correctly")
    else:
        issues.append("last_event_category: Column missing")
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY & RECOMMENDATIONS")
    print("=" * 80)
    
    if issues:
        print(f"\n❌ Issues Found ({len(issues)}):")
        for issue in issues:
            print(f"   - {issue}")
    
    if recommendations:
        print(f"\n💡 Recommendations ({len(recommendations)}):")
        for rec in recommendations:
            print(f"   - {rec}")
    
    if not issues and not recommendations:
        print("\n✅ All features look good!")
    
    print("\n🎯 Optimization Opportunities:")
    print("   1. Ensure last_event_category_encoded is properly calculated")
    print("   2. Check why speed_from_last_event has 0 importance (data quality?)")
    print("   3. Consider feature transformations (log, sqrt) for skewed distributions")
    print("   4. Add feature interactions (e.g., distance × angle)")
    print("   5. Check if time_since_powerplay_started needs better tracking")

if __name__ == "__main__":
    analyze_features()

