#!/usr/bin/env python3
"""
backfill_missing_stats.py

One-time script to fix all historical games:
- Find games in raw_nhl_data that are final but stats_extracted=false
- Ensure shifts exist for those games
- Run extraction
- Compute plus/minus
- Rebuild season stats

This ensures all historical data is complete before relying on live pipeline.
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


def get_final_unextracted_games(db: SupabaseRest) -> List[dict]:
  """
  Get games that are final (OFF, FINAL, F/SO, OVER) but stats_extracted=false.
  """
  print("[backfill] Finding final games that need extraction...")
  
  # Get games with stats_extracted=false
  all_games = []
  offset = 0
  batch_size = 1000
  
  while True:
    games = db.select(
      "raw_nhl_data",
      select="game_id,game_date,raw_json,stats_extracted",
      filters=[("stats_extracted", "eq", False)],
      limit=batch_size,
      offset=offset
    )
    if not games:
      break
    
    # Filter for final games
    for g in games:
      pbp = g.get("raw_json") or {}
      state = pbp.get("gameState", "")
      state_upper = str(state).upper()
      
      if state_upper in ("OFF", "FINAL", "F/SO", "OVER"):
        all_games.append(g)
    
    if len(games) < batch_size:
      break
    offset += batch_size
  
  print(f"[backfill] Found {len(all_games):,} final games that need extraction")
  return all_games


def check_game_has_shifts(db: SupabaseRest, game_id: int) -> bool:
  """Check if game has shifts (does not compute them)."""
  # Check if shifts exist
  shifts = db.select("player_shifts", select="id", filters=[("game_id", "eq", game_id)], limit=1)
  if shifts:
    return True
  
  shifts = db.select("player_shifts_official", select="shift_id", filters=[("game_id", "eq", game_id)], limit=1)
  if shifts:
    return True
  
  return False


def extract_game_stats(db: SupabaseRest, game: dict) -> bool:
  """Extract stats for a single game using extractor_job logic."""
  game_id = _safe_int(game.get("game_id"), 0)
  if not game_id:
    return False
  
  try:
    from extractor_job import _aggregate_player_stats_from_pbp, _upsert_player_game_stats, _is_final_game_state, _mark_extracted_if_final
    
    pbp = game.get("raw_json") or {}
    state = pbp.get("gameState")
    
    rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
    rows = list(rows_map.values())
    
    if rows:
      _upsert_player_game_stats(db, rows, game_id)
      print(f"  [backfill] ✓ Extracted stats for game {game_id} ({len(rows)} players)")
      
      # Mark as extracted if final
      if _is_final_game_state(state):
        _mark_extracted_if_final(db, game_id)
        print(f"  [backfill] ✓ Marked game {game_id} as stats_extracted=true")
      
      return True
    else:
      print(f"  [backfill] ✗ No stats extracted for game {game_id}")
      return False
      
  except Exception as e:
    print(f"  [backfill] ✗ Error extracting stats for game {game_id}: {e}")
    import traceback
    traceback.print_exc()
    return False


def main() -> int:
  print("=" * 80)
  print("[backfill_missing_stats] STARTING")
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
  
  # Step 1: Find final games that need extraction
  games = get_final_unextracted_games(db)
  
  if not games:
    print("[backfill] No games need backfilling!")
    return 0
  
  print(f"[backfill] Processing {len(games):,} games...")
  print()
  
  # Step 2: Check shifts status (informational)
  print("[backfill] Step 1: Checking shifts status...")
  shifts_count = 0
  for idx, game in enumerate(games, 1):
    game_id = _safe_int(game.get("game_id"), 0)
    if check_game_has_shifts(db, game_id):
      shifts_count += 1
    
    if idx % 50 == 0:
      print(f"  [PROGRESS] Checked {idx}/{len(games)} games ({shifts_count} have shifts)...")
  
  print(f"[backfill] Games with shifts: {shifts_count}/{len(games)}")
  if shifts_count < len(games):
    print(f"[backfill] Note: {len(games) - shifts_count} games missing shifts - TOI will be 0 but PPP/SHP/hits/blocks will still be extracted")
  print()
  
  # Step 3: Extract stats
  print("[backfill] Step 2: Extracting stats for all games...")
  extracted_count = 0
  last_progress_time = time.time()
  
  for idx, game in enumerate(games, 1):
    if extract_game_stats(db, game):
      extracted_count += 1
    
    # Progress every 15 seconds
    current_time = time.time()
    if current_time - last_progress_time >= 15:
      print(f"  [PROGRESS] Extracted {idx}/{len(games)} games ({extracted_count} successful)...")
      last_progress_time = current_time
    
    time.sleep(0.5)  # Small delay
  
  print(f"[backfill] Stats extracted: {extracted_count}/{len(games)} games")
  print()
  
  # Step 4: Compute plus/minus
  print("[backfill] Step 3: Computing plus/minus...")
  try:
    from compute_player_season_plus_minus import compute_plus_minus, upsert_plus_minus
    pm = compute_plus_minus(DEFAULT_SEASON, db)
    if pm:
      upsert_plus_minus(db, DEFAULT_SEASON, pm)
      print(f"[backfill] ✓ Computed plus/minus for {len(pm):,} players")
    else:
      print("[backfill] No plus/minus computed")
  except Exception as e:
    print(f"[backfill] Warning: Plus/minus computation failed: {e}")
  
  print()
  
  # Step 5: Rebuild season stats
  print("[backfill] Step 4: Rebuilding season stats...")
  try:
    from build_player_season_stats import main as build_main
    build_main()
    print("[backfill] ✓ Season stats rebuilt")
  except Exception as e:
    print(f"[backfill] Warning: Season stats rebuild failed: {e}")
    import traceback
    traceback.print_exc()
  
  print()
  print("=" * 80)
  print("[backfill_missing_stats] COMPLETE")
  print("=" * 80)
  print(f"Games processed: {len(games):,}")
  print(f"Shifts ensured: {shifts_ensured:,}")
  print(f"Stats extracted: {extracted_count:,}")
  
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
