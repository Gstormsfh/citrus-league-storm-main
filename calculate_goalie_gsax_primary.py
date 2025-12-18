#!/usr/bin/env python3
"""
Calculate Goals Saved Above Expected (GSAx) for PRIMARY SHOTS ONLY.

This script is identical to calculate_goalie_gsax.py but filters to primary shots only:
- Excludes rebounds (is_rebound == False OR time_since_last_event >= 3.0 seconds)
- Primary shots are more stable and repeatable than rebounds
- Used as Component 2 of the G-GAR model

This script:
1. Loads historical shots data from raw_shots table
2. Filters to primary shots only (non-rebounds)
3. Filters out empty-net shots
4. Aggregates by goalie_id
5. Calculates raw GSAx = total_xGA - total_GA
6. Applies Bayesian regression
7. Outputs regressed GSAx for primary shots
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from datetime import datetime

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


def load_historical_shots_data():
    """
    Load historical shots data from raw_shots table, including rebound/time information.
    
    Returns:
        DataFrame with columns: goalie_id, is_goal, shooting_talent_adjusted_xg, 
        flurry_adjusted_xg, xg_value, is_empty_net, is_rebound, time_since_last_event
    """
    print("=" * 80)
    print("LOADING HISTORICAL SHOTS DATA")
    print("=" * 80)
    
    print("Loading from Supabase raw_shots table...")
    print("(Using pagination to fetch all records)")
    
    try:
        all_shots = []
        offset = 0
        batch_size = 1000
        
        while True:
            response = supabase.table('raw_shots').select(
                'goalie_id, is_goal, shooting_talent_adjusted_xg, flurry_adjusted_xg, xg_value, is_empty_net, '
                'game_id, period, distance, angle, is_power_play, shot_type, '
                'is_rebound, time_since_last_event'
            ).range(offset, offset + batch_size - 1).execute()
            
            if not response.data or len(response.data) == 0:
                break
            
            all_shots.extend(response.data)
            
            if len(response.data) < batch_size:
                break
            
            offset += batch_size
            print(f"  Fetched {len(all_shots):,} records so far...")
        
        if len(all_shots) == 0:
            print("WARNING: No data found in database (0 rows returned)")
            return None
        
        df = pd.DataFrame(all_shots)
        
        # Convert types
        df['goalie_id'] = pd.to_numeric(df['goalie_id'], errors='coerce')
        df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
        df['is_empty_net'] = pd.to_numeric(df['is_empty_net'], errors='coerce').fillna(False).astype(bool)
        df['is_rebound'] = pd.to_numeric(df['is_rebound'], errors='coerce').fillna(False).astype(bool)
        df['time_since_last_event'] = pd.to_numeric(df['time_since_last_event'], errors='coerce')
        
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
        df['xga_value'] = df['shooting_talent_adjusted_xg'].fillna(
            df['flurry_adjusted_xg'].fillna(df['xg_value'])
        )
        
        # Log fallback cases
        missing_talent = df['shooting_talent_adjusted_xg'].isna().sum()
        using_flurry = (df['shooting_talent_adjusted_xg'].isna() & df['flurry_adjusted_xg'].notna()).sum()
        using_base = (df['shooting_talent_adjusted_xg'].isna() & df['flurry_adjusted_xg'].isna() & df['xg_value'].notna()).sum()
        
        if missing_talent > 0:
            print(f"WARNING: Fallback cases:")
            print(f"   Missing talent-adjusted xG: {missing_talent:,} shots")
            print(f"   Using flurry-adjusted xG: {using_flurry:,} shots")
            print(f"   Using base xG: {using_base:,} shots")
        
        # Comprehensive data validation (same as regular GSAx)
        initial_count = len(df)
        print(f"\n   Starting data validation (initial count: {initial_count:,} shots)")
        
        # Step 1: Remove rows with invalid goalie_id or missing xG
        df = df[df['goalie_id'].notna()].copy()
        df = df[df['xga_value'].notna()].copy()
        
        # Step 2: Ensure xG values are non-negative
        df['xga_value'] = df['xga_value'].clip(lower=0.0)
        
        # Step 3: Filter out zero xG values
        df = df[df['xga_value'] > 0.0].copy()
        
        # Step 4: Validate xG range (cap at 0.50)
        df['xga_value'] = df['xga_value'].clip(lower=0.001, upper=0.50)
        
        # Step 5: Validate goalie_id
        df = df[df['goalie_id'] > 0].copy()
        df['goalie_id'] = df['goalie_id'].astype(int)
        
        # Step 6: Filter to PRIMARY SHOTS ONLY
        # Primary shots: non-rebounds OR time >= 3 seconds since last event
        before_primary_filter = len(df)
        
        # Handle missing time_since_last_event (treat as primary if is_rebound is False)
        df['is_primary'] = (
            (df['is_rebound'] == False) | 
            (df['time_since_last_event'].notna() & (df['time_since_last_event'] >= 3.0))
        )
        
        df = df[df['is_primary'] == True].copy()
        
        removed_rebounds = before_primary_filter - len(df)
        
        print(f"\n   PRIMARY SHOTS FILTER:")
        print(f"   - Removed {removed_rebounds:,} rebound shots")
        print(f"   - Remaining primary shots: {len(df):,}")
        
        # Final data quality reporting
        final_count = len(df)
        retention_rate = (final_count / initial_count * 100) if initial_count > 0 else 0
        
        print(f"\n   Final dataset:")
        print(f"   - Total primary shots: {len(df):,}")
        print(f"   - Unique goalies: {df['goalie_id'].nunique():,}")
        if 'game_id' in df.columns:
            print(f"   - Unique games: {df['game_id'].nunique():,}")
        
        return df
        
    except Exception as e:
        print(f"ERROR: Error loading from database: {e}")
        import traceback
        traceback.print_exc()
        return None


def calculate_raw_gsax(df_shots):
    """
    Calculate raw GSAx for each goalie (primary shots only).
    
    Args:
        df_shots: DataFrame with goalie_id, is_goal, xga_value, is_empty_net
        
    Returns:
        DataFrame with goalie_id, total_shots_faced, total_xGA, total_GA, raw_gsax
    """
    print("\n" + "=" * 80)
    print("CALCULATING RAW GSAX (PRIMARY SHOTS ONLY)")
    print("=" * 80)
    
    # Filter out empty-net shots
    df_filtered = df_shots[~df_shots['is_empty_net']].copy()
    
    empty_net_count = len(df_shots) - len(df_filtered)
    if empty_net_count > 0:
        print(f"   Filtered out {empty_net_count:,} empty-net shots")
    
    print(f"   Processing {len(df_filtered):,} primary shots")
    
    # Aggregate by goalie
    goalie_stats = df_filtered.groupby('goalie_id').agg(
        total_shots_faced=('goalie_id', 'count'),
        total_xGA=('xga_value', 'sum'),
        total_GA=('is_goal', 'sum')
    ).reset_index()
    
    # Calculate raw GSAx
    goalie_stats['raw_gsax'] = goalie_stats['total_xGA'] - goalie_stats['total_GA']
    
    print(f"\nCalculated raw GSAx for {len(goalie_stats):,} goalies")
    print(f"   Total primary shots faced: {goalie_stats['total_shots_faced'].sum():,}")
    print(f"   Total xGA: {goalie_stats['total_xGA'].sum():.2f}")
    print(f"   Total GA: {goalie_stats['total_GA'].sum():,}")
    print(f"   Average raw GSAx: {goalie_stats['raw_gsax'].mean():.2f}")
    print(f"   Raw GSAx range: [{goalie_stats['raw_gsax'].min():.2f}, {goalie_stats['raw_gsax'].max():.2f}]")
    
    return goalie_stats


def calculate_bayesian_regression(goalie_stats):
    """
    Apply Bayesian regression to shrink low-sample goalies toward league average.
    
    Formula: GSAx_reg = (S / (S + C)) × Raw_GSAx + (C / (S + C)) × 0
    
    Args:
        goalie_stats: DataFrame with goalie_id, total_shots_faced, raw_gsax
        
    Returns:
        DataFrame with regressed_gsax and league_sv_pct added
    """
    print("\n" + "=" * 80)
    print("APPLYING BAYESIAN REGRESSION")
    print("=" * 80)
    
    # Calculate league average save percentage
    total_shots = goalie_stats['total_shots_faced'].sum()
    total_goals = goalie_stats['total_GA'].sum()
    total_xGA = goalie_stats['total_xGA'].sum()
    
    if total_shots == 0:
        print("ERROR: No shots available for league average calculation")
        return None
    
    league_sv_pct = 1.0 - (total_goals / total_shots)
    league_gsax = total_xGA - total_goals
    
    print(f"   League statistics (primary shots only):")
    print(f"   Total shots: {total_shots:,}")
    print(f"   Total goals: {total_goals:,}")
    print(f"   Total xGA: {total_xGA:.2f}")
    print(f"   League save %: {league_sv_pct:.4f}")
    print(f"   League GSAx: {league_gsax:.2f} (should be ~ 0)")
    
    # Prior strength constant (same as regular GSAx)
    C = 500
    
    print(f"\n   Prior strength (C): {C:,} shots")
    
    # Apply Bayesian regression
    goalie_stats['regressed_gsax'] = (
        (goalie_stats['total_shots_faced'] / (goalie_stats['total_shots_faced'] + C)) * goalie_stats['raw_gsax'] +
        (C / (goalie_stats['total_shots_faced'] + C)) * 0.0
    )
    
    goalie_stats['league_sv_pct'] = league_sv_pct
    
    print(f"\nApplied Bayesian regression to {len(goalie_stats):,} goalies")
    print(f"   Regressed GSAx range: [{goalie_stats['regressed_gsax'].min():.2f}, {goalie_stats['regressed_gsax'].max():.2f}]")
    
    return goalie_stats


def main():
    """Main execution function."""
    print("\n" + "=" * 80)
    print("GOALIE PRIMARY SHOTS GSAX CALCULATION")
    print("=" * 80)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Load data
    df_shots = load_historical_shots_data()
    if df_shots is None or len(df_shots) == 0:
        print("ERROR: Failed to load shots data")
        return
    
    # Calculate raw GSAx
    goalie_stats = calculate_raw_gsax(df_shots)
    if goalie_stats is None or len(goalie_stats) == 0:
        print("ERROR: Failed to calculate raw GSAx")
        return
    
    # Apply Bayesian regression
    goalie_stats = calculate_bayesian_regression(goalie_stats)
    if goalie_stats is None:
        print("ERROR: Failed to apply Bayesian regression")
        return
    
    # Add timestamp
    goalie_stats['calculated_at'] = datetime.now()
    
    # Round numeric columns
    goalie_stats['total_xGA'] = goalie_stats['total_xGA'].round(4)
    goalie_stats['raw_gsax'] = goalie_stats['raw_gsax'].round(4)
    goalie_stats['regressed_gsax'] = goalie_stats['regressed_gsax'].round(4)
    goalie_stats['league_sv_pct'] = goalie_stats['league_sv_pct'].round(4)
    
    # Display top and bottom goalies
    print("\n" + "=" * 80)
    print("TOP 10 GOALIES BY REGRESSED PRIMARY SHOTS GSAX")
    print("=" * 80)
    top_goalies = goalie_stats.nlargest(10, 'regressed_gsax')[
        ['goalie_id', 'total_shots_faced', 'total_GA', 'raw_gsax', 'regressed_gsax']
    ]
    print(top_goalies.to_string(index=False))
    
    print("\n" + "=" * 80)
    print("BOTTOM 10 GOALIES BY REGRESSED PRIMARY SHOTS GSAX")
    print("=" * 80)
    bottom_goalies = goalie_stats.nsmallest(10, 'regressed_gsax')[
        ['goalie_id', 'total_shots_faced', 'total_GA', 'raw_gsax', 'regressed_gsax']
    ]
    print(bottom_goalies.to_string(index=False))
    
    print(f"\nPrimary shots GSAx calculation complete!")
    print(f"   Total goalies processed: {len(goalie_stats):,}")
    print(f"   Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    return goalie_stats


def upsert_to_database(goalie_stats):
    """Upsert primary shots GSAx results to goalie_gsax_primary table."""
    print("\n" + "=" * 80)
    print("UPSERTING TO DATABASE")
    print("=" * 80)
    
    try:
        records = []
        for _, row in goalie_stats.iterrows():
            record = {
                'goalie_id': int(row['goalie_id']),
                'total_shots_faced': int(row['total_shots_faced']),
                # IMPORTANT: Postgres lower-cases unquoted identifiers.
                # The actual columns are `total_xga` and `total_ga`.
                'total_xga': float(row['total_xGA']),
                'total_ga': int(row['total_GA']),
                'raw_gsax': float(row['raw_gsax']),
                'regressed_gsax': float(row['regressed_gsax']),
                'league_sv_pct': float(row['league_sv_pct']) if pd.notna(row['league_sv_pct']) else None,
                'calculated_at': row['calculated_at'].isoformat() if pd.notna(row.get('calculated_at')) else None
            }
            records.append(record)
        
        batch_size = 100
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            try:
                supabase.table('goalie_gsax_primary').upsert(
                    batch,
                    on_conflict='goalie_id'
                ).execute()
            except Exception as e:
                print(f"WARNING: Failed to upsert batch: {e}")
                for record in batch:
                    try:
                        supabase.table('goalie_gsax_primary').upsert(
                            record,
                            on_conflict='goalie_id'
                        ).execute()
                    except Exception as e2:
                        print(f"   WARNING: Failed to upsert goalie_id {record['goalie_id']}: {e2}")
        
        print(f"\nUpserted {len(records):,} goalies to database")
        
    except Exception as e:
        print(f"ERROR: Error upserting to database: {e}")
        import traceback
        traceback.print_exc()


def main_with_export():
    """Main execution function with export."""
    results = main()
    
    if results is not None and len(results) > 0:
        # Export to CSV
        results.to_csv('goalie_gsax_primary.csv', index=False)
        print(f"\nExported results to goalie_gsax_primary.csv")
        
        # Upsert to database
        upsert_to_database(results)
        
        print("\n" + "=" * 80)
        print("ALL OPERATIONS COMPLETE")
        print("=" * 80)
    else:
        print("\nERROR: No results to export")


if __name__ == "__main__":
    main_with_export()

