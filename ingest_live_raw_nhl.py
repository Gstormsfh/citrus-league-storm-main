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

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_BASE_URL = "https://api-web.nhle.com/v1"

POLL_SECONDS = int(os.getenv("CITRUS_INGEST_POLL_SECONDS", "60"))
COOLDOWN_SECONDS = int(os.getenv("CITRUS_INGEST_COOLDOWN_SECONDS", "45"))


def supabase_client() -> SupabaseRest:
  return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def fetch_json(url: str, timeout: int = 15) -> dict:
  r = requests.get(url, timeout=timeout)
  r.raise_for_status()
  return r.json()


def get_schedule_now() -> dict:
  return fetch_json(f"{NHL_BASE_URL}/schedule/now")


def get_pbp(game_id: int) -> dict:
  return fetch_json(f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play")


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
  print("[ingest_live_raw_nhl] Starting live ingest loop.")
  print(f"[ingest_live_raw_nhl] poll={POLL_SECONDS}s cooldown={COOLDOWN_SECONDS}s")

  db = supabase_client()

  # game_id -> (lastUpdated, last_fetch_epoch)
  cooldown: Dict[int, Tuple[Optional[str], float]] = {}
  # game_id -> bool (final pull completed)
  finalized: Dict[int, bool] = {}

  while True:
    try:
      sched = get_schedule_now()
      games = (sched.get("games") or [])

      for g in games:
        try:
          game_id = int(g.get("id"))
        except Exception:
          continue

        game_state = g.get("gameState")
        if game_state not in ("LIVE", "CRIT", "OFF"):
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

        print(f"[ingest_live_raw_nhl] upserted game_id={game_id} state={pbp_state} lastUpdated={last_updated}")

        # If OFF, do a second immediate "gold standard" pull and finalize
        if pbp_state == "OFF" or game_state == "OFF":
          pbp2 = get_pbp(game_id)
          _, last_updated2, game_date2 = extract_game_state_and_last_updated(pbp2)
          upsert_raw_game(db, game_id, game_date2 or game_date, pbp2)
          finalized[game_id] = True
          cooldown[game_id] = (last_updated2, time.time())
          print(f"[ingest_live_raw_nhl] finalized game_id={game_id}")

      time.sleep(POLL_SECONDS)

    except KeyboardInterrupt:
      print("[ingest_live_raw_nhl] Exiting (Ctrl+C).")
      return 0
    except Exception as e:
      print(f"[ingest_live_raw_nhl] ERROR: {e}", file=sys.stderr)
      time.sleep(max(5, POLL_SECONDS // 2))


if __name__ == "__main__":
  raise SystemExit(main())


