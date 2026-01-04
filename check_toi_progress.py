#!/usr/bin/env python3
"""Check TOI calculation progress and identify problematic games."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Get all games
print("Fetching games...")
all_games = []
offset = 0
while True:
    batch = db.select('raw_nhl_data', select='game_id', filters=[
        ('game_date', 'gte', '2025-10-07'),
        ('game_date', 'lte', '2026-01-03')
    ], limit=1000, offset=offset)
    if not batch:
        break
    all_games.extend([g['game_id'] for g in batch])
    if len(batch) < 1000:
        break
    offset += 1000

game_ids = sorted(set(all_games))
print(f"Total games: {len(game_ids)}")

# Check which games have TOI data
print("\nChecking TOI progress...")
toi_games = set()
offset = 0
while True:
    batch = db.select('player_toi_by_situation', select='game_id', limit=1000, offset=offset)
    if not batch:
        break
    toi_games.update([g['game_id'] for g in batch])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"Games with TOI: {len(toi_games)}")
print(f"Games without TOI: {len(game_ids) - len(toi_games)}")

# Find first game without TOI
missing = [gid for gid in game_ids if gid not in toi_games]
if missing:
    print(f"\nFirst missing game: {missing[0]}")
    print(f"Position in list: {game_ids.index(missing[0]) + 1}")
    print(f"\nNext 10 missing games: {missing[:10]}")

