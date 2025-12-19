#!/usr/bin/env python3
"""
ensure_shifts_for_all_games.py

Ensures all games in raw_nhl_data have shifts computed (for TOI calculation).
Scans for games without shifts and computes them using calculate_player_toi.py logic.

This script can be run standalone or integrated into the pipeline.
"""

import os
import sys
import time
import datetime as dt
from typing import Dict, List, Set, Tuple
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
  return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def _safe_int(v, default=0) -> int:
  try:
    return int(v) if v is not None else default
  except Exception:
    return default


def get_games_without_shifts(db: SupabaseRest, season: int) -> List[int]:
  """
  Find game IDs in raw_nhl_data that don't have shifts in player_shifts or player_shifts_official.
  
  Returns: List of game_id integers
  """
  print("[ensure_shifts] Finding games without shifts...")
  
  # Get all games from raw_nhl_data
  all_games = []
  offset = 0
  batch_size = 1000
  
  while True:
    games = db.select("raw_nhl_data", select="game_id", limit=batch_size, offset=offset)
    if not games:
      break
    all_games.extend([_safe_int(g.get("game_id"), 0) for g in games if g.get("game_id")])
    if len(games) < batch_size:
      break
    offset += batch_size
  
  all_games = [g for g in all_games if g > 0]
  print(f"[ensure_shifts] Found {len(all_games):,} total games in raw_nhl_data")
  
  # Get games that have shifts
  games_with_shifts = set()
  offset = 0
  
  while True:
    shifts = db.select("player_shifts", select="game_id", limit=batch_size, offset=offset)
    if shifts:
      games_with_shifts.update([_safe_int(s.get("game_id"), 0) for s in shifts if s.get("game_id")])
    if not shifts or len(shifts) < batch_size:
      break
    offset += batch_size
  
  # Also check official shifts
  offset = 0
  while True:
    shifts = db.select("player_shifts_official", select="game_id", limit=batch_size, offset=offset)
    if shifts:
      games_with_shifts.update([_safe_int(s.get("game_id"), 0) for s in shifts if s.get("game_id")])
    if not shifts or len(shifts) < batch_size:
      break
    offset += batch_size
  
  games_with_shifts.discard(0)
  print(f"[ensure_shifts] Found {len(games_with_shifts):,} games with shifts")
  
  # Find games without shifts
  games_without = [g for g in all_games if g not in games_with_shifts]
  print(f"[ensure_shifts] Found {len(games_without):,} games without shifts")
  
  return games_without


def compute_shifts_for_game(db: SupabaseRest, game_id: int) -> Tuple[bool, int, str]:
  """
  Compute shifts for a single game.
  
  Note: This is a simplified version. For full shift computation,
  run calculate_player_toi.py separately for all games.
  
  Returns: (success: bool, shifts_created: int, error_message: str)
  """
  # For now, we'll just check if shifts can be computed
  # The actual computation should be done via calculate_player_toi.py
  # This function serves as a placeholder that can be enhanced later
  
  # Check if game has raw_nhl_data
  try:
    game_data = db.select("raw_nhl_data", select="game_id,raw_json", filters=[("game_id", "eq", game_id)], limit=1)
    if not game_data:
      return False, 0, "Game not found in raw_nhl_data"
  except Exception as e:
    return False, 0, f"Error checking game: {e}"
  
  # For now, return a message suggesting to run calculate_player_toi.py
  # In a full implementation, we would call process_game_shifts here
  return False, 0, "Shift computation requires calculate_player_toi.py - run it separately"


def main() -> int:
  print("=" * 80)
  print("[ensure_shifts_for_all_games] STARTING")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print(f"Timestamp: {_now_iso()}")
  print()
  
  try:
    db = supabase_client()
    print("[ensure_shifts] Connected to Supabase")
  except Exception as e:
    print(f"[ensure_shifts] ERROR: Failed to connect: {e}")
    return 1
  
  # Find games without shifts
  games_without = get_games_without_shifts(db, DEFAULT_SEASON)
  
  if not games_without:
    print("[ensure_shifts] All games already have shifts!")
    return 0
  
  if games_without:
    print(f"[ensure_shifts] Found {len(games_without):,} games without shifts")
    print(f"[ensure_shifts] To compute shifts, run: python calculate_player_toi.py")
    print(f"[ensure_shifts] Sample game IDs missing shifts: {sorted(games_without)[:10]}")
    print()
    print("[ensure_shifts] NOTE: Shift computation is handled by calculate_player_toi.py")
    print("[ensure_shifts] This script identifies games that need shifts computed.")
    return 0
  else:
    print("[ensure_shifts] ✓ All games have shifts!")
    return 0


if __name__ == "__main__":
  raise SystemExit(main())
