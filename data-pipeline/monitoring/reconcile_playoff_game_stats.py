#!/usr/bin/env python3
"""
reconcile_playoff_game_stats.py — ENGINEERING.md §12.13 reconciliation alerter.

Single SQL-shaped check: are there any playoff games marked `status='final'`
in `nhl_games` that have ZERO rows in `player_game_stats`? Such gaps are the
silent-scrape-miss pattern from the 2026-05-12 incident — 5 series-transition
games (3 R1 G4 closeouts + 2 R2 G1 openers) sat with no per-game stats for
9-17 days because no alert fired.

This script runs on a GitHub Actions cron and:
  - exits non-zero on any finding (GitHub emails on workflow failure)
  - prints a structured report to stdout for the workflow log
  - escalates to Slack / PagerDuty via the existing AlertManager if
    CITRUS_ALERT_SLACK_WEBHOOK / CITRUS_ALERT_PAGERDUTY_KEY are configured
    (no requirement to set them; ungated env vars = log-only fallback)

Scope: playoffs only, per the §12.13 spec. Extend to regular season after
the Web Summit demo window.

Usage:
    python reconcile_playoff_game_stats.py --season 2025
    python reconcile_playoff_game_stats.py --season 2025 --force-fail   # test fire
"""

import sys
import os
import argparse
import logging
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.monitoring.alerting import AlertManager, SEVERITY_CRITICAL

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def find_missing_game_stats(db: SupabaseRest, season: int) -> list[dict]:
    """
    Return playoff games marked final that have no player_game_stats rows.

    Implements the §12.13 spec query:
        SELECT game_id FROM nhl_games
        WHERE status='final' AND game_type='playoff' AND season=<season>
          AND game_id NOT IN (SELECT DISTINCT game_id FROM player_game_stats);

    Done in two REST calls + a set diff to avoid needing a SECURITY DEFINER
    function (smallest possible intervention per the spec).
    """
    final_playoff = db.select(
        "nhl_games",
        select="game_id,game_date,game_type,status,home_team_id,away_team_id",
        filters=[
            ("status", "eq", "final"),
            ("game_type", "eq", "playoff"),
            ("season", "eq", season),
        ],
        order="game_date,game_id",
    )

    if not final_playoff:
        return []

    final_ids = [g["game_id"] for g in final_playoff]

    # Paginate the player_game_stats query — PostgREST defaults to ~1000 rows
    # per response, and per-game roster size (~36 skaters + 4 goalies = ~40 rows)
    # means the full set exceeds the page size at >25 final playoff games.
    # Without pagination the truncated response silently drops rows past row
    # 1000; any game whose rows fall entirely past the cutoff is reported as
    # false-positive missing. This was the 2026-05-20 → 2026-06-02 false-alarm
    # pattern that consumed 13 days of hourly failure noise.
    # See ENGINEERING.md §12.13 for the original alerter spec.
    ids_with_stats: set = set()
    PAGE = 1000
    offset = 0
    while True:
        page = db.select(
            "player_game_stats",
            select="game_id",
            filters=[("game_id", "in", final_ids)],
            limit=PAGE,
            offset=offset,
        )
        if not page:
            break
        ids_with_stats.update(r["game_id"] for r in page)
        if len(page) < PAGE:
            break
        offset += PAGE

    return [g for g in final_playoff if g["game_id"] not in ids_with_stats]


def format_report(missing: list[dict], season: int) -> str:
    lines = [
        "=" * 70,
        f"  PLAYOFF GAME-STATS RECONCILIATION  (season {season})",
        "=" * 70,
        f"  Checked at: {datetime.now(timezone.utc).isoformat()}",
        f"  Missing:    {len(missing)} game(s)",
        "",
    ]
    if not missing:
        lines.append("  OK — every final playoff game has player_game_stats rows.")
    else:
        lines.append(f"  {'GAME_ID':<12} {'DATE':<12} {'HOME':>5} {'AWAY':>5}")
        lines.append("  " + "-" * 40)
        for g in missing:
            lines.append(
                f"  {g['game_id']:<12} {g['game_date']:<12} "
                f"{g['home_team_id']:>5} {g['away_team_id']:>5}"
            )
        lines += [
            "",
            "  Backfill primitive: data-pipeline/debug/backfill_missing_playoff_games_2026_05_12.py",
            "  (clone, swap the GAME_IDS list, --dry-run, then --apply).",
        ]
    lines.append("=" * 70)
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconciliation alerter for missed playoff game scrapes (§12.13).")
    parser.add_argument("--season", type=int, default=2025, help="NHL season (default 2025)")
    parser.add_argument(
        "--force-fail",
        action="store_true",
        help="Test-fire mode: emit a synthetic finding to prove the alert path works end-to-end. "
             "Does NOT touch the database — synthesizes a fake game row and runs the alert + exit-nonzero "
             "flow exactly as a real finding would.",
    )
    args = parser.parse_args()

    if args.force_fail:
        logger.warning("--force-fail set: emitting synthetic finding for alert-path test.")
        missing = [{
            "game_id": 9999999999,
            "game_date": "1970-01-01",
            "game_type": "playoff",
            "status": "final",
            "home_team_id": 0,
            "away_team_id": 0,
        }]
    else:
        try:
            db = SupabaseRest()
        except ValueError as e:
            logger.error(f"Supabase client init failed: {e}")
            return 2  # config error, distinct from "found gaps"
        try:
            missing = find_missing_game_stats(db, args.season)
        except Exception as e:
            logger.exception(f"Reconciliation query failed: {e}")
            return 3  # query error, distinct from "found gaps"

    report = format_report(missing, args.season)
    print(report)

    if not missing:
        return 0

    # Findings: escalate to AlertManager (Slack + PagerDuty if configured,
    # always logs) and exit non-zero so GitHub Actions emails on failure.
    alerts = AlertManager()
    alerts.send(
        message=f"Playoff game-stats reconciliation: {len(missing)} game(s) missing player_game_stats",
        severity=SEVERITY_CRITICAL,
        details={
            "season": args.season,
            "missing_count": len(missing),
            "game_ids": [g["game_id"] for g in missing],
            "earliest_date": missing[0]["game_date"] if missing else None,
            "spec": "ENGINEERING.md §12.13",
            "force_fail": args.force_fail,
        },
        dedup_key=f"playoff_reconcile_{args.season}",
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
