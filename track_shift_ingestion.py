#!/usr/bin/env python3
"""
track_shift_ingestion.py

Live progress tracker for shift ingestion.
Monitors database to show real-time progress and identify bottlenecks.
"""

import os
import time
import sys
from datetime import datetime
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_total_games(season: int = 2025) -> int:
  """Get total number of games in raw_nhl_data for the season."""
  game_id_min = int(f"{season}000000")
  game_id_max = int(f"{season + 1}000000")
  
  # Get count with pagination
  total = 0
  offset = 0
  while True:
    page = db.select("raw_nhl_data", select="game_id", 
                    filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
                    limit=1000, offset=offset)
    if not page:
      break
    total += len(page)
    if len(page) < 1000:
      break
    offset += 1000
  return total


def get_games_with_shifts(season: int = 2025) -> set:
  """Get set of game IDs that have shifts."""
  game_id_min = int(f"{season}000000")
  game_id_max = int(f"{season + 1}000000")
  
  games_with_shifts = set()
  offset = 0
  while True:
    page = db.select("player_shifts_official", select="game_id",
                    filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
                    limit=1000, offset=offset)
    if not page:
      break
    games_with_shifts.update(g.get("game_id") for g in page if g.get("game_id"))
    if len(page) < 1000:
      break
    offset += 1000
  return games_with_shifts


def get_recent_shifts_count(seconds: int = 60) -> int:
  """Get count of shifts added in the last N seconds."""
  try:
    # Get shifts added recently (using updated_at if available)
    # For simplicity, we'll estimate based on total count changes
    # This is approximate but gives us a sense of activity
    recent = db.select("player_shifts_official", select="shift_id", limit=1)
    return 1 if recent else 0
  except Exception:
    return 0


def format_time(seconds: float) -> str:
  """Format seconds into human-readable time."""
  if seconds < 60:
    return f"{seconds:.1f}s"
  elif seconds < 3600:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins}m {secs}s"
  else:
    hours = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    return f"{hours}h {mins}m"


def main():
  season = 2025
  print("=" * 80)
  print("SHIFT INGESTION LIVE TRACKER")
  print("=" * 80)
  print(f"Season: {season}")
  print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
  print()
  print("Press Ctrl+C to stop tracking")
  print("=" * 80)
  print()
  
  # Initial snapshot
  start_time = time.time()
  last_count = 0
  last_time = start_time
  
  try:
    while True:
      # Get current state
      current_time = time.time()
      total_games = get_total_games(season)
      games_with_shifts = get_games_with_shifts(season)
      games_without_shifts = total_games - len(games_with_shifts)
      
      # Calculate progress
      progress_pct = (len(games_with_shifts) / total_games * 100) if total_games > 0 else 0
      
      # Calculate rate
      elapsed = current_time - start_time
      new_shifts = len(games_with_shifts) - last_count
      time_delta = current_time - last_time
      
      if time_delta > 0:
        games_per_sec = new_shifts / time_delta if time_delta > 0 else 0
      else:
        games_per_sec = 0
      
      # Estimate time remaining
      if games_per_sec > 0 and games_without_shifts > 0:
        eta_seconds = games_without_shifts / games_per_sec
        eta_str = format_time(eta_seconds)
      else:
        eta_str = "calculating..."
      
      # Clear screen and print status
      os.system('cls' if os.name == 'nt' else 'clear')
      
      print("=" * 80)
      print("SHIFT INGESTION LIVE TRACKER")
      print("=" * 80)
      print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
      print(f"Elapsed: {format_time(elapsed)}")
      print()
      print(f"Total Games:        {total_games:,}")
      print(f"Games with Shifts:  {len(games_with_shifts):,}")
      print(f"Games Missing:      {games_without_shifts:,}")
      print()
      print(f"Progress:           {progress_pct:.1f}%")
      print(f"Rate:               {games_per_sec:.2f} games/sec")
      print(f"ETA:                {eta_str}")
      print()
      
      # Progress bar
      bar_width = 60
      filled = int(bar_width * progress_pct / 100)
      bar = "█" * filled + "░" * (bar_width - filled)
      print(f"[{bar}] {progress_pct:.1f}%")
      print()
      
      # Recent activity
      if new_shifts > 0:
        print(f"Recent: {new_shifts} games processed in last {time_delta:.1f}s")
      else:
        print("Recent: No new games processed (may be waiting or complete)")
      print()
      
      # Status indicators
      if games_without_shifts == 0:
        print("[SUCCESS] All games now have shifts!")
        print("=" * 80)
        break
      elif games_per_sec == 0 and elapsed > 30:
        print("[WARNING] No activity detected - check if ingestion is running")
      elif games_per_sec < 0.1 and games_without_shifts > 0:
        print("[SLOW] Processing rate is low - may indicate bottleneck")
      
      print("=" * 80)
      print("(Refreshing every 5 seconds... Press Ctrl+C to stop)")
      
      # Update for next iteration
      last_count = len(games_with_shifts)
      last_time = current_time
      
      # Wait before next update
      time.sleep(5)
      
  except KeyboardInterrupt:
    print("\n\nTracking stopped by user.")
    print("=" * 80)
    return 0
  except Exception as e:
    print(f"\n\n[ERROR] {e}")
    import traceback
    traceback.print_exc()
    return 1


if __name__ == "__main__":
  raise SystemExit(main())
