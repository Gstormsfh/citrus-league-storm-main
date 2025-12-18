#!/usr/bin/env python3
"""Properly count unique games across all data"""

from data_acquisition import supabase
import pandas as pd

print("Fetching all game IDs from database...")
all_game_ids = []
offset = 0
batch_size = 1000

while True:
    response = supabase.table('raw_shots').select('game_id').range(offset, offset + batch_size - 1).execute()
    if not response.data or len(response.data) == 0:
        break
    all_game_ids.extend([g['game_id'] for g in response.data])
    if len(response.data) < batch_size:
        break
    offset += batch_size
    if len(all_game_ids) % 5000 == 0:
        print(f"  Fetched {len(all_game_ids):,} game IDs...")

print(f"\nTotal shots: {len(all_game_ids):,}")

# Count unique games
unique_games = set(all_game_ids)
print(f"Unique games: {len(unique_games):,}")

if len(unique_games) > 0:
    avg_shots = len(all_game_ids) / len(unique_games)
    print(f"Average shots per game: {avg_shots:.1f}")
    
    # Show game ID range
    sorted_games = sorted(unique_games)
    print(f"\nGame ID range: {sorted_games[0]} to {sorted_games[-1]}")
    print(f"Sample game IDs: {sorted_games[:10]}")

