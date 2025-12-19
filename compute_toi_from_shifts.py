#!/usr/bin/env python3
"""Compute TOI from player_shifts_official and update player_game_stats."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("Computing TOI from player_shifts_official...")

# Get all shifts with duration
all_shifts = []
offset = 0
while True:
  page = db.select("player_shifts_official", select="game_id,player_id,duration_seconds", limit=1000, offset=offset)
  if not page:
    break
  all_shifts.extend([s for s in page if s.get("duration_seconds") is not None])
  if len(page) < 1000:
    break
  offset += 1000

print(f"Found {len(all_shifts)} shifts with duration")

# Aggregate by player_id + game_id
toi_by_player_game = {}
for shift in all_shifts:
  game_id = shift.get("game_id")
  player_id = shift.get("player_id")
  duration = shift.get("duration_seconds", 0)
  
  key = (player_id, game_id)
  toi_by_player_game[key] = toi_by_player_game.get(key, 0) + duration

print(f"Computed TOI for {len(toi_by_player_game)} player-game combinations")

# Update player_game_stats
updated = 0
for (player_id, game_id), toi_seconds in toi_by_player_game.items():
  db.update("player_game_stats", {"icetime_seconds": int(toi_seconds)}, filters=[("player_id", "eq", player_id), ("game_id", "eq", game_id)])
  updated += 1
  if updated % 100 == 0:
    print(f"  Updated {updated}/{len(toi_by_player_game)} player-game stats...")

print(f"\nDone! Updated {updated} player-game stats with TOI.")

