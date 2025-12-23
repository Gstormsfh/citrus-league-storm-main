#!/usr/bin/env python3
"""
Fix missing TOI for games that have shifts but TOI=0 in player_game_stats.
This happens when extractor ran before shifts were computed.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def _safe_int(v, default=0) -> int:
  try:
    return int(v) if v is not None else default
  except Exception:
    return default

def compute_toi_from_shifts(game_id: int) -> dict:
  """Compute TOI for all players in a game from shifts."""
  toi_by_player = {}
  
  # Try computed shifts first
  shifts = db.select(
    "player_shifts",
    select="player_id,shift_start_time_seconds,shift_end_time_seconds",
    filters=[("game_id", "eq", game_id)]
  )
  
  # Fallback to official shifts
  if not shifts:
    shifts = db.select(
      "player_shifts_official",
      select="player_id,shift_start_time_seconds,shift_end_time_seconds",
      filters=[("game_id", "eq", game_id)]
    )
  
  if not shifts:
    return {}
  
  for shift in shifts:
    player_id = _safe_int(shift.get("player_id"), 0)
    start = shift.get("shift_start_time_seconds")
    end = shift.get("shift_end_time_seconds")
    
    if not player_id or start is None or end is None:
      continue
    
    duration = max(0, float(end) - float(start))
    
    if player_id not in toi_by_player:
      toi_by_player[player_id] = 0
    toi_by_player[player_id] += int(duration)
  
  return toi_by_player

# Find games with 0 TOI but shifts exist
print("Finding games with 0 TOI but shifts available...")

# Get all unique games from player_game_stats
all_games = []
offset = 0
batch_size = 1000

while True:
  games = db.select(
    "player_game_stats",
    select="game_id",
    filters=[("season", "eq", 2025), ("icetime_seconds", "eq", 0)],
    limit=batch_size,
    offset=offset
  )
  if not games:
    break
  unique_games = set(g.get("game_id") for g in games if g.get("game_id"))
  all_games.extend(unique_games)
  if len(games) < batch_size:
    break
  offset += batch_size

all_games = sorted(set(all_games))
print(f"Found {len(all_games)} games with 0 TOI\n")

# Check which ones have shifts
games_with_shifts = []
for game_id in all_games[:100]:  # Limit to first 100 for testing
  shifts = db.select("player_shifts", select="id", filters=[("game_id", "eq", game_id)], limit=1)
  if not shifts:
    shifts = db.select("player_shifts_official", select="shift_id", filters=[("game_id", "eq", game_id)], limit=1)
  if shifts:
    games_with_shifts.append(game_id)

print(f"Found {len(games_with_shifts)} games with shifts that need TOI update\n")

# Update TOI for these games
updated_count = 0
for idx, game_id in enumerate(games_with_shifts, 1):
  toi_by_player = compute_toi_from_shifts(game_id)
  
  if not toi_by_player:
    continue
  
  # Get all player_game_stats for this game
  game_stats = db.select(
    "player_game_stats",
    select="season,game_id,game_date,player_id",
    filters=[("game_id", "eq", game_id), ("season", "eq", 2025)]
  )
  
  if not game_stats:
    continue
  
  # Update each player's TOI (need to include all required fields for upsert)
  updates = []
  for stat in game_stats:
    player_id = _safe_int(stat.get("player_id"), 0)
    if player_id in toi_by_player:
      updates.append({
        "season": 2025,
        "game_id": game_id,
        "game_date": stat.get("game_date"),
        "player_id": player_id,
        "icetime_seconds": toi_by_player[player_id]
      })
  
  if updates:
    # Upsert TOI updates in batches
    CHUNK = 50
    for i in range(0, len(updates), CHUNK):
      db.upsert("player_game_stats", updates[i:i+CHUNK], on_conflict="season,game_id,player_id")
    updated_count += len(updates)
    print(f"  [{idx}/{len(games_with_shifts)}] Game {game_id}: Updated TOI for {len(updates)} players")
  
  if idx % 10 == 0:
    print(f"  Progress: {idx}/{len(games_with_shifts)} games processed, {updated_count} players updated")

print(f"\nComplete! Updated TOI for {updated_count} player-game combinations")
