#!/usr/bin/env python3
"""
calculate_gar_regression.py
Apply Bayesian regression to GAR component rates and calculate final GAR values.

This script:
1. Loads raw component rates from calculate_gar_components.py
2. Calculates replacement level rates (75th percentile by TOI)
3. Applies Bayesian regression to each component with component-specific thresholds
4. Calculates final GAR values (Above Replacement)
5. Stores results in player_gar_components table

Component-Specific Stabilization Thresholds:
- EVO/EVD: C = 500 TOI minutes (stabilizes faster - more common situations)
- PPO: C = 100 TOI minutes (stabilizes slower - less common, high variance)
- PPD: C = 100 TOI minutes (stabilizes slower - less common, high variance)
- Penalty: C = 1000 TOI minutes (stabilizes very slowly - rare events)
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from datetime import datetime
from typing import Dict, Optional

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("ERROR: Supabase credentials not found in .env file")
    print("   Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)

# Component-specific stabilization thresholds (in TOI minutes)
STABILIZATION_THRESHOLDS = {
    'evo': 500.0,   # EVO stabilizes faster (common situation)
    'evd': 500.0,   # EVD stabilizes faster (common situation)
    'ppo': 100.0,   # PPO stabilizes slower (less common, high variance)
    'ppd': 100.0,   # PPD stabilizes slower (less common, high variance)
    'penalty': 1000.0  # Penalty stabilizes very slowly (rare events)
}

# Replacement level percentile (configurable, default 75th)
REPLACEMENT_LEVEL_PERCENTILE = 75.0


def load_raw_component_rates():
    """
    Load raw component rates from CSV or calculate from database.
    
    Returns:
        DataFrame with player_id, component rates, and TOI data
    """
    print("=" * 80)
    print("LOADING RAW COMPONENT RATES")
    print("=" * 80)
    
    # Try loading from CSV first
    csv_file = 'player_gar_components_raw.csv'
    if os.path.exists(csv_file):
        print(f"Loading from {csv_file}...")
        df = pd.read_csv(csv_file)
        print(f"Loaded {len(df):,} players from CSV")
        return df
    
    # If CSV doesn't exist, try to load from database
    print("CSV not found. Attempting to load from database...")
    print("(Note: Run calculate_gar_components.py first to generate raw rates)")
    
    # For now, return None - user should run calculate_gar_components.py first
    return None


def calculate_replacement_level_rates(df_rates):
    """
    Calculate replacement level rates for each component.
    
    Replacement level is defined as the 75th percentile of rates by TOI.
    This represents the average performance of a fringe NHL player.
    
    Args:
        df_rates: DataFrame with component rates and TOI data
    
    Returns:
        Dictionary with replacement level rates for each component
    """
    print("\n" + "=" * 80)
    print("CALCULATING REPLACEMENT LEVEL RATES")
    print("=" * 80)
    
    rp_rates = {}
    
    # Filter players with sufficient TOI for each component
    # Use total TOI as weight for percentile calculation
    
    # EVO replacement level (75th percentile of EVO rate, weighted by 5v5 TOI)
    evo_players = df_rates[df_rates['toi_5v5_minutes'] > 0].copy()
    if len(evo_players) > 0:
        # Weight by TOI for percentile calculation
        rp_rates['evo'] = np.percentile(
            evo_players['evo_rate_raw'],
            REPLACEMENT_LEVEL_PERCENTILE
        )
        print(f"   EVO Replacement Level: {rp_rates['evo']:.4f} xGF/60")
    else:
        rp_rates['evo'] = 0.0
        print("   WARNING: No players with 5v5 TOI for EVO replacement level")
    
    # EVD replacement level (75th percentile of EVD rate, weighted by 5v5 TOI)
    evd_players = df_rates[df_rates['toi_5v5_minutes'] > 0].copy()
    if len(evd_players) > 0:
        rp_rates['evd'] = np.percentile(
            evd_players['evd_rate_raw'],
            REPLACEMENT_LEVEL_PERCENTILE
        )
        print(f"   EVD Replacement Level: {rp_rates['evd']:.4f} xGA/60")
    else:
        rp_rates['evd'] = 0.0
        print("   WARNING: No players with 5v5 TOI for EVD replacement level")
    
    # PPO replacement level (75th percentile of PPO rate, weighted by PP TOI)
    ppo_players = df_rates[df_rates['toi_pp_minutes'] > 0].copy()
    if len(ppo_players) > 0:
        rp_rates['ppo'] = np.percentile(
            ppo_players['ppo_rate_raw'],
            REPLACEMENT_LEVEL_PERCENTILE
        )
        print(f"   PPO Replacement Level: {rp_rates['ppo']:.4f} xGF/60")
    else:
        rp_rates['ppo'] = 0.0
        print("   WARNING: No players with PP TOI for PPO replacement level")
    
    # PPD replacement level (75th percentile of PPD rate, weighted by PK TOI)
    ppd_players = df_rates[df_rates['toi_pk_minutes'] > 0].copy()
    if len(ppd_players) > 0:
        rp_rates['ppd'] = np.percentile(
            ppd_players['ppd_rate_raw'],
            REPLACEMENT_LEVEL_PERCENTILE
        )
        print(f"   PPD Replacement Level: {rp_rates['ppd']:.4f} xGA/60")
    else:
        rp_rates['ppd'] = 0.0
        print("   WARNING: No players with PK TOI for PPD replacement level")
    
    # Penalty replacement level (75th percentile of Penalty component, weighted by total TOI)
    penalty_players = df_rates[df_rates['toi_total_minutes'] > 0].copy()
    if len(penalty_players) > 0:
        rp_rates['penalty'] = np.percentile(
            penalty_players['penalty_component_raw'],
            REPLACEMENT_LEVEL_PERCENTILE
        )
        print(f"   Penalty Replacement Level: {rp_rates['penalty']:.4f} (drawn - taken)/60")
    else:
        rp_rates['penalty'] = 0.0
        print("   WARNING: No players with TOI for Penalty replacement level")
    
    return rp_rates


def apply_bayesian_regression(df_rates, rp_rates):
    """
    Apply Bayesian regression to each component rate.
    
    Formula: Regressed_Rate = (TOI / (TOI + C)) × Raw_Rate + (C / (TOI + C)) × RP_Rate
    
    Where:
    - TOI = Time on ice in minutes for the component
    - C = Stabilization threshold (component-specific)
    - Raw_Rate = Raw component rate
    - RP_Rate = Replacement level rate
    
    Args:
        df_rates: DataFrame with raw component rates and TOI
        rp_rates: Dictionary with replacement level rates
    
    Returns:
        DataFrame with regressed rates added
    """
    print("\n" + "=" * 80)
    print("APPLYING BAYESIAN REGRESSION")
    print("=" * 80)
    
    df = df_rates.copy()
    
    # EVO regression
    c_evo = STABILIZATION_THRESHOLDS['evo']
    df['evo_rate_regressed'] = np.where(
        df['toi_5v5_minutes'] > 0,
        (df['toi_5v5_minutes'] / (df['toi_5v5_minutes'] + c_evo)) * df['evo_rate_raw'] +
        (c_evo / (df['toi_5v5_minutes'] + c_evo)) * rp_rates['evo'],
        rp_rates['evo']  # Default to replacement level if no TOI
    )
    
    # EVD regression
    c_evd = STABILIZATION_THRESHOLDS['evd']
    df['evd_rate_regressed'] = np.where(
        df['toi_5v5_minutes'] > 0,
        (df['toi_5v5_minutes'] / (df['toi_5v5_minutes'] + c_evd)) * df['evd_rate_raw'] +
        (c_evd / (df['toi_5v5_minutes'] + c_evd)) * rp_rates['evd'],
        rp_rates['evd']  # Default to replacement level if no TOI
    )
    
    # PPO regression
    c_ppo = STABILIZATION_THRESHOLDS['ppo']
    df['ppo_rate_regressed'] = np.where(
        df['toi_pp_minutes'] > 0,
        (df['toi_pp_minutes'] / (df['toi_pp_minutes'] + c_ppo)) * df['ppo_rate_raw'] +
        (c_ppo / (df['toi_pp_minutes'] + c_ppo)) * rp_rates['ppo'],
        rp_rates['ppo']  # Default to replacement level if no TOI
    )
    
    # PPD regression
    c_ppd = STABILIZATION_THRESHOLDS['ppd']
    df['ppd_rate_regressed'] = np.where(
        df['toi_pk_minutes'] > 0,
        (df['toi_pk_minutes'] / (df['toi_pk_minutes'] + c_ppd)) * df['ppd_rate_raw'] +
        (c_ppd / (df['toi_pk_minutes'] + c_ppd)) * rp_rates['ppd'],
        rp_rates['ppd']  # Default to replacement level if no TOI
    )
    
    # Penalty regression
    c_penalty = STABILIZATION_THRESHOLDS['penalty']
    df['penalty_component_regressed'] = np.where(
        df['toi_total_minutes'] > 0,
        (df['toi_total_minutes'] / (df['toi_total_minutes'] + c_penalty)) * df['penalty_component_raw'] +
        (c_penalty / (df['toi_total_minutes'] + c_penalty)) * rp_rates['penalty'],
        rp_rates['penalty']  # Default to replacement level if no TOI
    )
    
    print(f"Applied Bayesian regression to {len(df):,} players")
    
    return df


def calculate_final_gar_values(df_rates, rp_rates):
    """
    Calculate final GAR values (Above Replacement) for each component.
    
    Formula: Component_GAR = (Regressed_Rate - RP_Rate) × TOI_Projected / 60
    
    For per-60 calculation: Component_GAR_per_60 = Regressed_Rate - RP_Rate
    
    Args:
        df_rates: DataFrame with regressed rates
        rp_rates: Dictionary with replacement level rates
    
    Returns:
        DataFrame with GAR values added
    """
    print("\n" + "=" * 80)
    print("CALCULATING FINAL GAR VALUES")
    print("=" * 80)
    
    df = df_rates.copy()
    
    # Calculate GAR per 60 minutes for each component
    # GAR_per_60 = Regressed_Rate - RP_Rate
    
    df['evo_gar_per_60'] = df['evo_rate_regressed'] - rp_rates['evo']
    df['evd_gar_per_60'] = rp_rates['evd'] - df['evd_rate_regressed']  # Inverted (lower is better)
    df['ppo_gar_per_60'] = df['ppo_rate_regressed'] - rp_rates['ppo']
    df['ppd_gar_per_60'] = rp_rates['ppd'] - df['ppd_rate_regressed']  # Inverted (lower is better)
    df['penalty_gar_per_60'] = df['penalty_component_regressed'] - rp_rates['penalty']
    
    # Total GAR per 60 = sum of all components
    df['total_gar_per_60'] = (
        df['evo_gar_per_60'] +
        df['evd_gar_per_60'] +
        df['ppo_gar_per_60'] +
        df['ppd_gar_per_60'] +
        df['penalty_gar_per_60']
    )
    
    print(f"Calculated GAR values for {len(df):,} players")
    print(f"   Average Total GAR/60: {df['total_gar_per_60'].mean():.4f}")
    print(f"   GAR/60 range: [{df['total_gar_per_60'].min():.4f}, {df['total_gar_per_60'].max():.4f}]")
    
    return df


def store_gar_components(df_gar, rp_rates, season: int = 2025):
    """
    Store GAR components in database.
    
    Args:
        df_gar: DataFrame with all GAR component data
        season: Season year (default: 2025)
    """
    print("\n" + "=" * 80)
    print("STORING GAR COMPONENTS IN DATABASE")
    print("=" * 80)
    
    # Prepare data for database
    records = []
    
    for _, row in df_gar.iterrows():
        record = {
            'player_id': int(row['player_id']),
            'season': season,
            # Raw rates
            'evo_rate_raw': float(row['evo_rate_raw']) if pd.notna(row['evo_rate_raw']) else None,
            'evd_rate_raw': float(row['evd_rate_raw']) if pd.notna(row['evd_rate_raw']) else None,
            'ppo_rate_raw': float(row['ppo_rate_raw']) if pd.notna(row['ppo_rate_raw']) else None,
            'ppd_rate_raw': float(row['ppd_rate_raw']) if pd.notna(row['ppd_rate_raw']) else None,
            'penalty_component_raw': float(row['penalty_component_raw']) if pd.notna(row['penalty_component_raw']) else None,
            # Regressed rates
            'evo_rate_regressed': float(row['evo_rate_regressed']) if pd.notna(row['evo_rate_regressed']) else None,
            'evd_rate_regressed': float(row['evd_rate_regressed']) if pd.notna(row['evd_rate_regressed']) else None,
            'ppo_rate_regressed': float(row['ppo_rate_regressed']) if pd.notna(row['ppo_rate_regressed']) else None,
            'ppd_rate_regressed': float(row['ppd_rate_regressed']) if pd.notna(row['ppd_rate_regressed']) else None,
            'penalty_component_regressed': float(row['penalty_component_regressed']) if pd.notna(row['penalty_component_regressed']) else None,
            # Replacement level rates (same for all players)
            'rp_evo_rate': float(row.get('rp_evo_rate', 0.0)) if pd.notna(row.get('rp_evo_rate', 0.0)) else None,
            'rp_evd_rate': float(row.get('rp_evd_rate', 0.0)) if pd.notna(row.get('rp_evd_rate', 0.0)) else None,
            'rp_ppo_rate': float(row.get('rp_ppo_rate', 0.0)) if pd.notna(row.get('rp_ppo_rate', 0.0)) else None,
            'rp_ppd_rate': float(row.get('rp_ppd_rate', 0.0)) if pd.notna(row.get('rp_ppd_rate', 0.0)) else None,
            'rp_penalty_rate': float(row.get('rp_penalty_rate', 0.0)) if pd.notna(row.get('rp_penalty_rate', 0.0)) else None,
            # TOI data
            'toi_5v5_minutes': float(row['toi_5v5_minutes']) if pd.notna(row['toi_5v5_minutes']) else None,
            'toi_pp_minutes': float(row['toi_pp_minutes']) if pd.notna(row['toi_pp_minutes']) else None,
            'toi_pk_minutes': float(row['toi_pk_minutes']) if pd.notna(row['toi_pk_minutes']) else None,
            'toi_total_minutes': float(row['toi_total_minutes']) if pd.notna(row['toi_total_minutes']) else None,
            # Final GAR values
            'evo_gar_per_60': float(row['evo_gar_per_60']) if pd.notna(row['evo_gar_per_60']) else None,
            'evd_gar_per_60': float(row['evd_gar_per_60']) if pd.notna(row['evd_gar_per_60']) else None,
            'ppo_gar_per_60': float(row['ppo_gar_per_60']) if pd.notna(row['ppo_gar_per_60']) else None,
            'ppd_gar_per_60': float(row['ppd_gar_per_60']) if pd.notna(row['ppd_gar_per_60']) else None,
            'penalty_gar_per_60': float(row['penalty_gar_per_60']) if pd.notna(row['penalty_gar_per_60']) else None,
            'total_gar_per_60': float(row['total_gar_per_60']) if pd.notna(row['total_gar_per_60']) else None,
        }
        records.append(record)
    
    # Add replacement level rates to all records
    for record in records:
        record['rp_evo_rate'] = rp_rates['evo']
        record['rp_evd_rate'] = rp_rates['evd']
        record['rp_ppo_rate'] = rp_rates['ppo']
        record['rp_ppd_rate'] = rp_rates['ppd']
        record['rp_penalty_rate'] = rp_rates['penalty']
    
    # Batch upsert
    print(f"Upserting {len(records):,} records...")
    
    try:
        chunk_size = 1000
        for i in range(0, len(records), chunk_size):
            chunk = records[i:i + chunk_size]
            result = supabase.table('player_gar_components').upsert(
                chunk,
                on_conflict='player_id,season'
            ).execute()
            print(f"  Upserted records {i+1}-{min(i+chunk_size, len(records))}")
        
        print(f"Successfully stored {len(records):,} GAR component records")
        
    except Exception as e:
        print(f"ERROR: Error storing GAR components: {e}")
        import traceback
        traceback.print_exc()


def save_to_csv(df_gar, rp_rates):
    """
    Save final GAR data to CSV.
    
    Args:
        df_gar: DataFrame with all GAR data
        rp_rates: Dictionary with replacement level rates
    """
    print("\n" + "=" * 80)
    print("SAVING TO CSV")
    print("=" * 80)
    
    # Save main GAR data
    output_file = 'player_gar_components.csv'
    df_gar.to_csv(output_file, index=False)
    print(f"Saved to {output_file}")
    
    # Save replacement level rates
    rp_df = pd.DataFrame([rp_rates])
    rp_file = 'replacement_level_rates.csv'
    rp_df.to_csv(rp_file, index=False)
    print(f"Saved replacement levels to {rp_file}")


def main():
    """
    Main function to apply regression and calculate final GAR values.
    """
    print("=" * 80)
    print("CALCULATE GAR REGRESSION AND FINAL VALUES")
    print("=" * 80)
    print()
    
    # Load raw component rates
    df_rates = load_raw_component_rates()
    if df_rates is None:
        print("ERROR: Failed to load raw component rates")
        print("   Please run calculate_gar_components.py first")
        return
    
    # Calculate replacement level rates
    rp_rates = calculate_replacement_level_rates(df_rates)
    
    # Apply Bayesian regression
    df_regressed = apply_bayesian_regression(df_rates, rp_rates)
    
    # Calculate final GAR values
    df_gar = calculate_final_gar_values(df_regressed, rp_rates)
    
    # Add replacement level rates to dataframe for storage
    df_gar['rp_evo_rate'] = rp_rates['evo']
    df_gar['rp_evd_rate'] = rp_rates['evd']
    df_gar['rp_ppo_rate'] = rp_rates['ppo']
    df_gar['rp_ppd_rate'] = rp_rates['ppd']
    df_gar['rp_penalty_rate'] = rp_rates['penalty']
    
    # Save to CSV
    save_to_csv(df_gar, rp_rates)
    
    # Store in database
    store_gar_components(df_gar, rp_rates, season=2025)
    
    print()
    print("=" * 80)
    print("COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    main()

