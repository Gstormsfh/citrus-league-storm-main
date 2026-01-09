#!/usr/bin/env python3
"""
ingest_live_raw_nhl.py

Producer: discover games via NHL schedule, ingest play-by-play for LIVE/CRIT games into public.raw_nhl_data.

Key behavior:
- Poll schedule/now and ingest games with gameState in {"LIVE","CRIT"}.
- When a game transitions to "OFF", perform one final pull (gold standard) and mark it as ingested.
- Cooldown cache: avoid re-fetching a game if lastUpdated hasn't changed.

This script only writes raw JSON. It does NOT compute stats; that is extractor_job.py.
"""

import os
import sys
import time
import json
import datetime as dt
from typing import Dict, Optional, Tuple

import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from src.utils.citrus_request import citrus_request

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_BASE_URL = "https://api-web.nhle.com/v1"

POLL_SECONDS = int(os.getenv("CITRUS_INGEST_POLL_SECONDS", "60"))
COOLDOWN_SECONDS = int(os.getenv("CITRUS_INGEST_COOLDOWN_SECONDS", "45"))
ADAPTIVE_MODE = os.getenv("CITRUS_INGEST_ADAPTIVE", "false").lower() == "true"
LIVE_INTERVAL = int(os.getenv("CITRUS_INGEST_LIVE_INTERVAL", "30"))  # 30 seconds during games
OFF_INTERVAL = int(os.getenv("CITRUS_INGEST_OFF_INTERVAL", "300"))  # 5 minutes off-hours


def supabase_client() -> SupabaseRest:
  return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def fetch_json(url: str, timeout: int = 15) -> dict:
  r = citrus_request(url, timeout=timeout)
  r.raise_for_status()
  return r.json()


def get_schedule_now() -> dict:
  return fetch_json(f"{NHL_BASE_URL}/schedule/now")


def get_pbp(game_id: int) -> dict:
  return fetch_json(f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play")


def detect_active_games() -> bool:
  """
  Check if there are any active games (LIVE, CRIT, INTERMISSION, or recently finished OFF).
  
  Returns:
      True if games are active, False otherwise
  """
  try:
    sched = get_schedule_now()
    games = (sched.get("games") or [])
    
    for game in games:
      game_state = game.get("gameState", "").upper()
      # Include LIVE, CRIT, and INTERMISSION as active states
      if game_state in ("LIVE", "CRIT", "INTERMISSION"):
        return True
      elif game_state == "OFF":
        # Check if game finished in last 2 hours (still processing)
        game_date_str = game.get("startTimeUTC", "")
        if game_date_str:
          try:
            game_date = dt.datetime.fromisoformat(game_date_str.replace('Z', '+00:00'))
            now = dt.datetime.now(dt.timezone.utc)
            if (now - game_date).total_seconds() < 7200:  # 2 hours
              return True
          except:
            pass
    
    return False
  except Exception as e:
    print(f"[ingest_live_raw_nhl] Warning: Error detecting active games: {e}")
    return False


def get_polling_interval() -> int:
  """
  Get the appropriate polling interval based on game state (if adaptive mode enabled).
  
  Returns:
      Polling interval in seconds
  """
  if ADAPTIVE_MODE:
    if detect_active_games():
      return LIVE_INTERVAL
    else:
      return OFF_INTERVAL
  else:
    return POLL_SECONDS


def extract_game_state_and_last_updated(pbp_json: dict) -> Tuple[Optional[str], Optional[str], Optional[str]]:
  """
  Returns: (gameState, lastUpdated, game_date_yyyy_mm_dd)
  """
  game_state = pbp_json.get("gameState")
  last_updated = pbp_json.get("lastUpdated")

  # Try to get a stable game date from gameInfo.startTimeUTC
  game_date = None
  gi = pbp_json.get("gameInfo") or {}
  st = gi.get("startTimeUTC")
  if isinstance(st, str) and "T" in st:
    game_date = st.split("T")[0]

  return game_state, last_updated, game_date


def upsert_raw_game(db: SupabaseRest, game_id: int, game_date: str, pbp_json: dict) -> None:
  db.upsert(
    "raw_nhl_data",
    {
      "game_id": int(game_id),
      "game_date": game_date,
      "raw_json": pbp_json,
      "scraped_at": _now_iso(),
    },
    on_conflict="game_id",
  )


def main() -> int:
  print("=" * 80)
  print("[ingest_live_raw_nhl] STARTING LIVE INGEST LOOP")
  print("=" * 80)
  if ADAPTIVE_MODE:
    print(f"Adaptive mode: ENABLED")
    print(f"  Live interval: {LIVE_INTERVAL}s (during active games)")
    print(f"  Off-hours interval: {OFF_INTERVAL}s (no active games)")
  else:
    print(f"Poll interval: {POLL_SECONDS}s (fixed)")
  print(f"Cooldown: {COOLDOWN_SECONDS}s")
  print(f"Timestamp: {_now_iso()}")
  print()
  
  try:
    db = supabase_client()
    print("[ingest_live_raw_nhl] Connected to Supabase")
  except Exception as e:
    print(f"[ingest_live_raw_nhl] ERROR: Failed to connect: {e}")
    return 1

  # game_id -> (lastUpdated, last_fetch_epoch)
  cooldown: Dict[int, Tuple[Optional[str], float]] = {}
  # game_id -> bool (final pull completed)
  finalized: Dict[int, bool] = {}
  
  total_ingested = 0
  last_progress_time = time.time()
  last_interval_check = time.time()

  while True:
    try:
      # Update polling interval if adaptive mode is enabled (check every 5 minutes)
      current_interval = POLL_SECONDS
      if ADAPTIVE_MODE and (time.time() - last_interval_check) >= 300:  # Check every 5 minutes
        current_interval = get_polling_interval()
        last_interval_check = time.time()
        if current_interval != POLL_SECONDS:
          print(f"[ingest_live_raw_nhl] [ADAPTIVE] Updated polling interval to {current_interval}s")
      
      sched = get_schedule_now()
      games = (sched.get("games") or [])
      
      # Progress update even when no games
      current_time = time.time()
      if current_time - last_progress_time >= 15:
        mode_str = f"adaptive ({current_interval}s)" if ADAPTIVE_MODE else f"fixed ({POLL_SECONDS}s)"
        print(f"[ingest_live_raw_nhl] [PROGRESS] Polling schedule... (mode: {mode_str}, total ingested: {total_ingested})")
        last_progress_time = current_time

      for g in games:
        try:
          game_id = int(g.get("id"))
        except Exception:
          continue

        game_state = g.get("gameState")
        # Include INTERMISSION as an active state (game is in progress)
        if game_state not in ("LIVE", "CRIT", "OFF", "INTERMISSION"):
          continue

        if finalized.get(game_id) is True:
          continue

        # Cooldown before even calling PBP (schedule/now doesn't expose PBP lastUpdated reliably)
        last_seen, last_epoch = cooldown.get(game_id, (None, 0.0))
        if (time.time() - last_epoch) < COOLDOWN_SECONDS and game_state != "OFF":
          continue

        pbp = get_pbp(game_id)
        pbp_state, last_updated, game_date = extract_game_state_and_last_updated(pbp)
        game_date = game_date or dt.date.today().strftime("%Y-%m-%d")

        # If we already have same lastUpdated and game isn't OFF, skip
        if last_updated and last_seen == last_updated and pbp_state != "OFF":
          cooldown[game_id] = (last_seen, time.time())
          continue

        upsert_raw_game(db, game_id, game_date, pbp)
        cooldown[game_id] = (last_updated, time.time())
        total_ingested += 1

        print(f"[ingest_live_raw_nhl] upserted game_id={game_id} state={pbp_state} lastUpdated={last_updated}")

        # If OFF, do a second immediate "gold standard" pull and finalize
        if pbp_state == "OFF" or game_state == "OFF":
          pbp2 = get_pbp(game_id)
          _, last_updated2, game_date2 = extract_game_state_and_last_updated(pbp2)
          upsert_raw_game(db, game_id, game_date2 or game_date, pbp2)
          finalized[game_id] = True
          cooldown[game_id] = (last_updated2, time.time())
          print(f"[ingest_live_raw_nhl] finalized game_id={game_id}")

      # Use adaptive interval if enabled, otherwise use fixed interval
      sleep_interval = get_polling_interval() if ADAPTIVE_MODE else POLL_SECONDS
      time.sleep(sleep_interval)

    except KeyboardInterrupt:
      print("[ingest_live_raw_nhl] Exiting (Ctrl+C).")
      return 0
    except Exception as e:
      print(f"[ingest_live_raw_nhl] ERROR: {e}", file=sys.stderr)
      time.sleep(max(5, POLL_SECONDS // 2))


if __name__ == "__main__":
  raise SystemExit(main())


