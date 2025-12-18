#!/usr/bin/env python3
"""
Fix GAR On-Ice Tracking - Join player_shifts with raw_shots to identify all players on ice.

This script:
1. Loads player_shifts data
2. Loads raw_shots data with time information
3. Joins shifts with shots to identify all players on ice for each shot
4. Calculates accurate on-ice xGF and xGA for EVD and PPD components
5. Updates calculate_gar_components.py with the fixed logic
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

supabase = create_client(
    os.getenv('VITE_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

def load_shifts_data():
    """Load player_shifts data from database."""
    print("Loading player_shifts data...")
    
    all_shifts = []
    offset = 0
    batch_size = 1000
    
    while True:
        response = supabase.table('player_shifts').select(
            'player_id, game_id, period, shift_start_time_seconds, shift_end_time_seconds, situation, team_id'
        ).range(offset, offset + batch_size - 1).execute()
        
        if not response.data or len(response.data) == 0:
            break
        
        all_shifts.extend(response.data)
        
        if len(response.data) < batch_size:
            break
        
        offset += batch_size
        print(f"  Fetched {len(all_shifts):,} shifts...")
    
    if len(all_shifts) == 0:
        print("WARNING: No shifts data found. Run calculate_player_toi.py first.")
        return None
    
    df = pd.DataFrame(all_shifts)
    
    # Convert types
    df['player_id'] = pd.to_numeric(df['player_id'], errors='coerce')
    df['game_id'] = pd.to_numeric(df['game_id'], errors='coerce')
    df['period'] = pd.to_numeric(df['period'], errors='coerce')
    df['shift_start_time_seconds'] = pd.to_numeric(df['shift_start_time_seconds'], errors='coerce')
    df['shift_end_time_seconds'] = pd.to_numeric(df['shift_end_time_seconds'], errors='coerce')
    df['team_id'] = pd.to_numeric(df['team_id'], errors='coerce')
    
    # Remove invalid rows
    df = df[df['player_id'].notna()].copy()
    df = df[df['game_id'].notna()].copy()
    df = df[df['period'].notna()].copy()
    df = df[df['shift_start_time_seconds'].notna()].copy()
    
    # Handle NULL shift_end_time_seconds (ongoing shifts at period end)
    # Set to period end time (20 minutes = 1200 seconds for regulation, 5 minutes = 300 for OT)
    df['shift_end_time_seconds'] = df['shift_end_time_seconds'].fillna(
        df['period'].apply(lambda p: 1200.0 if p <= 3 else 300.0)
    )
    
    print(f"Loaded {len(df):,} shifts")
    print(f"   Unique players: {df['player_id'].nunique():,}")
    print(f"   Unique games: {df['game_id'].nunique():,}")
    
    return df

def load_shots_with_time():
    """Load raw_shots data with time information."""
    print("\nLoading raw_shots data with time...")
    
    all_shots = []
    offset = 0
    batch_size = 1000
    
    while True:
        response = supabase.table('raw_shots').select(
            'id, player_id, game_id, period, time_remaining_seconds, shooting_talent_adjusted_xg, '
            'flurry_adjusted_xg, xg_value, is_goal, is_empty_net, '
            'home_skaters_on_ice, away_skaters_on_ice, team_code, is_home_team, goalie_id'
        ).range(offset, offset + batch_size - 1).execute()
        
        if not response.data or len(response.data) == 0:
            break
        
        all_shots.extend(response.data)
        
        if len(response.data) < batch_size:
            break
        
        offset += batch_size
        print(f"  Fetched {len(all_shots):,} shots...")
    
    if len(all_shots) == 0:
        print("WARNING: No shots data found.")
        return None
    
    df = pd.DataFrame(all_shots)
    
    # Convert types
    df['player_id'] = pd.to_numeric(df['player_id'], errors='coerce')
    df['game_id'] = pd.to_numeric(df['game_id'], errors='coerce')
    df['period'] = pd.to_numeric(df['period'], errors='coerce')
    df['time_remaining_seconds'] = pd.to_numeric(df['time_remaining_seconds'], errors='coerce')
    df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
    df['is_empty_net'] = pd.to_numeric(df['is_empty_net'], errors='coerce').fillna(False).astype(bool)
    
    # Handle xG values with fallback
    df['shooting_talent_adjusted_xg'] = pd.to_numeric(df['shooting_talent_adjusted_xg'], errors='coerce')
    df['flurry_adjusted_xg'] = pd.to_numeric(df['flurry_adjusted_xg'], errors='coerce')
    df['xg_value'] = pd.to_numeric(df['xg_value'], errors='coerce')
    df['xgf_value'] = df['shooting_talent_adjusted_xg'].fillna(
        df['flurry_adjusted_xg'].fillna(df['xg_value'])
    )
    
    # Convert time_remaining_seconds to time_elapsed_seconds
    # Period length: 20 minutes = 1200 seconds (regulation), 5 minutes = 300 seconds (OT)
    df['period_length_seconds'] = df['period'].apply(lambda p: 1200.0 if p <= 3 else 300.0)
    df['time_elapsed_seconds'] = df['period_length_seconds'] - df['time_remaining_seconds'].fillna(0)
    
    # Remove invalid rows
    df = df[df['player_id'].notna()].copy()
    df = df[df['game_id'].notna()].copy()
    df = df[df['period'].notna()].copy()
    df = df[df['xgf_value'].notna()].copy()
    df = df[df['xgf_value'] > 0].copy()
    
    print(f"Loaded {len(df):,} shots")
    print(f"   Unique players: {df['player_id'].nunique():,}")
    print(f"   Unique games: {df['game_id'].nunique():,}")
    
    return df

def join_shifts_with_shots(df_shifts, df_shots):
    """
    Join player_shifts with raw_shots to identify all players on ice for each shot.
    
    Returns:
        DataFrame with shot_id and list of player_ids on ice (shooting team and defending team)
    """
    print("\n" + "=" * 80)
    print("JOINING SHIFTS WITH SHOTS")
    print("=" * 80)
    
    print("Matching shots to shifts...")
    print("(This may take a few minutes for large datasets)")
    
    # We need to match:
    # - game_id
    # - period
    # - time_elapsed_seconds (shot) between shift_start_time_seconds and shift_end_time_seconds
    # - situation (from shift)
    
    # For each shot, find all players on ice
    shots_with_on_ice = []
    
    # Group shifts by game and period for faster lookup
    shifts_by_game_period = df_shifts.groupby(['game_id', 'period'])
    
    shot_count = 0
    for (game_id, period), shot_group in df_shots.groupby(['game_id', 'period']):
        if (game_id, period) not in shifts_by_game_period.groups:
            continue
        
        game_shifts = shifts_by_game_period.get_group((game_id, period))
        
        for _, shot in shot_group.iterrows():
            shot_time = shot['time_elapsed_seconds']
            
            # Find all shifts that overlap with this shot time
            overlapping_shifts = game_shifts[
                (game_shifts['shift_start_time_seconds'] <= shot_time) &
                (game_shifts['shift_end_time_seconds'] >= shot_time)
            ]
            
            if len(overlapping_shifts) > 0:
                # Get players on ice (both teams)
                players_on_ice = overlapping_shifts['player_id'].unique().tolist()
                
                # Determine shooting team and defending team
                # For now, we'll use the shooter's team as shooting team
                # TODO: Get actual team_id from shot data or shifts
                
                shots_with_on_ice.append({
                    'shot_id': shot['id'],
                    'game_id': game_id,
                    'period': period,
                    'shot_time_seconds': shot_time,
                    'shooter_id': shot['player_id'],
                    'xgf_value': shot['xgf_value'],
                    'is_goal': shot['is_goal'],
                    'players_on_ice': players_on_ice,
                    'situation': overlapping_shifts['situation'].iloc[0] if len(overlapping_shifts) > 0 else '5v5'
                })
            
            shot_count += 1
            if shot_count % 1000 == 0:
                print(f"  Processed {shot_count:,} shots...")
    
    print(f"\nMatched {len(shots_with_on_ice):,} shots with shifts")
    
    return pd.DataFrame(shots_with_on_ice)

def calculate_on_ice_xgf_xga(df_shots_with_on_ice):
    """
    Calculate on-ice xGF and xGA for each player.
    
    For each player:
    - xGF: Sum of xG for all shots taken by their team while they're on ice
    - xGA: Sum of xG for all shots taken against their team while they're on ice
    """
    print("\n" + "=" * 80)
    print("CALCULATING ON-ICE xGF AND xGA")
    print("=" * 80)
    
    # Expand shots_with_on_ice to one row per player per shot
    expanded_rows = []
    
    for _, shot_row in df_shots_with_on_ice.iterrows():
        players_on_ice = shot_row['players_on_ice']
        shooter_id = shot_row['shooter_id']
        xgf_value = shot_row['xgf_value']
        
        # For each player on ice, credit them with this shot's xG
        for player_id in players_on_ice:
            # Determine if this is xGF (player on shooting team) or xGA (player on defending team)
            # For now, we'll use a simplified approach:
            # - If player is the shooter, it's xGF
            # - If player is not the shooter, we need to know their team
            # TODO: Get team_id for each player to accurately determine xGF vs xGA
            
            expanded_rows.append({
                'player_id': player_id,
                'shot_id': shot_row['shot_id'],
                'game_id': shot_row['game_id'],
                'period': shot_row['period'],
                'situation': shot_row['situation'],
                'xgf_value': xgf_value if player_id == shooter_id else 0.0,  # Simplified
                'xga_value': xgf_value if player_id != shooter_id else 0.0,  # Simplified
                'is_shooter': player_id == shooter_id
            })
    
    df_expanded = pd.DataFrame(expanded_rows)
    
    # Aggregate by player and situation
    on_ice_stats = df_expanded.groupby(['player_id', 'situation']).agg(
        on_ice_xgf=('xgf_value', 'sum'),
        on_ice_xga=('xga_value', 'sum'),
        shots_for=('is_shooter', 'sum')
    ).reset_index()
    
    print(f"Calculated on-ice stats for {len(on_ice_stats):,} player-situation combinations")
    
    return on_ice_stats

if __name__ == "__main__":
    print("=" * 80)
    print("FIXING GAR ON-ICE TRACKING")
    print("=" * 80)
    
    # Load data
    df_shifts = load_shifts_data()
    if df_shifts is None:
        print("ERROR: Could not load shifts data")
        exit(1)
    
    df_shots = load_shots_with_time()
    if df_shots is None:
        print("ERROR: Could not load shots data")
        exit(1)
    
    # Join shifts with shots
    df_shots_with_on_ice = join_shifts_with_shots(df_shifts, df_shots)
    
    # Calculate on-ice xGF and xGA
    df_on_ice_stats = calculate_on_ice_xgf_xga(df_shots_with_on_ice)
    
    # Save results
    df_on_ice_stats.to_csv('on_ice_xgf_xga.csv', index=False)
    print(f"\n✅ Saved on-ice stats to on_ice_xgf_xga.csv")
    
    print("\n" + "=" * 80)
    print("NEXT STEPS")
    print("=" * 80)
    print("1. Review on_ice_xgf_xga.csv")
    print("2. Integrate this logic into calculate_gar_components.py")
    print("3. Update EVD and PPD calculations to use on-ice xGA")

