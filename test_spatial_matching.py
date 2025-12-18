#!/usr/bin/env python3
"""Test spatial index matching on a small subset"""

import pandas as pd
import time
from match_moneypuck_data import match_shots

print("=" * 80)
print("TESTING SPATIAL INDEX MATCHING")
print("=" * 80)

# Load data
print("\nLoading data...")
our_shots = pd.read_csv('data/our_shots_2025.csv')
moneypuck_shots = pd.read_csv('data/moneypuck_shots_2025.csv.csv')

# Test on small subset (first 1000 shots)
print(f"\nOriginal dataset sizes:")
print(f"  Our shots: {len(our_shots):,}")
print(f"  MoneyPuck shots: {len(moneypuck_shots):,}")

print(f"\nTesting on subset (first 1,000 shots)...")
our_subset = our_shots.head(1000).copy()
mp_subset = moneypuck_shots.head(1000).copy()

print(f"  Our subset: {len(our_subset):,}")
print(f"  MoneyPuck subset: {len(mp_subset):,}")

# Time the matching
start_time = time.time()
matched = match_shots(our_subset, mp_subset, coord_tolerance=3.0)
elapsed = time.time() - start_time

if matched is not None:
    print(f"\n✅ Test completed in {elapsed:.2f} seconds")
    print(f"   Matched {len(matched):,} shots")
    print(f"   Performance: {len(our_subset)/elapsed:.0f} shots/second")
    print(f"\n   Estimated time for full dataset: {len(our_shots)/(len(our_subset)/elapsed)/60:.1f} minutes")
else:
    print("\n❌ Test failed - no matches found")

