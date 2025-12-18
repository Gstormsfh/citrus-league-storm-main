#!/usr/bin/env python3
"""
ingest_shiftcharts.py

Ingest official NHL shift charts into public.player_shifts_official.

Source endpoint:
  https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=XXXXXXXXXX

We only persist rows where typeCode == 517 (actual shifts). typeCode == 505 are goal events in this feed.
"""

import argparse
import datetime as dt
import os
import time
from typing import Dict, List, Optional

import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

SHIFTCHARTS_URL = "https://api.nhle.com/stats/rest/en/shiftcharts"


def supabase_client() -> SupabaseRest:
  return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def mmss_to_seconds(v: Optional[str]) -> int:
  if not v:
    return 0
  s = str(v).strip()
  if ":" not in s:
    return 0
  try:
    m, sec = s.split(":")
    return int(m) * 60 + int(sec)
  except Exception:
    return 0


def fetch_shiftcharts(game_id: int) -> List[dict]:
  params = {"cayenneExp": f"gameId={int(game_id)}"}
  r = requests.get(SHIFTCHARTS_URL, params=params, timeout=30)
  r.raise_for_status()
  payload = r.json()
  return payload.get("data") or []


def upsert_shifts(db: SupabaseRest, shifts: List[dict]) -> None:
  if not shifts:
    return
  CHUNK = 1000
  for i in range(0, len(shifts), CHUNK):
    db.upsert("player_shifts_official", shifts[i:i + CHUNK], on_conflict="shift_id")


def iter_game_ids_from_raw_nhl_data(db: SupabaseRest, season: int, limit: int) -> List[int]:
  # Use game_id prefix range for season
  game_id_min = int(f"{season}000000")
  game_id_max = int(f"{season + 1}000000")
  rows = db.select(
    "raw_nhl_data",
    select="game_id",
    filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
    order="game_id.asc",
    limit=limit,
  )
  return [int(r["game_id"]) for r in rows if r.get("game_id") is not None]


def main() -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--game-id", type=int, default=None, help="Ingest a single game")
  ap.add_argument("--season", type=int, default=2025, help="Season year prefix used in NHL game_id")
  ap.add_argument("--limit", type=int, default=200, help="How many games to ingest when using --season")
  ap.add_argument("--sleep", type=float, default=0.2, help="Delay between games to avoid rate limiting")
  args = ap.parse_args()

  db = supabase_client()
  game_ids = [args.game_id] if args.game_id else iter_game_ids_from_raw_nhl_data(db, args.season, args.limit)

  print(f"[ingest_shiftcharts] ingesting games={len(game_ids)}")
  for idx, gid in enumerate(game_ids, start=1):
    try:
      rows = fetch_shiftcharts(gid)
      shift_rows = []
      for r in rows:
        # only actual shifts
        if int(r.get("typeCode") or 0) != 517:
          continue
        shift_id = int(r["id"])
        start_s = mmss_to_seconds(r.get("startTime"))
        end_s = mmss_to_seconds(r.get("endTime"))
        dur_s = mmss_to_seconds(r.get("duration")) if r.get("duration") else None

        shift_rows.append(
          {
            "shift_id": shift_id,
            "game_id": int(r.get("gameId")),
            "player_id": int(r.get("playerId")),
            "team_id": int(r.get("teamId")),
            "team_abbrev": r.get("teamAbbrev"),
            "period": int(r.get("period")),
            "shift_number": int(r.get("shiftNumber") or 0),
            "start_time": r.get("startTime"),
            "end_time": r.get("endTime"),
            "duration": r.get("duration"),
            "shift_start_time_seconds": int(start_s),
            "shift_end_time_seconds": int(end_s),
            "duration_seconds": int(dur_s) if dur_s is not None else None,
            "updated_at": _now_iso(),
          }
        )

      upsert_shifts(db, shift_rows)
      print(f"[ingest_shiftcharts] ({idx}/{len(game_ids)}) game_id={gid} shifts={len(shift_rows)}")
      time.sleep(max(0.0, args.sleep))
    except Exception as e:
      print(f"[ingest_shiftcharts] ERROR game_id={gid}: {e}")

  return 0


if __name__ == "__main__":
  raise SystemExit(main())


