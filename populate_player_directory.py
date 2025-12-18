#!/usr/bin/env python3
"""
populate_player_directory.py

Build/update public.player_directory (player_id -> name/team/position/is_goalie) from:
- raw_nhl_data (play-by-play includes player rosters in game metadata)
- or the NHL players endpoint (fallback)

MVP implementation: scan raw_nhl_data payloads and extract known players.
"""

import os
import datetime as dt
from typing import Dict, Optional

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


def _safe_int(v, default=0) -> int:
  try:
    return int(v)
  except Exception:
    return default


def main() -> int:
  db = supabase_client()
  season = DEFAULT_SEASON

  # Pull a chunk of raw_nhl_data (MVP). Can paginate later.
  rows = db.select("raw_nhl_data", select="game_id,raw_json", order="game_id.desc", limit=500)

  seen: Dict[int, dict] = {}

  for r in rows:
    pbp = r.get("raw_json") or {}
    rosters = pbp.get("rosterSpots") or pbp.get("rosterSpotsHome") or None

    # Many responses include `rosterSpots` as a flat array of players.
    if isinstance(rosters, list):
      for p in rosters:
        pid = _safe_int(p.get("playerId"), 0)
        if not pid:
          continue
        if pid in seen:
          continue
        full_name = p.get("name") or p.get("fullName") or ""
        team = p.get("teamAbbrev")
        pos = p.get("positionCode")
        is_goalie = (pos == "G")
        seen[pid] = {
          "season": season,
          "player_id": pid,
          "full_name": full_name,
          "team_abbrev": team,
          "position_code": pos,
          "is_goalie": is_goalie,
          "updated_at": _now_iso(),
        }

  if seen:
    db.upsert("player_directory", list(seen.values()), on_conflict="season,player_id")
    print(f"[populate_player_directory] upserted players={len(seen)}")
  else:
    print("[populate_player_directory] no players found in sampled raw_nhl_data payloads")

  return 0


if __name__ == "__main__":
  raise SystemExit(main())


