#!/usr/bin/env python3
"""
backfill_playoff_stats.py — W4 rider of the 9-season rebuild.

Runs the existing stats extractor over exactly the 20 game_ids that
public.check_pipeline_coverage() flags as `player_stats_missing/playoff`.
After the W2 fetch populates their raw_nhl_data rows, the stats
backfill produces the player_game_stats rows that were never captured
in-season.

Ledger:
  record_rebuild_audit(2025, 'playoff_stats_backfill', 20, <games with stat rows>).

Closes both standing coverage failures (play_by_play_missing/playoff/20
and player_stats_missing/playoff/20) honestly — no exclusions added.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from typing import List

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest


# From FINAL FOUR Task C2 handoff — 20 exact playoff game_ids
PLAYOFF_20 = [
    2025030117, 2025030147, 2025030155, 2025030156, 2025030157,
    2025030167, 2025030177, 2025030187, 2025030225, 2025030226,
    2025030227, 2025030236, 2025030237, 2025030247, 2025030316,
    2025030317, 2025030325, 2025030326, 2025030327, 2025030417,
]


def record_audit(db: SupabaseRest, season: int, gate_name: str,
                 expected, actual: int, note: str = "") -> None:
    db.rpc("record_rebuild_audit", {
        "p_season": int(season),
        "p_gate_name": gate_name,
        "p_expected": expected,
        "p_actual": int(actual),
        "p_note": note[:1000] if note else "",
    })
    print(f"  [ledger] season={season} {gate_name}: expected={expected} actual={actual}",
          flush=True)


def games_with_stats(db: SupabaseRest, game_ids: List[int]) -> int:
    """Count how many of the target game_ids have at least one player_game_stats row."""
    hits = 0
    for gid in game_ids:
        rows = db.select_exact(
            "player_game_stats",
            select="player_id",
            filters=[("game_id", "eq", gid)],
            limit=1,
        )
        if rows:
            hits += 1
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required", file=sys.stderr)
        return 1
    from urllib.parse import urlparse
    host = urlparse(url).hostname or ""

    print("=" * 78)
    print(f"[BANNER] destination host: {host}")
    print(f"[BANNER] backfilling stats for {len(PLAYOFF_20)} playoff game_ids")
    print(f"[BANNER] dry-run: {args.dry_run}")
    print("=" * 78, flush=True)

    db = SupabaseRest(url, key)
    scraper = os.path.join(
        _REPO_ROOT, "data-pipeline", "acquisition", "scrape_per_game_nhl_stats.py",
    )

    if args.dry_run:
        pre = games_with_stats(db, PLAYOFF_20)
        print(f"[dry-run] {pre} of {len(PLAYOFF_20)} games already have stats", flush=True)
        return 0

    # scrape_per_game_nhl_stats.py takes a date range and pulls games from
    # nhl_games. Convert each game_id to its date via nhl_games and
    # invoke per-date. Each per-date run picks up whichever games from
    # nhl_games fall on that date — CITRUS_MAX_GAMES_PER_RUN provides
    # the "refuse if we grab more than expected" gate from #D-05.
    dates = set()
    for gid in PLAYOFF_20:
        rows = db.select("nhl_games", select="game_date",
                         filters=[("game_id", "eq", gid)], limit=1)
        if rows:
            dates.add(rows[0]["game_date"])
    print(f"[backfill] target dates: {sorted(dates)}", flush=True)

    env = os.environ.copy()
    env["CITRUS_MAX_GAMES_PER_RUN"] = "8"  # playoff nights are ≤4 games typically
    for d in sorted(dates):
        cmd = [sys.executable, scraper, d, d]
        print(f"[backfill] running: {' '.join(cmd)}", flush=True)
        proc = subprocess.run(cmd, env=env)
        if proc.returncode not in (0, 3):
            # 3 = refuse-gate fired; everything else is a real failure
            print(f"[warn] scraper exited {proc.returncode} for {d}", file=sys.stderr)
        time.sleep(2)

    hits = games_with_stats(db, PLAYOFF_20)
    record_audit(db, 2025, "playoff_stats_backfill",
                 expected=len(PLAYOFF_20), actual=hits,
                 note=f"20 exact game_ids from check_pipeline_coverage()")

    if hits < len(PLAYOFF_20):
        print(f"[warn] {len(PLAYOFF_20) - hits} games still missing stats", file=sys.stderr)
        return 1
    print(f"[OK] all {hits}/{len(PLAYOFF_20)} playoff games now have stats", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
