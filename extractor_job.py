#!/usr/bin/env python3
"""
extractor_job.py

Consumer: read public.raw_nhl_data (raw play-by-play JSON) and extract per-player per-game stats into
public.player_game_stats and public.player_directory.

Principles:
- No staging reliance.
- Season totals (GP/PTS/SOG) are derived from play-by-play events, not raw_shots (coords can be missing).
- PPP/SHP uses situationCode parsing.
- Mark raw_nhl_data.stats_extracted=true only when game is final ("OFF").

This is MVP-grade extraction: enough to restore correctness of fantasy categories used in the UI.
We can iterate to add more play types later.
"""

import os
import sys
import time
import datetime as dt
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))
POLL_SECONDS = int(os.getenv("CITRUS_EXTRACT_POLL_SECONDS", "120"))
MAX_BATCH = int(os.getenv("CITRUS_EXTRACT_BATCH", "25"))


def supabase_client() -> Client:
  return create_client(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def _safe_int(v: Any, default: int = 0) -> int:
  try:
    if v is None:
      return default
    return int(v)
  except Exception:
    return default


def _parse_situation_code(code: Any) -> Tuple[Optional[int], Optional[int]]:
  """
  NHL situationCode is often 4-digit like 1551.
  We only need skater counts for PPP/SHP classification.

  Empirically (from prior bugfix): for 4-digit codes,
    away_skaters = int(code_str[1])
    home_skaters = int(code_str[2])
  """
  if code is None:
    return None, None
  s = str(code).strip()
  if len(s) < 3:
    return None, None
  if len(s) >= 4:
    away = _safe_int(s[1], 0)
    home = _safe_int(s[2], 0)
    return home, away
  # fallback: unknown format
  return None, None


def _is_goal_play(play: dict) -> bool:
  # NHL PBP: play["typeCode"] == 505 for GOAL in gamecenter API
  return str(play.get("typeCode")) == "505" or (play.get("typeDescKey") == "goal")


def _is_shot_play(play: dict) -> bool:
  # SOG shot-type events include "shot-on-goal" (usually 507?) and goals are also SOG.
  # We'll count SOG as: GOAL or play typeDescKey == "shot-on-goal"
  if _is_goal_play(play):
    return True
  return play.get("typeDescKey") == "shot-on-goal"


def _get_players_from_play(play: dict) -> List[dict]:
  # In NHL API, play["details"] often includes "players" list; sometimes "scoringPlayerId", etc.
  details = play.get("details") or {}
  players = details.get("players")
  if isinstance(players, list):
    return players
  return []


def _extract_game_date(pbp: dict) -> str:
  gi = pbp.get("gameInfo") or {}
  st = gi.get("startTimeUTC")
  if isinstance(st, str) and "T" in st:
    return st.split("T")[0]
  return dt.date.today().strftime("%Y-%m-%d")


def _extract_team_abbrevs(pbp: dict) -> Tuple[Optional[str], Optional[str]]:
  home = (pbp.get("homeTeam") or {}).get("abbrev")
  away = (pbp.get("awayTeam") or {}).get("abbrev")
  return home, away


def _upsert_player_directory(db: Client, season: int, player_id: int, full_name: str, team_abbrev: Optional[str], position_code: Optional[str], is_goalie: bool) -> None:
  db.table("player_directory").upsert(
    {
      "season": season,
      "player_id": player_id,
      "full_name": full_name,
      "team_abbrev": team_abbrev,
      "position_code": position_code,
      "is_goalie": bool(is_goalie),
      "updated_at": _now_iso(),
    },
    on_conflict="season,player_id",
  ).execute()


def _aggregate_player_stats_from_pbp(pbp: dict, season: int) -> Dict[int, dict]:
  """
  Returns map player_id -> aggregated stat row (player_game_stats fields).
  This MVP focuses on:
  - goals, assists (primary/secondary when available), points
  - shots_on_goal (goals + shot-on-goal events)
  - pim (penalties attributed to committedByPlayerId or penaltyOnPlayerId)
  - ppp/shp for goal scorers + assisters based on situationCode
  """
  game_id = _safe_int(pbp.get("id"), 0) or _safe_int(pbp.get("gameId"), 0)
  game_date = _extract_game_date(pbp)
  home_abbrev, away_abbrev = _extract_team_abbrevs(pbp)

  plays = pbp.get("plays") or pbp.get("playByPlay") or []
  if not isinstance(plays, list):
    plays = []

  acc: Dict[int, dict] = {}

  def ensure(pid: int) -> dict:
    if pid not in acc:
      acc[pid] = {
        "season": season,
        "game_id": game_id,
        "game_date": game_date,
        "player_id": pid,
        "team_abbrev": None,
        "position_code": None,
        "is_goalie": False,
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
        "plus_minus": 0,  # computed by separate shiftcharts path
        "icetime_seconds": 0,
        "goalie_gp": 0,
        "wins": 0,
        "saves": 0,
        "shots_faced": 0,
        "goals_against": 0,
        "shutouts": 0,
        "updated_at": _now_iso(),
      }
    return acc[pid]

  for play in plays:
    details = play.get("details") or {}

    # SOG
    if _is_shot_play(play):
      shooter = details.get("shootingPlayerId") or details.get("scoringPlayerId")
      pid = _safe_int(shooter, 0)
      if pid:
        ensure(pid)["shots_on_goal"] += 1

    # Goals / assists / PPP/SHP
    if _is_goal_play(play):
      scoring_pid = _safe_int(details.get("scoringPlayerId"), 0)
      assist1_pid = _safe_int(details.get("assist1PlayerId"), 0)
      assist2_pid = _safe_int(details.get("assist2PlayerId"), 0)

      # Determine parity from situationCode (home/away skaters)
      sc = details.get("situationCode")
      home_skaters, away_skaters = _parse_situation_code(sc)

      # Determine scoring team side
      scoring_team_id = details.get("eventOwnerTeamId")
      home_team_id = _safe_int((pbp.get("homeTeam") or {}).get("id"), 0)
      away_team_id = _safe_int((pbp.get("awayTeam") or {}).get("id"), 0)
      is_home_scoring = (scoring_team_id == home_team_id) if scoring_team_id and home_team_id else None

      scoring_team_skaters = None
      defending_team_skaters = None
      if is_home_scoring is True:
        scoring_team_skaters = home_skaters
        defending_team_skaters = away_skaters
      elif is_home_scoring is False:
        scoring_team_skaters = away_skaters
        defending_team_skaters = home_skaters

      is_pp = (scoring_team_skaters is not None and defending_team_skaters is not None and scoring_team_skaters > defending_team_skaters)
      is_sh = (scoring_team_skaters is not None and defending_team_skaters is not None and scoring_team_skaters < defending_team_skaters)

      if scoring_pid:
        ensure(scoring_pid)["goals"] += 1
        ensure(scoring_pid)["points"] += 1
        if is_pp:
          ensure(scoring_pid)["ppp"] += 1
        if is_sh:
          ensure(scoring_pid)["shp"] += 1

      if assist1_pid:
        ensure(assist1_pid)["primary_assists"] += 1
        ensure(assist1_pid)["points"] += 1
        if is_pp:
          ensure(assist1_pid)["ppp"] += 1
        if is_sh:
          ensure(assist1_pid)["shp"] += 1

      if assist2_pid:
        ensure(assist2_pid)["secondary_assists"] += 1
        ensure(assist2_pid)["points"] += 1
        if is_pp:
          ensure(assist2_pid)["ppp"] += 1
        if is_sh:
          ensure(assist2_pid)["shp"] += 1

    # Penalties -> PIM
    if play.get("typeDescKey") == "penalty":
      minutes = _safe_int(details.get("penaltyMinutes"), 0)
      offender = _safe_int(details.get("committedByPlayerId") or details.get("penaltyOnPlayerId"), 0)
      if offender and minutes:
        ensure(offender)["pim"] += minutes

  # Attach team abbreviations where possible (best-effort)
  for pid, row in acc.items():
    # We don't have perfect player->team mapping in PBP without richer parsing.
    # Keep null for now; directory builder will populate this.
    row["team_abbrev"] = row["team_abbrev"] or None
  return acc


def _upsert_player_game_stats(db: Client, rows: List[dict]) -> None:
  if not rows:
    return
  # chunk to avoid large payload limits
  CHUNK = 500
  for i in range(0, len(rows), CHUNK):
    db.table("player_game_stats").upsert(rows[i:i + CHUNK], on_conflict="season,game_id,player_id").execute()


def _mark_extracted_if_final(db: Client, game_id: int) -> None:
  db.table("raw_nhl_data").update({"stats_extracted": True, "stats_extracted_at": _now_iso()}).eq("game_id", game_id).execute()


def _get_unextracted_games(db: Client, limit: int) -> List[dict]:
  resp = db.table("raw_nhl_data").select("game_id, game_date, raw_json, stats_extracted").eq("stats_extracted", False).limit(limit).execute()
  return resp.data or []


def main() -> int:
  print("[extractor_job] Starting extractor loop.")
  db = supabase_client()

  while True:
    try:
      games = _get_unextracted_games(db, MAX_BATCH)
      if not games:
        time.sleep(POLL_SECONDS)
        continue

      for g in games:
        game_id = _safe_int(g.get("game_id"), 0)
        pbp = g.get("raw_json") or {}
        state = pbp.get("gameState")

        rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
        rows = list(rows_map.values())
        _upsert_player_game_stats(db, rows)

        print(f"[extractor_job] upserted player_game_stats game_id={game_id} players={len(rows)} state={state}")

        if state == "OFF":
          _mark_extracted_if_final(db, game_id)
          print(f"[extractor_job] marked stats_extracted for game_id={game_id}")

      time.sleep(2)

    except KeyboardInterrupt:
      print("[extractor_job] Exiting (Ctrl+C).")
      return 0
    except Exception as e:
      print(f"[extractor_job] ERROR: {e}", file=sys.stderr)
      time.sleep(max(5, POLL_SECONDS // 2))


if __name__ == "__main__":
  raise SystemExit(main())


