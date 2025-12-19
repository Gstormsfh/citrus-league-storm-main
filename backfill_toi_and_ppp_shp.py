#!/usr/bin/env python3
"""
backfill_toi_and_ppp_shp.py

Re-process all games with new window-based PPP/SHP extraction and PBP-based TOI calculation.
This ensures 100% TOI coverage and accurate PPP/SHP matching NHL.com standards.
"""

import os
import sys
import time
import datetime as dt
from typing import List
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


def main() -> int:
  print("=" * 80)
  print("[backfill_toi_and_ppp_shp] STARTING")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print(f"Timestamp: {_now_iso()}")
  print()
  
  try:
    db = supabase_client()
    print("[backfill] Connected to Supabase")
  except Exception as e:
    print(f"[backfill] ERROR: Failed to connect: {e}")
    return 1
  
  # Import extractor functions
  from extractor_job import _aggregate_player_stats_from_pbp, _upsert_player_game_stats, _is_final_game_state
  
  # Process games in batches (avoid timeout)
  print("[backfill] Processing games in batches...")
  batch_size = 50  # Smaller batches to avoid timeout
  offset = 0
  processed_count = 0
  updated_count = 0
  last_progress_time = time.time()
  total_games_processed = 0
  
  while True:
    games = db.select(
      "raw_nhl_data",
      select="game_id,game_date,raw_json,stats_extracted",
      order="game_id.asc",
      limit=batch_size,
      offset=offset
    )
    if not games:
      break
    
    print(f"[backfill] Processing batch: games {offset+1} to {offset+len(games)}...")
    
    for idx, game in enumerate(games, 1):
      game_id = _safe_int(game.get("game_id"), 0)
      if not game_id:
        continue
      
      pbp = game.get("raw_json") or {}
      if not pbp:
        continue
      
      try:
        # Re-extract stats with new logic
        rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
        rows = list(rows_map.values())
        
        if rows:
          # Upsert with new TOI and PPP/SHP
          _upsert_player_game_stats(db, rows, game_id, pbp)
          updated_count += len(rows)
          processed_count += 1
          
          total_games_processed += 1
          
          # Progress every 15 seconds
          current_time = time.time()
          if current_time - last_progress_time >= 15:
            print(f"  [PROGRESS] Processed {total_games_processed} games total ({processed_count} successful, {updated_count:,} player records updated)...")
            last_progress_time = current_time
        
      except Exception as e:
        print(f"  [ERROR] Failed to process game {game_id}: {e}")
        import traceback
        traceback.print_exc()
        continue
    
    # Move to next batch
    if len(games) < batch_size:
      break
    offset += batch_size
    time.sleep(1)  # Small delay between batches
  
  print()
  print("=" * 80)
  print("[backfill_toi_and_ppp_shp] COMPLETE")
  print("=" * 80)
  print(f"Games processed: {processed_count:,} successful out of {total_games_processed:,} total")
  print(f"Player records updated: {updated_count:,}")
  print()
  print("[backfill] Next steps:")
  print("  1. Run: python build_player_season_stats.py")
  print("  2. Run: python compute_player_season_plus_minus.py --write")
  print("  3. Verify McDavid stats: 24 PPP, 1 SHP, ~20-22 TOI/G")
  
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
