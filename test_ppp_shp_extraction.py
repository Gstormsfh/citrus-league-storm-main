#!/usr/bin/env python3
"""Test PPP/SHP extraction from a sample game."""

import os
import json
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from extractor_job import _aggregate_player_stats_from_pbp

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Get a sample game with goals
game = db.select("raw_nhl_data", select="game_id,raw_json", filters=[("game_id", "eq", 2025020001)], limit=1)
if not game:
  print("No game found")
  exit(1)

pbp = game[0].get("raw_json", {})
plays = pbp.get("plays", [])

# Find goals
goals = []
for play in plays:
  if play.get("typeDescKey") == "goal":
    goals.append(play)

print(f"Total goals: {len(goals)}")

if goals:
  print("\nSample goal:")
  print(json.dumps(goals[0], indent=2))
  
  details = goals[0].get("details", {})
  print(f"\nGoal details:")
  print(f"  situationCode: {details.get('situationCode')}")
  print(f"  scoringPlayerId: {details.get('scoringPlayerId')}")
  print(f"  assist1PlayerId: {details.get('assist1PlayerId')}")
  print(f"  assist2PlayerId: {details.get('assist2PlayerId')}")

# Test extraction
print("\n" + "="*70)
print("Testing extraction function:")
print("="*70)
stats = _aggregate_player_stats_from_pbp(pbp, 2025)

# Find players with PPP or SHP
players_with_ppp = {pid: s.get("ppp", 0) for pid, s in stats.items() if s.get("ppp", 0) > 0}
players_with_shp = {pid: s.get("shp", 0) for pid, s in stats.items() if s.get("shp", 0) > 0}

print(f"\nPlayers with PPP > 0: {len(players_with_ppp)}")
if players_with_ppp:
  print(f"  Sample: {list(players_with_ppp.items())[:5]}")

print(f"\nPlayers with SHP > 0: {len(players_with_shp)}")
if players_with_shp:
  print(f"  Sample: {list(players_with_shp.items())[:5]}")



