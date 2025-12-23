#!/usr/bin/env python3
"""
Component independence test for G-GAR.

Tests that Rebound Control and Primary Shots GSAx are independent components.
Target: r < 0.30 (components should measure different skills)
"""

import pandas as pd
import numpy as np
from scipy.stats import pearsonr
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
supabase = create_client(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))


def load_gar_components():
    """Load G-GAR component data."""
    print("=" * 80)
    print("G-GAR COMPONENT INDEPENDENCE TEST")
    print("=" * 80)
    print()
    
    try:
        # Try database first
        try:
            response = supabase.table('goalie_gar').select('*').execute()
            if response.data and len(response.data) > 0:
                df = pd.DataFrame(response.data)
                print("   Loaded from database")
            else:
                raise Exception("No data in database")
        except Exception as db_error:
            # Fallback to CSV
            print("   Database table not found, loading from CSV...")
            try:
                df = pd.read_csv('goalie_gar.csv')
                print("   Loaded from CSV file")
            except FileNotFoundError:
                print("ERROR: No G-GAR data found. Run calculate_goalie_gar.py first.")
                return None
        
        if df is None or len(df) == 0:
            print("ERROR: No G-GAR data found.")
            return None
        
        # Convert types
        df['goalie_id'] = pd.to_numeric(df['goalie_id'], errors='coerce')
        df['rebound_control_score'] = pd.to_numeric(df['rebound_control_score'], errors='coerce')
        df['primary_gsax_score'] = pd.to_numeric(df['primary_gsax_score'], errors='coerce')
        
        # Filter valid data
        df = df[
            df['goalie_id'].notna() & 
            df['rebound_control_score'].notna() & 
            df['primary_gsax_score'].notna()
        ].copy()
        
        print(f"Loaded {len(df):,} goalies with both components")
        
        return df
        
    except Exception as e:
        print(f"ERROR: Error loading G-GAR data: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_component_independence(df):
    """Test correlation between components."""
    print("\n" + "=" * 80)
    print("COMPONENT CORRELATION ANALYSIS")
    print("=" * 80)
    
    # Calculate correlation
    r, p = pearsonr(df['rebound_control_score'], df['primary_gsax_score'])
    
    print(f"\nCorrelation Results:")
    print(f"  Sample size: {len(df):,} goalies")
    print(f"  Correlation (r): {r:.4f}")
    print(f"  P-value: {p:.4f}")
    print(f"  Target: r < 0.30 (components should be independent)")
    print(f"  Status: {'PASS' if abs(r) < 0.30 else 'FAIL'}")
    
    # Find examples
    print(f"\nComponent Examples:")
    
    # High rebound control, low primary GSAx
    high_rebound_low_gsax = df.nlargest(5, 'rebound_control_score').nsmallest(1, 'primary_gsax_score')
    if len(high_rebound_low_gsax) > 0:
        example = high_rebound_low_gsax.iloc[0]
        print(f"  High Rebound Control, Low Primary GSAx:")
        print(f"    Goalie ID: {int(example['goalie_id'])}")
        print(f"    Rebound Control: {example['rebound_control_score']:.4f}")
        print(f"    Primary GSAx: {example['primary_gsax_score']:.4f}")
    
    # Low rebound control, high primary GSAx
    low_rebound_high_gsax = df.nsmallest(5, 'rebound_control_score').nlargest(1, 'primary_gsax_score')
    if len(low_rebound_high_gsax) > 0:
        example = low_rebound_high_gsax.iloc[0]
        print(f"  Low Rebound Control, High Primary GSAx:")
        print(f"    Goalie ID: {int(example['goalie_id'])}")
        print(f"    Rebound Control: {example['rebound_control_score']:.4f}")
        print(f"    Primary GSAx: {example['primary_gsax_score']:.4f}")
    
    # Save results
    os.makedirs('validation_results', exist_ok=True)
    results = pd.DataFrame({
        'correlation': [r],
        'p_value': [p],
        'sample_size': [len(df)],
        'target': [0.30],
        'status': ['PASS' if abs(r) < 0.30 else 'FAIL']
    })
    results.to_csv('validation_results/goalie_gar_component_independence.csv', index=False)
    
    print(f"\nResults saved to validation_results/goalie_gar_component_independence.csv")
    
    return r, p, df


if __name__ == "__main__":
    df = load_gar_components()
    
    if df is not None and len(df) > 0:
        result = test_component_independence(df)
        
        if result:
            r, p, df_result = result
            print("\n" + "=" * 80)
            print("TEST COMPLETE")
            print("=" * 80)
            print(f"\nComponent correlation: r = {r:.4f}")
            if abs(r) < 0.30:
                print("SUCCESS: Components are independent (r < 0.30)")
            else:
                print(f"WARNING: Components show correlation (r >= 0.30)")
                print("This suggests components may be measuring similar underlying skills")
                print("Consider:")
                print("  - Refining rebound tracking methodology")
                print("  - Adjusting component definitions")

