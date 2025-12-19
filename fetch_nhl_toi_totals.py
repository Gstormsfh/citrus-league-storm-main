#!/usr/bin/env python3
"""
fetch_nhl_toi_totals.py

Fetch TOI season totals from NHL.com API and store in player_season_stats.
This replaces our calculated TOI with official NHL.com totals for player cards.

TOI is just for display - not used in our models, so using official source is perfect.
"""

import os
import sys
import time
import requests
from typing import Optional, Dict
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_API_BASE = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
  return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _safe_int(v, default=0) -> int:
  try:
    return int(v) if v is not None else default
  except Exception:
    return default


def fetch_player_season_stats(player_id: int, season: int) -> Optional[Dict]:
  """
  Fetch player season stats from NHL Stats API (statsapi.web.nhl.com).
  This API has TOI data that the landing endpoint doesn't have.
  Returns dict with TOI and other stats, or None if not found.
  """
  try:
    # Format season as YYYY0YYYY (e.g., 20242025)
    season_str = f"{season}{season+1}"
    url = f"https://statsapi.web.nhl.com/api/v1/people/{player_id}/stats?stats=statsSingleSeason&season={season_str}"
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    data = response.json()
    
    # Extract stats from response
    stats_list = data.get("stats", [])
    if not stats_list:
      return None
    
    splits = stats_list[0].get("splits", [])
    if not splits:
      return None
    
    # Get the regular season stats (first split is usually regular season)
    stat_data = splits[0].get("stat", {})
    return stat_data
    
  except Exception as e:
    print(f"  Error fetching stats for player {player_id}: {e}")
    return None


def parse_toi_from_nhl_stats(stats: Dict) -> int:
  """
  Parse TOI from NHL Stats API.
  NHL Stats API returns TOI in format "HH:MM:SS" or total seconds as string.
  """
  # NHL Stats API field names for TOI
  toi_str = stats.get("timeOnIce") or stats.get("evenTimeOnIce") or stats.get("powerPlayTimeOnIce") or stats.get("shortHandedTimeOnIce")
  
  if not toi_str:
    # If no direct TOI, try to sum situation-specific TOI
    even_toi = stats.get("evenTimeOnIce", "0:00")
    pp_toi = stats.get("powerPlayTimeOnIce", "0:00")
    sh_toi = stats.get("shortHandedTimeOnIce", "0:00")
    
    total_seconds = 0
    for toi in [even_toi, pp_toi, sh_toi]:
      if toi:
        total_seconds += parse_time_string(toi)
    return total_seconds if total_seconds > 0 else 0
  
  return parse_time_string(toi_str)


def parse_time_string(time_str: str) -> int:
  """
  Parse time string from NHL API (format: "HH:MM:SS" or "MM:SS").
  Returns total seconds.
  """
  if not time_str or not isinstance(time_str, str):
    return 0
  
  try:
    parts = time_str.split(":")
    if len(parts) == 3:  # HH:MM:SS
      hours = _safe_int(parts[0], 0)
      minutes = _safe_int(parts[1], 0)
      seconds = _safe_int(parts[2], 0)
      return hours * 3600 + minutes * 60 + seconds
    elif len(parts) == 2:  # MM:SS
      minutes = _safe_int(parts[0], 0)
      seconds = _safe_int(parts[1], 0)
      return minutes * 60 + seconds
    else:
      # Try to parse as integer (total seconds)
      return _safe_int(time_str, 0)
  except Exception:
    return 0


def main() -> int:
  print("=" * 80)
  print("[fetch_nhl_toi_totals] STARTING")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print("Fetching TOI totals from NHL.com API...")
  print()
  
  try:
    db = supabase_client()
    print("[fetch_nhl_toi] Connected to Supabase")
  except Exception as e:
    print(f"[fetch_nhl_toi] ERROR: Failed to connect: {e}")
    return 1
  
  # Get all players from player_directory
  print("[fetch_nhl_toi] Fetching players from player_directory...")
  players = []
  offset = 0
  batch_size = 1000
  
  while True:
    batch = db.select("player_directory", select="player_id,full_name", limit=batch_size, offset=offset)
    if not batch:
      break
    players.extend(batch)
    if len(batch) < batch_size:
      break
    offset += batch_size
  
  print(f"[fetch_nhl_toi] Found {len(players):,} players")
  print()
  
  # Fetch TOI for each player
  updated_count = 0
  not_found_count = 0
  error_count = 0
  last_progress_time = time.time()
  
  for idx, player in enumerate(players, 1):
    player_id = _safe_int(player.get("player_id"), 0)
    if not player_id:
      continue
    
    # Fetch from NHL API
    stats = fetch_player_season_stats(player_id, DEFAULT_SEASON)
    
    if stats:
      toi_seconds = parse_toi_from_nhl_stats(stats)
      
      if toi_seconds > 0:
        # Update player_season_stats with NHL.com TOI (for display)
        # Note: icetime_seconds is kept for our calculated TOI (used in GAR)
        try:
          db.upsert("player_season_stats", [{
            "season": DEFAULT_SEASON,
            "player_id": player_id,
            "nhl_toi_seconds": toi_seconds
          }], on_conflict="season,player_id")
          updated_count += 1
        except Exception as e:
          print(f"  [ERROR] Failed to update player {player_id}: {e}")
          error_count += 1
      else:
        not_found_count += 1
    else:
      not_found_count += 1
    
    # Progress every 15 seconds
    current_time = time.time()
    if current_time - last_progress_time >= 15:
      print(f"  [PROGRESS] Processed {idx}/{len(players)} players ({updated_count} updated, {not_found_count} not found, {error_count} errors)...")
      last_progress_time = current_time
    
    # Rate limiting
    if idx < len(players):
      time.sleep(0.1)  # 100ms delay between requests
  
  print()
  print("=" * 80)
  print("[fetch_nhl_toi_totals] COMPLETE")
  print("=" * 80)
  print(f"Players processed: {len(players):,}")
  print(f"TOI updated: {updated_count:,}")
  print(f"Not found: {not_found_count:,}")
  print(f"Errors: {error_count:,}")
  
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
