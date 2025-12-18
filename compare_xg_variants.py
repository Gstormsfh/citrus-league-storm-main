#!/usr/bin/env python3
"""
compare_xg_variants.py
Compare different xG variants (base, flurry-adjusted, talent-adjusted, created) 
against actual goals to see which performs best.
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from scipy.stats import pearsonr

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Supabase credentials not found")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def load_shots_from_database():
    """Load shots from database with all xG variants."""
    print("=" * 80)
    print("LOADING SHOTS FROM DATABASE")
    print("=" * 80)
    
    all_shots = []
    offset = 0
    batch_size = 1000
    
    while True:
        response = supabase.table('raw_shots').select(
            'game_id, player_id, xg_value, flurry_adjusted_xg, '
            'shooting_talent_adjusted_xg, created_expected_goals, is_goal'
        ).range(offset, offset + batch_size - 1).execute()
        
        if not response.data or len(response.data) == 0:
            break
        
        all_shots.extend(response.data)
        offset += batch_size
        print(f"  Loaded {len(all_shots):,} shots...")
        
        if len(response.data) < batch_size:
            break
    
    df = pd.DataFrame(all_shots)
    print(f"✅ Loaded {len(df):,} shots from database")
    
    # Convert numeric columns
    for col in ['xg_value', 'flurry_adjusted_xg', 'shooting_talent_adjusted_xg', 
                'created_expected_goals', 'is_goal']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
    
    return df

def compare_xg_variants(df):
    """Compare different xG variants against actual goals."""
    print("\n" + "=" * 80)
    print("COMPARING xG VARIANTS AGAINST ACTUAL GOALS")
    print("=" * 80)
    
    # Filter to shots with valid data
    df = df[df['is_goal'].notna()].copy()
    
    results = {}
    
    # Test each xG variant
    variants = {
        'Base xG': 'xg_value',
        'Flurry-Adjusted xG': 'flurry_adjusted_xg',
        'Talent-Adjusted xG': 'shooting_talent_adjusted_xg',
        'Created Expected Goals': 'created_expected_goals'
    }
    
    for variant_name, col_name in variants.items():
        if col_name not in df.columns:
            print(f"⚠️  {variant_name} column not found, skipping...")
            continue
        
        # Use flurry-adjusted as fallback if talent-adjusted is missing
        if variant_name == 'Talent-Adjusted xG':
            df[col_name] = df[col_name].fillna(df['flurry_adjusted_xg'].fillna(df['xg_value']))
        elif variant_name == 'Created Expected Goals':
            # Created xG might be 0 for many shots, use base xG as fallback
            df[col_name] = df[col_name].fillna(df['xg_value'])
        else:
            df[col_name] = df[col_name].fillna(df['xg_value'])
        
        xg_values = df[col_name]
        goals = df['is_goal']
        
        # Calculate metrics
        total_xg = xg_values.sum()
        total_goals = goals.sum()
        calibration_ratio = total_xg / total_goals if total_goals > 0 else 0
        
        r2 = r2_score(goals, xg_values)
        corr, p_value = pearsonr(xg_values, goals)
        mae = mean_absolute_error(goals, xg_values)
        rmse = np.sqrt(mean_squared_error(goals, xg_values))
        
        results[variant_name] = {
            'total_xg': total_xg,
            'total_goals': total_goals,
            'calibration_ratio': calibration_ratio,
            'r2': r2,
            'correlation': corr,
            'p_value': p_value,
            'mae': mae,
            'rmse': rmse
        }
        
        print(f"\n📊 {variant_name}:")
        print(f"   Total xG: {total_xg:.2f}")
        print(f"   Total Goals: {total_goals:.0f}")
        print(f"   Calibration Ratio: {calibration_ratio:.3f}")
        print(f"   R² Score: {r2:.4f}")
        print(f"   Correlation: {corr:.4f} (p-value: {p_value:.2e})")
        print(f"   MAE: {mae:.4f}")
        print(f"   RMSE: {rmse:.4f}")
    
    # Create comparison table
    print("\n" + "=" * 80)
    print("COMPARISON SUMMARY")
    print("=" * 80)
    print(f"{'Variant':<25} {'R²':<8} {'Correlation':<12} {'Calibration':<12} {'MAE':<8}")
    print("-" * 80)
    
    for variant_name, metrics in results.items():
        print(f"{variant_name:<25} {metrics['r2']:<8.4f} {metrics['correlation']:<12.4f} "
              f"{metrics['calibration_ratio']:<12.3f} {metrics['mae']:<8.4f}")
    
    # Find best performer
    best_r2 = max(results.items(), key=lambda x: x[1]['r2'])
    best_corr = max(results.items(), key=lambda x: x[1]['correlation'])
    best_calibration = min(results.items(), key=lambda x: abs(x[1]['calibration_ratio'] - 1.0))
    
    print("\n🏆 Best Performers:")
    print(f"   Best R²: {best_r2[0]} ({best_r2[1]['r2']:.4f})")
    print(f"   Best Correlation: {best_corr[0]} ({best_corr[1]['correlation']:.4f})")
    print(f"   Best Calibration: {best_calibration[0]} ({best_calibration[1]['calibration_ratio']:.3f})")
    
    return results

def compare_player_level(df):
    """Compare at player-season level."""
    print("\n" + "=" * 80)
    print("PLAYER-SEASON LEVEL COMPARISON")
    print("=" * 80)
    
    # Load actual player stats
    try:
        response = supabase.table('staging_2025_skaters').select(
            'playerId, I_F_goals, games_played'
        ).eq('situation', 'all').execute()
        
        actual_stats = pd.DataFrame(response.data)
        actual_stats['playerId'] = pd.to_numeric(actual_stats['playerId'], errors='coerce')
        actual_stats = actual_stats[actual_stats['playerId'].notna()].copy()
    except Exception as e:
        print(f"⚠️  Could not load actual stats: {e}")
        return
    
    # Aggregate by player
    df['player_id'] = pd.to_numeric(df['player_id'], errors='coerce')
    df = df[df['player_id'].notna()].copy()
    
    player_stats = df.groupby('player_id').agg(
        base_xg=('xg_value', 'sum'),
        flurry_xg=('flurry_adjusted_xg', 'sum'),
        talent_xg=('shooting_talent_adjusted_xg', 'sum'),
        created_xg=('created_expected_goals', 'sum'),
        goals=('is_goal', 'sum')
    ).reset_index()
    
    # Merge with actual stats
    comparison = player_stats.merge(
        actual_stats,
        left_on='player_id',
        right_on='playerId',
        how='inner'
    )
    
    # Fill missing values and ensure numeric
    comparison['talent_xg'] = pd.to_numeric(comparison['talent_xg'], errors='coerce').fillna(comparison['flurry_xg'])
    comparison['created_xg'] = pd.to_numeric(comparison['created_xg'], errors='coerce').fillna(comparison['base_xg'])
    comparison['base_xg'] = pd.to_numeric(comparison['base_xg'], errors='coerce')
    comparison['flurry_xg'] = pd.to_numeric(comparison['flurry_xg'], errors='coerce')
    comparison['I_F_goals'] = pd.to_numeric(comparison['I_F_goals'], errors='coerce')
    
    variants = {
        'Base xG': 'base_xg',
        'Flurry-Adjusted xG': 'flurry_xg',
        'Talent-Adjusted xG': 'talent_xg',
        'Created Expected Goals': 'created_xg'
    }
    
    print(f"\n📊 Player-Season Comparison ({len(comparison)} players):")
    print(f"{'Variant':<25} {'R²':<8} {'Correlation':<12}")
    print("-" * 50)
    
    for variant_name, col_name in variants.items():
        if col_name not in comparison.columns:
            continue
        
        # Filter to players with non-zero values for this variant
        variant_data = comparison[comparison[col_name] > 0].copy()
        
        if len(variant_data) < 10:  # Need at least 10 players
            print(f"{variant_name:<25} {'N/A':<8} {'N/A':<12} (insufficient data)")
            continue
        
        r2 = r2_score(variant_data['I_F_goals'], variant_data[col_name])
        corr, _ = pearsonr(variant_data[col_name], variant_data['I_F_goals'])
        
        print(f"{variant_name:<25} {r2:<8.4f} {corr:<12.4f} ({len(variant_data)} players)")

def main():
    """Main execution."""
    print("=" * 80)
    print("xG VARIANTS COMPARISON")
    print("=" * 80)
    
    # Load data
    df = load_shots_from_database()
    
    if df is None or len(df) == 0:
        print("❌ No data found")
        return
    
    # Compare variants
    results = compare_xg_variants(df)
    
    # Compare at player level
    compare_player_level(df)
    
    print("\n" + "=" * 80)
    print("✅ COMPARISON COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()

