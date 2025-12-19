#!/usr/bin/env python3
"""Check McDavid's games in the pipeline."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import json

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

MCDAVID_ID = 8478402

print("=" * 60)
print(f"Checking games for Connor McDavid (ID: {MCDAVID_ID})")
print("=" * 60)

# Check player_game_stats
print("\n1. player_game_stats:")
mcdavid_games = db.select("player_game_stats", filters=[("player_id", "eq", MCDAVID_ID)], limit=100)
print(f"   Found {len(mcdavid_games)} game rows")
if mcdavid_games:
  for g in mcdavid_games[:10]:
    print(f"   Game {g.get('game_id')}: G={g.get('goals', 0)}, A={g.get('primary_assists', 0) + g.get('secondary_assists', 0)}, PTS={g.get('points', 0)}, SOG={g.get('shots_on_goal', 0)}")

# Check raw_nhl_data for games where McDavid appears
print("\n2. Checking raw_nhl_data for games with McDavid...")
all_games = db.select("raw_nhl_data", select="game_id,raw_json", limit=1000)
mcdavid_in_games = []
for g in all_games:
  pbp = g.get("raw_json") or {}
  # Check rosterSpots
  rosters = pbp.get("rosterSpots") or []
  if isinstance(rosters, list):
    for p in rosters:
      if _safe_int(p.get("playerId")) == MCDAVID_ID:
        mcdavid_in_games.append(g.get("game_id"))
        break
  # Also check plays for McDavid
  plays = pbp.get("plays") or []
  for play in plays:
    players = play.get("players") or []
    for p in players:
      if _safe_int(p.get("player", {}).get("id")) == MCDAVID_ID:
        if g.get("game_id") not in mcdavid_in_games:
          mcdavid_in_games.append(g.get("game_id"))
        break

print(f"   Found McDavid in {len(mcdavid_in_games)} raw_nhl_data games")
if mcdavid_in_games:
  print(f"   Sample game IDs: {mcdavid_in_games[:10]}")

# Check player_season_stats
print("\n3. player_season_stats:")
season = db.select("player_season_stats", filters=[("player_id", "eq", MCDAVID_ID)], limit=1)
if season:
  s = season[0]
  print(f"   GP: {s.get('games_played', 0)}")
  print(f"   G: {s.get('goals', 0)}, A: {s.get('primary_assists', 0) + s.get('secondary_assists', 0)}, PTS: {s.get('points', 0)}")
  print(f"   SOG: {s.get('shots_on_goal', 0)}")

def _safe_int(v, default=0):
  try:
    return int(v) if v is not None else default
  except:
    return default

