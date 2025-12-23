#!/usr/bin/env python3
"""
optimize_moneypuck_features.py
Optimize MoneyPuck features to improve R² further.

Key optimizations:
1. Fix speed_from_last_event calculation (ensure it's calculated correctly)
2. Ensure last_event_category_encoded is properly included
3. Add feature transformations for better model performance
4. Calculate missing features from existing data
"""

import pandas as pd
import numpy as np
from sklearn.preprocessing import LabelEncoder
import joblib

def optimize_features_for_training():
    """Optimize features before training to maximize R²."""
    print("=" * 80)
    print("OPTIMIZING MONEYPUCK FEATURES")
    print("=" * 80)
    
    # Load data
    print("\nLoading data...")
    try:
        our_shots = pd.read_csv('data/our_shots_2025.csv')
        matched = pd.read_csv('data/matched_shots_2025.csv')
        print(f"✅ Loaded {len(our_shots):,} shots")
    except Exception as e:
        print(f"❌ Error: {e}")
        return None
    
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
    print("\n🔧 Optimization 1: Fixing speed_from_last_event calculation...")
    if 'distance_from_last_event' in merged.columns and 'time_since_last_event' in merged.columns:
        # Recalculate speed if missing or zero
        mask = (merged['speed_from_last_event'].isna()) | (merged['speed_from_last_event'] == 0)
        if mask.sum() > 0:
            merged.loc[mask, 'speed_from_last_event'] = (
                merged.loc[mask, 'distance_from_last_event'] / 
                merged.loc[mask, 'time_since_last_event'].replace(0, np.nan)
            )
            print(f"   ✅ Recalculated {mask.sum():,} speed values")
        
        # Handle division by zero
        merged['speed_from_last_event'] = merged['speed_from_last_event'].replace([np.inf, -np.inf], np.nan)
        
        # Log transform for better distribution (speed can be very skewed)
        speed_positive = merged['speed_from_last_event'] > 0
        if speed_positive.sum() > 0:
            merged.loc[speed_positive, 'speed_from_last_event_log'] = np.log1p(merged.loc[speed_positive, 'speed_from_last_event'])
            print(f"   ✅ Added log-transformed speed feature")
    else:
        print("   ⚠️  Cannot calculate speed - missing distance or time columns")
    
    # OPTIMIZATION 2: Ensure last_event_category_encoded exists
    print("\n🔧 Optimization 2: Encoding last_event_category...")
    if 'last_event_category' in merged.columns:
        if 'last_event_category_encoded' not in merged.columns:
            # Try to load existing encoder
            try:
                encoder = joblib.load('last_event_category_encoder.joblib')
                merged['last_event_category_encoded'] = encoder.transform(
                    merged['last_event_category'].fillna('unknown').astype(str)
                )
                print("   ✅ Used existing encoder")
            except:
                # Create new encoder
                encoder = LabelEncoder()
                merged['last_event_category_encoded'] = encoder.fit_transform(
                    merged['last_event_category'].fillna('unknown').astype(str)
                )
                joblib.dump(encoder, 'last_event_category_encoder.joblib')
                print("   ✅ Created and saved new encoder")
        else:
            print("   ✅ Already encoded")
    else:
        print("   ⚠️  last_event_category column missing")
    
    # OPTIMIZATION 3: Add derived location features
    print("\n🔧 Optimization 3: Adding location features...")
    if 'shot_y' in merged.columns and 'east_west_location_of_shot' not in merged.columns:
        merged['east_west_location_of_shot'] = merged['shot_y']
    if 'last_event_y' in merged.columns and 'east_west_location_of_last_event' not in merged.columns:
        merged['east_west_location_of_last_event'] = merged['last_event_y']
    if 'shot_x' in merged.columns and 'north_south_location_of_shot' not in merged.columns:
        merged['north_south_location_of_shot'] = merged['shot_x']
    print("   ✅ Location features added")
    
    # OPTIMIZATION 4: Defending team skaters
    print("\n🔧 Optimization 4: Calculating defending_team_skaters_on_ice...")
    if 'defending_team_skaters_on_ice' not in merged.columns:
        if 'is_home_team' in merged.columns and 'home_skaters_on_ice' in merged.columns and 'away_skaters_on_ice' in merged.columns:
            merged['defending_team_skaters_on_ice'] = merged.apply(
                lambda row: row['away_skaters_on_ice'] if row.get('is_home_team') == 1 
                else row['home_skaters_on_ice'] if row.get('is_home_team') == 0
                else 5,
                axis=1
            )
            print("   ✅ Calculated from home/away skaters")
        else:
            merged['defending_team_skaters_on_ice'] = 5
            print("   ⚠️  Set to default (5)")
    
    # OPTIMIZATION 5: Time since powerplay started
    print("\n🔧 Optimization 5: Adding time_since_powerplay_started...")
    if 'time_since_powerplay_started' not in merged.columns:
        merged['time_since_powerplay_started'] = 0.0  # Will be calculated in future processing
        print("   ⚠️  Set to 0 (needs processing with new code)")
    
    # OPTIMIZATION 6: Fix shot_angle_plus_rebound_speed
    print("\n🔧 Optimization 6: Ensuring shot_angle_plus_rebound_speed is correct...")
    if 'shot_angle_plus_rebound_speed' not in merged.columns or merged['shot_angle_plus_rebound_speed'].isna().sum() > len(merged) * 0.5:
        # Calculate from angle change and time
        if 'angle_change_from_last_event' in merged.columns and 'time_since_last_event' in merged.columns:
            merged['shot_angle_plus_rebound_speed'] = merged.apply(
                lambda row: (row['angle_change_from_last_event'] / row['time_since_last_event']) 
                if pd.notna(row.get('angle_change_from_last_event')) and pd.notna(row.get('time_since_last_event')) and row.get('time_since_last_event', 0) > 0
                else 0.0,
                axis=1
            )
            print("   ✅ Calculated from angle_change and time")
        else:
            merged['shot_angle_plus_rebound_speed'] = 0.0
            print("   ⚠️  Set to 0 (missing source data)")
    
    # OPTIMIZATION 7: Feature transformations for better distributions
    print("\n🔧 Optimization 7: Adding feature transformations...")
    
    # Log transform distance (if it helps)
    if 'distance' in merged.columns:
        merged['distance_log'] = np.log1p(merged['distance'])
    
    # Square root of angle (for better distribution)
    if 'angle' in merged.columns:
        merged['angle_sqrt'] = np.sqrt(merged['angle'])
    
    # Interaction: distance × angle (important interaction)
    if 'distance' in merged.columns and 'angle' in merged.columns:
        merged['distance_angle_interaction'] = merged['distance'] * merged['angle'] / 100  # Normalize
        print("   ✅ Added distance × angle interaction")
    
    # OPTIMIZATION 8: Ensure all MoneyPuck 15 variables exist
    print("\n🔧 Optimization 8: Verifying all 15 MoneyPuck variables...")
    moneypuck_15 = [
        'distance', 'time_since_last_event', 'shot_type_encoded', 'speed_from_last_event',
        'angle', 'east_west_location_of_last_event', 'shot_angle_plus_rebound_speed',
        'last_event_category_encoded', 'defending_team_skaters_on_ice', 'east_west_location_of_shot',
        'is_power_play', 'time_since_powerplay_started', 'distance_from_last_event',
        'north_south_location_of_shot', 'is_empty_net'
    ]
    
    missing = [v for v in moneypuck_15 if v not in merged.columns]
    if missing:
        print(f"   ⚠️  Missing: {missing}")
    else:
        print("   ✅ All 15 variables present")
    
    # Summary
    print("\n" + "=" * 80)
    print("OPTIMIZATION SUMMARY")
    print("=" * 80)
    print(f"✅ Dataset ready: {len(merged):,} shots")
    print(f"✅ Features available: {len([c for c in merged.columns if c in moneypuck_15])}/15 MoneyPuck variables")
    
    return merged

if __name__ == "__main__":
    df = optimize_features_for_training()
    if df is not None:
        print("\n💡 Next step: Update retrain_xg_with_moneypuck.py to use optimized features")
        print("   Or save optimized dataset for training")

