#!/usr/bin/env python3
"""Clarify what data we actually have"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("DATA STATUS CLARIFICATION")
print("=" * 80)
print()

# Get ALL raw game data (no limit)
print("Fetching ALL raw game data...")
raw_games = set()
offset = 0
while True:
    batch = db.select(
        "raw_nhl_data",
        select="game_id,game_date",
        filters=[("game_date", "lte", "2026-01-03")],
        limit=1000,
        offset=offset
    )
    if not batch:
        break
    for g in batch:
        if g.get("game_id"):
            raw_games.add(g["game_id"])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"[OK] Raw game data in raw_nhl_data: {len(raw_games)} games")
print("   (This is the play-by-play JSON from NHL API)")
print()

# Get ALL games with processed shots
print("Fetching ALL processed shots...")
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
    for s in batch:
        if s.get("game_id"):
            shots_games.add(s["game_id"])
    if len(batch) < 1000:
        break
    offset += 1000

print(f"[OK] Processed shots in raw_shots: {len(shots_games)} games")
print("   (This is shots with xG values calculated)")
print()

# Compare
missing_shots = raw_games - shots_games

print("=" * 80)
print("SUMMARY")
print("=" * 80)
print(f"Total games with raw data:     {len(raw_games)}")
print(f"Games with processed shots:    {len(shots_games)}")
print(f"Games needing xG processing:   {len(missing_shots)}")
print()

print("=" * 80)
print("WHAT THIS MEANS")
print("=" * 80)
print()
print("[YES] We HAVE all the raw game data:")
print(f"   - {len(raw_games)} games have play-by-play JSON in raw_nhl_data")
print("   - This includes all shot events, passes, goals, etc.")
print()
print("[NO] We DON'T have processed shots for all games:")
print(f"   - Only {len(shots_games)} games have been processed through xG pipeline")
print("   - These games have shots with xG values in raw_shots table")
print()
print(f"[NEED TO PROCESS] {len(missing_shots)} games")
print("   - The xG pipeline needs to:")
print("     1. Extract shots from raw JSON")
print("     2. Calculate features (distance, angle, etc.)")
print("     3. Apply xG model to predict goal probability")
print("     4. Save shots to raw_shots table")
print()
print("=" * 80)
print()
print("The '{len(shots_games)} games with shots' is CORRECT - that's how many")
print("games have been fully processed. The remaining games have raw")
print("data but haven't been through the xG pipeline yet.")
print()

