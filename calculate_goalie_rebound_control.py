#!/usr/bin/env python3
"""
Calculate Goalie Rebound Control Component (AdjRP - Adjusted Rebound Percentage).

This component measures a goalie's ability to prevent and control rebounds,
a highly repeatable skill that is not fully captured by single-number GSAx.

Formula:
AdjRP = (Total Rebound Shots After Saves) / (Total Saves - Puck Freezes)

Lower AdjRP = Better (fewer rebounds allowed)
"""

import pandas as pd
import numpy as np
from datetime import datetime
import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("ERROR: Missing Supabase credentials. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)


def load_shots_with_rebound_data():
    """
    Load shots data with rebound tracking information.
    
    Returns:
        DataFrame with columns: goalie_id, game_id, period, time_remaining_seconds,
        is_goal, shot_was_on_goal, shot_goalie_froze, shot_generated_rebound,
        time_since_last_event, is_rebound, team_code, event_owner_team_id
    """
    print("=" * 80)
    print("LOADING SHOTS DATA FOR REBOUND TRACKING")
    print("=" * 80)
    
    print("Loading from Supabase raw_shots table...")
    print("(Using pagination to fetch all records)")
    
    try:
        all_shots = []
        offset = 0
        batch_size = 1000
        
        while True:
            response = supabase.table('raw_shots').select(
                'goalie_id, game_id, period, time_remaining_seconds, '
                'is_goal, shot_was_on_goal, shot_goalie_froze, shot_generated_rebound, '
                'time_since_last_event, is_rebound, team_code, event_owner_team_id, '
                'is_empty_net, time_in_period, sort_order'
            ).range(offset, offset + batch_size - 1).execute()
            
            if not response.data or len(response.data) == 0:
                break
            
            all_shots.extend(response.data)
            
            if len(response.data) < batch_size:
                break
            
            offset += batch_size
            print(f"  Fetched {len(all_shots):,} records so far...")
        
        if len(all_shots) == 0:
            print("WARNING: No data found in database")
            return None
        
        df = pd.DataFrame(all_shots)
        
        # Convert types
        df['goalie_id'] = pd.to_numeric(df['goalie_id'], errors='coerce')
        df['game_id'] = pd.to_numeric(df['game_id'], errors='coerce')
        df['period'] = pd.to_numeric(df['period'], errors='coerce')
        df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
        df['shot_was_on_goal'] = pd.to_numeric(df['shot_was_on_goal'], errors='coerce').fillna(False).astype(bool)
        df['shot_goalie_froze'] = pd.to_numeric(df['shot_goalie_froze'], errors='coerce').fillna(False).astype(bool)
        df['shot_generated_rebound'] = pd.to_numeric(df['shot_generated_rebound'], errors='coerce').fillna(False).astype(bool)
        df['time_since_last_event'] = pd.to_numeric(df['time_since_last_event'], errors='coerce')
        df['is_rebound'] = pd.to_numeric(df['is_rebound'], errors='coerce').fillna(False).astype(bool)
        df['is_empty_net'] = pd.to_numeric(df['is_empty_net'], errors='coerce').fillna(False).astype(bool)
        df['time_remaining_seconds'] = pd.to_numeric(df['time_remaining_seconds'], errors='coerce')
        df['sort_order'] = pd.to_numeric(df['sort_order'], errors='coerce')
        
        # Filter out empty-net shots and invalid goalie_ids
        df = df[df['is_empty_net'] == False].copy()
        df = df[df['goalie_id'].notna()].copy()
        df = df[df['goalie_id'] > 0].copy()
        df = df[df['game_id'].notna()].copy()
        
        # Sort by game, period, time (descending) for proper sequencing
        df = df.sort_values(['game_id', 'period', 'time_remaining_seconds'], ascending=[True, True, False]).reset_index(drop=True)
        
        print(f"\nLoaded {len(df):,} shots from database")
        print(f"   Unique goalies: {df['goalie_id'].nunique():,}")
        print(f"   Unique games: {df['game_id'].nunique():,}")
        
        return df
        
    except Exception as e:
        print(f"ERROR: Error loading from database: {e}")
        import traceback
        traceback.print_exc()
        return None


def identify_saves_and_rebounds(df):
    """
    Identify saves and track rebounds within 2 seconds.
    
    Args:
        df: DataFrame with shots data, sorted by game/period/time
        
    Returns:
        DataFrame with rebound tracking information
    """
    print("\n" + "=" * 80)
    print("IDENTIFYING SAVES AND REBOUNDS")
    print("=" * 80)
    
    # Identify saves: shots on goal that didn't score
    df['is_save'] = (df['shot_was_on_goal'] == True) & (df['is_goal'] == 0)
    
    saves_count = df['is_save'].sum()
    print(f"   Identified {saves_count:,} saves")
    
    # Track rebounds: shots within 2 seconds of a save by the same team
    df['rebound_after_save'] = False
    df['seconds_after_save'] = None
    
    # Group by game and period for proper sequencing
    rebound_count = 0
    
    for (game_id, period), group in df.groupby(['game_id', 'period']):
        group = group.sort_values('time_remaining_seconds', ascending=False).reset_index(drop=True)
        
        for idx, row in group.iterrows():
            if row['is_save']:
                # Look ahead for shots within 2 seconds by the same team
                save_time = row['time_remaining_seconds']
                save_team = row.get('event_owner_team_id') or row.get('team_code')
                
                # Check next shots in sequence
                for next_idx in range(idx + 1, min(idx + 10, len(group))):  # Check up to 10 shots ahead
                    next_row = group.iloc[next_idx]
                    next_time = next_row['time_remaining_seconds']
                    next_team = next_row.get('event_owner_team_id') or next_row.get('team_code')
                    
                    # Calculate time difference (accounting for period boundaries)
                    if next_row['period'] == row['period']:
                        time_diff = save_time - next_time
                    else:
                        # Different period, skip
                        break
                    
                    # Check if within 2 seconds and same team
                    if time_diff <= 2.0 and time_diff >= 0 and next_team == save_team:
                        df.loc[group.index[next_idx], 'rebound_after_save'] = True
                        df.loc[group.index[next_idx], 'seconds_after_save'] = time_diff
                        rebound_count += 1
                        break  # Only count first rebound after save
    
    print(f"   Identified {rebound_count:,} rebounds within 2 seconds of saves")
    
    return df


def calculate_rebound_control(df):
    """
    Calculate Adjusted Rebound Percentage (AdjRP) for each goalie with Bayesian regression.
    
    Formula:
    Raw AdjRP = (Total Rebound Shots After Saves) / (Total Saves - Puck Freezes)
    Regressed AdjRP = (S / (S + C)) × Raw_AdjRP + (C / (S + C)) × League_Mean_AdjRP
    
    Args:
        df: DataFrame with saves, rebounds, and freeze information
        
    Returns:
        DataFrame with goalie_id, total_saves, puck_freezes, rebound_shots_allowed, adj_rebound_pct,
        regressed_adjrp_c5000, regressed_adjrp_c10000, league_mean_adjrp
    """
    print("\n" + "=" * 80)
    print("CALCULATING REBOUND CONTROL (AdjRP)")
    print("=" * 80)
    
    # Aggregate by goalie
    goalie_stats = []
    
    for goalie_id, group in df.groupby('goalie_id'):
        total_saves = group['is_save'].sum()
        puck_freezes = group['shot_goalie_froze'].sum()
        rebound_shots = group['rebound_after_save'].sum()
        
        # Calculate denominator: saves minus freezes
        effective_saves = total_saves - puck_freezes
        
        # Calculate Raw AdjRP
        if effective_saves > 0:
            adj_rebound_pct = rebound_shots / effective_saves
        else:
            adj_rebound_pct = None
        
        # Calculate per-60 rate (for normalization)
        if total_saves > 0:
            rebound_shots_per_60_saves = (rebound_shots / total_saves) * 60
        else:
            rebound_shots_per_60_saves = None
        
        goalie_stats.append({
            'goalie_id': int(goalie_id),
            'total_saves': int(total_saves),
            'puck_freezes': int(puck_freezes),
            'rebound_shots_allowed': int(rebound_shots),
            'effective_saves': int(effective_saves),
            'adj_rebound_pct': adj_rebound_pct,
            'rebound_shots_per_60_saves': rebound_shots_per_60_saves
        })
    
    result_df = pd.DataFrame(goalie_stats)
    
    print(f"\nCalculated rebound control for {len(result_df):,} goalies")
    print(f"   Total saves: {result_df['total_saves'].sum():,}")
    print(f"   Total puck freezes: {result_df['puck_freezes'].sum():,}")
    print(f"   Total rebound shots: {result_df['rebound_shots_allowed'].sum():,}")
    
    # Calculate league mean AdjRP
    valid_adjrp = result_df[result_df['adj_rebound_pct'].notna()]
    if len(valid_adjrp) > 0:
        league_mean_adjrp = valid_adjrp['adj_rebound_pct'].mean()
        print(f"\n   Raw AdjRP Statistics:")
        print(f"   - Mean (League): {league_mean_adjrp:.6f}")
        print(f"   - Median: {valid_adjrp['adj_rebound_pct'].median():.4f}")
        print(f"   - Min: {valid_adjrp['adj_rebound_pct'].min():.4f}")
        print(f"   - Max: {valid_adjrp['adj_rebound_pct'].max():.4f}")
        print(f"   - Range: [{valid_adjrp['adj_rebound_pct'].min():.4f}, {valid_adjrp['adj_rebound_pct'].max():.4f}]")
    else:
        league_mean_adjrp = 0.0
        print("   WARNING: No valid AdjRP values to calculate league mean")
    
    # Apply Bayesian regression with strong priors (C=5,000 and C=10,000)
    print(f"\n   Applying Bayesian Regression:")
    print(f"   - Prior strength C=5,000 saves (Test 1)")
    print(f"   - Prior strength C=10,000 saves (Test 2)")
    print(f"   - Regression target: League Mean AdjRP = {league_mean_adjrp:.6f}")
    
    C1 = 5000  # Strong prior
    C2 = 10000  # Extreme prior
    
    result_df['league_mean_adjrp'] = league_mean_adjrp
    result_df['regressed_adjrp_c5000'] = None
    result_df['regressed_adjrp_c10000'] = None
    
    for idx, row in result_df.iterrows():
        if row['adj_rebound_pct'] is not None and row['effective_saves'] > 0:
            S = row['effective_saves']
            raw_adjrp = row['adj_rebound_pct']
            
            # Regression with C=5,000
            regressed_c5000 = (S / (S + C1)) * raw_adjrp + (C1 / (S + C1)) * league_mean_adjrp
            result_df.loc[idx, 'regressed_adjrp_c5000'] = regressed_c5000
            
            # Regression with C=10,000
            regressed_c10000 = (S / (S + C2)) * raw_adjrp + (C2 / (S + C2)) * league_mean_adjrp
            result_df.loc[idx, 'regressed_adjrp_c10000'] = regressed_c10000
    
    # Report regressed statistics
    valid_regressed_c5000 = result_df[result_df['regressed_adjrp_c5000'].notna()]
    valid_regressed_c10000 = result_df[result_df['regressed_adjrp_c10000'].notna()]
    
    if len(valid_regressed_c5000) > 0:
        print(f"\n   Regressed AdjRP (C=5,000) Statistics:")
        print(f"   - Mean: {valid_regressed_c5000['regressed_adjrp_c5000'].mean():.6f}")
        print(f"   - Std Dev: {valid_regressed_c5000['regressed_adjrp_c5000'].std():.6f}")
        print(f"   - Range: [{valid_regressed_c5000['regressed_adjrp_c5000'].min():.6f}, {valid_regressed_c5000['regressed_adjrp_c5000'].max():.6f}]")
    
    if len(valid_regressed_c10000) > 0:
        print(f"\n   Regressed AdjRP (C=10,000) Statistics:")
        print(f"   - Mean: {valid_regressed_c10000['regressed_adjrp_c10000'].mean():.6f}")
        print(f"   - Std Dev: {valid_regressed_c10000['regressed_adjrp_c10000'].std():.6f}")
        print(f"   - Range: [{valid_regressed_c10000['regressed_adjrp_c10000'].min():.6f}, {valid_regressed_c10000['regressed_adjrp_c10000'].max():.6f}]")
    
    return result_df


def store_rebound_control(goalie_stats):
    """
    Store rebound control results to database.
    
    Args:
        goalie_stats: DataFrame with rebound control statistics
    """
    print("\n" + "=" * 80)
    print("STORING REBOUND CONTROL RESULTS")
    print("=" * 80)
    
    if goalie_stats is None or len(goalie_stats) == 0:
        print("ERROR: No data to store")
        return
    
    # Round numeric columns
    goalie_stats['adj_rebound_pct'] = goalie_stats['adj_rebound_pct'].round(6)
    goalie_stats['rebound_shots_per_60_saves'] = goalie_stats['rebound_shots_per_60_saves'].round(4)
    
    # Prepare records for upsert (convert datetime to ISO string)
    records = []
    for _, row in goalie_stats.iterrows():
        record = {
            'goalie_id': int(row['goalie_id']),
            'total_saves': int(row['total_saves']),
            'puck_freezes': int(row['puck_freezes']),
            'rebound_shots_allowed': int(row['rebound_shots_allowed']),
            'effective_saves': int(row['effective_saves']),
            'adj_rebound_pct': float(row['adj_rebound_pct']) if pd.notna(row['adj_rebound_pct']) else None,
            'rebound_shots_per_60_saves': float(row['rebound_shots_per_60_saves']) if pd.notna(row['rebound_shots_per_60_saves']) else None,
            'calculated_at': datetime.now().isoformat()
        }
        records.append(record)
    
    # Upsert in batches
    batch_size = 100
    success_count = 0
    error_count = 0
    
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        
        try:
            supabase.table('goalie_rebound_control').upsert(
                batch,
                on_conflict='goalie_id'
            ).execute()
            success_count += len(batch)
        except Exception as e:
            print(f"WARNING: Failed to upsert batch {i//batch_size + 1}: {e}")
            error_count += len(batch)
    
    print(f"\nUpserted {success_count:,} goalies to database")
    if error_count > 0:
        print(f"   Failed: {error_count:,} goalies")


def main():
    """Main execution function."""
    print("=" * 80)
    print("GOALIE REBOUND CONTROL CALCULATION")
    print("=" * 80)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    
    # Load shots data
    df = load_shots_with_rebound_data()
    if df is None or len(df) == 0:
        print("ERROR: Failed to load shots data")
        return
    
    # Identify saves and rebounds
    df = identify_saves_and_rebounds(df)
    
    # Calculate rebound control
    goalie_stats = calculate_rebound_control(df)
    
    if goalie_stats is None or len(goalie_stats) == 0:
        print("ERROR: Failed to calculate rebound control")
        return
    
    # Store results
    store_rebound_control(goalie_stats)
    
    # Export to CSV
    goalie_stats.to_csv('goalie_rebound_control.csv', index=False)
    print(f"\nExported results to goalie_rebound_control.csv")
    
    print("\n" + "=" * 80)
    print("ALL OPERATIONS COMPLETE")
    print("=" * 80)
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()

