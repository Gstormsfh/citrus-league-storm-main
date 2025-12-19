#!/usr/bin/env python3
"""
Reset games that are marked as stats_extracted=true but don't have player_game_stats.
These need to be re-processed by the extractor.
"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 70)
print("RESETTING MISSING EXTRACTED GAMES")
print("=" * 70)

# Get all extracted game IDs
print("\n1. Finding all extracted game IDs...")
all_extracted_ids = set()
offset = 0
while True:
  page = db.select("raw_nhl_data", select="game_id", filters=[("stats_extracted", "eq", True)], limit=1000, offset=offset)
  if not page:
    break
  all_extracted_ids.update(g.get("game_id") for g in page if g.get("game_id"))
  if len(page) < 1000:
    break
  offset += 1000
print(f"   Found {len(all_extracted_ids)} extracted games")

# Get all games in player_game_stats
print("\n2. Finding games in player_game_stats...")
all_game_stats = []
offset = 0
while True:
  page = db.select("player_game_stats", select="game_id", limit=1000, offset=offset)
  if not page:
    break
  all_game_stats.extend(page)
  if len(page) < 1000:
    break
  offset += 1000
unique_games_in_stats = set(g.get("game_id") for g in all_game_stats)
print(f"   Found {len(unique_games_in_stats)} games in player_game_stats")

# Find missing
missing = all_extracted_ids - unique_games_in_stats
print(f"\n3. Found {len(missing)} games marked extracted but missing from player_game_stats")

if not missing:
  print("\n[OK] No games need resetting!")
  exit(0)

# Reset them
print(f"\n4. Resetting {len(missing)} games to stats_extracted=false...")
missing_list = list(missing)
CHUNK = 100
reset_count = 0

for i in range(0, len(missing_list), CHUNK):
  batch = missing_list[i:i + CHUNK]
  try:
    # Update each game in the batch
    for game_id in batch:
      db.update("raw_nhl_data", {"stats_extracted": False, "stats_extracted_at": None}, filters=[("game_id", "eq", game_id)])
    reset_count += len(batch)
    print(f"   Reset {reset_count}/{len(missing_list)} games...")
  except Exception as e:
    print(f"   ERROR resetting batch: {e}")

print(f"\n[OK] Reset {reset_count} games. Extractor can now process them.")
print("=" * 70)

