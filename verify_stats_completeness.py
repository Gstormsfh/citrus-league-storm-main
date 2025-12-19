#!/usr/bin/env python3
"""
verify_stats_completeness.py

Data quality verification script to check if all required stats are populated.
Reports:
- Games with missing shifts
- Players with 0 stats but games played
- Missing PPP/SHP/TOI/+/-
- Data quality summary
"""

import os
import sys
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


def _safe_int(v, default=0) -> int:
  try:
    return int(v) if v is not None else default
  except Exception:
    return default


def check_games_without_shifts(db: SupabaseRest) -> dict:
  """Check how many games are missing shifts."""
  print("[verify] Checking games without shifts...")
  
  # Get all games
  all_games = set()
  offset = 0
  batch_size = 1000
  
  while True:
    games = db.select("raw_nhl_data", select="game_id", limit=batch_size, offset=offset)
    if not games:
      break
    all_games.update([_safe_int(g.get("game_id"), 0) for g in games if g.get("game_id")])
    if len(games) < batch_size:
      break
    offset += batch_size
  
  all_games.discard(0)
  
  # Get games with shifts
  games_with_shifts = set()
  offset = 0
  
  while True:
    shifts = db.select("player_shifts", select="game_id", limit=batch_size, offset=offset)
    if shifts:
      games_with_shifts.update([_safe_int(s.get("game_id"), 0) for s in shifts if s.get("game_id")])
    if not shifts or len(shifts) < batch_size:
      break
    offset += batch_size
  
  offset = 0
  while True:
    shifts = db.select("player_shifts_official", select="game_id", limit=batch_size, offset=offset)
    if shifts:
      games_with_shifts.update([_safe_int(s.get("game_id"), 0) for s in shifts if s.get("game_id")])
    if not shifts or len(shifts) < batch_size:
      break
    offset += batch_size
  
  games_without = all_games - games_with_shifts
  
  return {
    "total_games": len(all_games),
    "games_with_shifts": len(games_with_shifts),
    "games_without_shifts": len(games_without),
    "missing_game_ids": sorted(list(games_without))[:20]  # Sample
  }


def check_player_stats_completeness(db: SupabaseRest, season: int) -> dict:
  """Check player_season_stats for missing critical stats."""
  print("[verify] Checking player_season_stats completeness...")
  
  # Get all player stats
  all_stats = []
  offset = 0
  batch_size = 1000
  
  while True:
    stats = db.select(
      "player_season_stats",
      select="player_id,games_played,icetime_seconds,ppp,shp,plus_minus,hits,blocks",
      filters=[("season", "eq", season)],
      limit=batch_size,
      offset=offset
    )
    if not stats:
      break
    all_stats.extend(stats)
    if len(stats) < batch_size:
      break
    offset += batch_size
  
  # Analyze
  total_players = len(all_stats)
  players_with_games = [s for s in all_stats if _safe_int(s.get("games_played"), 0) > 0]
  
  # Check for "null/zero gap"
  zero_toi_with_games = [s for s in players_with_games if _safe_int(s.get("icetime_seconds"), 0) == 0]
  zero_ppp_with_games = [s for s in players_with_games if _safe_int(s.get("ppp"), 0) == 0]
  zero_shp_with_games = [s for s in players_with_games if _safe_int(s.get("shp"), 0) == 0]
  zero_plusminus_with_games = [s for s in players_with_games if _safe_int(s.get("plus_minus"), 0) == 0]
  zero_hits_with_games = [s for s in players_with_games if _safe_int(s.get("hits"), 0) == 0]
  zero_blocks_with_games = [s for s in players_with_games if _safe_int(s.get("blocks"), 0) == 0]
  
  return {
    "total_players": total_players,
    "players_with_games": len(players_with_games),
    "zero_toi_with_games": len(zero_toi_with_games),
    "zero_ppp_with_games": len(zero_ppp_with_games),
    "zero_shp_with_games": len(zero_shp_with_games),
    "zero_plusminus_with_games": len(zero_plusminus_with_games),
    "zero_hits_with_games": len(zero_hits_with_games),
    "zero_blocks_with_games": len(zero_blocks_with_games),
  }


def check_extraction_status(db: SupabaseRest) -> dict:
  """Check how many games have been extracted."""
  print("[verify] Checking extraction status...")
  
  # Count extracted vs unextracted
  extracted = db.select("raw_nhl_data", select="game_id", filters=[("stats_extracted", "eq", True)], limit=10000)
  unextracted = db.select("raw_nhl_data", select="game_id", filters=[("stats_extracted", "eq", False)], limit=10000)
  
  extracted_count = len(extracted) if extracted else 0
  unextracted_count = len(unextracted) if unextracted else 0
  
  return {
    "extracted_games": extracted_count,
    "unextracted_games": unextracted_count,
    "extraction_rate": extracted_count / (extracted_count + unextracted_count) * 100 if (extracted_count + unextracted_count) > 0 else 0
  }


def main() -> int:
  print("=" * 80)
  print("[verify_stats_completeness] DATA QUALITY REPORT")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print()
  
  try:
    db = supabase_client()
  except Exception as e:
    print(f"[verify] ERROR: Failed to connect: {e}")
    return 1
  
  # Run all checks
  shifts_check = check_games_without_shifts(db)
  stats_check = check_player_stats_completeness(db, DEFAULT_SEASON)
  extraction_check = check_extraction_status(db)
  
  # Print report
  print()
  print("=" * 80)
  print("VERIFICATION RESULTS")
  print("=" * 80)
  print()
  
  print("1. GAMES WITHOUT SHIFTS:")
  print(f"   Total games: {shifts_check['total_games']:,}")
  print(f"   Games with shifts: {shifts_check['games_with_shifts']:,}")
  print(f"   Games without shifts: {shifts_check['games_without_shifts']:,}")
  if shifts_check['missing_game_ids']:
    print(f"   Sample missing game IDs: {shifts_check['missing_game_ids'][:10]}")
  print()
  
  print("2. EXTRACTION STATUS:")
  print(f"   Extracted games: {extraction_check['extracted_games']:,}")
  print(f"   Unextracted games: {extraction_check['unextracted_games']:,}")
  print(f"   Extraction rate: {extraction_check['extraction_rate']:.1f}%")
  print()
  
  print("3. PLAYER STATS COMPLETENESS:")
  print(f"   Total players: {stats_check['total_players']:,}")
  print(f"   Players with games played: {stats_check['players_with_games']:,}")
  print()
  print("   Missing stats (players with games but 0 stat):")
  print(f"     TOI = 0: {stats_check['zero_toi_with_games']:,}")
  print(f"     PPP = 0: {stats_check['zero_ppp_with_games']:,}")
  print(f"     SHP = 0: {stats_check['zero_shp_with_games']:,}")
  print(f"     +/- = 0: {stats_check['zero_plusminus_with_games']:,}")
  print(f"     Hits = 0: {stats_check['zero_hits_with_games']:,}")
  print(f"     Blocks = 0: {stats_check['zero_blocks_with_games']:,}")
  print()
  
  # Alerts
  print("=" * 80)
  print("ALERTS")
  print("=" * 80)
  
  alerts = []
  
  if shifts_check['games_without_shifts'] > 0:
    alerts.append(f"⚠️  {shifts_check['games_without_shifts']:,} games missing shifts (TOI will be 0)")
  
  if stats_check['zero_toi_with_games'] > stats_check['players_with_games'] * 0.1:
    alerts.append(f"⚠️  High number of players with 0 TOI ({stats_check['zero_toi_with_games']:,}) - shifts may be missing")
  
  if extraction_check['extraction_rate'] < 90:
    alerts.append(f"⚠️  Low extraction rate ({extraction_check['extraction_rate']:.1f}%) - many games not extracted")
  
  if not alerts:
    print("✅ No critical issues detected")
  else:
    for alert in alerts:
      print(alert)
  
  print()
  print("=" * 80)
  
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
