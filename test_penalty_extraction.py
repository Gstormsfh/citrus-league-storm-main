#!/usr/bin/env python3
"""Test penalty extraction from a sample game."""

import os
import json
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from extractor_job import _aggregate_player_stats_from_pbp, _safe_int

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Get a sample game
game = db.select("raw_nhl_data", select="game_id,raw_json", filters=[("game_id", "eq", 2025020001)], limit=1)
if not game:
  print("No game found")
  exit(1)

pbp = game[0].get("raw_json", {})
plays = pbp.get("plays", [])

print(f"Total plays: {len(plays)}")

# Find penalties
penalties = []
for play in plays:
  if play.get("typeDescKey") == "penalty":
    penalties.append(play)

print(f"\nPenalties found: {len(penalties)}")

if penalties:
  print("\nSample penalty:")
  print(json.dumps(penalties[0], indent=2))
  
  details = penalties[0].get("details", {})
  print(f"\nPenalty details:")
  print(f"  committedByPlayerId: {details.get('committedByPlayerId')}")
  print(f"  penaltyOnPlayerId: {details.get('penaltyOnPlayerId')}")
  print(f"  penaltyMinutes: {details.get('penaltyMinutes')}")
  print(f"  typeDescKey: {penalties[0].get('typeDescKey')}")

# Test extraction
print("\n" + "="*70)
print("Testing extraction function:")
print("="*70)
stats = _aggregate_player_stats_from_pbp(pbp, 2025)

# Find McDavid
mcdavid_id = 8478402
if mcdavid_id in stats:
  mcdavid = stats[mcdavid_id]
  print(f"\nMcDavid stats from extraction:")
  print(f"  PIM: {mcdavid.get('pim', 0)}")
  print(f"  PPP: {mcdavid.get('ppp', 0)}")
  print(f"  SHP: {mcdavid.get('shp', 0)}")
  print(f"  Goals: {mcdavid.get('goals', 0)}")
  print(f"  Assists: {mcdavid.get('primary_assists', 0) + mcdavid.get('secondary_assists', 0)}")

# Check all players with PIM
players_with_pim = {pid: s.get("pim", 0) for pid, s in stats.items() if s.get("pim", 0) > 0}
print(f"\nPlayers with PIM > 0: {len(players_with_pim)}")
if players_with_pim:
  print(f"  Sample: {list(players_with_pim.items())[:5]}")


