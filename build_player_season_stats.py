#!/usr/bin/env python3
"""
build_player_season_stats.py

Rollup: aggregate public.player_game_stats into public.player_season_stats for fast UI loads.
Optionally enrich with xG/xA totals from public.raw_shots (if available).
"""

import os
import sys
import datetime as dt
from typing import Dict, List

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> Client:
  return create_client(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def fetch_all_player_game_stats(db: Client, season: int) -> List[dict]:
  # naive full pull (MVP); can be paginated later
  resp = db.table("player_game_stats").select("*").eq("season", season).execute()
  return resp.data or []


def try_fetch_xg_totals(db: Client, season: int) -> Dict[int, Dict[str, float]]:
  """
  Returns player_id -> {x_goals, x_assists}
  Best-effort: if raw_shots schema differs or unavailable, return empty.
  """
  try:
    # raw_shots has player_id and xg; xA might be xa or expected_assists depending on schema.
    resp = db.table("raw_shots").select("player_id, xg, xa").execute()
    rows = resp.data or []
    out: Dict[int, Dict[str, float]] = {}
    for r in rows:
      pid = r.get("player_id")
      if pid is None:
        continue
      pid = int(pid)
      if pid not in out:
        out[pid] = {"x_goals": 0.0, "x_assists": 0.0}
      out[pid]["x_goals"] += float(r.get("xg") or 0.0)
      out[pid]["x_assists"] += float(r.get("xa") or 0.0)
    return out
  except Exception:
    return {}


def upsert_player_season_stats(db: Client, season_rows: List[dict]) -> None:
  if not season_rows:
    return
  CHUNK = 500
  for i in range(0, len(season_rows), CHUNK):
    db.table("player_season_stats").upsert(season_rows[i:i + CHUNK], on_conflict="season,player_id").execute()


def main() -> int:
  db = supabase_client()
  season = DEFAULT_SEASON

  rows = fetch_all_player_game_stats(db, season)
  if not rows:
    print("[build_player_season_stats] No player_game_stats rows found.")
    return 0

  # Pure-Python rollup (no pandas) for Windows friendliness
  acc: Dict[tuple, dict] = {}

  for r in rows:
    pid = int(r.get("player_id"))
    key = (season, pid)

    if key not in acc:
      acc[key] = {
        "season": season,
        "player_id": pid,
        "team_abbrev": r.get("team_abbrev"),
        "position_code": r.get("position_code"),
        "is_goalie": bool(r.get("is_goalie") or False),
        "games_played": 0,
        "icetime_seconds": 0,

        "goals": 0,
        "primary_assists": 0,
        "secondary_assists": 0,
        "points": 0,
        "shots_on_goal": 0,
        "hits": 0,
        "blocks": 0,
        "pim": 0,
        "ppp": 0,
        "shp": 0,
        "plus_minus": 0,

        "x_goals": 0.0,
        "x_assists": 0.0,

        "goalie_gp": 0,
        "wins": 0,
        "saves": 0,
        "shots_faced": 0,
        "goals_against": 0,
        "shutouts": 0,
        "save_pct": None,

        "updated_at": _now_iso(),
      }

    out = acc[key]
    out["team_abbrev"] = r.get("team_abbrev") or out["team_abbrev"]
    out["position_code"] = r.get("position_code") or out["position_code"]
    out["is_goalie"] = bool(out["is_goalie"] or (r.get("is_goalie") or False))

    # games_played is count distinct games
    # We'll approximate by incrementing once per row, since table is (season, game_id, player_id) PK.
    out["games_played"] += 1

    out["icetime_seconds"] += int(r.get("icetime_seconds") or 0)
    out["goals"] += int(r.get("goals") or 0)
    out["primary_assists"] += int(r.get("primary_assists") or 0)
    out["secondary_assists"] += int(r.get("secondary_assists") or 0)
    out["points"] += int(r.get("points") or 0)
    out["shots_on_goal"] += int(r.get("shots_on_goal") or 0)
    out["hits"] += int(r.get("hits") or 0)
    out["blocks"] += int(r.get("blocks") or 0)
    out["pim"] += int(r.get("pim") or 0)
    out["ppp"] += int(r.get("ppp") or 0)
    out["shp"] += int(r.get("shp") or 0)
    out["plus_minus"] += int(r.get("plus_minus") or 0)

    out["goalie_gp"] += int(r.get("goalie_gp") or 0)
    out["wins"] += int(r.get("wins") or 0)
    out["saves"] += int(r.get("saves") or 0)
    out["shots_faced"] += int(r.get("shots_faced") or 0)
    out["goals_against"] += int(r.get("goals_against") or 0)
    out["shutouts"] += int(r.get("shutouts") or 0)

  # Save pct
  for out in acc.values():
    sf = float(out.get("shots_faced") or 0)
    sv = float(out.get("saves") or 0)
    out["save_pct"] = (sv / sf) if sf > 0 else None

  # xG enrich (optional)
  xg = try_fetch_xg_totals(db, season)
  if xg:
    for out in acc.values():
      pid = int(out["player_id"])
      out["x_goals"] = float(xg.get(pid, {}).get("x_goals", 0.0))
      out["x_assists"] = float(xg.get(pid, {}).get("x_assists", 0.0))

  season_rows = list(acc.values())
  upsert_player_season_stats(db, season_rows)

  print(f"[build_player_season_stats] upserted player_season_stats rows={len(season_rows)} season={season}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())


