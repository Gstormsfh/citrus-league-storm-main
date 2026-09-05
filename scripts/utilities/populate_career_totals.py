#!/usr/bin/env python3
"""
Career totals for the player directory (2026-09-05).

Reads the NHL landing endpoint for every player in the current season's
directory and writes one small JSON document to player_directory.career:
regular-season career totals, the draft, the count of NHL seasons and the
trophies. The writeups read it to say "897 goals over 21 seasons" instead
of nothing.

Stale-first: rows never fetched go first, then the oldest career_fetched_at.
A run refreshes everything older than --stale-days (default 7), so the
weekly workflow keeps the directory current without hammering the API, and
a manual --all run rebuilds the lot.

Regular season only: fantasy uses regular-season data (Garrett, 2026-09-05).
"""
import argparse
import datetime as dt
import os
import sys
import time
from typing import Any, Dict, List, Optional

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401,E402

from dotenv import load_dotenv  # noqa: E402
from data_pipeline.utils.citrus_request import citrus_request  # noqa: E402
from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa: E402
from data_pipeline.utils.season_config import derive_nhl_season_year  # noqa: E402

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_API_BASE = "https://api-web.nhle.com/v1"
_ENV_SEASON = os.getenv("CITRUS_DEFAULT_SEASON")
DEFAULT_SEASON = int(_ENV_SEASON) if _ENV_SEASON else derive_nhl_season_year(dt.date.today())


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def _int(v: Any) -> Optional[int]:
  try:
    if v is None:
      return None
    return int(v)
  except (TypeError, ValueError):
    return None


def summarize_landing(landing: Dict[str, Any]) -> Dict[str, Any]:
  """The career document from one landing payload. Pure; tested by hand against Ovechkin's page."""
  reg = ((landing.get("careerTotals") or {}).get("regularSeason")) or {}
  seasons = landing.get("seasonTotals") or []
  nhl_seasons = sorted({s.get("season") for s in seasons if s.get("leagueAbbrev") == "NHL" and s.get("gameTypeId") == 2 and s.get("season")})
  draft = landing.get("draftDetails") or {}
  awards_out: List[Dict[str, Any]] = []
  for a in landing.get("awards") or []:
    name = ((a.get("trophy") or {}).get("default")) if isinstance(a.get("trophy"), dict) else a.get("trophy")
    if not name:
      continue
    awards_out.append({"name": str(name), "count": len(a.get("seasons") or [])})
  doc: Dict[str, Any] = {
    "gp": _int(reg.get("gamesPlayed")),
    "goals": _int(reg.get("goals")),
    "assists": _int(reg.get("assists")),
    "points": _int(reg.get("points")),
    "wins": _int(reg.get("wins")),
    "shutouts": _int(reg.get("shutouts")),
    "seasons": len(nhl_seasons),
    "first_season": nhl_seasons[0] if nhl_seasons else None,
    "draft": (
      {
        "year": _int(draft.get("year")),
        "round": _int(draft.get("round")),
        "overall": _int(draft.get("overallPick")),
        "team": draft.get("teamAbbrev"),
      }
      if draft
      else None
    ),
    "awards": awards_out,
    "source": "api-web.nhle.com/v1/player/{id}/landing",
  }
  return doc


def fetch_landing(player_id: int) -> Optional[Dict[str, Any]]:
  try:
    resp = citrus_request(f"{NHL_API_BASE}/player/{player_id}/landing", timeout=10)
    if resp.status_code == 200:
      return resp.json()
    print(f"[career_totals] {player_id}: HTTP {resp.status_code}")
    return None
  except Exception as e:  # noqa: BLE001
    print(f"[career_totals] {player_id}: {e}")
    return None


def candidates(db: SupabaseRest, season: int, stale_days: int, refresh_all: bool) -> List[Dict[str, Any]]:
  # select() pages transparently and checks the tally against Content-Range.
  rows = db.select(
    "player_directory",
    select="player_id, career_fetched_at",
    filters=[("season", "eq", season)],
    order="career_fetched_at.asc.nullsfirst",
  )
  if refresh_all:
    return rows
  cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=stale_days)
  out = []
  for r in rows:
    fetched = r.get("career_fetched_at")
    if not fetched:
      out.append(r)
      continue
    try:
      when = dt.datetime.fromisoformat(str(fetched).replace("Z", "+00:00"))
    except ValueError:
      out.append(r)
      continue
    if when < cutoff:
      out.append(r)
  return out


def main() -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--season", type=int, default=DEFAULT_SEASON)
  ap.add_argument("--stale-days", type=int, default=7)
  ap.add_argument("--all", action="store_true", help="refresh every row regardless of age")
  ap.add_argument("--limit", type=int, default=0, help="stop after N players (0 = no limit)")
  args = ap.parse_args()

  db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
  todo = candidates(db, args.season, args.stale_days, args.all)
  if args.limit:
    todo = todo[: args.limit]
  print(f"[career_totals] season={args.season} candidates={len(todo)} stale_days={args.stale_days} all={args.all}")

  written = 0
  failed = 0
  started = time.time()
  for idx, row in enumerate(todo, 1):
    pid = _int(row.get("player_id"))
    if not pid:
      continue
    landing = fetch_landing(pid)
    time.sleep(0.2)
    if not landing:
      failed += 1
      continue
    doc = summarize_landing(landing)
    # Every season row for the player carries the same career; update by player.
    db.update("player_directory", {"career": doc, "career_fetched_at": _now_iso()}, filters=[("player_id", "eq", pid)])
    written += 1
    if idx % 50 == 0:
      print(f"[career_totals] {idx}/{len(todo)} written={written} failed={failed} {time.time() - started:.0f}s")

  print(f"[career_totals] done written={written} failed={failed} in {time.time() - started:.0f}s")
  # The affirmative signal for the workflow log: how many rows now carry a career.
  with_career = db.select("player_directory", select="player_id", filters=[("season", "eq", args.season), ("career", "not.is", "null")])
  print(f"[career_totals] rows with career (season {args.season}): {len(with_career)}")
  return 0 if failed < max(1, len(todo) // 2) else 1


if __name__ == "__main__":
  sys.exit(main())
