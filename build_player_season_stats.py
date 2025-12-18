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

import pandas as pd
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

  df = pd.DataFrame(rows)

  # roll up
  grp = df.groupby(["season", "player_id"], dropna=False)
  rolled = grp.agg(
    team_abbrev=("team_abbrev", "last"),
    position_code=("position_code", "last"),
    is_goalie=("is_goalie", "max"),
    games_played=("game_id", "nunique"),
    icetime_seconds=("icetime_seconds", "sum"),

    goals=("goals", "sum"),
    primary_assists=("primary_assists", "sum"),
    secondary_assists=("secondary_assists", "sum"),
    points=("points", "sum"),
    shots_on_goal=("shots_on_goal", "sum"),
    hits=("hits", "sum"),
    blocks=("blocks", "sum"),
    pim=("pim", "sum"),
    ppp=("ppp", "sum"),
    shp=("shp", "sum"),
    plus_minus=("plus_minus", "sum"),

    goalie_gp=("goalie_gp", "sum"),
    wins=("wins", "sum"),
    saves=("saves", "sum"),
    shots_faced=("shots_faced", "sum"),
    goals_against=("goals_against", "sum"),
    shutouts=("shutouts", "sum"),
  ).reset_index()

  # compute save_pct
  def save_pct(row):
    sf = float(row.get("shots_faced") or 0)
    sv = float(row.get("saves") or 0)
    if sf <= 0:
      return None
    return sv / sf

  rolled["save_pct"] = rolled.apply(save_pct, axis=1)
  rolled["x_goals"] = 0.0
  rolled["x_assists"] = 0.0
  rolled["updated_at"] = _now_iso()

  xg = try_fetch_xg_totals(db, season)
  if xg:
    def xg_goals(pid): return float(xg.get(int(pid), {}).get("x_goals", 0.0))
    def xg_assists(pid): return float(xg.get(int(pid), {}).get("x_assists", 0.0))
    rolled["x_goals"] = rolled["player_id"].apply(xg_goals)
    rolled["x_assists"] = rolled["player_id"].apply(xg_assists)

  season_rows = rolled.to_dict(orient="records")
  upsert_player_season_stats(db, season_rows)

  print(f"[build_player_season_stats] upserted player_season_stats rows={len(season_rows)} season={season}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())


