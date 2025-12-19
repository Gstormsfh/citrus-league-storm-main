#!/usr/bin/env python3
"""
validate_pipeline_integrity.py

Diagnostic script to identify pipeline integrity issues:
- Games with 0 shifts (CRITICAL: data integrity failure)
- Games marked as extracted but missing player_game_stats
- Games stuck in processing loop
- Games with stats_extracted=false that should be final
"""

import os
import sys
from typing import Dict, List, Set
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _fetch_all_paginated(table: str, select: str, filters: List = None, batch_size: int = 1000) -> List[dict]:
  """Fetch all rows from a table with pagination."""
  all_rows = []
  offset = 0
  while True:
    page = db.select(table, select=select, filters=filters, limit=batch_size, offset=offset)
    if not page:
      break
    all_rows.extend(page)
    if len(page) < batch_size:
      break
    offset += batch_size
    if offset % 5000 == 0:
      print(f"  ... fetched {len(all_rows)} rows so far...")
  return all_rows


def check_games_without_shifts() -> Set[int]:
  """
  CRITICAL: Find games with 0 shifts.
  This is a data integrity failure - all hockey games MUST have shifts.
  """
  print("=" * 70)
  print("CHECKING FOR GAMES WITH 0 SHIFTS (CRITICAL DATA INTEGRITY FAILURE)")
  print("=" * 70)
  
  print("\n1. Fetching all games from raw_nhl_data...")
  all_games = _fetch_all_paginated("raw_nhl_data", "game_id")
  all_game_ids = set(g.get("game_id") for g in all_games if g.get("game_id"))
  print(f"   Found {len(all_game_ids)} total games")
  
  print("\n2. Fetching all games with shifts from player_shifts_official...")
  all_shifts = _fetch_all_paginated("player_shifts_official", "game_id")
  games_with_shifts = set(s.get("game_id") for s in all_shifts if s.get("game_id"))
  print(f"   Found {len(games_with_shifts)} games with shifts")
  
  games_without_shifts = all_game_ids - games_with_shifts
  print(f"\n3. CRITICAL: Found {len(games_without_shifts)} games with 0 shifts")
  
  if games_without_shifts:
    games_sorted = sorted(list(games_without_shifts))
    print(f"\n   Games with 0 shifts (first 50):")
    for i, gid in enumerate(games_sorted[:50], 1):
      print(f"   {i}. Game {gid}")
    if len(games_sorted) > 50:
      print(f"   ... and {len(games_sorted) - 50} more")
    print(f"\n   ACTION REQUIRED: These games need shifts ingested before extraction can proceed.")
    print(f"   Run: python ingest_shiftcharts.py --game-id <game_id> for each game")
  else:
    print("\n   [OK] All games have shifts - constraint satisfied!")
  
  return games_without_shifts


def check_extracted_games_missing_stats() -> Set[int]:
  """Find games marked as extracted but missing from player_game_stats."""
  print("\n" + "=" * 70)
  print("CHECKING EXTRACTED GAMES MISSING FROM player_game_stats")
  print("=" * 70)
  
  print("\n1. Fetching games marked as stats_extracted=true...")
  extracted_games = _fetch_all_paginated("raw_nhl_data", "game_id", 
                                        filters=[("stats_extracted", "eq", True)])
  extracted_ids = set(g.get("game_id") for g in extracted_games if g.get("game_id"))
  print(f"   Found {len(extracted_ids)} extracted games")
  
  print("\n2. Fetching games in player_game_stats...")
  stats_games = _fetch_all_paginated("player_game_stats", "game_id")
  stats_game_ids = set(g.get("game_id") for g in stats_games if g.get("game_id"))
  print(f"   Found {len(stats_game_ids)} games in player_game_stats")
  
  missing = extracted_ids - stats_game_ids
  print(f"\n3. Found {len(missing)} games marked extracted but missing from player_game_stats")
  
  if missing:
    games_sorted = sorted(list(missing))
    print(f"\n   Games needing re-extraction (first 50):")
    for i, gid in enumerate(games_sorted[:50], 1):
      print(f"   {i}. Game {gid}")
    if len(games_sorted) > 50:
      print(f"   ... and {len(games_sorted) - 50} more")
    print(f"\n   ACTION REQUIRED: Reset these games to stats_extracted=false")
    print(f"   Run: python reset_missing_extracted_games.py")
  else:
    print("\n   [OK] All extracted games have stats - no issues!")
  
  return missing


def check_stuck_games() -> List[dict]:
  """Find games that are likely stuck (final state but not extracted)."""
  print("\n" + "=" * 70)
  print("CHECKING FOR STUCK GAMES (Final state but not extracted)")
  print("=" * 70)
  
  print("\n1. Fetching unextracted games with raw_json...")
  unextracted = _fetch_all_paginated("raw_nhl_data", "game_id,raw_json,stats_extracted",
                                    filters=[("stats_extracted", "eq", False)])
  print(f"   Found {len(unextracted)} unextracted games")
  
  stuck_games = []
  final_states = {"OFF", "FINAL", "F/SO", "OVER"}
  
  print("\n2. Checking game states...")
  for game in unextracted:
    game_id = game.get("game_id")
    raw_json = game.get("raw_json") or {}
    state = raw_json.get("gameState")
    
    if state in final_states:
      stuck_games.append({
        "game_id": game_id,
        "state": state,
      })
  
  print(f"\n3. Found {len(stuck_games)} games in final state but not extracted")
  
  if stuck_games:
    print(f"\n   Stuck games (first 50):")
    for i, game in enumerate(stuck_games[:50], 1):
      print(f"   {i}. Game {game['game_id']} - State: {game['state']}")
    if len(stuck_games) > 50:
      print(f"   ... and {len(stuck_games) - 50} more")
    print(f"\n   These games should be extractable. Check if they have shifts.")
  else:
    print("\n   [OK] No stuck games found!")
  
  return stuck_games


def main() -> int:
  print("=" * 70)
  print("PIPELINE INTEGRITY VALIDATION")
  print("=" * 70)
  print()
  
  # Check 1: Games with 0 shifts (CRITICAL)
  games_without_shifts = check_games_without_shifts()
  
  # Check 2: Extracted games missing stats
  extracted_missing_stats = check_extracted_games_missing_stats()
  
  # Check 3: Stuck games
  stuck_games = check_stuck_games()
  
  # Summary
  print("\n" + "=" * 70)
  print("SUMMARY")
  print("=" * 70)
  print(f"Games with 0 shifts (CRITICAL): {len(games_without_shifts)}")
  print(f"Extracted games missing stats: {len(extracted_missing_stats)}")
  print(f"Stuck games (final but not extracted): {len(stuck_games)}")
  print()
  
  if games_without_shifts:
    print("[CRITICAL] Games with 0 shifts must be fixed before pipeline can proceed.")
    print("   These games violate the constraint: ALL GAMES MUST HAVE SHIFTS")
  
  if extracted_missing_stats:
    print("[WARNING] Games marked as extracted but missing stats need re-extraction.")
  
  if stuck_games:
    print("[WARNING] Stuck games in final state should be extractable - investigate why they're not extracted.")
  
  if not games_without_shifts and not extracted_missing_stats and not stuck_games:
    print("[OK] Pipeline integrity check passed! No issues found.")
  
  print("=" * 70)
  
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
