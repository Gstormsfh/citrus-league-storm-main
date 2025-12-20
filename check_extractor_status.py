#!/usr/bin/env python3
"""Check extractor status and find issues."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 70)
print("EXTRACTOR STATUS CHECK")
print("=" * 70)

# Check unextracted games
print("\n1. Unextracted games (stats_extracted = false):")
unextracted = db.select("raw_nhl_data", select="game_id,game_date", filters=[("stats_extracted", "eq", False)], limit=100)
print(f"   Found: {len(unextracted)} games")
if unextracted:
  print(f"   Sample game IDs: {[g.get('game_id') for g in unextracted[:10]]}")

# Check extracted games
print("\n2. Extracted games (stats_extracted = true):")
extracted = db.select("raw_nhl_data", select="game_id", filters=[("stats_extracted", "eq", True)], limit=100)
print(f"   Found: {len(extracted)} games (showing first 100)")

# Check which games are in player_game_stats
print("\n3. Games in player_game_stats:")
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
print(f"   Found: {len(unique_games_in_stats)} unique games")

# Find games marked as extracted but not in player_game_stats
print("\n4. Games marked extracted but missing from player_game_stats:")
# Get all extracted game IDs (with pagination)
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

missing = all_extracted_ids - unique_games_in_stats
print(f"   Found: {len(missing)} games marked extracted but not in player_game_stats")
if missing:
  print(f"   Sample missing game IDs: {list(missing)[:10]}")

# Check game states
print("\n5. Game states in raw_nhl_data (sample):")
sample_games = db.select("raw_nhl_data", select="game_id,raw_json", limit=20)
states = {}
for g in sample_games:
  pbp = g.get("raw_json") or {}
  state = pbp.get("gameState", "UNKNOWN")
  states[state] = states.get(state, 0) + 1
print(f"   States: {states}")

print("\n" + "=" * 70)


