#!/usr/bin/env python3
"""
calculate_goalie_gsax.py
Calculate Goals Saved Above Expected (GSAx) for goaltenders using Bayesian regression.

This script:
1. Loads historical shots data from raw_shots table
2. Filters out empty-net shots
3. Aggregates by goalie_id (opposing goalie who faced the shot)
4. Calculates raw GSAx = total_xGA - total_GA
5. Applies Bayesian regression to handle low-sample goalies
6. Outputs regressed GSAx for each goalie
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

# Season label for storing results in `goalie_gsax` (table may include historical seasons).
# For NHL game IDs like 2025020xxx, the season year is 2025.
SEASON = 2025

def load_historical_shots_data():
    """
    Load historical shots data from raw_shots table.
    
    Returns:
        DataFrame with columns: goalie_id, is_goal, shooting_talent_adjusted_xg, 
        flurry_adjusted_xg, xg_value, is_empty_net
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
                'goalie_id, goalie_name, is_goal, shooting_talent_adjusted_xg, flurry_adjusted_xg, xg_value, is_empty_net, '
                'game_id, period, distance, angle, is_power_play, shot_type'
            ).range(offset, offset + batch_size - 1).execute()
            
            if not response.data or len(response.data) == 0:
                break
            
            all_shots.extend(response.data)
            
            if len(response.data) < batch_size:
                break  # Last batch
            
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
        
        # Handle xG values with fallback logic
        # Priority: shooting_talent_adjusted_xg > flurry_adjusted_xg > xg_value
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
        
        # Log fallback cases for data quality monitoring
        missing_talent = df['shooting_talent_adjusted_xg'].isna().sum()
        using_flurry = (df['shooting_talent_adjusted_xg'].isna() & df['flurry_adjusted_xg'].notna()).sum()
        using_base = (df['shooting_talent_adjusted_xg'].isna() & df['flurry_adjusted_xg'].isna() & df['xg_value'].notna()).sum()
        missing_all = df['xga_value'].isna().sum()
        
        if missing_talent > 0:
            print(f"WARNING: Fallback cases:")
            print(f"   Missing talent-adjusted xG: {missing_talent:,} shots")
            print(f"   Using flurry-adjusted xG: {using_flurry:,} shots")
            print(f"   Using base xG: {using_base:,} shots")
            if missing_all > 0:
                print(f"   Missing all xG values: {missing_all:,} shots (will be excluded)")
        
        # Comprehensive data validation and filtering (similar to xG model)
        initial_count = len(df)
        print(f"\n   Starting data validation (initial count: {initial_count:,} shots)")
        
        # Step 1: Remove rows with invalid goalie_id or missing xG
        before_validation = len(df)
        df = df[df['goalie_id'].notna()].copy()
        df = df[df['xga_value'].notna()].copy()
        removed_missing = before_validation - len(df)
        
        # Step 2: Ensure xG values are non-negative
        df['xga_value'] = df['xga_value'].clip(lower=0.0)
        
        # Step 3: Filter out zero xG values (data quality issues, not real shots)
        before_zero_filter = len(df)
        df = df[df['xga_value'] > 0.0].copy()
        removed_zero_xg = before_zero_filter - len(df)
        
        # Step 4: Validate xG range (realistic shot probabilities: 0.001 to 0.50)
        # Cap at 0.50 (same as xG model - MoneyPuck xG rarely exceeds 0.5)
        before_range_filter = len(df)
        df['xga_value'] = df['xga_value'].clip(lower=0.001, upper=0.50)
        # Note: We clip but don't remove - very high xG values are just capped
        
        # Step 5: Validate goalie_id (must be positive integer)
        before_goalie_filter = len(df)
        df = df[df['goalie_id'] > 0].copy()
        df['goalie_id'] = df['goalie_id'].astype(int)
        removed_invalid_goalie = before_goalie_filter - len(df)
        
        # Step 6: Validate game_id if available
        if 'game_id' in df.columns:
            before_game_filter = len(df)
            df = df[df['game_id'].notna()].copy()
            df = df[df['game_id'] > 0].copy()
            removed_invalid_game = before_game_filter - len(df)
        else:
            removed_invalid_game = 0
        
        # Step 7: Validate distance and angle if available (optional)
        if 'distance' in df.columns:
            df['distance'] = pd.to_numeric(df['distance'], errors='coerce')
            df = df[(df['distance'].isna()) | (df['distance'] > 0)].copy()
        
        if 'angle' in df.columns:
            df['angle'] = pd.to_numeric(df['angle'], errors='coerce')
            df = df[(df['angle'].isna()) | ((df['angle'] >= 0) & (df['angle'] <= 90))].copy()
        
        # Data quality reporting
        final_count = len(df)
        total_removed = initial_count - final_count
        retention_rate = (final_count / initial_count * 100) if initial_count > 0 else 0
        
        print(f"\n   Data validation results:")
        print(f"   - Removed {removed_missing:,} rows with missing goalie_id or xG")
        print(f"   - Removed {removed_zero_xg:,} rows with zero xG values")
        print(f"   - Removed {removed_invalid_goalie:,} rows with invalid goalie_id")
        if removed_invalid_game > 0:
            print(f"   - Removed {removed_invalid_game:,} rows with invalid game_id")
        print(f"   - Total removed: {total_removed:,} rows ({100 - retention_rate:.1f}%)")
        print(f"   - Final count: {final_count:,} shots ({retention_rate:.1f}% retention)")
        
        if retention_rate < 95:
            print(f"   WARNING: Low data retention ({retention_rate:.1f}%) - may indicate data quality issues")
        
        # xG value distribution reporting
        if len(df) > 0:
            print(f"\n   xG value distribution:")
            print(f"   - Min: {df['xga_value'].min():.4f}")
            print(f"   - Max: {df['xga_value'].max():.4f}")
            print(f"   - Mean: {df['xga_value'].mean():.4f}")
            print(f"   - Median: {df['xga_value'].median():.4f}")
            print(f"   - 95th percentile: {df['xga_value'].quantile(0.95):.4f}")
        
        # Check xG coverage
        talent_coverage = (df['shooting_talent_adjusted_xg'].notna().sum() / len(df)) * 100 if len(df) > 0 else 0
        if talent_coverage < 90:
            print(f"   WARNING: Only {talent_coverage:.1f}% of shots have talent-adjusted xG")
        else:
            print(f"   Data quality: {talent_coverage:.1f}% of shots have talent-adjusted xG")
        
        print(f"\n   Final dataset:")
        print(f"   - Total shots: {len(df):,}")
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
    Calculate raw GSAx for each goalie.
    
    Args:
        df_shots: DataFrame with goalie_id, is_goal, xga_value, is_empty_net
    
    Returns:
        DataFrame with goalie_id, total_shots_faced, total_xGA, total_GA, raw_gsax
    """
    print("\n" + "=" * 80)
    print("CALCULATING RAW GSAX")
    print("=" * 80)
    
    # Filter out empty-net shots
    df_filtered = df_shots[~df_shots['is_empty_net']].copy()
    
    empty_net_count = len(df_shots) - len(df_filtered)
    if empty_net_count > 0:
        print(f"   Filtered out {empty_net_count:,} empty-net shots")
    
    print(f"   Processing {len(df_filtered):,} shots")
    
    # Aggregate by goalie (include goalie_name if available)
    if 'goalie_name' in df_filtered.columns:
        goalie_stats = df_filtered.groupby('goalie_id').agg(
            goalie_name=('goalie_name', 'first'),  # Get first non-null name
            total_shots_faced=('goalie_id', 'count'),
            total_xGA=('xga_value', 'sum'),
            total_GA=('is_goal', 'sum')
        ).reset_index()
        # Clean up goalie_name (use first non-null value per goalie)
        goalie_stats['goalie_name'] = goalie_stats['goalie_name'].fillna('')
    else:
        goalie_stats = df_filtered.groupby('goalie_id').agg(
            total_shots_faced=('goalie_id', 'count'),
            total_xGA=('xga_value', 'sum'),
            total_GA=('is_goal', 'sum')
        ).reset_index()
        goalie_stats['goalie_name'] = None
    
    # Calculate raw GSAx
    goalie_stats['raw_gsax'] = goalie_stats['total_xGA'] - goalie_stats['total_GA']
    
    print(f"\nCalculated raw GSAx for {len(goalie_stats):,} goalies")
    print(f"   Total shots faced: {goalie_stats['total_shots_faced'].sum():,}")
    print(f"   Total xGA: {goalie_stats['total_xGA'].sum():.2f}")
    print(f"   Total GA: {goalie_stats['total_GA'].sum():,}")
    print(f"   Average raw GSAx: {goalie_stats['raw_gsax'].mean():.2f}")
    print(f"   Raw GSAx range: [{goalie_stats['raw_gsax'].min():.2f}, {goalie_stats['raw_gsax'].max():.2f}]")
    
    return goalie_stats


def calculate_bayesian_regression(goalie_stats):
    """
    Apply Bayesian regression to shrink low-sample goalies toward league average.
    
    Formula: GSAx_reg = (S / (S + C)) × Raw_GSAx + (C / (S + C)) × 0
    
    Where:
    - S = shots faced by goalie
    - C = 1,000 (prior strength constant)
    - 0 = league-average GSAx
    
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
    league_gsax = total_xGA - total_goals  # Should be close to 0
    
    print(f"   League statistics:")
    print(f"   Total shots: {total_shots:,}")
    print(f"   Total goals: {total_goals:,}")
    print(f"   Total xGA: {total_xGA:.2f}")
    print(f"   League save %: {league_sv_pct:.4f}")
    print(f"   League GSAx: {league_gsax:.2f} (should be ~ 0)")
    
    # Prior strength constant
    # Reduced from 1000 to 500 to preserve more variance and improve stability correlations
    C = 500  # Shots needed for full stabilization
    
    print(f"\n   Prior strength (C): {C:,} shots")
    print(f"   Goalies with < {C} shots will be regressed toward league average (GSAx = 0)")
    
    # Apply Bayesian regression
    goalie_stats['regressed_gsax'] = (
        (goalie_stats['total_shots_faced'] / (goalie_stats['total_shots_faced'] + C)) * goalie_stats['raw_gsax'] +
        (C / (goalie_stats['total_shots_faced'] + C)) * 0.0
    )
    
    goalie_stats['league_sv_pct'] = league_sv_pct
    
    # Validation: Check low-sample goalies
    low_sample = goalie_stats[goalie_stats['total_shots_faced'] < 100]
    high_sample = goalie_stats[goalie_stats['total_shots_faced'] > 1000]
    
    if len(low_sample) > 0:
        print(f"\n   Validation - Low-sample goalies (S < 100):")
        print(f"   Count: {len(low_sample):,}")
        print(f"   Average regressed GSAx: {low_sample['regressed_gsax'].mean():.4f} (should be ~ 0)")
        print(f"   Max absolute regressed GSAx: {low_sample['regressed_gsax'].abs().max():.4f}")
    
    if len(high_sample) > 0:
        print(f"\n   Validation - High-sample goalies (S > 1,000):")
        print(f"   Count: {len(high_sample):,}")
        avg_diff = (high_sample['regressed_gsax'] - high_sample['raw_gsax']).abs().mean()
        print(f"   Average |regressed - raw|: {avg_diff:.4f} (should be small)")
        print(f"   Max |regressed - raw|: {(high_sample['regressed_gsax'] - high_sample['raw_gsax']).abs().max():.4f}")
    
    print(f"\nApplied Bayesian regression to {len(goalie_stats):,} goalies")
    print(f"   Regressed GSAx range: [{goalie_stats['regressed_gsax'].min():.2f}, {goalie_stats['regressed_gsax'].max():.2f}]")
    
    return goalie_stats


def main():
    """Main execution function."""
    print("\n" + "=" * 80)
    print("GOALIE GSAX CALCULATION")
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
    
    # Round numeric columns for cleaner output
    goalie_stats['total_xGA'] = goalie_stats['total_xGA'].round(4)
    goalie_stats['raw_gsax'] = goalie_stats['raw_gsax'].round(4)
    goalie_stats['regressed_gsax'] = goalie_stats['regressed_gsax'].round(4)
    goalie_stats['league_sv_pct'] = goalie_stats['league_sv_pct'].round(4)
    
    # Display top and bottom goalies
    print("\n" + "=" * 80)
    print("TOP 10 GOALIES BY REGRESSED GSAX")
    print("=" * 80)
    display_cols = ['goalie_id', 'total_shots_faced', 'total_GA', 'raw_gsax', 'regressed_gsax']
    if 'goalie_name' in goalie_stats.columns:
        display_cols.insert(1, 'goalie_name')
    top_goalies = goalie_stats.nlargest(10, 'regressed_gsax')[display_cols]
    print(top_goalies.to_string(index=False))
    
    print("\n" + "=" * 80)
    print("BOTTOM 10 GOALIES BY REGRESSED GSAX")
    print("=" * 80)
    bottom_goalies = goalie_stats.nsmallest(10, 'regressed_gsax')[display_cols]
    print(bottom_goalies.to_string(index=False))
    
    print(f"\nGSAx calculation complete!")
    print(f"   Total goalies processed: {len(goalie_stats):,}")
    print(f"   Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Return the results for use in export functions
    return goalie_stats


def export_to_csv(goalie_stats, filename='goalie_gsax.csv'):
    """
    Export GSAx results to CSV file.
    
    Args:
        goalie_stats: DataFrame with GSAx results
        filename: Output CSV filename
    """
    print("\n" + "=" * 80)
    print("EXPORTING TO CSV")
    print("=" * 80)
    
    try:
        # Select columns for export (include goalie_name if available)
        base_cols = [
            'goalie_id', 'total_shots_faced', 'total_xGA', 'total_GA',
            'raw_gsax', 'regressed_gsax', 'league_sv_pct', 'calculated_at'
        ]
        if 'goalie_name' in goalie_stats.columns:
            base_cols.insert(1, 'goalie_name')
        export_df = goalie_stats[base_cols].copy()
        
        # Convert calculated_at to string for CSV
        if 'calculated_at' in export_df.columns:
            export_df['calculated_at'] = export_df['calculated_at'].astype(str)
        
        export_df.to_csv(filename, index=False)
        print(f"Exported {len(export_df):,} goalies to {filename}")
        
    except Exception as e:
        print(f"ERROR: Error exporting to CSV: {e}")
        import traceback
        traceback.print_exc()


def upsert_to_database(goalie_stats):
    """
    Upsert GSAx results to goalie_gsax table in Supabase.
    
    Args:
        goalie_stats: DataFrame with GSAx results
    """
    print("\n" + "=" * 80)
    print("UPSERTING TO DATABASE")
    print("=" * 80)
    
    try:
        # Make the operation idempotent even if the table lacks a unique constraint.
        # We clear the current season rows, then insert fresh results.
        try:
            supabase.table('goalie_gsax').delete().eq('season', SEASON).execute()
            supabase.table('goalie_gsax').delete().is_('season', 'null').execute()
        except Exception as e:
            print(f"   WARNING: Could not clear existing season rows: {e}")

        # Prepare data for database
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
                'calculated_at': row['calculated_at'].isoformat() if pd.notna(row.get('calculated_at')) else None,
                'season': SEASON,
            }
            records.append(record)
        
        # Batch insert (we cleared the season first; table may not have ON CONFLICT constraints)
        batch_size = 100
        total_batches = (len(records) + batch_size - 1) // batch_size
        
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            
            try:
                supabase.table('goalie_gsax').insert(batch).execute()
                
                print(f"   Inserted batch {batch_num}/{total_batches} ({len(batch)} goalies)")
                
            except Exception as e:
                print(f"   WARNING: Error inserting batch {batch_num}: {e}")
                # Try individual inserts for this batch (best-effort)
                for record in batch:
                    try:
                        supabase.table('goalie_gsax').insert(record).execute()
                    except Exception as e2:
                        print(f"      WARNING: Failed to insert goalie_id {record['goalie_id']}: {e2}")
        
        print(f"\nInserted {len(records):,} goalies to database (season={SEASON})")
        
    except Exception as e:
        print(f"ERROR: Error upserting to database: {e}")
        import traceback
        traceback.print_exc()


def main_with_export():
    """Main execution function with export."""
    results = main()
    
    if results is not None and len(results) > 0:
        # Export to CSV
        export_to_csv(results)
        
        # Upsert to database
        upsert_to_database(results)
        
        print("\n" + "=" * 80)
        print("ALL OPERATIONS COMPLETE")
        print("=" * 80)
    else:
        print("\nERROR: No results to export")


if __name__ == "__main__":
    main_with_export()

