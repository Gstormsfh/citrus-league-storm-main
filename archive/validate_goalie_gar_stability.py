#!/usr/bin/env python3
"""
Split-half stability test for combined G-GAR metric.

Tests if the combined G-GAR metric has better stability than single-number GSAx.
Target: r > 0.40 (vs baseline r=0.1721 for single GSAx)
"""

import pandas as pd
import numpy as np
from scipy.stats import pearsonr
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
supabase = create_client(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))


def load_goalie_shots_for_gar(goalie_id):
    """Load all shots for a goalie needed for G-GAR calculation."""
    all_shots = []
    offset = 0
    batch_size = 1000
    
    while True:
        response = supabase.table('raw_shots').select(
            'goalie_id, is_goal, shooting_talent_adjusted_xg, flurry_adjusted_xg, xg_value, '
            'is_empty_net, is_rebound, time_since_last_event, shot_was_on_goal, '
            'shot_goalie_froze, shot_generated_rebound, game_id, period, time_remaining_seconds, '
            'team_code, event_owner_team_id'
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
    
    # Filter and validate
    df = df[df['xga_value'].notna()].copy()
    df = df[df['xga_value'] > 0.0].copy()
    df['xga_value'] = df['xga_value'].clip(lower=0.001, upper=0.50)
    df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
    df['is_rebound'] = pd.to_numeric(df['is_rebound'], errors='coerce').fillna(False).astype(bool)
    df['time_since_last_event'] = pd.to_numeric(df['time_since_last_event'], errors='coerce')
    df['shot_was_on_goal'] = pd.to_numeric(df['shot_was_on_goal'], errors='coerce').fillna(False).astype(bool)
    
    return df


def calculate_rebound_control_for_shots(df_shots):
    """
    Calculate rebound control component using same logic as full implementation.
    Identifies saves and tracks rebounds within 2 seconds.
    """
    if len(df_shots) == 0:
        return None
    
    # Sort by game, period, time for proper sequencing
    if 'game_id' in df_shots.columns and 'period' in df_shots.columns and 'time_remaining_seconds' in df_shots.columns:
        df_sorted = df_shots.sort_values(['game_id', 'period', 'time_remaining_seconds'], ascending=[True, True, False]).reset_index(drop=True)
    else:
        df_sorted = df_shots.copy()
    
    # Identify saves
    df_sorted['is_save'] = (df_sorted['shot_was_on_goal'] == True) & (df_sorted['is_goal'] == 0)
    saves_count = df_sorted['is_save'].sum()
    
    # Track rebounds: shots within 2 seconds of a save by the same team
    df_sorted['rebound_after_save'] = False
    
    rebound_count = 0
    if 'game_id' in df_sorted.columns and 'period' in df_sorted.columns:
        for (game_id, period), group in df_sorted.groupby(['game_id', 'period']):
            group = group.sort_values('time_remaining_seconds', ascending=False).reset_index(drop=True)
            
            for idx, row in group.iterrows():
                if row['is_save']:
                    save_time = row['time_remaining_seconds']
                    save_team = row.get('event_owner_team_id') or row.get('team_code')
                    
                    # Check next shots in sequence
                    for next_idx in range(idx + 1, min(idx + 10, len(group))):
                        next_row = group.iloc[next_idx]
                        next_time = next_row['time_remaining_seconds']
                        next_team = next_row.get('event_owner_team_id') or next_row.get('team_code')
                        
                        if next_row['period'] == row['period']:
                            time_diff = save_time - next_time
                        else:
                            break
                        
                        if time_diff <= 2.0 and time_diff >= 0 and next_team == save_team:
                            df_sorted.loc[group.index[next_idx], 'rebound_after_save'] = True
                            rebound_count += 1
                            break
    
    # Calculate AdjRP
    puck_freezes = df_sorted['shot_goalie_froze'].sum() if 'shot_goalie_froze' in df_sorted.columns else 0
    effective_saves = saves_count - puck_freezes
    
    if effective_saves > 0:
        adj_rebound_pct = rebound_count / effective_saves
    else:
        adj_rebound_pct = 0.0
    
    return adj_rebound_pct, saves_count, rebound_count


def calculate_primary_gsax_for_shots(df_shots, C=500):
    """Calculate primary shots GSAx using same logic as full implementation."""
    if len(df_shots) == 0:
        return 0.0, 0
    
    # Filter to primary shots (non-rebounds or time >= 3s)
    df_primary = df_shots[
        (df_shots['is_rebound'] == False) | 
        (df_shots['time_since_last_event'].notna() & (df_shots['time_since_last_event'] >= 3.0))
    ].copy()
    
    if len(df_primary) == 0:
        return 0.0, 0
    
    # Calculate raw GSAx
    total_xga = df_primary['xga_value'].sum()
    total_ga = df_primary['is_goal'].sum()
    raw_gsax = total_xga - total_ga
    shots_primary = len(df_primary)
    
    # Apply regression
    regressed_gsax = (shots_primary / (shots_primary + C)) * raw_gsax
    
    return regressed_gsax, shots_primary


def calculate_gar_for_shots_with_regression(df_shots, primary_C=500, w1=0.3, w2=0.7, 
                                           rebound_C=None, rebound_mean=None, rebound_std=None,
                                           raw_adjrp_mean=None, raw_adjrp_std=None):
    """
    Calculate G-GAR for a set of shots with optional rebound control regression.
    
    Args:
        df_shots: DataFrame with shots data
        primary_C: Regression constant for primary GSAx
        w1, w2: Component weights
        rebound_C: Regression constant for rebound control (None = use raw)
        rebound_mean, rebound_std: For regressed AdjRP standardization
        raw_adjrp_mean, raw_adjrp_std: For raw AdjRP standardization
    """
    if len(df_shots) == 0:
        return None
    
    # Calculate rebound control
    adj_rebound_pct, saves_count, rebound_count = calculate_rebound_control_for_shots(df_shots)
    
    if adj_rebound_pct is None:
        return None
    
    # Apply regression to AdjRP if specified
    if rebound_C is not None and rebound_mean is not None:
        # Apply Bayesian regression: (S / (S + C)) × Raw + (C / (S + C)) × Mean
        effective_saves = saves_count
        if effective_saves > 0:
            regressed_adjrp = (effective_saves / (effective_saves + rebound_C)) * adj_rebound_pct + (rebound_C / (effective_saves + rebound_C)) * rebound_mean
        else:
            regressed_adjrp = rebound_mean
        
        # Standardize regressed AdjRP
        if rebound_std is not None and rebound_std > 0:
            rebound_control_z = (regressed_adjrp - rebound_mean) / rebound_std
            rebound_control_score = -1 * rebound_control_z
        else:
            rebound_control_score = 0.0
    else:
        # Use raw AdjRP
        if raw_adjrp_mean is not None and raw_adjrp_std is not None and raw_adjrp_std > 0:
            rebound_control_z = (adj_rebound_pct - raw_adjrp_mean) / raw_adjrp_std
            rebound_control_score = -1 * rebound_control_z
        else:
            # Use raw AdjRP (inverted, lower is better)
            rebound_control_score = -adj_rebound_pct
    
    # Calculate primary shots GSAx
    regressed_gsax_primary, shots_primary = calculate_primary_gsax_for_shots(df_shots, primary_C)
    
    # Calculate combined G-GAR
    total_gar = w1 * rebound_control_score + w2 * regressed_gsax_primary
    
    return {
        'regressed_gsax_primary': regressed_gsax_primary,
        'rebound_control_score': rebound_control_score,
        'total_gar': total_gar,
        'shots_primary': shots_primary,
        'saves': saves_count,
        'adj_rebound_pct': adj_rebound_pct
    }


def perform_split_half_test_all_configs(min_shots=200, C=500):
    """Perform split-half correlation test for all G-GAR configurations."""
    print("=" * 80)
    print("G-GAR SPLIT-HALF STABILITY TEST (ALL CONFIGURATIONS)")
    print("=" * 80)
    print(f"Minimum shots per goalie: {min_shots}")
    print(f"Primary GSAx regression constant (C): {C}")
    print(f"Testing 7 configurations:")
    print(f"  1. Raw AdjRP, w1=0.3, w2=0.7 (baseline)")
    print(f"  2. Regressed C=5,000, w1=0.3, w2=0.7")
    print(f"  3. Regressed C=10,000, w1=0.3, w2=0.7")
    print(f"  4. Regressed C=5,000, w1=0.10, w2=0.90")
    print(f"  5. Regressed C=10,000, w1=0.10, w2=0.90")
    print(f"  6. Regressed C=5,000, w1=0.05, w2=0.95")
    print(f"  7. Regressed C=10,000, w1=0.05, w2=0.95")
    print()
    
    # Load goalie list from G-GAR table
    try:
        response = supabase.table('goalie_gar').select('goalie_id').execute()
        goalies_df = pd.DataFrame(response.data)
    except:
        print("ERROR: Could not load goalie list. Run calculate_goalie_gar.py first.")
        return None
    
    if len(goalies_df) == 0:
        print("ERROR: No goalies found in goalie_gar table")
        return None
    
    print(f"Testing {len(goalies_df)} goalies")
    print()
    
    # First pass: collect all AdjRP values to calculate mean/std for standardization
    print("  Step 1: Calculating standardization parameters...")
    all_adjrp_values = []
    all_regressed_c5000_values = []
    all_regressed_c10000_values = []
    
    # Load from CSV if available (has regressed values)
    try:
        gar_df = pd.read_csv('goalie_gar_all_configs.csv')
        if 'regressed_adjrp_c5000' in gar_df.columns:
            all_regressed_c5000_values = gar_df['regressed_adjrp_c5000'].dropna().tolist()
        if 'regressed_adjrp_c10000' in gar_df.columns:
            all_regressed_c10000_values = gar_df['regressed_adjrp_c10000'].dropna().tolist()
        all_adjrp_values = gar_df['adj_rebound_pct'].dropna().tolist()
    except:
        # Fallback: calculate from shots
        for idx, row in goalies_df.iterrows():
            goalie_id = int(row['goalie_id'])
            shots_df = load_goalie_shots_for_gar(goalie_id)
            
            if len(shots_df) < min_shots:
                continue
            
            adj_rebound_pct, _, _ = calculate_rebound_control_for_shots(shots_df)
            if adj_rebound_pct is not None:
                all_adjrp_values.append(adj_rebound_pct)
    
    # Calculate standardization parameters
    if len(all_adjrp_values) > 0:
        adjrp_mean = np.mean(all_adjrp_values)
        adjrp_std = np.std(all_adjrp_values)
        print(f"    Raw AdjRP mean: {adjrp_mean:.6f}, std: {adjrp_std:.6f}")
    else:
        adjrp_mean = None
        adjrp_std = None
    
    if len(all_regressed_c5000_values) > 0:
        regressed_c5000_mean = np.mean(all_regressed_c5000_values)
        regressed_c5000_std = np.std(all_regressed_c5000_values)
        print(f"    Regressed AdjRP (C=5,000) mean: {regressed_c5000_mean:.6f}, std: {regressed_c5000_std:.6f}")
    else:
        regressed_c5000_mean = None
        regressed_c5000_std = None
    
    if len(all_regressed_c10000_values) > 0:
        regressed_c10000_mean = np.mean(all_regressed_c10000_values)
        regressed_c10000_std = np.std(all_regressed_c10000_values)
        print(f"    Regressed AdjRP (C=10,000) mean: {regressed_c10000_mean:.6f}, std: {regressed_c10000_std:.6f}")
    else:
        regressed_c10000_mean = None
        regressed_c10000_std = None
    
    print()
    print("  Step 2: Performing split-half test for all configurations...")
    
    # Define all configurations to test
    configs = [
        ('w30_raw', 0.3, 0.7, None, None, None),  # Raw AdjRP, w1=0.3, w2=0.7
        ('w30_c5000', 0.3, 0.7, 5000, regressed_c5000_mean, regressed_c5000_std),  # Regressed C=5,000, w1=0.3, w2=0.7
        ('w30_c10000', 0.3, 0.7, 10000, regressed_c10000_mean, regressed_c10000_std),  # Regressed C=10,000, w1=0.3, w2=0.7
        ('w10_c5000', 0.10, 0.90, 5000, regressed_c5000_mean, regressed_c5000_std),  # Regressed C=5,000, w1=0.10, w2=0.90
        ('w10_c10000', 0.10, 0.90, 10000, regressed_c10000_mean, regressed_c10000_std),  # Regressed C=10,000, w1=0.10, w2=0.90
        ('w5_c5000', 0.05, 0.95, 5000, regressed_c5000_mean, regressed_c5000_std),  # Regressed C=5,000, w1=0.05, w2=0.95
        ('w5_c10000', 0.05, 0.95, 10000, regressed_c10000_mean, regressed_c10000_std),  # Regressed C=10,000, w1=0.05, w2=0.95
    ]
    
    results = {config_name: [] for config_name, _, _, _, _, _ in configs}
    
    for idx, row in goalies_df.iterrows():
        goalie_id = int(row['goalie_id'])
        
        # Load shots for this goalie
        shots_df = load_goalie_shots_for_gar(goalie_id)
        
        if len(shots_df) < min_shots:
            continue
        
        # Random split
        np.random.seed(42)
        shots_df = shots_df.sample(frac=1, random_state=goalie_id).reset_index(drop=True)
        mid_point = len(shots_df) // 2
        
        half_a = shots_df.iloc[:mid_point]
        half_b = shots_df.iloc[mid_point:]
        
        # Calculate G-GAR for each configuration
        for config_name, w1, w2, rebound_C, rebound_mean, rebound_std in configs:
            gar_a = calculate_gar_for_shots_with_regression(half_a, C, w1, w2, rebound_C, rebound_mean, rebound_std, adjrp_mean, adjrp_std)
            gar_b = calculate_gar_for_shots_with_regression(half_b, C, w1, w2, rebound_C, rebound_mean, rebound_std, adjrp_mean, adjrp_std)
            
            if gar_a is None or gar_b is None:
                continue
            
            results[config_name].append({
                'goalie_id': goalie_id,
                'total_shots': len(shots_df),
                'gar_half_a': gar_a['total_gar'],
                'gar_half_b': gar_b['total_gar'],
                'difference': abs(gar_a['total_gar'] - gar_b['total_gar']),
                'primary_gsax_a': gar_a['regressed_gsax_primary'],
                'primary_gsax_b': gar_b['regressed_gsax_primary'],
                'rebound_control_a': gar_a['rebound_control_score'],
                'rebound_control_b': gar_b['rebound_control_score']
            })
        
        total_processed = sum(len(r) for r in results.values())
        if total_processed % 10 == 0:
            print(f"  Processed {total_processed} goalie-configurations...")
    
    # Calculate correlations for each configuration
    all_results = {}
    
    for config_name, w1, w2, rebound_C, _, _ in configs:
        config_results = results[config_name]
        
        if len(config_results) < 10:
            print(f"  WARNING: Configuration {config_name} has only {len(config_results)} valid splits (need >= 10)")
            continue
        
        results_df = pd.DataFrame(config_results)
        
        # Calculate correlation
        r, p = pearsonr(results_df['gar_half_a'], results_df['gar_half_b'])
        
        all_results[config_name] = {
            'r': r,
            'p': p,
            'n': len(results_df),
            'mean_diff': results_df['difference'].mean(),
            'median_diff': results_df['difference'].median(),
            'df': results_df
        }
        
        print(f"\n  Configuration: {config_name} (w1={w1}, w2={w2}, rebound_C={rebound_C})")
        print(f"    Sample size: {len(results_df)} goalies")
        print(f"    Correlation (r): {r:.4f}")
        print(f"    P-value: {p:.4f}")
        print(f"    Average absolute difference: {results_df['difference'].mean():.4f}")
    
    # Save results for all configurations
    os.makedirs('validation_results', exist_ok=True)
    
    # Save individual configuration results
    for config_name, result_data in all_results.items():
        result_data['df'].to_csv(f'validation_results/goalie_gar_stability_{config_name}.csv', index=False)
    
    # Save summary
    summary_data = []
    for config_name, result_data in all_results.items():
        summary_data.append({
            'configuration': config_name,
            'correlation_r': result_data['r'],
            'p_value': result_data['p'],
            'sample_size': result_data['n'],
            'mean_difference': result_data['mean_diff'],
            'median_difference': result_data['median_diff']
        })
    
    summary_df = pd.DataFrame(summary_data)
    summary_df.to_csv('validation_results/goalie_gar_stability_summary.csv', index=False)
    print(f"\nResults saved to validation_results/goalie_gar_stability_*.csv")
    print(f"Summary saved to validation_results/goalie_gar_stability_summary.csv")
    
    return all_results


if __name__ == "__main__":
    result = perform_split_half_test_all_configs(min_shots=200, C=500)
    
    if result:
        print("\n" + "=" * 80)
        print("TEST COMPLETE - ALL CONFIGURATIONS")
        print("=" * 80)
        
        baseline_r = 0.1721
        best_config = None
        best_r = -1
        
        print(f"\nBaseline (single GSAx): r = {baseline_r:.4f}")
        print(f"Target: r > {baseline_r:.4f} (improve over baseline)")
        print(f"\nConfiguration Results:")
        print("-" * 80)
        
        for config_name, result_data in sorted(result.items(), key=lambda x: x[1]['r'], reverse=True):
            r = result_data['r']
            improvement = ((r - baseline_r) / baseline_r * 100) if baseline_r > 0 else 0
            status = "PASS" if r > baseline_r else "FAIL"
            
            print(f"{config_name:20s}: r = {r:.4f} ({improvement:+.1f}%) [{status}]")
            
            if r > best_r:
                best_r = r
                best_config = config_name
        
        print("-" * 80)
        print(f"\nBest Configuration: {best_config} (r = {best_r:.4f})")
        
        if best_r > baseline_r:
            improvement = ((best_r - baseline_r) / baseline_r * 100)
            print(f"SUCCESS: Best configuration shows {improvement:.1f}% improvement over baseline")
        else:
            print(f"WARNING: No configuration exceeds baseline (r = {baseline_r:.4f})")
            print("Consider:")
            print("  - Further adjusting component weights")
            print("  - Testing different regression constants")
            print("  - Improving rebound tracking accuracy")
            print("  - Increasing minimum sample size")

