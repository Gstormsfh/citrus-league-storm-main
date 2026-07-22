#!/usr/bin/env python3
"""Phase 0 / 0d-pre #6a: pilot retrofit on 5 strategic games.

One-shot script that re-processes 5 specific game_ids through
process_xg_stats.process_single_game_json — same call path that
run_daily_pbp_processing.py uses, but limited to the chosen pilot
set (vs the full unprocessed-games sweep).

Validates the typeCode 503→502 fix from 0d-pre #2 produces non-NULL
time_since_faceoff + 36 TOI columns on the existing 99K-row corpus
shape, before authorizing 6b/6c sweeps.

Usage:
    python scripts/_one_offs/phase0_pre6a_pilot.py

Pilot games (locked 2026-05-07):
    2025020652  early Jan 2026 (substitute for Oct gap)
    2025020339  Dec 2025 active scoring
    2025020873  Feb 2026 mid-season
    2025030131  Apr 2026 playoff (fresh-extract)
    2025020914  late-Feb regular (fresh-extract)
"""

import os
import sys
import time

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline", "acquisition"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline", "utils"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "scripts", "utilities"))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv
load_dotenv()

from data_pipeline.utils.supabase_rest import SupabaseRest

PILOT_GAMES = [2025020652, 2025020339, 2025020873, 2025030131, 2025020914]


def main():
    url = os.getenv("VITE_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        return 1

    db = SupabaseRest(url, key)

    # process_single_game_json deletes existing shots and re-inserts via
    # the patched data_acquisition._extract_shots_from_game logic.
    from process_xg_stats import process_single_game_json

    total_start = time.time()
    results = {}
    for idx, game_id in enumerate(PILOT_GAMES, 1):
        print(f"\n=== [{idx}/{len(PILOT_GAMES)}] game_id={game_id} ===")
        rows = db.select(
            "raw_nhl_data",
            select="raw_json",
            filters=[("game_id", "eq", game_id)],
            limit=1,
        )
        if not rows:
            print(f"  ERROR: no raw_nhl_data row for game {game_id}")
            results[game_id] = {"status": "missing_raw_json"}
            continue
        raw_json = rows[0]["raw_json"]

        t0 = time.time()
        try:
            result = process_single_game_json(raw_json, game_id)
            elapsed = time.time() - t0
            if result is None:
                print(f"  process_single_game_json returned None ({elapsed:.1f}s)")
                results[game_id] = {"status": "returned_none", "elapsed": elapsed}
            else:
                shots_returned = len(result) if hasattr(result, "__len__") else "?"
                print(f"  OK: {shots_returned} shots processed in {elapsed:.1f}s")
                results[game_id] = {
                    "status": "ok",
                    "shots": shots_returned,
                    "elapsed": elapsed,
                }
        except Exception as e:
            elapsed = time.time() - t0
            print(f"  ERROR after {elapsed:.1f}s: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            results[game_id] = {"status": "exception", "error": str(e), "elapsed": elapsed}

    total_elapsed = time.time() - total_start
    print(f"\n{'='*70}\nPilot complete in {total_elapsed:.1f}s")
    for gid, info in results.items():
        print(f"  {gid}: {info}")
    return 0 if all(r.get("status") == "ok" for r in results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
