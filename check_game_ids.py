#!/usr/bin/env python3
"""Quick script to check game ID formats"""

import pandas as pd

our = pd.read_csv('data/our_shots_2025.csv')
mp = pd.read_csv('data/moneypuck_shots_2025.csv.csv')

print("=" * 80)
print("GAME ID COMPARISON")
print("=" * 80)

print("\nOur data:")
print(f"  game_id column exists: {'game_id' in our.columns}")
if 'game_id' in our.columns:
    print(f"  Sample values: {our['game_id'].head(5).tolist()}")
    print(f"  Type: {our['game_id'].dtype}")
    print(f"  Unique games: {our['game_id'].nunique()}")

print("\nMoneyPuck data:")
print(f"  game_id column exists: {'game_id' in mp.columns}")
print(f"  gameId column exists: {'gameId' in mp.columns}")

# Find any column with 'game' in the name
game_cols = [c for c in mp.columns if 'game' in c.lower()]
print(f"  Columns with 'game': {game_cols}")

if game_cols:
    for col in game_cols:
        print(f"\n  {col}:")
        print(f"    Sample values: {mp[col].head(5).tolist()}")
        print(f"    Type: {mp[col].dtype}")
        print(f"    Unique games: {mp[col].nunique()}")

# Check if there's a match
if 'game_id' in our.columns and game_cols:
    our_games = set(our['game_id'].unique())
    mp_games = set(mp[game_cols[0]].unique())
    common = our_games & mp_games
    print(f"\n  Common game IDs: {len(common)}")
    if len(common) > 0:
        print(f"    Sample common IDs: {list(common)[:5]}")

