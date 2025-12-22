#!/usr/bin/env python3
"""Find games that need shift data."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 70)
print("CHECKING MISSING SHIFTS")
print("=" * 70)

# Get all games from raw_nhl_data
print("\n1. Getting all games from raw_nhl_data...")
all_games = []
offset = 0
while True:
  page = db.select("raw_nhl_data", select="game_id", limit=1000, offset=offset)
  if not page:
    break
  all_games.extend([g.get("game_id") for g in page if g.get("game_id")])
  if len(page) < 1000:
    break
  offset += 1000
print(f"   Found {len(all_games)} total games")

# Get games that have shifts
print("\n2. Getting games with shifts...")
all_shifts = []
offset = 0
while True:
  page = db.select("player_shifts_official", select="game_id", limit=1000, offset=offset)
  if not page:
    break
  all_shifts.extend(page)
  if len(page) < 1000:
    break
  offset += 1000
games_with_shifts = set(s.get("game_id") for s in all_shifts if s.get("game_id"))
print(f"   Found {len(games_with_shifts)} games with shifts")

# Find missing
all_games_set = set(all_games)
missing = all_games_set - games_with_shifts
print(f"\n3. Games missing shifts: {len(missing)}")
if missing:
  missing_sorted = sorted(list(missing))
  print(f"   Sample missing game IDs: {missing_sorted[:20]}")
  print(f"\n4. To ingest, run:")
  print(f"   python ingest_shiftcharts.py --limit {len(missing)}")
  print(f"\n   Or process in batches:")
  print(f"   python ingest_shiftcharts.py --limit 200")
else:
  print("\n[OK] All games have shifts!")

print("=" * 70)



