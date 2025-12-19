#!/usr/bin/env python3
"""
ensure_toi_for_all_games.py

Run calculate_player_toi.py for all games to populate player_toi_by_situation.
This ensures we have accurate TOI data for all games (22+ min/game for top players).
"""

import os
import sys
import time
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


def supabase_client() -> SupabaseRest:
  return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _safe_int(v, default=0) -> int:
  try:
    return int(v) if v is not None else default
  except Exception:
    return default


def main() -> int:
  print("=" * 80)
  print("[ensure_toi_for_all_games] STARTING")
  print("=" * 80)
  print("This script runs calculate_player_toi.py for all games to ensure accurate TOI.")
  print("This is the BEST source of TOI data (22+ min/game for top players).")
  print()
  
  try:
    db = supabase_client()
    print("[ensure_toi] Connected to Supabase")
  except Exception as e:
    print(f"[ensure_toi] ERROR: Failed to connect: {e}")
    return 1
  
  # Get all game IDs
  print("[ensure_toi] Finding all games...")
  all_game_ids = set()
  offset = 0
  batch_size = 1000
  
  while True:
    games = db.select("raw_nhl_data", select="game_id", limit=batch_size, offset=offset, order="game_id.asc")
    if not games:
      break
    all_game_ids.update([_safe_int(g.get("game_id"), 0) for g in games if g.get("game_id")])
    if len(games) < batch_size:
      break
    offset += batch_size
  
  all_game_ids.discard(0)
  print(f"[ensure_toi] Found {len(all_game_ids):,} games")
  
  # Check which games already have TOI data
  games_with_toi = set()
  offset = 0
  
  while True:
    toi_records = db.select("player_toi_by_situation", select="game_id", limit=batch_size, offset=offset)
    if toi_records:
      games_with_toi.update([_safe_int(t.get("game_id"), 0) for t in toi_records if t.get("game_id")])
    if not toi_records or len(toi_records) < batch_size:
      break
    offset += batch_size
  
  games_with_toi.discard(0)
  games_needing_toi = sorted(all_game_ids - games_with_toi)
  
  print(f"[ensure_toi] Games with TOI: {len(games_with_toi):,}")
  print(f"[ensure_toi] Games needing TOI: {len(games_needing_toi):,}")
  print()
  
  if not games_needing_toi:
    print("[ensure_toi] All games already have TOI data!")
    return 0
  
  print(f"[ensure_toi] Running calculate_player_toi.py for {len(games_needing_toi):,} games...")
  print("[ensure_toi] NOTE: This will take a while. The script processes games one at a time.")
  print()
  
  # Import and run calculate_player_toi for each game
  try:
    from calculate_player_toi import process_game_shifts, store_shifts_and_toi
    
    processed = 0
    last_progress_time = time.time()
    
    for idx, game_id in enumerate(games_needing_toi, 1):
      try:
        shifts, toi_records = process_game_shifts(game_id)
        if shifts or toi_records:
          store_shifts_and_toi(shifts, toi_records)
          processed += 1
        
        # Progress every 15 seconds
        current_time = time.time()
        if current_time - last_progress_time >= 15:
          print(f"  [PROGRESS] Processed {idx}/{len(games_needing_toi)} games ({processed} successful)...")
          last_progress_time = current_time
        
        # Small delay to avoid overwhelming the system
        if idx < len(games_needing_toi):
          time.sleep(0.5)
      
      except Exception as e:
        print(f"  [ERROR] Failed to process game {game_id}: {e}")
        continue
    
    print()
    print("=" * 80)
    print("[ensure_toi_for_all_games] COMPLETE")
    print("=" * 80)
    print(f"Games processed: {processed:,}/{len(games_needing_toi):,}")
    print()
    print("[ensure_toi] Next steps:")
    print("  1. Run: python backfill_toi_and_ppp_shp.py (to update player_game_stats with new TOI)")
    print("  2. Run: python build_player_season_stats.py")
    
  except ImportError:
    print("[ensure_toi] ERROR: Could not import calculate_player_toi")
    print("[ensure_toi] Make sure calculate_player_toi.py is in the same directory")
    return 1
  
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
