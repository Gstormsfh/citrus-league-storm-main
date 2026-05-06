#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose: Fetch + insert NHL playoff game schedule
# Invoked: .github/workflows/playoff-sync.yml (cron */15 * * * *)
# Reads:   NHL schedule API
# Writes:  nhl_games
# ────────────────────────────────────────────────────────────
"""
ingest_playoff_schedule.py

Fetches the NHL playoff game schedule from the NHL API and inserts
rows into the `nhl_games` table with `game_type='playoff'`.

The live scraper (`data_scraping_service.py`) already queries
`nhl_games WHERE game_date = today` without filtering on game_type,
so once playoff games are in this table, live stat scraping and
scoreboard updates work automatically.

Self-healing: uses upsert on (game_id) to avoid duplicates.
Run daily via playoff-sync cron or manually before Round 1 starts.

NHL API Schedule endpoint:
  https://api-web.nhle.com/v1/schedule/{YYYY-MM-DD}   (hyphens required!)
  gameType: 2 = regular, 3 = playoff
"""

import sys
import os
import logging
import argparse
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.citrus_request import citrus_request
from data_pipeline.utils.supabase_rest import SupabaseRest

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

NHL_BASE = "https://api-web.nhle.com/v1"
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# NHL API team IDs that differ from our nhl_teams table.
# Utah HC: NHL API uses 68 (post-rebrand ID), our DB has 59 (original ARI→UTA migration).
TEAM_ID_MAP = {68: 59}


class FetchError(Exception):
    """Raised when the NHL schedule API call itself fails (network / 5xx)."""


def fetch_schedule_for_date(date_str: str) -> list[dict]:
    """Fetch all games for a given date from the NHL API.

    Raises FetchError on transport / HTTP failures so the caller can record
    the date as failed. An empty list means "API succeeded, no games" —
    that's a valid answer (off day) and must not be conflated with failure.

    NHL endpoint expects YYYY-MM-DD with hyphens. Stripping them returns
    404 for every date — that's the bug that meant Round 1 games never
    actually came from this script (they were manually inserted via the
    Supabase Management API in c93f15c).
    """
    url = f"{NHL_BASE}/schedule/{date_str}"
    try:
        resp = citrus_request(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise FetchError(f"{date_str}: schedule fetch failed: {e}") from e
    games = []
    for week in data.get("gameWeek", []):
        if week.get("date") != date_str:
            continue
        for g in week.get("games", []):
            games.append(g)
    return games


def ingest_playoff_schedule(start_date: str, end_date: str, season: int = 2025) -> tuple[int, list[str]]:
    """
    Scan a date range for playoff games (gameType == 3) and upsert
    them into nhl_games with game_type='playoff'.

    Returns (total_upserted, failed_dates). Caller is expected to exit
    non-zero when failed_dates is non-empty so the workflow fails loudly
    instead of silently reporting green while the live scraper goes blind.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        return 0, ["__config__"]

    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    current = start
    total = 0
    failed_dates: list[str] = []

    logger.info(f"Scanning {start_date} to {end_date} for playoff games (season={season})...")

    while current <= end:
        ds = current.strftime("%Y-%m-%d")
        try:
            games = fetch_schedule_for_date(ds)
        except FetchError as e:
            # Transport-level failure — keep iterating other dates so a
            # partial outage doesn't lose the entire 7-day window, but
            # record this date as failed so we exit non-zero at the end.
            logger.error(f"  {e}")
            failed_dates.append(ds)
            current += timedelta(days=1)
            import time
            time.sleep(0.3)
            continue

        playoff_games = [g for g in games if g.get("gameType") == 3]
        if playoff_games:
            rows = []
            for g in playoff_games:
                game_id = g.get("id")
                if not game_id:
                    continue

                home = g.get("homeTeam", {})
                away = g.get("awayTeam", {})
                start_time = g.get("startTimeUTC")
                venue = g.get("venue", {}).get("default", "")
                state = g.get("gameState", "FUT")

                # Map gameState → status
                status_map = {
                    "FUT": "scheduled",
                    "PRE": "scheduled",
                    "LIVE": "in_progress",
                    "CRIT": "in_progress",
                    "FINAL": "final",
                    "OFF": "final",
                }
                status = status_map.get(state, state.lower())

                period_desc = g.get("periodDescriptor", {})
                period_num = period_desc.get("number")
                clock = g.get("clock", {}).get("timeRemaining")

                # Series info (if available from schedule response)
                series_status = g.get("seriesStatus", {})
                series_game_num = series_status.get("gameNumberOfSeries")

                row = {
                    "game_id": game_id,
                    "game_date": ds,
                    "game_time": start_time,
                    "home_team": home.get("abbrev", ""),
                    "away_team": away.get("abbrev", ""),
                    "home_team_id": TEAM_ID_MAP.get(home.get("id"), home.get("id")),
                    "away_team_id": TEAM_ID_MAP.get(away.get("id"), away.get("id")),
                    "home_score": home.get("score", 0) if status != "scheduled" else 0,
                    "away_score": away.get("score", 0) if status != "scheduled" else 0,
                    "status": status,
                    "period": str(period_num) if period_num else None,
                    "period_time": clock,
                    "venue": venue,
                    "season": season,
                    "game_type": "playoff",
                    "series_game_number": series_game_num,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                rows.append(row)

            if rows:
                try:
                    db.upsert("nhl_games", rows, on_conflict="game_id")
                    logger.info(f"  {ds}: upserted {len(rows)} playoff game(s)")
                    total += len(rows)
                except Exception as e:
                    # The most common cause of this is an FK reject on a
                    # team_id that NHL renumbered (see UTA 68→59 in
                    # TEAM_ID_MAP). Record and surface — don't swallow.
                    logger.error(f"  {ds}: upsert failed: {e}")
                    failed_dates.append(ds)

        current += timedelta(days=1)
        # Small sleep between dates to be polite to the API
        import time
        time.sleep(0.3)

    logger.info(f"Done. Total playoff games upserted: {total}")
    if failed_dates:
        logger.error(f"FAILED dates ({len(failed_dates)}): {', '.join(failed_dates)}")
    return total, failed_dates


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest NHL playoff game schedule")
    parser.add_argument("--start", default="2026-04-19", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", default="2026-06-30", help="End date (YYYY-MM-DD)")
    parser.add_argument("--season", type=int, default=2025, help="NHL season (year of Oct start)")
    args = parser.parse_args()

    count, failed = ingest_playoff_schedule(args.start, args.end, args.season)
    if count == 0 and not failed:
        logger.info("No playoff games found yet — NHL may not have published the schedule.")
    if failed:
        # Exit non-zero so the GitHub Actions cron fails loudly. Silent
        # failure here is what caused the "no games found" outage during
        # Round 1 — we never want to be in that state again.
        logger.error(
            f"Exiting non-zero because {len(failed)} date(s) failed to ingest. "
            f"Workflow should fail to surface this."
        )
        sys.exit(1)
