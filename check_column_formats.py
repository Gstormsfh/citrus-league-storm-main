#!/usr/bin/env python3
"""Check exact column formats for matching"""

import pandas as pd

our = pd.read_csv('data/our_shots_2025.csv')
mp = pd.read_csv('data/moneypuck_shots_2025.csv.csv')

print("=" * 80)
print("COLUMN FORMATS FOR MATCHING")
print("=" * 80)

print("\nOUR DATASET:")
print(f"  period: {our['period'].head(5).tolist()} (type: {our['period'].dtype})")
print(f"  time_remaining_seconds: {our['time_remaining_seconds'].head(5).tolist()} (type: {our['time_remaining_seconds'].dtype})")
print(f"  team_code: {our['team_code'].head(5).tolist()} (type: {our['team_code'].dtype})")
print(f"  time_in_period: {our['time_in_period'].head(5).tolist()}")

print("\nMONEYPUCK DATASET:")
print(f"  period: {mp['period'].head(5).tolist()} (type: {mp['period'].dtype})")

# Check time column
if 'time' in mp.columns:
    print(f"  time: {mp['time'].head(5).tolist()} (type: {mp['time'].dtype})")
else:
    print("  time: NOT FOUND")

# Check for shootingTeamCode or homeTeamCode
team_code_cols = [c for c in mp.columns if 'TeamCode' in c or 'teamCode' in c]
print(f"\n  Team code columns: {team_code_cols}")
for col in team_code_cols[:5]:
    print(f"    {col}: {mp[col].head(3).tolist()}")

# Check if we can derive shooting team
print("\n" + "=" * 80)
print("MATCHING STRATEGY")
print("=" * 80)
print("\nBest matching factors:")
print("1. Coordinates (x, y) - primary, within 1.5 feet")
print("2. Period - must match exactly")
print("3. Time remaining - should be very close (within 2-3 seconds tolerance)")
print("4. Team code - shooting team should match")

print("\nImplementation approach:")
print("- Use spatial index for initial coordinate matching (fast)")
print("- Filter matches by period (exact match)")
print("- Filter by time remaining (within 2-3 seconds)")
print("- Filter by team code (exact match)")
print("- This will dramatically reduce false matches!")

