#!/usr/bin/env python3
"""
Quick validation test for GSAx using the cleaned data.
Tests basic statistics and data quality.
"""

import pandas as pd
import numpy as np
from scipy.stats import pearsonr

def test_gsax_statistics():
    """Test basic GSAx statistics to ensure they're reasonable."""
    print("=" * 80)
    print("GSAX STATISTICS VALIDATION")
    print("=" * 80)
    print()
    
    # Load GSAx data from CSV
    try:
        gsax_df = pd.read_csv('goalie_gsax.csv')
    except FileNotFoundError:
        print("ERROR: goalie_gsax.csv not found. Run calculate_goalie_gsax.py first.")
        return None
    
    print(f"Loaded {len(gsax_df):,} goalies from CSV")
    
    # Check statistics
    print(f"\nRegressed GSAx Statistics:")
    print(f"  Mean: {gsax_df['regressed_gsax'].mean():.4f}")
    print(f"  Median: {gsax_df['regressed_gsax'].median():.4f}")
    print(f"  Std Dev: {gsax_df['regressed_gsax'].std():.4f}")
    print(f"  Min: {gsax_df['regressed_gsax'].min():.4f}")
    print(f"  Max: {gsax_df['regressed_gsax'].max():.4f}")
    print(f"  Range: [{gsax_df['regressed_gsax'].min():.2f}, {gsax_df['regressed_gsax'].max():.2f}]")
    
    # Expected range: typically -20 to +20 for NHL goalies
    print(f"\nExpected range: [-20, +20] for NHL goalies")
    in_range = ((gsax_df['regressed_gsax'] >= -20) & (gsax_df['regressed_gsax'] <= 20)).sum()
    print(f"  Goalies in expected range: {in_range}/{len(gsax_df)} ({in_range/len(gsax_df)*100:.1f}%)")
    
    # Check distribution
    print(f"\nDistribution:")
    print(f"  Positive GSAx (above average): {(gsax_df['regressed_gsax'] > 0).sum()} goalies")
    print(f"  Negative GSAx (below average): {(gsax_df['regressed_gsax'] < 0).sum()} goalies")
    print(f"  Near zero (within [-1, 1]): {((gsax_df['regressed_gsax'] >= -1) & (gsax_df['regressed_gsax'] <= 1)).sum()} goalies")
    
    # Check raw vs regressed correlation (should be high for high-sample goalies)
    high_sample = gsax_df[gsax_df['total_shots_faced'] >= 500].copy()
    if len(high_sample) > 5:
        r_raw_reg, p = pearsonr(high_sample['raw_gsax'], high_sample['regressed_gsax'])
        print(f"\nHigh-sample goalies (>= 500 shots):")
        print(f"  Count: {len(high_sample)}")
        print(f"  Raw vs Regressed correlation: {r_raw_reg:.4f}")
        print(f"  (Should be high - regression preserves signal for high-sample goalies)")
    
    # Check low-sample goalies (should be regressed toward 0)
    low_sample = gsax_df[gsax_df['total_shots_faced'] < 200].copy()
    if len(low_sample) > 5:
        print(f"\nLow-sample goalies (< 200 shots):")
        print(f"  Count: {len(low_sample)}")
        print(f"  Average regressed GSAx: {low_sample['regressed_gsax'].mean():.4f}")
        print(f"  (Should be close to 0 - regression shrinks low-sample goalies)")
        print(f"  Max absolute regressed GSAx: {low_sample['regressed_gsax'].abs().max():.4f}")
    
    return gsax_df


def test_data_quality():
    """Test that the data quality improvements are working."""
    print("\n" + "=" * 80)
    print("DATA QUALITY VALIDATION")
    print("=" * 80)
    print()
    
    # Check that GSAx values are reasonable
    gsax_df = pd.read_csv('goalie_gsax.csv')
    
    # Check for any anomalies
    print("Checking for data anomalies:")
    
    # Check for negative shots (shouldn't happen)
    negative_shots = (gsax_df['total_shots_faced'] < 0).sum()
    if negative_shots > 0:
        print(f"  WARNING: {negative_shots} goalies with negative shots")
    else:
        print(f"  OK: No negative shot counts")
    
    # Check for negative xGA (shouldn't happen)
    negative_xga = (gsax_df['total_xGA'] < 0).sum()
    if negative_xga > 0:
        print(f"  WARNING: {negative_xga} goalies with negative xGA")
    else:
        print(f"  OK: No negative xGA values")
    
    # Check that GA <= shots (logical constraint)
    ga_exceeds_shots = (gsax_df['total_GA'] > gsax_df['total_shots_faced']).sum()
    if ga_exceeds_shots > 0:
        print(f"  WARNING: {ga_exceeds_shots} goalies with GA > shots (impossible!)")
    else:
        print(f"  OK: All goalies have GA <= shots")
    
    # Check save percentage is reasonable (typically 0.88 to 0.95)
    gsax_df['sv_pct'] = 1.0 - (gsax_df['total_GA'] / gsax_df['total_shots_faced'])
    unreasonable_sv_pct = ((gsax_df['sv_pct'] < 0.80) | (gsax_df['sv_pct'] > 0.98)).sum()
    if unreasonable_sv_pct > 0:
        print(f"  WARNING: {unreasonable_sv_pct} goalies with unreasonable save %")
        print(f"    Min: {gsax_df['sv_pct'].min():.4f}, Max: {gsax_df['sv_pct'].max():.4f}")
    else:
        print(f"  OK: All save percentages in reasonable range")
        print(f"    Range: [{gsax_df['sv_pct'].min():.4f}, {gsax_df['sv_pct'].max():.4f}]")
    
    return True


if __name__ == "__main__":
    import os
    os.makedirs('validation_results', exist_ok=True)
    
    # Test statistics
    stats_df = test_gsax_statistics()
    
    # Test data quality
    test_data_quality()
    
    print("\n" + "=" * 80)
    print("VALIDATION COMPLETE")
    print("=" * 80)
    print("\nNext steps:")
    print("1. Review statistics to ensure they're in expected ranges")
    print("2. Check that high-sample goalies have high raw-regressed correlation")
    print("3. Check that low-sample goalies are regressed toward 0")
    print("4. Re-run full validation tests once validation scripts are fixed")
