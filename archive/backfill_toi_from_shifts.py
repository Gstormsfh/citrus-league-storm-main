#!/usr/bin/env python3
"""
Backfill TOI for games that have shifts but TOI=0 in player_game_stats.
This fixes the issue where games were extracted before shifts were computed.
"""

import os
import time
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def _safe_int(v, default=0) -> int:
  try:
    return int(v) if v is not None else default
  except Exception:
    return default


def compute_toi_for_game(db: SupabaseRest, game_id: int) -> dict:
  """Compute TOI for all players in a game, using player_toi_by_situation first."""
  toi_by_player = {}
  
  # Try player_toi_by_situation first (most accurate)
  toi_records = db.select(
    "player_toi_by_situation",
    select="player_id,toi_seconds",
    filters=[("game_id", "eq", game_id)]
  )
  
  if toi_records:
    for record in toi_records:
      player_id = _safe_int(record.get("player_id"), 0)
      toi_seconds = _safe_int(record.get("toi_seconds"), 0)
      if player_id and toi_seconds:
        if player_id not in toi_by_player:
          toi_by_player[player_id] = 0
        toi_by_player[player_id] += toi_seconds
    return toi_by_player
  
  # Fallback to player_shifts
  shifts = db.select(
    "player_shifts",
    select="player_id,shift_start_time_seconds,shift_end_time_seconds",
    filters=[("game_id", "eq", game_id)]
  )
  
  if not shifts:
    shifts = db.select(
      "player_shifts_official",
      select="player_id,shift_start_time_seconds,shift_end_time_seconds",
      filters=[("game_id", "eq", game_id)]
    )
  
  if shifts:
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


def main():
  print("=" * 80)
  print("[backfill_toi_from_shifts] STARTING")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print()
  
  # Find games with TOI=0 but shifts exist
  print("Finding games with TOI=0 but shifts available...")
  
  # Get all unique game_ids from player_game_stats where TOI=0
  games_with_zero_toi = set()
  offset = 0
  batch_size = 1000
  
  while True:
    stats = db.select(
      "player_game_stats",
      select="game_id",
      filters=[("season", "eq", DEFAULT_SEASON), ("icetime_seconds", "eq", 0)],
      limit=batch_size,
      offset=offset
    )
    if not stats:
      break
    games_with_zero_toi.update([_safe_int(s.get("game_id"), 0) for s in stats if s.get("game_id")])
    if len(stats) < batch_size:
      break
    offset += batch_size
  
  games_with_zero_toi.discard(0)
  print(f"Found {len(games_with_zero_toi):,} games with TOI=0")
  
  # Check which ones have shifts
  games_with_shifts = set()
  offset = 0
  
  while True:
    shifts = db.select("player_toi_by_situation", select="game_id", limit=batch_size, offset=offset)
    if shifts:
      games_with_shifts.update([_safe_int(s.get("game_id"), 0) for s in shifts if s.get("game_id")])
    if not shifts or len(shifts) < batch_size:
      break
    offset += batch_size
  
  # Also check player_shifts
  offset = 0
  while True:
    shifts = db.select("player_shifts", select="game_id", limit=batch_size, offset=offset)
    if shifts:
      games_with_shifts.update([_safe_int(s.get("game_id"), 0) for s in shifts if s.get("game_id")])
    if not shifts or len(shifts) < batch_size:
      break
    offset += batch_size
  
  games_to_fix = sorted(games_with_zero_toi & games_with_shifts)
  print(f"Found {len(games_to_fix):,} games with TOI=0 but shifts available")
  print()
  
  if not games_to_fix:
    print("No games need TOI backfill!")
    return 0
  
  # Backfill TOI for these games
  print(f"Backfilling TOI for {len(games_to_fix):,} games...")
  updated_count = 0
  last_progress_time = time.time()
  
  for idx, game_id in enumerate(games_to_fix, 1):
    toi_by_player = compute_toi_for_game(db, game_id)
    
    if not toi_by_player:
      continue
    
    # Get existing game stats to preserve other fields
    existing_stats = db.select(
      "player_game_stats",
      select="player_id,game_date,team_abbrev,position_code,is_goalie",
      filters=[("game_id", "eq", game_id), ("season", "eq", DEFAULT_SEASON)]
    )
    
    # Create lookup for existing stats
    existing_by_player = {_safe_int(s.get("player_id"), 0): s for s in existing_stats if s.get("player_id")}
    
    # Update player_game_stats for each player
    updates = []
    for player_id, toi_seconds in toi_by_player.items():
      existing = existing_by_player.get(player_id, {})
      updates.append({
        "season": DEFAULT_SEASON,
        "game_id": game_id,
        "player_id": player_id,
        "game_date": existing.get("game_date") or "2025-10-07",  # Fallback date
        "team_abbrev": existing.get("team_abbrev"),
        "position_code": existing.get("position_code"),
        "is_goalie": existing.get("is_goalie") or False,
        "icetime_seconds": toi_seconds
      })
    
    if updates:
      # Upsert in chunks
      CHUNK = 100
      for i in range(0, len(updates), CHUNK):
        db.upsert("player_game_stats", updates[i:i + CHUNK], on_conflict="season,game_id,player_id")
      
      updated_count += len(updates)
    
    # Progress every 15 seconds
    current_time = time.time()
    if current_time - last_progress_time >= 15:
      print(f"  [PROGRESS] Processed {idx}/{len(games_to_fix)} games, updated {updated_count} player records...")
      last_progress_time = current_time
  
  print()
  print("=" * 80)
  print("[backfill_toi_from_shifts] COMPLETE")
  print("=" * 80)
  print(f"Games processed: {len(games_to_fix):,}")
  print(f"Player records updated: {updated_count:,}")
  
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
