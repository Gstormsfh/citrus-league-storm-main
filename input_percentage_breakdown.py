#!/usr/bin/env python3
"""
input_percentage_breakdown.py

Comprehensive breakdown of all input percentages for the xG model.
Shows data quality and coverage for all features.
"""

import pandas as pd
import numpy as np

def analyze_input_percentages(csv_path='data/our_shots_2025.csv'):
    """Analyze percentage coverage for all model inputs."""
    print("=" * 80)
    print("COMPREHENSIVE INPUT PERCENTAGE BREAKDOWN")
    print("=" * 80)
    
    # Load data
    print(f"\n📁 Loading data from: {csv_path}")
    try:
        df = pd.read_csv(csv_path)
        print(f"✅ Loaded {len(df):,} shots")
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        return
    
    total_shots = len(df)
    
    # ============================================================================
    # FLURRY ADJUSTMENT INPUTS
    # ============================================================================
    print("\n" + "=" * 80)
    print("FLURRY ADJUSTMENT INPUTS")
    print("=" * 80)
    
    flurry_inputs = {
        'game_id': 'Game ID',
        'team_code': 'Team Code (shooting team)',
        'period': 'Period number',
        'time_in_period': 'Time in period (MM:SS)',
        'time_since_last_event': 'Time since last event (seconds)',
        'xg_value': 'Base xG value'
    }
    
    for col, description in flurry_inputs.items():
        if col in df.columns:
            missing = df[col].isna().sum()
            missing_pct = (missing / total_shots) * 100
            present_pct = 100 - missing_pct
            
            # Check for zero values (if numeric)
            if df[col].dtype in ['int64', 'int32', 'float64']:
                zeros = (df[col] == 0).sum()
                zeros_pct = (zeros / total_shots) * 100
                non_zero_pct = 100 - zeros_pct - missing_pct
                
                print(f"\n{description:40s} ({col})")
                print(f"  ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
                print(f"  ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
                print(f"  📊 Non-zero: {non_zero_pct:6.2f}% ({total_shots - missing - zeros:,} shots)")
                print(f"  🔢 Zero values: {zeros_pct:6.2f}% ({zeros:,} shots)")
                
                if col == 'time_since_last_event':
                    non_zero = df[df[col] > 0][col]
                    if len(non_zero) > 0:
                        print(f"  📈 Non-zero range: {non_zero.min():.2f}s to {non_zero.max():.2f}s")
                        print(f"  📈 Non-zero median: {non_zero.median():.2f}s")
            else:
                print(f"\n{description:40s} ({col})")
                print(f"  ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
                print(f"  ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
    
    # ============================================================================
    # MONEYPUCK CORE 15 VARIABLES
    # ============================================================================
    print("\n" + "=" * 80)
    print("MONEYPUCK CORE 15 VARIABLES")
    print("=" * 80)
    
    moneypuck_vars = {
        'distance': '1. Shot Distance From Net',
        'time_since_last_event': '2. Time Since Last Game Event',
        'shot_type_encoded': '3. Shot Type (encoded)',
        'speed_from_last_event': '4. Speed From Previous Event',
        'angle': '5. Shot Angle',
        'east_west_location_of_last_event': '6. East-West Location of Last Event',
        'shot_angle_plus_rebound_speed': '7. Shot Angle + Rebound Speed',
        'last_event_category_encoded': '8. Last Event Category (encoded)',
        'defending_team_skaters_on_ice': '9. Defending Team Skaters on Ice',
        'east_west_location_of_shot': '10. East-West Location of Shot',
        'is_power_play': '11. Man Advantage Situation',
        'time_since_powerplay_started': '12. Time Since Powerplay Started',
        'distance_from_last_event': '13. Distance From Previous Event',
        'north_south_location_of_shot': '14. North-South Location of Shot',
        'is_empty_net': '15. Shooting on Empty Net',
    }
    
    for col, description in moneypuck_vars.items():
        if col in df.columns:
            missing = df[col].isna().sum()
            missing_pct = (missing / total_shots) * 100
            present_pct = 100 - missing_pct
            
            # Check for zero values (if numeric)
            if df[col].dtype in ['int64', 'int32', 'float64']:
                zeros = (df[col] == 0).sum()
                zeros_pct = (zeros / total_shots) * 100
                non_zero_pct = 100 - zeros_pct - missing_pct
                
                print(f"\n{description}")
                print(f"  Column: {col}")
                print(f"  ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
                print(f"  ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
                print(f"  📊 Non-zero: {non_zero_pct:6.2f}% ({total_shots - missing - zeros:,} shots)")
                print(f"  🔢 Zero values: {zeros_pct:6.2f}% ({zeros:,} shots)")
            else:
                print(f"\n{description}")
                print(f"  Column: {col}")
                print(f"  ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
                print(f"  ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
        else:
            # Check for alternative column names
            alt_names = {
                'shot_type_encoded': ['shot_type', 'shotType'],
                'last_event_category_encoded': ['last_event_category', 'lastEventCategory'],
            }
            found = False
            if col in alt_names:
                for alt in alt_names[col]:
                    if alt in df.columns:
                        print(f"\n{description}")
                        print(f"  ⚠️  Column '{col}' not found, but '{alt}' exists")
                        found = True
                        break
            if not found:
                print(f"\n{description}")
                print(f"  ❌ Column '{col}' NOT FOUND")
    
    # ============================================================================
    # ADDITIONAL FEATURES
    # ============================================================================
    print("\n" + "=" * 80)
    print("ADDITIONAL MODEL FEATURES")
    print("=" * 80)
    
    additional_features = {
        'distance_angle_interaction': 'Distance × Angle Interaction',
        'speed_from_last_event_log': 'Log-transformed Speed',
        'is_rebound': 'Is Rebound (binary)',
        'score_differential': 'Score Differential',
        'has_pass_before_shot': 'Has Pass Before Shot',
        'pass_lateral_distance': 'Pass Lateral Distance',
        'pass_to_net_distance': 'Pass to Net Distance',
        'flurry_adjusted_xg': 'Flurry Adjusted xG',
    }
    
    for col, description in additional_features.items():
        if col in df.columns:
            missing = df[col].isna().sum()
            missing_pct = (missing / total_shots) * 100
            present_pct = 100 - missing_pct
            
            if df[col].dtype in ['int64', 'int32', 'float64']:
                zeros = (df[col] == 0).sum()
                zeros_pct = (zeros / total_shots) * 100
                non_zero_pct = 100 - zeros_pct - missing_pct
                
                print(f"\n{description:40s} ({col})")
                print(f"  ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
                print(f"  ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
                print(f"  📊 Non-zero: {non_zero_pct:6.2f}% ({total_shots - missing - zeros:,} shots)")
                print(f"  🔢 Zero values: {zeros_pct:6.2f}% ({zeros:,} shots)")
            else:
                print(f"\n{description:40s} ({col})")
                print(f"  ✅ Present: {present_pct:6.2f}% ({total_shots - missing:,} shots)")
                print(f"  ⚠️  Missing: {missing_pct:6.2f}% ({missing:,} shots)")
        else:
            print(f"\n{description:40s} ({col})")
            print(f"  ❌ NOT FOUND")
    
    # ============================================================================
    # SUMMARY STATISTICS
    # ============================================================================
    print("\n" + "=" * 80)
    print("SUMMARY STATISTICS")
    print("=" * 80)
    
    # Calculate overall data quality
    critical_cols = ['game_id', 'team_code', 'period', 'time_in_period', 'xg_value']
    all_critical_present = df[critical_cols].notna().all(axis=1).sum()
    all_critical_pct = (all_critical_present / total_shots) * 100
    
    print(f"\n📊 Overall Data Quality:")
    print(f"   Shots with all critical inputs: {all_critical_present:,} ({all_critical_pct:.2f}%)")
    
    # MoneyPuck variables coverage
    mp_cols = [col for col in moneypuck_vars.keys() if col in df.columns]
    if mp_cols:
        mp_coverage = df[mp_cols].notna().sum(axis=1)
        avg_mp_vars = mp_coverage.mean()
        print(f"   Average MoneyPuck variables per shot: {avg_mp_vars:.1f} / {len(mp_cols)}")
    
    # Feature completeness
    print(f"\n📈 Feature Completeness:")
    all_features = list(moneypuck_vars.keys()) + list(additional_features.keys())
    available_features = [col for col in all_features if col in df.columns]
    print(f"   Available features: {len(available_features)} / {len(all_features)} ({len(available_features)/len(all_features)*100:.1f}%)")
    
    print("\n" + "=" * 80)
    print("✅ BREAKDOWN COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    analyze_input_percentages()

