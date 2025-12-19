#!/usr/bin/env python3
"""
Quick progress check for pipeline tables.
"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("=" * 60)
print("PIPELINE PROGRESS CHECK")
print("=" * 60)

# Player Directory
try:
  players = db.select("player_directory", select="player_id", limit=10000)
  print(f"[OK] player_directory: {len(players)} players")
except Exception as e:
  print(f"[ERROR] player_directory: {e}")

# Raw NHL Data
try:
  raw_total = db.select("raw_nhl_data", select="game_id", limit=10000)
  raw_extracted = db.select("raw_nhl_data", select="game_id", filters=[("stats_extracted", "eq", True)], limit=10000)
  print(f"[OK] raw_nhl_data: {len(raw_total)} total games, {len(raw_extracted)} extracted")
except Exception as e:
  print(f"[ERROR] raw_nhl_data: {e}")

# Player Game Stats (with pagination)
try:
  all_game_stats = []
  offset = 0
  page_size = 1000
  while True:
    page = db.select("player_game_stats", select="game_id", limit=page_size, offset=offset)
    if not page:
      break
    all_game_stats.extend(page)
    if len(page) < page_size:
      break
    offset += page_size
    if offset % 5000 == 0:
      print(f"  ... fetched {len(all_game_stats)} rows so far...")
  unique_games = len(set(g.get("game_id") for g in all_game_stats))
  print(f"[OK] player_game_stats: {len(all_game_stats)} player-game rows ({unique_games} unique games)")
except Exception as e:
  print(f"[ERROR] player_game_stats: {e}")

# Player Season Stats
try:
  season_stats = db.select("player_season_stats", select="player_id", limit=10000)
  print(f"[OK] player_season_stats: {len(season_stats)} players")
  if season_stats:
    sample = season_stats[0]
    print(f"  Sample player_id: {sample.get('player_id')}")
except Exception as e:
  print(f"[ERROR] player_season_stats: {e}")

# Player Shifts Official (with pagination)
try:
  all_shifts = []
  offset = 0
  page_size = 1000
  while True:
    page = db.select("player_shifts_official", select="shift_id,game_id", limit=page_size, offset=offset)
    if not page:
      break
    all_shifts.extend(page)
    if len(page) < page_size:
      break
    offset += page_size
  unique_games_shifts = len(set(s.get("game_id") for s in all_shifts)) if all_shifts else 0
  print(f"[OK] player_shifts_official: {len(all_shifts)} shifts ({unique_games_shifts} unique games)")
except Exception as e:
  print(f"[ERROR] player_shifts_official: {e}")

# Sample stats for a known player (McDavid = 8478402)
try:
  mcdavid = db.select("player_season_stats", filters=[("player_id", "eq", 8478402)], limit=1)
  if mcdavid:
    m = mcdavid[0]
    print(f"\nSample: Connor McDavid (8478402)")
    print(f"   GP: {m.get('games_played', 0)}, G: {m.get('goals', 0)}, A: {m.get('primary_assists', 0) + m.get('secondary_assists', 0)}, PTS: {m.get('points', 0)}")
    print(f"   SOG: {m.get('shots_on_goal', 0)}, PIM: {m.get('pim', 0)}, PPP: {m.get('ppp', 0)}, SHP: {m.get('shp', 0)}")
    print(f"   +/-: {m.get('plus_minus', 0)}, TOI: {m.get('icetime_seconds', 0)}s")
  else:
    print(f"\n[WARN] McDavid not found in player_season_stats yet")
except Exception as e:
  print(f"\n[ERROR] McDavid check: {e}")

print("=" * 60)

