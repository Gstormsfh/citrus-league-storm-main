#!/usr/bin/env python3
"""
analyze_missing_data.py
Analyze what data is missing/zero and how we can fill it with actuals.
"""

import pandas as pd
import numpy as np

print("=" * 80)
print("ANALYZING MISSING DATA & ZEROS")
print("=" * 80)

# Load data
our_shots = pd.read_csv('data/our_shots_2025.csv')
matched = pd.read_csv('data/matched_shots_2025.csv')

print(f"\n📊 Total shots: {len(our_shots):,}")

# Key features to check
key_features = {
    'time_since_last_event': 'Time since last event (seconds)',
    'distance_from_last_event': 'Distance from last event (feet)',
    'speed_from_last_event': 'Speed from last event (ft/s)',
    'is_power_play': 'Power play situation',
    'is_empty_net': 'Empty net situation',
    'time_since_powerplay_started': 'Time since PP started',
    'defending_team_skaters_on_ice': 'Defending team skaters',
    'last_event_category': 'Last event type',
    'last_event_x': 'Last event X coordinate',
    'last_event_y': 'Last event Y coordinate',
}

print("\n" + "=" * 80)
print("MISSING/ZERO DATA ANALYSIS")
print("=" * 80)

for feature, description in key_features.items():
    if feature in our_shots.columns:
        total = len(our_shots)
        missing = our_shots[feature].isna().sum()
        zeros = (our_shots[feature] == 0).sum() if pd.api.types.is_numeric_dtype(our_shots[feature]) else 0
        non_zero = total - missing - zeros
        
        print(f"\n{description} ({feature}):")
        print(f"  Total: {total:,}")
        print(f"  Missing: {missing:,} ({missing/total*100:.1f}%)")
        if pd.api.types.is_numeric_dtype(our_shots[feature]):
            print(f"  Zeros: {zeros:,} ({zeros/total*100:.1f}%)")
            print(f"  Non-zero: {non_zero:,} ({non_zero/total*100:.1f}%)")
            if non_zero > 0:
                non_zero_data = our_shots[our_shots[feature] != 0][feature]
                print(f"  Non-zero mean: {non_zero_data.mean():.2f}")
                print(f"  Non-zero std: {non_zero_data.std():.2f}")
        else:
            unique = our_shots[feature].nunique()
            print(f"  Unique values: {unique}")
    else:
        print(f"\n{description} ({feature}): ❌ NOT IN DATA")

# Check if we can derive missing values
print("\n" + "=" * 80)
print("DERIVATION OPPORTUNITIES")
print("=" * 80)

# Speed from distance/time
if 'distance_from_last_event' in our_shots.columns and 'time_since_last_event' in our_shots.columns:
    can_derive_speed = (
        (our_shots['distance_from_last_event'] > 0) & 
        (our_shots['time_since_last_event'] > 0) &
        ((our_shots['speed_from_last_event'].isna()) | (our_shots['speed_from_last_event'] == 0))
    ).sum()
    print(f"\n✅ Can derive speed_from_last_event: {can_derive_speed:,} shots")
    print(f"   Formula: distance_from_last_event / time_since_last_event")

# Location features from coordinates
if 'shot_x' in our_shots.columns and 'shot_y' in our_shots.columns:
    missing_ns = (our_shots.get('north_south_location_of_shot', pd.Series([np.nan]*len(our_shots))).isna()).sum() if 'north_south_location_of_shot' in our_shots.columns else len(our_shots)
    missing_ew = (our_shots.get('east_west_location_of_shot', pd.Series([np.nan]*len(our_shots))).isna()).sum() if 'east_west_location_of_shot' in our_shots.columns else len(our_shots)
    print(f"\n✅ Can derive location features:")
    print(f"   north_south_location_of_shot from shot_x: {missing_ns:,} shots")
    print(f"   east_west_location_of_shot from shot_y: {missing_ew:,} shots")

# Defending team skaters
if 'home_skaters_on_ice' in our_shots.columns and 'away_skaters_on_ice' in our_shots.columns:
    can_derive_defending = (
        (our_shots.get('defending_team_skaters_on_ice', pd.Series([np.nan]*len(our_shots))).isna()) |
        (our_shots.get('defending_team_skaters_on_ice', pd.Series([0]*len(our_shots))) == 0)
    ).sum() if 'defending_team_skaters_on_ice' in our_shots.columns else len(our_shots)
    print(f"\n✅ Can derive defending_team_skaters_on_ice: {can_derive_defending:,} shots")
    print(f"   From home_skaters_on_ice / away_skaters_on_ice based on is_home_team")

# Check data sources
print("\n" + "=" * 80)
print("DATA SOURCE CHECK")
print("=" * 80)

# Check if we have play-by-play data we can use
if 'last_event_x' in our_shots.columns and 'last_event_y' in our_shots.columns:
    has_last_event = ((our_shots['last_event_x'].notna()) & (our_shots['last_event_y'].notna())).sum()
    print(f"\n✅ Have last event coordinates: {has_last_event:,} shots ({has_last_event/len(our_shots)*100:.1f}%)")
    if has_last_event > 0:
        print(f"   Can calculate east_west_location_of_last_event from last_event_y")
        print(f"   Can calculate distance_from_last_event from coordinates")

print("\n💡 Recommendations:")
print("   1. Derive speed_from_last_event from distance/time")
print("   2. Derive location features from shot coordinates")
print("   3. Derive defending_team_skaters_on_ice from home/away skaters")
print("   4. Use last_event coordinates to fill missing values")
print("   5. Consider reprocessing games to get full feature data")

