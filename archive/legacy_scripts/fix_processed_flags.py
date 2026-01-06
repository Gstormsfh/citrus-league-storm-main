#!/usr/bin/env python3
"""
fix_processed_flags.py

Reset processed flags for games that don't have shots in raw_shots table.
This fixes the issue where raw_shots was archived/truncated but processed flags weren't reset.
"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("FIXING PROCESSED FLAGS")
print("=" * 80)
print()

# Get all games with shots
print("Fetching games with shots...")
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

print(f"Found {len(shots_games)} games with shots in raw_shots")
print()

# Get all processed games
print("Fetching processed games...")
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

print(f"Found {len(processed_games)} games marked as processed")
print()

# Find games marked processed but without shots
processed_ids = set(g["game_id"] for g in processed_games if g.get("game_id"))
missing_shots = processed_ids - shots_games

print(f"Games marked processed but NO shots: {len(missing_shots)}")
print()

if len(missing_shots) == 0:
    print("No fix needed - all processed games have shots!")
    exit(0)

# Auto-fix (no confirmation needed - this is safe)
print("=" * 80)
print("AUTO-FIXING PROCESSED FLAGS")
print("=" * 80)
print(f"This will reset the 'processed' flag to False for {len(missing_shots)} games")
print("that are marked processed but don't have shots in raw_shots.")
print()
print("This will allow process_xg_stats.py to re-process these games.")
print()

print()
print("Resetting processed flags...")

# Reset in batches
batch_size = 100
missing_list = list(missing_shots)
total_reset = 0

for i in range(0, len(missing_list), batch_size):
    batch = missing_list[i:i + batch_size]
    try:
        for game_id in batch:
            db.update(
                "raw_nhl_data",
                {"processed": False},
                filters=[("game_id", "eq", game_id)]
            )
        total_reset += len(batch)
        print(f"  Reset {total_reset}/{len(missing_list)} games...")
    except Exception as e:
        print(f"  Error resetting batch: {e}")

print()
print("=" * 80)
print(f"COMPLETE: Reset {total_reset} processed flags")
print("=" * 80)
print()
print("You can now run: python process_xg_stats.py --batch-size 10")
print("to re-process these games.")

