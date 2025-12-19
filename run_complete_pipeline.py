#!/usr/bin/env python3
"""
run_complete_pipeline.py

Master orchestrator script that runs the complete pipeline in correct order:
1. Ensure shifts exist for all unextracted games
2. Run extractor on unextracted games
3. Compute plus/minus for season
4. Rebuild season stats
5. Verify data quality

This can be run manually or scheduled to run periodically (e.g., every 15 minutes).
"""

import os
import sys
import time
import datetime as dt
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


def main() -> int:
  print("=" * 80)
  print("[run_complete_pipeline] STARTING COMPLETE PIPELINE")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print(f"Timestamp: {_now_iso()}")
  print()
  
  try:
    db = supabase_client()
    print("[pipeline] Connected to Supabase")
  except Exception as e:
    print(f"[pipeline] ERROR: Failed to connect: {e}")
    return 1
  
  start_time = time.time()
  
  # Step 1: Ensure shifts exist
  print("[pipeline] Step 1: Ensuring shifts exist for unextracted games...")
  try:
    from ensure_shifts_for_all_games import get_games_without_shifts, compute_shifts_for_game
    
    games_without = get_games_without_shifts(db, DEFAULT_SEASON)
    if games_without:
      print(f"[pipeline] Computing shifts for {len(games_without):,} games...")
      for idx, game_id in enumerate(games_without[:50], 1):  # Limit to 50 per run to avoid timeout
        success, _, _ = compute_shifts_for_game(db, game_id)
        if idx % 10 == 0:
          print(f"  [PROGRESS] Processed {idx}/{min(50, len(games_without))} games...")
        time.sleep(0.5)
      print(f"[pipeline] [OK] Shift computation complete")
    else:
      print("[pipeline] [OK] All games have shifts")
  except Exception as e:
    print(f"[pipeline] Warning: Shift computation failed: {e}")
    import traceback
    traceback.print_exc()
  
  print()
  
  # Step 2: Run extractor (process unextracted games)
  print("[pipeline] Step 2: Extracting stats from unextracted games...")
  try:
    from extractor_job import _get_unextracted_games, _aggregate_player_stats_from_pbp, _upsert_player_game_stats, _is_final_game_state, _mark_extracted_if_final, _safe_int
    
    games = _get_unextracted_games(db, 25)  # Process up to 25 games per run
    if games:
      print(f"[pipeline] Found {len(games)} unextracted games")
      extracted = 0
      for game in games:
        game_id = _safe_int(game.get("game_id"), 0)
        if not game_id:
          continue
        
        pbp = game.get("raw_json") or {}
        state = pbp.get("gameState")
        
        rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
        rows = list(rows_map.values())
        
        if rows:
          _upsert_player_game_stats(db, rows, game_id)
          extracted += 1
          
          if _is_final_game_state(state):
            _mark_extracted_if_final(db, game_id)
      
      print(f"[pipeline] [OK] Extracted stats for {extracted}/{len(games)} games")
    else:
      print("[pipeline] [OK] No unextracted games")
  except Exception as e:
    print(f"[pipeline] Warning: Extraction failed: {e}")
    import traceback
    traceback.print_exc()
  
  print()
  
  # Step 3: Compute plus/minus
  print("[pipeline] Step 3: Computing plus/minus...")
  try:
    from compute_player_season_plus_minus import compute_plus_minus, upsert_plus_minus
    
    pm = compute_plus_minus(DEFAULT_SEASON, db)
    if pm:
      upsert_plus_minus(db, DEFAULT_SEASON, pm)
      print(f"[pipeline] [OK] Computed plus/minus for {len(pm):,} players")
    else:
      print("[pipeline] No plus/minus computed")
  except Exception as e:
    print(f"[pipeline] Warning: Plus/minus computation failed: {e}")
    import traceback
    traceback.print_exc()
  
  print()
  
  # Step 4: Rebuild season stats
  print("[pipeline] Step 4: Rebuilding season stats...")
  try:
    from build_player_season_stats import main as build_main
    build_main()
    print("[pipeline] [OK] Season stats rebuilt")
  except Exception as e:
    print(f"[pipeline] Warning: Season stats rebuild failed: {e}")
    import traceback
    traceback.print_exc()
  
  print()
  
  # Step 5: Quick verification
  print("[pipeline] Step 5: Quick verification...")
  try:
    from verify_stats_completeness import check_player_stats_completeness
    stats_check = check_player_stats_completeness(db, DEFAULT_SEASON)
    print(f"[pipeline] Players with games: {stats_check['players_with_games']:,}")
    print(f"[pipeline] Players with 0 TOI: {stats_check['zero_toi_with_games']:,}")
    print(f"[pipeline] Players with 0 PPP: {stats_check['zero_ppp_with_games']:,}")
    print(f"[pipeline] Players with 0 SHP: {stats_check['zero_shp_with_games']:,}")
  except Exception as e:
    print(f"[pipeline] Warning: Verification failed: {e}")
  
  elapsed = time.time() - start_time
  print()
  print("=" * 80)
  print("[run_complete_pipeline] COMPLETE")
  print("=" * 80)
  print(f"Total time: {elapsed:.1f} seconds")
  
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
