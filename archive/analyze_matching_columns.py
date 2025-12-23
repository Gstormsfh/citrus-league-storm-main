#!/usr/bin/env python3
"""Analyze columns in both datasets to find best matching factors"""

import pandas as pd

print("=" * 80)
print("ANALYZING COLUMNS FOR MULTI-FACTOR MATCHING")
print("=" * 80)

# Load datasets
our = pd.read_csv('data/our_shots_2025.csv')
mp = pd.read_csv('data/moneypuck_shots_2025.csv.csv')

print(f"\nOur dataset: {len(our):,} shots, {len(our.columns)} columns")
print(f"MoneyPuck dataset: {len(mp):,} shots, {len(mp.columns)} columns")

# Find common columns and time/period related
print("\n" + "=" * 80)
print("TIME/PERIOD RELATED COLUMNS")
print("=" * 80)

our_time_cols = [c for c in our.columns if any(x in c.lower() for x in ['time', 'period', 'remaining'])]
mp_time_cols = [c for c in mp.columns if any(x in c.lower() for x in ['time', 'period', 'remaining'])]

print("\nOur time/period columns:")
for col in our_time_cols:
    non_null = our[col].notna().sum()
    print(f"  - {col}: {non_null:,} values ({100*non_null/len(our):.1f}%)")
    if non_null > 0 and non_null < len(our):
        print(f"    Sample: {our[col].dropna().head(3).tolist()}")

print("\nMoneyPuck time/period columns:")
for col in mp_time_cols:
    non_null = mp[col].notna().sum()
    print(f"  - {col}: {non_null:,} values ({100*non_null/len(mp):.1f}%)")
    if non_null > 0 and non_null < len(mp):
        print(f"    Sample: {mp[col].dropna().head(3).tolist()}")

# Find team/player related
print("\n" + "=" * 80)
print("TEAM/PLAYER RELATED COLUMNS")
print("=" * 80)

our_team_cols = [c for c in our.columns if any(x in c.lower() for x in ['team', 'player', 'shooter'])]
mp_team_cols = [c for c in mp.columns if any(x in c.lower() for x in ['team', 'player', 'shooter'])]

print("\nOur team/player columns:")
for col in our_team_cols[:10]:
    non_null = our[col].notna().sum()
    print(f"  - {col}: {non_null:,} values")

print("\nMoneyPuck team/player columns:")
for col in mp_team_cols[:10]:
    non_null = mp[col].notna().sum()
    print(f"  - {col}: {non_null:,} values")

# Find score related
print("\n" + "=" * 80)
print("SCORE RELATED COLUMNS")
print("=" * 80)

our_score_cols = [c for c in our.columns if 'score' in c.lower()]
mp_score_cols = [c for c in mp.columns if 'score' in c.lower()]

print("\nOur score columns:")
for col in our_score_cols:
    non_null = our[col].notna().sum()
    print(f"  - {col}: {non_null:,} values")

print("\nMoneyPuck score columns:")
for col in mp_score_cols:
    non_null = mp[col].notna().sum()
    print(f"  - {col}: {non_null:,} values")

# Recommendations
print("\n" + "=" * 80)
print("RECOMMENDATIONS FOR MULTI-FACTOR MATCHING")
print("=" * 80)
print("\nBest matching factors (in order of priority):")
print("1. Coordinates (already using) - primary match")
print("2. Period number - should match exactly")
print("3. Time remaining - should be very close (within 1-2 seconds)")
print("4. Team code - should match (home/away team)")
print("\nThese factors will help filter out false matches and improve accuracy!")

