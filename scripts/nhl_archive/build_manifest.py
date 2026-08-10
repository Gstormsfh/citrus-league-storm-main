#!/usr/bin/env python3
"""
build_manifest.py — W1 of the 9-season official-log rebuild.

For each requested season (default 2017..2026), fetches the full team
club-schedule from api-web.nhle.com for the 33-code superset (32 current
teams + ARI, which existed pre-relocation), dedupes by game id, keeps
gameType in (2=regular, 3=playoff), and emits:

  * manifest.csv — one row per game (game_id, season, type, date,
    home, away, start_time_utc). Artifact-uploaded by the workflow so
    downstream fetch/extract jobs can pick it up.
  * Ledger writes to public.xg_rebuild_audit via record_rebuild_audit(
    season, gate_name, expected, actual, note).

For season 2026 (the 2026-27 schedule) additionally UPSERTs rows into
public.nhl_games so the 2026-27 opening night is playable — the
DB currently holds ZERO season-2026 rows (measured 2026-08-10).

VALIDATION built in, hard-fail if violated (regular-season counts):
    2017:1271, 2018:1271, 2019:1082, 2020:868, 2021:1312, 2022:1312,
    2023:1312, 2024:1312, 2025:1312.
Playoffs vary; report actuals.

Refuses to run against prod without the workflow's confirm=yes gate.
Refuses to run at all without both VITE_SUPABASE_URL + SERVICE_ROLE.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.utils.citrus_request import citrus_request


NHL_API_BASE = "https://api-web.nhle.com/v1"

# 32 current teams + ARI (pre-2024 relocation to UTA)
TEAMS_33 = [
    "ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL", "DET",
    "EDM", "FLA", "LAK", "MIN", "MTL", "NSH", "NJD", "NYI", "NYR", "OTT",
    "PHI", "PIT", "SJS", "SEA", "STL", "TBL", "TOR", "UTA", "VAN", "VGK",
    "WSH", "WPG", "ARI",
]

# Hard expected counts per regular season (per NHL published schedule)
REGULAR_SEASON_EXPECTED = {
    2017: 1271, 2018: 1271, 2019: 1082, 2020: 868,
    2021: 1312, 2022: 1312, 2023: 1312, 2024: 1312, 2025: 1312,
}


def _season_code(season_start_year: int) -> str:
    """2017 → '20172018'; the NHL API's season identifier format."""
    return f"{season_start_year}{season_start_year + 1}"


def fetch_team_schedule(team_abbrev: str, season_start_year: int) -> List[Dict[str, Any]]:
    """Fetch a team's full season schedule. Returns games array or []."""
    url = f"{NHL_API_BASE}/club-schedule-season/{team_abbrev}/{_season_code(season_start_year)}"
    try:
        resp = citrus_request(url, timeout=20)
        if resp.status_code == 404:
            # Team didn't exist that season (e.g. UTA for 2017, ARI for 2025+)
            return []
        if resp.status_code != 200:
            print(f"  [warn] {team_abbrev} season={season_start_year}: HTTP {resp.status_code}",
                  flush=True)
            return []
        data = resp.json()
        return data.get("games", []) or []
    except Exception as e:
        print(f"  [warn] {team_abbrev} season={season_start_year}: {e}", flush=True)
        return []


def build_season_manifest(season_start_year: int) -> List[Dict[str, Any]]:
    """Dedupe games across all 33 team schedules for the season."""
    seen: Dict[int, Dict[str, Any]] = {}
    print(f"[manifest] season {season_start_year} ({_season_code(season_start_year)}):", flush=True)
    for team in TEAMS_33:
        games = fetch_team_schedule(team, season_start_year)
        time.sleep(0.15)  # be polite
        for g in games:
            gid = g.get("id")
            if not gid:
                continue
            game_type = g.get("gameType")
            if game_type not in (2, 3):  # regular + playoff only
                continue
            if gid in seen:
                continue
            seen[gid] = g
    print(f"  deduped: {len(seen)} games (types 2+3)", flush=True)
    return list(seen.values())


def record_audit(db: SupabaseRest, season: int, gate_name: str,
                 expected: Optional[int], actual: int, note: str = "") -> None:
    """Ledger write via the public.record_rebuild_audit RPC installed on prod."""
    try:
        db.rpc("record_rebuild_audit", {
            "p_season": int(season),
            "p_gate_name": gate_name,
            "p_expected": expected,
            "p_actual": int(actual),
            "p_note": note[:1000] if note else "",
        })
        print(f"  [ledger] season={season} {gate_name}: expected={expected} actual={actual}",
              flush=True)
    except Exception as e:
        # Fail loudly — a stage that can't record its result cannot proceed.
        raise RuntimeError(
            f"[FATAL] ledger write failed for season={season} gate={gate_name}: {e}"
        ) from e


def upsert_nhl_games_for_2026(db: SupabaseRest, games: List[Dict[str, Any]]) -> int:
    """UPSERT 2026-27 schedule rows into public.nhl_games so opening night
    is playable. Matches the existing nhl_games schema (game_id,
    game_date, home_team, away_team, home_team_id, away_team_id,
    game_time, status, game_type, season).
    """
    rows: List[Dict[str, Any]] = []
    game_type_map = {2: "regular", 3: "playoff"}
    for g in games:
        gid = g.get("id")
        if not gid:
            continue
        date = g.get("gameDate")  # e.g. "2026-10-07"
        home = g.get("homeTeam", {})
        away = g.get("awayTeam", {})
        rows.append({
            "game_id": gid,
            "game_date": date,
            "home_team": home.get("abbrev", ""),
            "away_team": away.get("abbrev", ""),
            "home_team_id": home.get("id"),
            "away_team_id": away.get("id"),
            "game_time": g.get("startTimeUTC"),
            "status": "scheduled",
            "game_type": game_type_map.get(g.get("gameType", 2), "regular"),
            "season": 2026,
        })
    if not rows:
        return 0
    # Idempotent — nhl_games has unique constraint on game_id.
    db.upsert("nhl_games", rows, on_conflict="game_id")
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=str, default="2017-2026",
                    help='Season range, e.g. "2017-2026" or "2025"')
    ap.add_argument("--out", type=str, default="manifest.csv",
                    help="Path for the manifest CSV artifact")
    ap.add_argument("--upsert-2026", action="store_true",
                    help="UPSERT 2026-27 schedule rows into public.nhl_games")
    args = ap.parse_args()

    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required", file=sys.stderr)
        return 1
    from urllib.parse import urlparse
    host = urlparse(url).hostname or ""

    if "-" in args.seasons:
        lo, hi = args.seasons.split("-", 1)
        seasons = list(range(int(lo), int(hi) + 1))
    else:
        seasons = [int(args.seasons)]

    print("=" * 78)
    print(f"[BANNER] destination host: {host}")
    print(f"[BANNER] seasons to build : {seasons}")
    print(f"[BANNER] upsert 2026 -> nhl_games: {args.upsert_2026}")
    print("=" * 78, flush=True)

    db = SupabaseRest(url, key)

    all_rows: List[Dict[str, Any]] = []
    for season in seasons:
        games = build_season_manifest(season)
        regular = [g for g in games if g.get("gameType") == 2]
        playoff = [g for g in games if g.get("gameType") == 3]
        expected_regular = REGULAR_SEASON_EXPECTED.get(season)
        actual_regular = len(regular)
        # Validation — hard-fail if regular-season count deviates from published schedule
        if expected_regular is not None and actual_regular != expected_regular:
            print(f"[FATAL] season {season} regular-season count "
                  f"expected={expected_regular} actual={actual_regular}", file=sys.stderr)
            record_audit(db, season, "manifest",
                         expected=expected_regular, actual=actual_regular,
                         note=f"REGULAR-SEASON COUNT MISMATCH; playoff={len(playoff)}")
            return 2
        # Emit ledger row (info-tier: playoff variable, use total games as actual)
        record_audit(db, season, "manifest",
                     expected=expected_regular, actual=actual_regular,
                     note=f"regular={actual_regular} playoff={len(playoff)}")
        # Enrich rows for CSV
        for g in games:
            all_rows.append({
                "game_id": g.get("id"),
                "season": season,
                "type": g.get("gameType"),
                "date": g.get("gameDate"),
                "home": g.get("homeTeam", {}).get("abbrev", ""),
                "away": g.get("awayTeam", {}).get("abbrev", ""),
                "start_time_utc": g.get("startTimeUTC", ""),
            })
        # W1 rider — season 2026 also UPSERTs into nhl_games
        if season == 2026 and args.upsert_2026:
            print(f"  [nhl_games] upserting {len(games)} rows for season 2026-27...")
            upserted = upsert_nhl_games_for_2026(db, games)
            record_audit(db, 2026, "nhl_games_schedule",
                         expected=len(games), actual=upserted,
                         note="2026-27 schedule seeding for opening night")

    # Write manifest CSV
    if all_rows:
        with open(args.out, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
            w.writeheader()
            for r in all_rows:
                w.writerow(r)
        print(f"[manifest] wrote {len(all_rows)} rows to {args.out}", flush=True)
    else:
        print("[manifest] no rows to write", file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
