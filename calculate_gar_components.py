#!/usr/bin/env python3
"""
calculate_gar_components.py
Calculate raw GAR component rates (EVO, EVD, PPO, PPD, Penalty) for all skaters.

This script:
1. Loads shots data from raw_shots table
2. Loads TOI data from player_toi_by_situation table
3. Identifies which players were on ice for each shot (using shifts)
4. Calculates raw component rates per 60 minutes for:
   - EVO (Even Strength Offense): xGF/60 at 5v5
   - EVD (Even Strength Defense): xGA/60 at 5v5
   - PPO (Power Play Offense): xGF/60 on PP
   - PPD (Power Play Defense/Penalty Kill): xGA/60 on PK
   - Penalty Component: (Penalties Drawn - Penalties Taken)/60
5. Outputs raw component rates for Bayesian regression

Note: This script requires shift tracking to identify on-ice players.
For initial implementation, we'll use shooter's xG as a proxy for on-ice xGF,
then enhance with full on-ice tracking when available.
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
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

supabase = SupabaseRest(supabase_url, supabase_key)

# Component-specific constants
SITUATION_5V5 = "5v5"
SITUATION_PP = "PP"
SITUATION_PK = "PK"


def load_shots_data():
    """
    Load shots data from raw_shots table.
    
    Returns:
        DataFrame with columns: player_id, game_id, period, shooting_talent_adjusted_xg,
        flurry_adjusted_xg, xg_value, is_goal, is_empty_net, home_skaters_on_ice,
        away_skaters_on_ice, team_code, is_home_team
    """
    print("=" * 80)
    print("LOADING SHOTS DATA")
    print("=" * 80)
    
    print("Loading from Supabase raw_shots table...")
    print("(Using pagination to fetch all records)")
    
    try:
        all_shots = []
        offset = 0
        batch_size = 1000
        
        while True:
            batch = supabase.select(
                'raw_shots',
                select='id, player_id, game_id, period, time_remaining_seconds, shooting_talent_adjusted_xg, flurry_adjusted_xg, xg_value, is_goal, is_empty_net, home_skaters_on_ice, away_skaters_on_ice, team_code, is_home_team, goalie_id',
                limit=batch_size,
                offset=offset
            )
            
            if not batch or len(batch) == 0:
                break
            
            all_shots.extend(batch)
            
            if len(batch) < batch_size:
                break  # Last batch
            
            offset += batch_size
            print(f"  Fetched {len(all_shots):,} records so far...")
        
        if len(all_shots) == 0:
            print("WARNING: No data found in database (0 rows returned)")
            return None
        
        df = pd.DataFrame(all_shots)
        
        # Convert types
        df['player_id'] = pd.to_numeric(df['player_id'], errors='coerce')
        df['game_id'] = pd.to_numeric(df['game_id'], errors='coerce')
        df['period'] = pd.to_numeric(df['period'], errors='coerce')
        df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
        df['is_empty_net'] = pd.to_numeric(df['is_empty_net'], errors='coerce').fillna(False).astype(bool)
        df['home_skaters_on_ice'] = pd.to_numeric(df['home_skaters_on_ice'], errors='coerce').fillna(5)
        df['away_skaters_on_ice'] = pd.to_numeric(df['away_skaters_on_ice'], errors='coerce').fillna(5)
        df['is_home_team'] = pd.to_numeric(df['is_home_team'], errors='coerce').fillna(False).astype(bool)
        
        # Handle xG values with fallback logic
        df['shooting_talent_adjusted_xg'] = pd.to_numeric(
            df['shooting_talent_adjusted_xg'], errors='coerce'
        )
        df['flurry_adjusted_xg'] = pd.to_numeric(
            df['flurry_adjusted_xg'], errors='coerce'
        )
        df['xg_value'] = pd.to_numeric(
            df['xg_value'], errors='coerce'
        )
        
        # Apply fallback logic
        df['xgf_value'] = df['shooting_talent_adjusted_xg'].fillna(
            df['flurry_adjusted_xg'].fillna(df['xg_value'])
        )
        
        # Remove rows with invalid player_id or missing xG
        df = df[df['player_id'].notna()].copy()
        df = df[df['xgf_value'].notna()].copy()
        
        # Ensure xG values are non-negative
        df['xgf_value'] = df['xgf_value'].clip(lower=0.0)
        
        # Identify situation for each shot
        df['situation'] = df.apply(identify_situation_from_shot, axis=1)
        
        print(f"Loaded {len(df):,} shots from database")
        print(f"   Unique players: {df['player_id'].nunique():,}")
        print(f"   Unique games: {df['game_id'].nunique():,}")
        print(f"   Situation breakdown:")
        print(f"     5v5: {(df['situation'] == SITUATION_5V5).sum():,}")
        print(f"     PP:  {(df['situation'] == SITUATION_PP).sum():,}")
        print(f"     PK:  {(df['situation'] == SITUATION_PK).sum():,}")
        
        return df
        
    except Exception as e:
        print(f"ERROR: Error loading from database: {e}")
        import traceback
        traceback.print_exc()
        return None


def identify_situation_from_shot(row):
    """
    Identify game situation from shot row.
    
    Args:
        row: DataFrame row with home_skaters_on_ice, away_skaters_on_ice, is_empty_net, is_home_team
    
    Returns:
        Situation string: "5v5", "PP", or "PK"
    """
    home_skaters = row.get('home_skaters_on_ice', 5)
    away_skaters = row.get('away_skaters_on_ice', 5)
    is_empty_net = row.get('is_empty_net', False)
    is_home_team = row.get('is_home_team', False)
    
    # Empty net situations
    if is_empty_net:
        return SITUATION_5V5
    
    # Even strength
    if home_skaters == 5 and away_skaters == 5:
        return SITUATION_5V5
    
    # Determine if shooting team has man advantage (PP) or disadvantage (PK)
    if is_home_team:
        if home_skaters > away_skaters:
            return SITUATION_PP  # Home team on power play
        elif home_skaters < away_skaters:
            return SITUATION_PK  # Home team on penalty kill
    else:
        if away_skaters > home_skaters:
            return SITUATION_PP  # Away team on power play
        elif away_skaters < home_skaters:
            return SITUATION_PK  # Away team on penalty kill
    
    # Default to 5v5
    return SITUATION_5V5


def load_toi_data():
    """
    Load TOI data from player_toi_by_situation table.
    
    Returns:
        DataFrame with columns: player_id, game_id, situation, toi_seconds
    """
    print("\n" + "=" * 80)
    print("LOADING TOI DATA")
    print("=" * 80)
    
    print("Loading from Supabase player_toi_by_situation table...")
    
    try:
        all_toi = []
        offset = 0
        batch_size = 1000
        
        while True:
            batch = supabase.select(
                'player_toi_by_situation',
                select='player_id, game_id, situation, toi_seconds',
                limit=batch_size,
                offset=offset
            )
            
            if not batch or len(batch) == 0:
                break
            
            all_toi.extend(batch)
            
            if len(batch) < batch_size:
                break  # Last batch
            
            offset += batch_size
            print(f"  Fetched {len(all_toi):,} records so far...")
        
        if len(all_toi) == 0:
            print("WARNING: No TOI data found. Run calculate_player_toi.py first.")
            return None
        
        df = pd.DataFrame(all_toi)
        
        # Convert types
        df['player_id'] = pd.to_numeric(df['player_id'], errors='coerce')
        df['game_id'] = pd.to_numeric(df['game_id'], errors='coerce')
        df['toi_seconds'] = pd.to_numeric(df['toi_seconds'], errors='coerce')
        
        # Remove invalid rows
        df = df[df['player_id'].notna()].copy()
        df = df[df['game_id'].notna()].copy()
        df = df[df['toi_seconds'].notna()].copy()
        df = df[df['toi_seconds'] > 0].copy()
        
        # Convert to minutes
        df['toi_minutes'] = df['toi_seconds'] / 60.0
        
        print(f"Loaded {len(df):,} TOI records")
        print(f"   Unique players: {df['player_id'].nunique():,}")
        print(f"   Unique games: {df['game_id'].nunique():,}")
        
        return df
        
    except Exception as e:
        print(f"ERROR: Error loading TOI data: {e}")
        import traceback
        traceback.print_exc()
        return None


def calculate_component_rates(df_shots, df_toi):
    """
    Calculate raw component rates for each player.
    
    Args:
        df_shots: DataFrame with shot data
        df_toi: DataFrame with TOI data
    
    Returns:
        DataFrame with player_id and component rates
    """
    print("\n" + "=" * 80)
    print("CALCULATING RAW COMPONENT RATES")
    print("=" * 80)
    
    # Aggregate shots by player and situation
    # For now, we'll use shooter's xG as proxy for on-ice xGF
    # TODO: Enhance with full on-ice tracking when shifts are available
    
    print("Aggregating shots by player and situation...")
    
    # Filter out empty-net shots
    df_shots_filtered = df_shots[~df_shots['is_empty_net']].copy()
    
    # Aggregate xGF by player and situation (using shooter's xG as proxy)
    shot_aggregates = df_shots_filtered.groupby(['player_id', 'situation']).agg(
        total_xgf=('xgf_value', 'sum'),
        shot_count=('player_id', 'count')
    ).reset_index()
    
    # Aggregate TOI by player and situation
    toi_aggregates = df_toi.groupby(['player_id', 'situation']).agg(
        total_toi_minutes=('toi_minutes', 'sum')
    ).reset_index()
    
    # Merge shots and TOI
    merged = pd.merge(
        shot_aggregates,
        toi_aggregates,
        on=['player_id', 'situation'],
        how='outer'
    )
    
    # Fill missing values
    merged['total_xgf'] = merged['total_xgf'].fillna(0.0)
    merged['shot_count'] = merged['shot_count'].fillna(0)
    merged['total_toi_minutes'] = merged['total_toi_minutes'].fillna(0.0)
    
    # Calculate rates per 60 minutes
    # Rate = (Total xGF / Total TOI minutes) × 60
    merged['rate_per_60'] = np.where(
        merged['total_toi_minutes'] > 0,
        (merged['total_xgf'] / merged['total_toi_minutes']) * 60.0,
        0.0
    )
    
    # Pivot to get one row per player with columns for each situation
    component_rates = merged.pivot_table(
        index='player_id',
        columns='situation',
        values='rate_per_60',
        aggfunc='sum',
        fill_value=0.0
    ).reset_index()
    
    # Rename columns
    if SITUATION_5V5 in component_rates.columns:
        component_rates['evo_rate_raw'] = component_rates[SITUATION_5V5]
    else:
        component_rates['evo_rate_raw'] = 0.0
    
    if SITUATION_PP in component_rates.columns:
        component_rates['ppo_rate_raw'] = component_rates[SITUATION_PP]
    else:
        component_rates['ppo_rate_raw'] = 0.0
    
    # For EVD and PPD, we need shots AGAINST the player's team
    # This requires knowing which team each player is on
    # For now, we'll calculate a simplified version
    # TODO: Enhance with team tracking and on-ice xGA calculation
    
    # Placeholder for EVD and PPD (will be calculated when on-ice tracking is available)
    component_rates['evd_rate_raw'] = 0.0  # TODO: Calculate from shots against
    component_rates['ppd_rate_raw'] = 0.0  # TODO: Calculate from shots against
    
    # Penalty component (placeholder - requires penalty event data)
    component_rates['penalty_component_raw'] = 0.0  # TODO: Calculate from penalty events
    
    # Get total TOI for each player
    player_toi = df_toi.groupby('player_id').agg(
        toi_5v5_minutes=('toi_minutes', lambda x: x[df_toi.loc[x.index, 'situation'] == SITUATION_5V5].sum() if SITUATION_5V5 in df_toi.loc[x.index, 'situation'].values else 0.0),
        toi_pp_minutes=('toi_minutes', lambda x: x[df_toi.loc[x.index, 'situation'] == SITUATION_PP].sum() if SITUATION_PP in df_toi.loc[x.index, 'situation'].values else 0.0),
        toi_pk_minutes=('toi_minutes', lambda x: x[df_toi.loc[x.index, 'situation'] == SITUATION_PK].sum() if SITUATION_PK in df_toi.loc[x.index, 'situation'].values else 0.0),
        toi_total_minutes=('toi_minutes', 'sum')
    ).reset_index()
    
    # Better approach: filter by situation first
    toi_5v5 = df_toi[df_toi['situation'] == SITUATION_5V5].groupby('player_id')['toi_minutes'].sum().reset_index()
    toi_5v5.columns = ['player_id', 'toi_5v5_minutes']
    
    toi_pp = df_toi[df_toi['situation'] == SITUATION_PP].groupby('player_id')['toi_minutes'].sum().reset_index()
    toi_pp.columns = ['player_id', 'toi_pp_minutes']
    
    toi_pk = df_toi[df_toi['situation'] == SITUATION_PK].groupby('player_id')['toi_minutes'].sum().reset_index()
    toi_pk.columns = ['player_id', 'toi_pk_minutes']
    
    toi_total = df_toi.groupby('player_id')['toi_minutes'].sum().reset_index()
    toi_total.columns = ['player_id', 'toi_total_minutes']
    
    # Merge all TOI data
    player_toi = component_rates[['player_id']].merge(toi_5v5, on='player_id', how='left')
    player_toi = player_toi.merge(toi_pp, on='player_id', how='left')
    player_toi = player_toi.merge(toi_pk, on='player_id', how='left')
    player_toi = player_toi.merge(toi_total, on='player_id', how='left')
    
    # Fill missing values
    player_toi['toi_5v5_minutes'] = player_toi['toi_5v5_minutes'].fillna(0.0)
    player_toi['toi_pp_minutes'] = player_toi['toi_pp_minutes'].fillna(0.0)
    player_toi['toi_pk_minutes'] = player_toi['toi_pk_minutes'].fillna(0.0)
    player_toi['toi_total_minutes'] = player_toi['toi_total_minutes'].fillna(0.0)
    
    # Merge TOI data into component rates
    component_rates = component_rates.merge(player_toi, on='player_id', how='left')
    
    # Fill missing TOI values
    component_rates['toi_5v5_minutes'] = component_rates['toi_5v5_minutes'].fillna(0.0)
    component_rates['toi_pp_minutes'] = component_rates['toi_pp_minutes'].fillna(0.0)
    component_rates['toi_pk_minutes'] = component_rates['toi_pk_minutes'].fillna(0.0)
    component_rates['toi_total_minutes'] = component_rates['toi_total_minutes'].fillna(0.0)
    
    # Clean up pivot columns
    if SITUATION_5V5 in component_rates.columns:
        component_rates = component_rates.drop(columns=[SITUATION_5V5])
    if SITUATION_PP in component_rates.columns:
        component_rates = component_rates.drop(columns=[SITUATION_PP])
    if SITUATION_PK in component_rates.columns:
        component_rates = component_rates.drop(columns=[SITUATION_PK])
    
    print(f"Calculated component rates for {len(component_rates):,} players")
    print(f"   Players with 5v5 TOI: {(component_rates['toi_5v5_minutes'] > 0).sum():,}")
    print(f"   Players with PP TOI: {(component_rates['toi_pp_minutes'] > 0).sum():,}")
    print(f"   Players with PK TOI: {(component_rates['toi_pk_minutes'] > 0).sum():,}")
    
    return component_rates


def save_component_rates(df_rates):
    """
    Save component rates to CSV and database.
    
    Args:
        df_rates: DataFrame with component rates
    """
    print("\n" + "=" * 80)
    print("SAVING COMPONENT RATES")
    print("=" * 80)
    
    # Save to CSV
    output_file = 'player_gar_components_raw.csv'
    df_rates.to_csv(output_file, index=False)
    print(f"Saved to {output_file}")
    
    # Note: We'll save to database after regression in calculate_gar_regression.py
    print("   (Database storage will happen after regression)")


def main():
    """
    Main function to calculate GAR component rates.
    """
    print("=" * 80)
    print("CALCULATE GAR COMPONENT RATES")
    print("=" * 80)
    print()
    
    # Load data
    df_shots = load_shots_data()
    if df_shots is None:
        print("ERROR: Failed to load shots data")
        return
    
    df_toi = load_toi_data()
    if df_toi is None:
        print("WARNING: No TOI data available. Component rates will be incomplete.")
        print("   Run calculate_player_toi.py first to generate TOI data.")
        return
    
    # Calculate component rates
    df_rates = calculate_component_rates(df_shots, df_toi)
    
    if df_rates is None or len(df_rates) == 0:
        print("ERROR: Failed to calculate component rates")
        return
    
    # Save results
    save_component_rates(df_rates)
    
    print()
    print("=" * 80)
    print("COMPLETE")
    print("=" * 80)
    print()
    print("Next steps:")
    print("1. Enhance on-ice tracking for accurate EVD and PPD calculation")
    print("2. Load penalty event data for Penalty component")
    print("3. Run calculate_gar_regression.py to apply Bayesian regression")


if __name__ == "__main__":
    main()

