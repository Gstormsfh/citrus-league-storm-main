#!/usr/bin/env python3
"""
Calculate Combined Goalie G-GAR (Goals Above Replacement) Metric.

This combines two stable components:
1. Rebound Control Component (AdjRP) - Lower is better
2. Primary Shots GSAx Component - Higher is better

Formula:
G_GAR = (w1 × rebound_control_score) + (w2 × primary_gsax_score)

Where:
- rebound_control_score = -1 × z_score(adj_rebound_pct)  (inverted, lower AdjRP = better)
- primary_gsax_score = regressed_gsax_primary (already in goals units)
- w1 = 0.3 (rebound control weight)
- w2 = 0.7 (primary shots weight)
"""

import pandas as pd
import numpy as np
from datetime import datetime
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from scipy import stats

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("ERROR: Missing Supabase credentials. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)


def load_rebound_control():
    """Load rebound control component data with regressed values."""
    print("=" * 80)
    print("LOADING REBOUND CONTROL COMPONENT")
    print("=" * 80)
    
    try:
        # Try database first
        try:
            response = supabase.table('goalie_rebound_control').select('*').execute()
            if response.data and len(response.data) > 0:
                df = pd.DataFrame(response.data)
                print("   Loaded from database")
            else:
                raise Exception("No data in database")
        except Exception as db_error:
            # Fallback to CSV
            print("   Database table not found or empty, loading from CSV...")
            try:
                df = pd.read_csv('goalie_rebound_control.csv')
                print("   Loaded from CSV file")
            except FileNotFoundError:
                print("WARNING: No rebound control data found. Run calculate_goalie_rebound_control.py first.")
                return None
        
        if df is None or len(df) == 0:
            print("WARNING: No rebound control data found.")
            return None
        
        # Convert types
        df['goalie_id'] = pd.to_numeric(df['goalie_id'], errors='coerce')
        df['adj_rebound_pct'] = pd.to_numeric(df['adj_rebound_pct'], errors='coerce')
        df['regressed_adjrp_c5000'] = pd.to_numeric(df.get('regressed_adjrp_c5000', pd.Series()), errors='coerce')
        df['regressed_adjrp_c10000'] = pd.to_numeric(df.get('regressed_adjrp_c10000', pd.Series()), errors='coerce')
        df['league_mean_adjrp'] = pd.to_numeric(df.get('league_mean_adjrp', pd.Series()), errors='coerce')
        
        # Filter valid data
        df = df[df['goalie_id'].notna()].copy()
        
        print(f"Loaded {len(df):,} goalies with rebound control data")
        
        return df
        
    except Exception as e:
        print(f"ERROR: Error loading rebound control data: {e}")
        import traceback
        traceback.print_exc()
        return None


def load_primary_gsax():
    """Load primary shots GSAx component data."""
    print("\n" + "=" * 80)
    print("LOADING PRIMARY SHOTS GSAX COMPONENT")
    print("=" * 80)
    
    try:
        # Try database first
        try:
            response = supabase.table('goalie_gsax_primary').select('*').execute()
            if response.data and len(response.data) > 0:
                df = pd.DataFrame(response.data)
                print("   Loaded from database")
            else:
                raise Exception("No data in database")
        except Exception as db_error:
            # Fallback to CSV
            print("   Database table not found or empty, loading from CSV...")
            try:
                df = pd.read_csv('goalie_gsax_primary.csv')
                print("   Loaded from CSV file")
            except FileNotFoundError:
                print("WARNING: No primary shots GSAx data found. Run calculate_goalie_gsax_primary.py first.")
                return None
        
        if df is None or len(df) == 0:
            print("WARNING: No primary shots GSAx data found.")
            return None
        
        # Convert types
        df['goalie_id'] = pd.to_numeric(df['goalie_id'], errors='coerce')
        df['regressed_gsax'] = pd.to_numeric(df['regressed_gsax'], errors='coerce')
        
        # Filter valid data
        df = df[df['goalie_id'].notna()].copy()
        df = df[df['regressed_gsax'].notna()].copy()
        
        print(f"Loaded {len(df):,} goalies with primary shots GSAx data")
        
        return df
        
    except Exception as e:
        print(f"ERROR: Error loading primary shots GSAx data: {e}")
        import traceback
        traceback.print_exc()
        return None


def standardize_components(rebound_df, primary_df):
    """
    Standardize both components to combine them.
    Handles both raw and regressed AdjRP values.
    
    Args:
        rebound_df: DataFrame with adj_rebound_pct and regressed values
        primary_df: DataFrame with regressed_gsax
        
    Returns:
        Combined DataFrame with standardized scores for all configurations
    """
    print("\n" + "=" * 80)
    print("STANDARDIZING COMPONENTS")
    print("=" * 80)
    
    # Merge on goalie_id
    combined = pd.merge(
        rebound_df[['goalie_id', 'adj_rebound_pct', 'regressed_adjrp_c5000', 'regressed_adjrp_c10000', 'league_mean_adjrp']],
        primary_df[['goalie_id', 'regressed_gsax']],
        on='goalie_id',
        how='inner'
    )
    
    print(f"   Merged data: {len(combined):,} goalies with both components")
    
    # Standardize raw rebound control (for baseline comparison)
    valid_adjrp = combined['adj_rebound_pct'].dropna()
    if len(valid_adjrp) > 0:
        mean_adjrp = valid_adjrp.mean()
        std_adjrp = valid_adjrp.std()
        
        # Calculate z-score and invert (lower AdjRP = better)
        combined['rebound_control_z'] = (combined['adj_rebound_pct'] - mean_adjrp) / std_adjrp
        combined['rebound_control_score'] = -1 * combined['rebound_control_z']
    
    # Standardize regressed AdjRP (C=5,000)
    valid_regressed_c5000 = combined['regressed_adjrp_c5000'].dropna()
    if len(valid_regressed_c5000) > 0:
        mean_regressed_c5000 = valid_regressed_c5000.mean()
        std_regressed_c5000 = valid_regressed_c5000.std()
        if std_regressed_c5000 > 0:
            combined['rebound_control_z_c5000'] = (combined['regressed_adjrp_c5000'] - mean_regressed_c5000) / std_regressed_c5000
            combined['rebound_control_score_c5000'] = -1 * combined['rebound_control_z_c5000']
        else:
            combined['rebound_control_score_c5000'] = 0.0
    
    # Standardize regressed AdjRP (C=10,000)
    valid_regressed_c10000 = combined['regressed_adjrp_c10000'].dropna()
    if len(valid_regressed_c10000) > 0:
        mean_regressed_c10000 = valid_regressed_c10000.mean()
        std_regressed_c10000 = valid_regressed_c10000.std()
        if std_regressed_c10000 > 0:
            combined['rebound_control_z_c10000'] = (combined['regressed_adjrp_c10000'] - mean_regressed_c10000) / std_regressed_c10000
            combined['rebound_control_score_c10000'] = -1 * combined['rebound_control_z_c10000']
        else:
            combined['rebound_control_score_c10000'] = 0.0
    
    # Primary GSAx is already in goals units, use directly
    combined['primary_gsax_score'] = combined['regressed_gsax']
    
    print(f"\n   Rebound Control Standardization:")
    if len(valid_adjrp) > 0:
        print(f"   - Raw AdjRP Mean: {mean_adjrp:.6f}, Std: {std_adjrp:.6f}")
    if len(valid_regressed_c5000) > 0:
        print(f"   - Regressed AdjRP (C=5,000) Mean: {mean_regressed_c5000:.6f}, Std: {std_regressed_c5000:.6f}")
    if len(valid_regressed_c10000) > 0:
        print(f"   - Regressed AdjRP (C=10,000) Mean: {mean_regressed_c10000:.6f}, Std: {std_regressed_c10000:.6f}")
    
    print(f"\n   Primary Shots GSAx:")
    print(f"   - Primary GSAx Score range: [{combined['primary_gsax_score'].min():.2f}, {combined['primary_gsax_score'].max():.2f}]")
    
    return combined


def calculate_combined_gar_all_configs(combined_df):
    """
    Calculate combined G-GAR metric for all 6 configurations.
    
    Configurations:
    1. Raw AdjRP, w1=0.3, w2=0.7 (baseline)
    2. Regressed C=5,000, w1=0.3, w2=0.7
    3. Regressed C=10,000, w1=0.3, w2=0.7
    4. Regressed C=5,000, w1=0.10, w2=0.90
    5. Regressed C=10,000, w1=0.10, w2=0.90
    6. Regressed C=5,000, w1=0.05, w2=0.95
    7. Regressed C=10,000, w1=0.05, w2=0.95
    
    Args:
        combined_df: DataFrame with standardized component scores
        
    Returns:
        DataFrame with all G-GAR configurations
    """
    print("\n" + "=" * 80)
    print("CALCULATING COMBINED G-GAR FOR ALL CONFIGURATIONS")
    print("=" * 80)
    
    # Fill missing regressed scores with 0 (for goalies without regressed values)
    if 'rebound_control_score_c5000' not in combined_df.columns:
        combined_df['rebound_control_score_c5000'] = 0.0
    else:
        combined_df['rebound_control_score_c5000'] = combined_df['rebound_control_score_c5000'].fillna(0.0)
    
    if 'rebound_control_score_c10000' not in combined_df.columns:
        combined_df['rebound_control_score_c10000'] = 0.0
    else:
        combined_df['rebound_control_score_c10000'] = combined_df['rebound_control_score_c10000'].fillna(0.0)
    
    if 'rebound_control_score' not in combined_df.columns:
        combined_df['rebound_control_score'] = 0.0
    else:
        combined_df['rebound_control_score'] = combined_df['rebound_control_score'].fillna(0.0)
    
    # Configuration 1: Raw AdjRP, w1=0.3, w2=0.7 (baseline)
    combined_df['total_gar_w30_raw'] = (
        0.3 * combined_df['rebound_control_score'] +
        0.7 * combined_df['primary_gsax_score']
    )
    
    # Configuration 2: Regressed C=5,000, w1=0.3, w2=0.7
    combined_df['total_gar_w30_c5000'] = (
        0.3 * combined_df['rebound_control_score_c5000'] +
        0.7 * combined_df['primary_gsax_score']
    )
    
    # Configuration 3: Regressed C=10,000, w1=0.3, w2=0.7
    combined_df['total_gar_w30_c10000'] = (
        0.3 * combined_df['rebound_control_score_c10000'] +
        0.7 * combined_df['primary_gsax_score']
    )
    
    # Configuration 4: Regressed C=5,000, w1=0.10, w2=0.90
    combined_df['total_gar_w10_c5000'] = (
        0.10 * combined_df['rebound_control_score_c5000'] +
        0.90 * combined_df['primary_gsax_score']
    )
    
    # Configuration 5: Regressed C=10,000, w1=0.10, w2=0.90
    combined_df['total_gar_w10_c10000'] = (
        0.10 * combined_df['rebound_control_score_c10000'] +
        0.90 * combined_df['primary_gsax_score']
    )
    
    # Configuration 6: Regressed C=5,000, w1=0.05, w2=0.95
    combined_df['total_gar_w5_c5000'] = (
        0.05 * combined_df['rebound_control_score_c5000'] +
        0.95 * combined_df['primary_gsax_score']
    )
    
    # Configuration 7: Regressed C=10,000, w1=0.05, w2=0.95
    combined_df['total_gar_w5_c10000'] = (
        0.05 * combined_df['rebound_control_score_c10000'] +
        0.95 * combined_df['primary_gsax_score']
    )
    
    print(f"\n   Calculated G-GAR for 7 configurations:")
    print(f"   1. Raw AdjRP, w1=0.3, w2=0.7 (baseline)")
    print(f"   2. Regressed C=5,000, w1=0.3, w2=0.7")
    print(f"   3. Regressed C=10,000, w1=0.3, w2=0.7")
    print(f"   4. Regressed C=5,000, w1=0.10, w2=0.90")
    print(f"   5. Regressed C=10,000, w1=0.10, w2=0.90")
    print(f"   6. Regressed C=5,000, w1=0.05, w2=0.95")
    print(f"   7. Regressed C=10,000, w1=0.05, w2=0.95")
    
    # Print statistics for each configuration
    configs = [
        ('total_gar_w30_raw', 'Baseline (Raw, w30)'),
        ('total_gar_w30_c5000', 'C=5,000, w30'),
        ('total_gar_w30_c10000', 'C=10,000, w30'),
        ('total_gar_w10_c5000', 'C=5,000, w10'),
        ('total_gar_w10_c10000', 'C=10,000, w10'),
        ('total_gar_w5_c5000', 'C=5,000, w5'),
        ('total_gar_w5_c10000', 'C=10,000, w5')
    ]
    
    print(f"\n   G-GAR Statistics by Configuration:")
    for col, name in configs:
        if col in combined_df.columns:
            valid = combined_df[col].dropna()
            if len(valid) > 0:
                print(f"   {name}:")
                print(f"     - Mean: {valid.mean():.4f}")
                print(f"     - Std Dev: {valid.std():.4f}")
                print(f"     - Range: [{valid.min():.2f}, {valid.max():.2f}]")
    
    return combined_df


def store_gar_results_all_configs(gar_df):
    """Store all G-GAR configurations to database."""
    print("\n" + "=" * 80)
    print("STORING G-GAR RESULTS (ALL CONFIGURATIONS)")
    print("=" * 80)
    
    # Prepare records with all configurations
    records = []
    for _, row in gar_df.iterrows():
        record = {
            'goalie_id': int(row['goalie_id']),
            'rebound_control_score': float(row['rebound_control_score']) if pd.notna(row.get('rebound_control_score')) else None,
            'primary_gsax_score': float(row['primary_gsax_score']) if pd.notna(row.get('primary_gsax_score')) else None,
            # Store baseline (for backward compatibility)
            'total_gar': float(row['total_gar_w30_raw']) if pd.notna(row.get('total_gar_w30_raw')) else None,
            # Store all configurations (may not exist in older DB schemas)
            'total_gar_w30_raw': float(row['total_gar_w30_raw']) if pd.notna(row.get('total_gar_w30_raw')) else None,
            'total_gar_w30_c5000': float(row['total_gar_w30_c5000']) if pd.notna(row.get('total_gar_w30_c5000')) else None,
            'total_gar_w30_c10000': float(row['total_gar_w30_c10000']) if pd.notna(row.get('total_gar_w30_c10000')) else None,
            'total_gar_w10_c5000': float(row['total_gar_w10_c5000']) if pd.notna(row.get('total_gar_w10_c5000')) else None,
            'total_gar_w10_c10000': float(row['total_gar_w10_c10000']) if pd.notna(row.get('total_gar_w10_c10000')) else None,
            'total_gar_w5_c5000': float(row['total_gar_w5_c5000']) if pd.notna(row.get('total_gar_w5_c5000')) else None,
            'total_gar_w5_c10000': float(row['total_gar_w5_c10000']) if pd.notna(row.get('total_gar_w5_c10000')) else None,
            'calculated_at': datetime.now().isoformat()
        }
        records.append(record)

    # Baseline-only fallback records (compatible with the original goalie_gar schema)
    baseline_records = []
    for _, row in gar_df.iterrows():
        baseline_records.append({
            'goalie_id': int(row['goalie_id']),
            'rebound_control_score': float(row['rebound_control_score']) if pd.notna(row.get('rebound_control_score')) else None,
            'primary_gsax_score': float(row['primary_gsax_score']) if pd.notna(row.get('primary_gsax_score')) else None,
            'total_gar': float(row['total_gar_w30_raw']) if pd.notna(row.get('total_gar_w30_raw')) else None,
            'calculated_at': datetime.now().isoformat()
        })
    
    # Upsert in batches
    batch_size = 100
    success_count = 0
    
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            supabase.table('goalie_gar').upsert(
                batch,
                on_conflict='goalie_id'
            ).execute()
            success_count += len(batch)
        except Exception as e:
            # Most common cause: DB is missing the extended configuration columns.
            print(f"WARNING: Failed to upsert batch (full schema): {e}")
            # Retry with baseline-only schema for this batch.
            baseline_batch = baseline_records[i:i + batch_size]
            try:
                supabase.table('goalie_gar').upsert(
                    baseline_batch,
                    on_conflict='goalie_id'
                ).execute()
                success_count += len(baseline_batch)
                continue
            except Exception as e_fallback:
                print(f"WARNING: Failed to upsert batch (baseline schema): {e_fallback}")
                # Try individual baseline upserts
                for record in baseline_batch:
                    try:
                        supabase.table('goalie_gar').upsert(
                            record,
                            on_conflict='goalie_id'
                        ).execute()
                        success_count += 1
                    except Exception as e2:
                        print(f"   WARNING: Failed to upsert goalie_id {record['goalie_id']}: {e2}")
    
    print(f"\nUpserted {success_count:,} goalies to database (all configurations)")


def main():
    """Main execution function."""
    print("=" * 80)
    print("GOALIE G-GAR CALCULATION")
    print("=" * 80)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    
    # Load components
    rebound_df = load_rebound_control()
    if rebound_df is None or len(rebound_df) == 0:
        print("ERROR: Failed to load rebound control data")
        return
    
    primary_df = load_primary_gsax()
    if primary_df is None or len(primary_df) == 0:
        print("ERROR: Failed to load primary shots GSAx data")
        return
    
    # Standardize and combine
    combined_df = standardize_components(rebound_df, primary_df)
    if combined_df is None or len(combined_df) == 0:
        print("ERROR: Failed to standardize components")
        return
    
    # Calculate combined G-GAR for all configurations
    gar_df = calculate_combined_gar_all_configs(combined_df)
    
    # Display top and bottom goalies for baseline configuration
    print("\n" + "=" * 80)
    print("TOP 10 GOALIES BY G-GAR (Baseline: Raw AdjRP, w30)")
    print("=" * 80)
    top_goalies = gar_df.nlargest(10, 'total_gar_w30_raw')[
        ['goalie_id', 'rebound_control_score', 'primary_gsax_score', 'total_gar_w30_raw']
    ]
    print(top_goalies.to_string(index=False))
    
    print("\n" + "=" * 80)
    print("BOTTOM 10 GOALIES BY G-GAR (Baseline: Raw AdjRP, w30)")
    print("=" * 80)
    bottom_goalies = gar_df.nsmallest(10, 'total_gar_w30_raw')[
        ['goalie_id', 'rebound_control_score', 'primary_gsax_score', 'total_gar_w30_raw']
    ]
    print(bottom_goalies.to_string(index=False))
    
    # Store results (store all configurations)
    store_gar_results_all_configs(gar_df)
    
    # Export to CSV
    gar_df.to_csv('goalie_gar_all_configs.csv', index=False)
    print(f"\nExported all configurations to goalie_gar_all_configs.csv")
    
    print("\n" + "=" * 80)
    print("ALL OPERATIONS COMPLETE")
    print("=" * 80)
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()

