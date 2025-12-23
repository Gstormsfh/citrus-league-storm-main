#!/usr/bin/env python3
"""
Split-half stability test for GSAx.
Splits each goalie's shots into two random halves and calculates correlation.
"""

import pandas as pd
import numpy as np
from scipy.stats import pearsonr
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
supabase = create_client(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

def load_goalie_shots(goalie_id):
    """Load all shots for a specific goalie."""
    all_shots = []
    offset = 0
    batch_size = 1000
    
    while True:
        response = supabase.table('raw_shots').select(
            'goalie_id, is_goal, shooting_talent_adjusted_xg, flurry_adjusted_xg, xg_value, is_empty_net'
        ).eq('goalie_id', goalie_id).eq('is_empty_net', False).range(offset, offset + batch_size - 1).execute()
        
        if not response.data or len(response.data) == 0:
            break
        
        all_shots.extend(response.data)
        
        if len(response.data) < batch_size:
            break
        
        offset += batch_size
    
    if len(all_shots) == 0:
        return pd.DataFrame()
    
    df = pd.DataFrame(all_shots)
    
    # Apply xG fallback
    df['shooting_talent_adjusted_xg'] = pd.to_numeric(df['shooting_talent_adjusted_xg'], errors='coerce')
    df['flurry_adjusted_xg'] = pd.to_numeric(df['flurry_adjusted_xg'], errors='coerce')
    df['xg_value'] = pd.to_numeric(df['xg_value'], errors='coerce')
    df['xga_value'] = df['shooting_talent_adjusted_xg'].fillna(
        df['flurry_adjusted_xg'].fillna(df['xg_value'])
    )
    
    # Filter: non-zero xG, valid range
    df = df[df['xga_value'].notna()].copy()
    df = df[df['xga_value'] > 0.0].copy()
    df['xga_value'] = df['xga_value'].clip(lower=0.001, upper=0.50)
    df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
    
    return df


def calculate_gsax_regressed(total_shots, raw_gsax, C=500):
    """Calculate regressed GSAx."""
    if total_shots == 0:
        return 0.0
    return (total_shots / (total_shots + C)) * raw_gsax


def perform_split_half_test(min_shots=200, C=500):
    """Perform split-half correlation test."""
    print("=" * 80)
    print("GSAX SPLIT-HALF STABILITY TEST")
    print("=" * 80)
    print(f"Minimum shots per goalie: {min_shots}")
    print(f"Regression constant (C): {C}")
    print()
    
    # Load goalie list from CSV
    try:
        goalies_df = pd.read_csv('goalie_gsax.csv')
    except FileNotFoundError:
        print("ERROR: goalie_gsax.csv not found. Run calculate_goalie_gsax.py first.")
        return None
    
    # Filter goalies with enough shots
    eligible_goalies = goalies_df[goalies_df['total_shots_faced'] >= min_shots].copy()
    print(f"Testing {len(eligible_goalies)} goalies with >= {min_shots} shots")
    print()
    
    results = []
    
    for idx, row in eligible_goalies.iterrows():
        goalie_id = int(row['goalie_id'])
        total_shots = int(row['total_shots_faced'])
        
        # Load shots for this goalie
        shots_df = load_goalie_shots(goalie_id)
        
        if len(shots_df) < min_shots:
            continue
        
        # Random split (use fixed seed for reproducibility)
        np.random.seed(42)
        shots_df = shots_df.sample(frac=1, random_state=goalie_id).reset_index(drop=True)
        mid_point = len(shots_df) // 2
        
        half_a = shots_df.iloc[:mid_point]
        half_b = shots_df.iloc[mid_point:]
        
        # Calculate raw GSAx for each half
        xga_a = half_a['xga_value'].sum()
        ga_a = half_a['is_goal'].sum()
        raw_gsax_a = xga_a - ga_a
        
        xga_b = half_b['xga_value'].sum()
        ga_b = half_b['is_goal'].sum()
        raw_gsax_b = xga_b - ga_b
        
        # Apply regression
        gsax_reg_a = calculate_gsax_regressed(len(half_a), raw_gsax_a, C)
        gsax_reg_b = calculate_gsax_regressed(len(half_b), raw_gsax_b, C)
        
        results.append({
            'goalie_id': goalie_id,
            'total_shots': total_shots,
            'gsax_reg_half_a': gsax_reg_a,
            'gsax_reg_half_b': gsax_reg_b,
            'difference': abs(gsax_reg_a - gsax_reg_b)
        })
        
        if len(results) % 10 == 0:
            print(f"  Processed {len(results)} goalies...")
    
    if len(results) < 10:
        print(f"ERROR: Only {len(results)} goalies with valid splits (need >= 10)")
        return None
    
    results_df = pd.DataFrame(results)
    
    # Calculate correlation
    r, p = pearsonr(results_df['gsax_reg_half_a'], results_df['gsax_reg_half_b'])
    
    print(f"\nResults:")
    print(f"  Sample size: {len(results_df)} goalies")
    print(f"  Correlation (r): {r:.4f}")
    print(f"  P-value: {p:.4f}")
    print(f"  Target: r > 0.60")
    print(f"  Status: {'PASS' if r >= 0.60 else 'FAIL'}")
    print(f"\n  Average absolute difference: {results_df['difference'].mean():.4f}")
    print(f"  Median absolute difference: {results_df['difference'].median():.4f}")
    
    # Save results
    os.makedirs('validation_results', exist_ok=True)
    results_df.to_csv('validation_results/gsax_stability_results.csv', index=False)
    print(f"\nResults saved to validation_results/gsax_stability_results.csv")
    
    return r, p, results_df


if __name__ == "__main__":
    result = perform_split_half_test(min_shots=200, C=500)
    
    if result:
        r, p, df = result
        print("\n" + "=" * 80)
        print("TEST COMPLETE")
        print("=" * 80)
        print(f"\nStability correlation: r = {r:.4f}")
        if r >= 0.60:
            print("SUCCESS: GSAx shows good stability (r >= 0.60)")
        else:
            print(f"WARNING: Stability correlation below target (r < 0.60)")
            print("Consider:")
            print("  - Reducing regression constant C further")
            print("  - Increasing minimum sample size")
            print("  - Checking for data quality issues")

