#!/usr/bin/env python3
"""
Live pipeline progress tracker - refreshes every 15 seconds.
Shows real-time progress and highlights any errors.
"""

import os
import time
from datetime import datetime
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
MCDAVID_ID = 8478402
REFRESH_SECONDS = 15

def clear_screen():
  """Clear terminal screen (cross-platform)."""
  os.system('cls' if os.name == 'nt' else 'clear')

def get_count_with_pagination(table, select_col="*", filters=None, page_size=1000):
  """Get full count with pagination."""
  all_rows = []
  offset = 0
  while True:
    try:
      page = db.select(table, select=select_col, filters=filters or [], limit=page_size, offset=offset)
      if not page:
        break
      all_rows.extend(page)
      if len(page) < page_size:
        break
      offset += page_size
    except Exception as e:
      return None, str(e)
  return all_rows, None

def get_mcdavid_stats():
  """Get McDavid's current season stats."""
  try:
    stats = db.select("player_season_stats", filters=[("player_id", "eq", MCDAVID_ID)], limit=1)
    if stats:
      s = stats[0]
      return {
        "gp": s.get('games_played', 0),
        "g": s.get('goals', 0),
        "a": s.get('primary_assists', 0) + s.get('secondary_assists', 0),
        "pts": s.get('points', 0),
        "sog": s.get('shots_on_goal', 0),
        "pim": s.get('pim', 0),
        "ppp": s.get('ppp', 0),
        "shp": s.get('shp', 0),
        "plus_minus": s.get('plus_minus', 0),
        "toi_sec": s.get('icetime_seconds', 0),
      }
  except Exception as e:
    return {"error": str(e)}
  return None

def format_toi(seconds):
  """Format seconds to MM:SS."""
  if not seconds:
    return "0:00"
  mins = seconds // 60
  secs = seconds % 60
  return f"{mins}:{secs:02d}"

def main():
  print("=" * 70)
  print("LIVE PIPELINE TRACKER - Refreshing every 15 seconds")
  print("Press Ctrl+C to stop")
  print("=" * 70)
  time.sleep(2)

  last_counts = {}
  iteration = 0

  try:
    while True:
      iteration += 1
      now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
      clear_screen()
      
      print("=" * 70)
      print(f"LIVE PIPELINE TRACKER - Iteration #{iteration} - {now}")
      print("=" * 70)
      print()

      errors = []

      # Player Directory
      try:
        players, err = get_count_with_pagination("player_directory", select_col="player_id")
        if err:
          errors.append(f"player_directory: {err}")
          player_count = "ERROR"
        else:
          player_count = len(players)
          last_counts['player_directory'] = player_count
      except Exception as e:
        errors.append(f"player_directory: {e}")
        player_count = last_counts.get('player_directory', '?')

      # Raw NHL Data
      try:
        raw_total, err1 = get_count_with_pagination("raw_nhl_data", select_col="game_id")
        raw_extracted, err2 = get_count_with_pagination("raw_nhl_data", select_col="game_id", filters=[("stats_extracted", "eq", True)])
        if err1 or err2:
          errors.append(f"raw_nhl_data: {err1 or err2}")
          raw_info = "ERROR"
        else:
          raw_info = f"{len(raw_total)} total, {len(raw_extracted)} extracted"
          last_counts['raw_nhl_data'] = len(raw_total)
      except Exception as e:
        errors.append(f"raw_nhl_data: {e}")
        raw_info = last_counts.get('raw_nhl_data', '?')

      # Player Game Stats
      try:
        game_stats, err = get_count_with_pagination("player_game_stats", select_col="game_id")
        if err:
          errors.append(f"player_game_stats: {err}")
          game_stats_info = "ERROR"
        else:
          unique_games = len(set(g.get("game_id") for g in game_stats))
          game_stats_info = f"{len(game_stats)} rows ({unique_games} games)"
          last_counts['player_game_stats'] = len(game_stats)
      except Exception as e:
        errors.append(f"player_game_stats: {e}")
        game_stats_info = last_counts.get('player_game_stats', '?')

      # Player Season Stats
      try:
        season_stats, err = get_count_with_pagination("player_season_stats", select_col="player_id")
        if err:
          errors.append(f"player_season_stats: {err}")
          season_count = "ERROR"
        else:
          season_count = len(season_stats)
          last_counts['player_season_stats'] = season_count
      except Exception as e:
        errors.append(f"player_season_stats: {e}")
        season_count = last_counts.get('player_season_stats', '?')

      # Player Shifts Official
      try:
        shifts, err = get_count_with_pagination("player_shifts_official", select_col="shift_id,game_id")
        if err:
          errors.append(f"player_shifts_official: {err}")
          shifts_info = "ERROR"
        else:
          unique_games_shifts = len(set(s.get("game_id") for s in shifts)) if shifts else 0
          shifts_info = f"{len(shifts)} shifts ({unique_games_shifts} games)"
          last_counts['player_shifts_official'] = len(shifts)
      except Exception as e:
        errors.append(f"player_shifts_official: {e}")
        shifts_info = last_counts.get('player_shifts_official', '?')

      # Display results
      print("TABLE COUNTS:")
      print(f"  player_directory:        {player_count}")
      print(f"  raw_nhl_data:            {raw_info}")
      print(f"  player_game_stats:       {game_stats_info}")
      print(f"  player_season_stats:    {season_count}")
      print(f"  player_shifts_official: {shifts_info}")
      print()

      # McDavid sanity check
      print("SANITY CHECK - Connor McDavid (8478402):")
      mcdavid = get_mcdavid_stats()
      if isinstance(mcdavid, dict) and "error" in mcdavid:
        print(f"  [ERROR] {mcdavid['error']}")
        errors.append(f"McDavid stats: {mcdavid['error']}")
      elif mcdavid:
        toi_str = format_toi(mcdavid.get('toi_sec', 0))
        print(f"  GP: {mcdavid.get('gp', 0):3d} | G: {mcdavid.get('g', 0):2d} | A: {mcdavid.get('a', 0):2d} | PTS: {mcdavid.get('pts', 0):3d}")
        print(f"  SOG: {mcdavid.get('sog', 0):3d} | PIM: {mcdavid.get('pim', 0):2d} | PPP: {mcdavid.get('ppp', 0):2d} | SHP: {mcdavid.get('shp', 0):2d}")
        print(f"  +/-: {mcdavid.get('plus_minus', 0):+3d} | TOI: {toi_str}")
      else:
        print("  [WARN] McDavid not found in player_season_stats")
      print()

      # Show errors if any
      if errors:
        print("=" * 70)
        print("ERRORS DETECTED:")
        for err in errors:
          print(f"  [ERROR] {err}")
        print("=" * 70)
      else:
        print("[OK] No errors detected")

      # Show deltas
      if iteration > 1:
        print()
        print("CHANGES (vs last check):")
        # Could add delta tracking here if needed

      print()
      print("=" * 70)
      print(f"Next refresh in {REFRESH_SECONDS} seconds... (Ctrl+C to stop)")
      print("=" * 70)

      time.sleep(REFRESH_SECONDS)

  except KeyboardInterrupt:
    print("\n\nTracker stopped by user.")
    return 0
  except Exception as e:
    print(f"\n\n[FATAL ERROR] Tracker crashed: {e}")
    return 1

if __name__ == "__main__":
  raise SystemExit(main())

