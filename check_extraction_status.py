#!/usr/bin/env python3
"""Check if games need re-extraction for PIM/PPP/SHP."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 70)
print("Extraction Status Check")
print("=" * 70)

# Check how many games have PIM/PPP/SHP data
all_games = []
offset = 0
while True:
  page = db.select("player_game_stats", limit=1000, offset=offset)
  if not page:
    break
  all_games.extend(page)
  if len(page) < 1000:
    break
  offset += 1000

print(f"\nTotal player_game_stats rows: {len(all_games)}")

games_with_pim = sum(1 for g in all_games if g.get("pim", 0) > 0)
games_with_ppp = sum(1 for g in all_games if g.get("ppp", 0) > 0)
games_with_shp = sum(1 for g in all_games if g.get("shp", 0) > 0)

print(f"\nGames with PIM > 0: {games_with_pim}")
print(f"Games with PPP > 0: {games_with_ppp}")
print(f"Games with SHP > 0: {games_with_shp}")

# Check raw_nhl_data extraction status
raw_games = []
offset = 0
while True:
  page = db.select("raw_nhl_data", select="game_id,stats_extracted", limit=1000, offset=offset)
  if not page:
    break
  raw_games.extend(page)
  if len(page) < 1000:
    break
  offset += 1000

extracted = sum(1 for g in raw_games if g.get("stats_extracted") is True)
not_extracted = sum(1 for g in raw_games if g.get("stats_extracted") is False or g.get("stats_extracted") is None)

print(f"\nRaw NHL Data:")
print(f"  Total games: {len(raw_games)}")
print(f"  Extracted: {extracted}")
print(f"  Not extracted: {not_extracted}")

print("=" * 70)

