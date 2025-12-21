#!/usr/bin/env python3
"""
build_player_season_stats.py

Rollup: aggregate public.player_game_stats into public.player_season_stats for fast UI loads.
Optionally enrich with xG/xA totals from public.raw_shots (if available).
"""

from dotenv import load_dotenv
import os
import sys
import datetime as dt
from typing import Dict, List

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


def fetch_all_player_game_stats(db: SupabaseRest, season: int) -> List[dict]:
  # Paginated pull to get all rows
  all_rows = []
  offset = 0
  page_size = 1000
  while True:
    page = db.select("player_game_stats", select="*", filters=[("season", "eq", season)], limit=page_size, offset=offset)
    if not page:
      break
    all_rows.extend(page)
    if len(page) < page_size:
      break
    offset += page_size
    if offset % 5000 == 0:
      print(f"[build_player_season_stats] Fetched {len(all_rows)} rows so far...")
  return all_rows


def try_fetch_xg_totals(db: SupabaseRest, season: int) -> Dict[int, Dict[str, float]]:
  """
  Returns player_id -> {x_goals, x_assists}
  Best-effort: handles multiple column name variations in raw_shots with pagination.
  Uses shooting_talent_adjusted_xg if available (preferred), otherwise falls back to xg_value.
  """
  import time
  try:
    out: Dict[int, Dict[str, float]] = {}
    batch_size = 1000  # PostgREST max limit
    offset = 0
    shot_count = 0
    last_progress_time = time.time()
    use_talent_adjusted = False
    
    print("[build_player_season_stats] Fetching xG/xA from raw_shots (with pagination)...")
    
    # Try to determine which columns are available by testing first batch
    try:
      test_batch = db.select("raw_shots", select="player_id,shooting_talent_adjusted_xg,xg_value,xa_value", limit=1, offset=0)
      if test_batch and len(test_batch) > 0:
        if "shooting_talent_adjusted_xg" in test_batch[0]:
          use_talent_adjusted = True
          select_cols = "player_id,shooting_talent_adjusted_xg,xg_value,xa_value"
        else:
          select_cols = "player_id,xg_value,xa_value"
      else:
        select_cols = "player_id,xg_value,xa_value"
    except:
      # Fallback to basic columns
      try:
        test_batch = db.select("raw_shots", select="player_id,xg_value,xa_value", limit=1, offset=0)
        select_cols = "player_id,xg_value,xa_value"
      except:
        # Last resort: try old column names
        select_cols = "player_id,xg,xa"
    
    # Fetch all rows with pagination
    while True:
      try:
        rows = db.select("raw_shots", select=select_cols, limit=batch_size, offset=offset)
      except Exception as e:
        print(f"[build_player_season_stats] Warning: Could not fetch xG/xA batch at offset {offset}: {e}")
        break
      
      if not rows:
        break
      
      for r in rows:
        shot_count += 1
        pid = r.get("player_id")
        if pid is None:
          continue
        pid = int(pid)
        if pid not in out:
          out[pid] = {"x_goals": 0.0, "x_assists": 0.0}
        
        # Prefer shooting_talent_adjusted_xg if available, otherwise use xg_value or xg
        xg_val = 0.0
        if use_talent_adjusted and r.get("shooting_talent_adjusted_xg") is not None:
          xg_val = float(r.get("shooting_talent_adjusted_xg") or 0.0)
        elif r.get("xg_value") is not None:
          xg_val = float(r.get("xg_value") or 0.0)
        elif r.get("xg") is not None:
          xg_val = float(r.get("xg") or 0.0)
        
        # xA: prefer xa_value, fallback to xa
        xa_val = 0.0
        if r.get("xa_value") is not None:
          xa_val = float(r.get("xa_value") or 0.0)
        elif r.get("xa") is not None:
          xa_val = float(r.get("xa") or 0.0)
        
        out[pid]["x_goals"] += xg_val
        out[pid]["x_assists"] += xa_val
      
      # Progress every 15 seconds
      current_time = time.time()
      if current_time - last_progress_time >= 15:
        print(f"  [PROGRESS] Scanned {shot_count:,} shots, enriched {len(out)} players...")
        last_progress_time = current_time
      
      # Check if we got fewer rows than batch_size (last page)
      if len(rows) < batch_size:
        break
      
      offset += batch_size
    
    print(f"[build_player_season_stats] Enriched xG/xA for {len(out)} players from {shot_count:,} shots")
    return out
  except Exception as e:
    print(f"[build_player_season_stats] Warning: Error enriching xG/xA: {e}")
    import traceback
    traceback.print_exc()
    return {}


def upsert_player_season_stats(db: SupabaseRest, season_rows: List[dict]) -> None:
  if not season_rows:
    return
  CHUNK = 500
  for i in range(0, len(season_rows), CHUNK):
    db.upsert("player_season_stats", season_rows[i:i + CHUNK], on_conflict="season,player_id")


def main() -> int:
  import time
  print("=" * 80)
  print("[build_player_season_stats] STARTING")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print(f"Timestamp: {_now_iso()}")
  print()
  
  try:
    db = supabase_client()
    print("[build_player_season_stats] Connected to Supabase")
  except Exception as e:
    print(f"[build_player_season_stats] ERROR: Failed to connect to Supabase: {e}")
    return 1
  
  season = DEFAULT_SEASON

  print("[build_player_season_stats] Fetching player_game_stats...")
  rows = fetch_all_player_game_stats(db, season)
  if not rows:
    print("[build_player_season_stats] No player_game_stats rows found.")
    return 0
  
  print(f"[build_player_season_stats] Fetched {len(rows):,} player_game_stats rows")
  print("[build_player_season_stats] Aggregating season stats...")

  # Pure-Python rollup (no pandas) for Windows friendliness
  acc: Dict[tuple, dict] = {}
  last_progress_time = time.time()

  for idx, r in enumerate(rows, 1):
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
    
    # Progress every 15 seconds
    current_time = time.time()
    if current_time - last_progress_time >= 15:
      print(f"  [PROGRESS] Processed {idx:,}/{len(rows):,} game stats rows ({len(acc)} unique players)...")
      last_progress_time = current_time

  print(f"[build_player_season_stats] Aggregated stats for {len(acc)} unique players")
  
  # Save pct
  for out in acc.values():
    sf = float(out.get("shots_faced") or 0)
    sv = float(out.get("saves") or 0)
    out["save_pct"] = (sv / sf) if sf > 0 else None

  # xG enrich (optional)
  print()
  print("[build_player_season_stats] Enriching with xG/xA from raw_shots...")
  xg = try_fetch_xg_totals(db, season)
  if xg:
    enriched_count = 0
    for out in acc.values():
      pid = int(out["player_id"])
      if pid in xg:
        out["x_goals"] = float(xg[pid].get("x_goals", 0.0))
        out["x_assists"] = float(xg[pid].get("x_assists", 0.0))
        enriched_count += 1
    print(f"[build_player_season_stats] Enriched xG/xA for {enriched_count} players")
  else:
    print("[build_player_season_stats] No xG/xA data available (will use 0.0)")

  # Plus/minus computation (integrated)
  print()
  print("[build_player_season_stats] Computing plus/minus from shifts and goals...")
  try:
    from compute_player_season_plus_minus import compute_plus_minus
    pm = compute_plus_minus(season, db)
    if pm:
      pm_count = 0
      for out in acc.values():
        pid = int(out["player_id"])
        if pid in pm:
          out["plus_minus"] = int(pm[pid])
          pm_count += 1
      print(f"[build_player_season_stats] Computed plus/minus for {pm_count} players")
    else:
      print("[build_player_season_stats] No plus/minus computed (will use 0)")
  except ImportError:
    print("[build_player_season_stats] Warning: Could not import compute_plus_minus (plus/minus will remain 0)")
  except Exception as e:
    print(f"[build_player_season_stats] Warning: Plus/minus computation failed: {e}")
    import traceback
    traceback.print_exc()

  print()
  print("[build_player_season_stats] Upserting to player_season_stats...")
  print("[build_player_season_stats] Note: NHL.com official stats are preserved (not overwritten by PBP aggregation)")
  season_rows = list(acc.values())
  upsert_player_season_stats(db, season_rows)

  print()
  print("=" * 80)
  print(f"[build_player_season_stats] [OK] COMPLETE: upserted {len(season_rows)} player_season_stats rows for season {season}")
  print("=" * 80)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())


