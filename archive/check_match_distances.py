#!/usr/bin/env python3
"""Check match distance distribution"""

import pandas as pd

df = pd.read_csv('data/matched_shots_2025.csv')

print("=" * 80)
print("MATCH DISTANCE DISTRIBUTION")
print("=" * 80)
print("\nStatistics:")
print(df['match_distance'].describe())

print("\nMatches by distance range:")
ranges = [
    (0, 0.5, "< 0.5 feet"),
    (0.5, 1.0, "0.5-1.0 feet"),
    (1.0, 1.5, "1.0-1.5 feet"),
    (1.5, 2.0, "1.5-2.0 feet"),
    (2.0, 2.5, "2.0-2.5 feet"),
    (2.5, 3.0, "2.5-3.0 feet"),
]

for min_dist, max_dist, label in ranges:
    count = ((df['match_distance'] >= min_dist) & (df['match_distance'] < max_dist)).sum()
    pct = count / len(df) * 100
    print(f"  {label}: {count:,} ({pct:.1f}%)")

print(f"\nMatches at tolerance limit (2.9-3.0 feet): {((df['match_distance'] >= 2.9) & (df['match_distance'] <= 3.0)).sum():,}")

print(f"\nRecommendation:")
close_matches = (df['match_distance'] < 1.5).sum()
print(f"  Matches < 1.5 feet: {close_matches:,} ({close_matches/len(df)*100:.1f}%)")
print(f"  These are likely true matches (very close coordinates)")

far_matches = (df['match_distance'] >= 2.0).sum()
print(f"  Matches >= 2.0 feet: {far_matches:,} ({far_matches/len(df)*100:.1f}%)")
print(f"  These might be false matches (coordinates differ significantly)")

