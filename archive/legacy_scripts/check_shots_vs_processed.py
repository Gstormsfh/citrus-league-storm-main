#!/usr/bin/env python3
"""Check discrepancy between processed games and games with shots"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("CHECKING PROCESSED GAMES vs GAMES WITH SHOTS")
print("=" * 80)
print()

# Get all processed games
print("Fetching processed games from raw_nhl_data...")
processed_games = []
offset = 0
while True:
    batch = db.select(
        "raw_nhl_data",
        select="game_id,processed",
        filters=[("processed", "eq", True)],
        limit=1000,
        offset=offset
    )
    if not batch:
        break
    processed_games.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000

print(f"Total games marked as processed: {len(processed_games)}")
print()

# Get all unique game IDs from raw_shots
print("Fetching games with shots from raw_shots...")
shots_games = set()
offset = 0
while True:
    batch = db.select(
        "raw_shots",
        select="game_id",
        limit=1000,
        offset=offset
    )
    if not batch:
        break
    for shot in batch:
        if shot.get("game_id"):
            shots_games.add(shot["game_id"])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"Unique games with shots in raw_shots: {len(shots_games)}")
print()

# Compare
processed_ids = set(g["game_id"] for g in processed_games if g.get("game_id"))
missing_shots = processed_ids - shots_games
missing_processed = shots_games - processed_ids

print("=" * 80)
print("COMPARISON")
print("=" * 80)
print(f"Games marked processed: {len(processed_ids)}")
print(f"Games with shots: {len(shots_games)}")
print()
print(f"Games marked processed but NO shots: {len(missing_shots)}")
if missing_shots:
    print(f"  Sample: {sorted(list(missing_shots))[:10]}")
print()
print(f"Games with shots but NOT marked processed: {len(missing_processed)}")
if missing_processed:
    print(f"  Sample: {sorted(list(missing_processed))[:10]}")
print()

# Check if raw_shots table might have been truncated/archived
print("Checking raw_shots table size...")
total_shots = db.select("raw_shots", select="id", limit=1)
# Try to get count
try:
    # Get a sample to see if table exists and has data
    sample = db.select("raw_shots", select="game_id", limit=5)
    print(f"Sample shots found: {len(sample)}")
    if sample:
        print(f"Sample game IDs: {[s.get('game_id') for s in sample]}")
except Exception as e:
    print(f"Error checking raw_shots: {e}")

print()
print("=" * 80)


