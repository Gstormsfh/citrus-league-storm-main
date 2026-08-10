#!/usr/bin/env python3
"""
backfill_missing_playoff_games_2026_05_12.py

One-off backfill for 5 playoff games that the scraper silently skipped on
series-transition dates (3 R1 G4 closeouts on 2026-04-25, and 2 R2 G1
openers on 2026-05-02/03). Audit found these had status='final' in
nhl_games but ZERO player_game_stats rows and NO raw_nhl_data record —
the games were never fetched.

Root cause (to fix separately): data-pipeline catch-up window in
data_scraping_service.py:797-821 only looks back one day, so any day
that gets deferred (the "live games being polled, defer catch-up"
branch) rolls off after 24h.

This script reuses the existing per-game primitive from
scrape_per_game_nhl_stats.py — fetch_game_boxscore (force_api=True),
extract_player_stats_from_boxscore, update_player_game_stats_nhl_columns.
The DB upsert is idempotent on (season, game_id, player_id), so a
re-run is safe.

Usage:
  python -m data_pipeline.debug.backfill_missing_playoff_games_2026_05_12 --dry-run
  python -m data_pipeline.debug.backfill_missing_playoff_games_2026_05_12 --apply
"""

import argparse
import os
import sys
from datetime import date
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.acquisition.scrape_per_game_nhl_stats import (
    fetch_game_boxscore,
    extract_player_stats_from_boxscore,
    update_player_game_stats_nhl_columns,
)

# Five playoff games confirmed missing by the 2026-05-12 audit.
# (game_id, game_date_iso, label)
MISSING_GAMES = [
    (2025030134, "2026-04-25", "R1 G4 — CAR @ OTT 4-2"),
    (2025030144, "2026-04-25", "R1 G4 — PIT @ PHI 4-2"),
    (2025030164, "2026-04-25", "R1 G4 — DAL @ MIN 2-3"),
    (2025030221, "2026-05-02", "R2 G1 — PHI @ CAR 0-3"),
    (2025030231, "2026-05-03", "R2 G1 — MIN @ COL 6-9"),
]
SEASON = 2025


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true",
                      help="Fetch boxscores and report counts WITHOUT writing")
    mode.add_argument("--apply", action="store_true",
                      help="Fetch and write to player_game_stats")
    args = parser.parse_args()

    load_dotenv()
    url = os.getenv("VITE_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env")

    db = SupabaseRest(url, key)

    print("=" * 78)
    print(f"Backfill missing playoff games — {'DRY RUN' if args.dry_run else 'APPLY'}")
    print("=" * 78)

    overall = {"games_ok": 0, "games_failed": 0, "rows_written": 0, "rows_planned": 0}

    for game_id, game_date_iso, label in MISSING_GAMES:
        print(f"\n[{game_id}] {game_date_iso} — {label}")

        # Pre-check: confirm pgs is still empty for this game (sanity, not race-safe)
        existing = db.select(
            "player_game_stats",
            select="player_id",
            filters=[("game_id", "eq", game_id), ("season", "eq", SEASON)],
            limit=1,
        )
        existing_n = len(existing) if existing else 0
        print(f"  pre-fetch pgs rows: {existing_n}")

        # Fetch boxscore directly from NHL API (force_api=True bypasses
        # the raw_nhl_data lookup, which is empty for these games).
        try:
            boxscore = fetch_game_boxscore(game_id, db=db, force_api=True)
        except Exception as e:
            print(f"  [ERROR] fetch_game_boxscore raised: {e}")
            overall["games_failed"] += 1
            continue

        if not boxscore:
            print(f"  [ERROR] boxscore returned None — NHL API did not serve this game")
            overall["games_failed"] += 1
            continue

        player_stats = extract_player_stats_from_boxscore(boxscore)
        if not player_stats:
            print(f"  [ERROR] no player stats extracted from boxscore")
            overall["games_failed"] += 1
            continue

        print(f"  extracted {len(player_stats)} player stat blocks")
        overall["rows_planned"] += len(player_stats)

        if args.dry_run:
            # Just preview — count goalies vs skaters, show a sample
            n_goalies = sum(1 for s in player_stats.values() if s.get("_is_goalie"))
            n_skaters = len(player_stats) - n_goalies
            print(f"  [DRY-RUN] would write: {n_skaters} skater + {n_goalies} goalie rows")
            overall["games_ok"] += 1
        else:
            # Actually write
            try:
                result = update_player_game_stats_nhl_columns(
                    db=db,
                    game_id=game_id,
                    game_date=date.fromisoformat(game_date_iso),
                    player_stats=player_stats,
                    season=SEASON,
                )
                created = result.get("created", 0)
                updated = result.get("updated", 0)
                skipped = result.get("skipped", 0)
                print(f"  [WRITE] created={created} updated={updated} skipped={skipped}")
                overall["rows_written"] += created + updated
                overall["games_ok"] += 1
            except Exception as e:
                print(f"  [ERROR] write failed: {e}")
                overall["games_failed"] += 1

    print()
    print("=" * 78)
    print("SUMMARY")
    print("=" * 78)
    print(f"  games_ok:     {overall['games_ok']} / {len(MISSING_GAMES)}")
    print(f"  games_failed: {overall['games_failed']}")
    if args.dry_run:
        print(f"  rows_planned: {overall['rows_planned']} (would write on --apply)")
    else:
        print(f"  rows_written: {overall['rows_written']}")
    print()
    if not args.dry_run and overall["games_ok"] == len(MISSING_GAMES):
        print("Next steps:")
        print("  SELECT aggregate_player_playoff_stats_live(2025);")
        print("  SELECT score_all_playoff_roster_pools();")

    return 0 if overall["games_failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
