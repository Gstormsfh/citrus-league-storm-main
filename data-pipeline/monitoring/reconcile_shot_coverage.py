#!/usr/bin/env python3
"""
reconcile_shot_coverage.py — detect (and optionally heal) the three
gap classes surfaced by the Phase 0b investigation.

  no_payload    — nhl_games has status='final' but raw_nhl_data has no row.
                  Cause mode #3 from PHASE_0B_DIAGNOSTIC.md (April 17 → May 4
                  proxy_manager outage, plus early-April games that never made
                  it through the ingest workflow).
  stale_payload — raw_nhl_data row exists but raw_json.gameState != 'OFF'.
                  Cause mode #2 (FUT-stub capture defect — pre-game payloads
                  captured then never refreshed post-game).
  no_shots      — payload OK but raw_shots has no rows for the game.
                  Cause mode #1 (encoder-death from 0d-pre Bug C, now fixed
                  by 73382cc but historic gaps persist until healed).

Runs daily via .github/workflows/shot-coverage-reconciler.yml. Fail-red on
gaps (workflow email = alert channel) or on any heal failure. Reuses the
extract → score → save path from backfill_from_raw_payloads.py so healing
and live scraping share one code path (the 0b divergence lesson).

Modes:
    --report-only (default): detect + print + exit 0/2 (0 clean, 2 gaps)
    --heal --max-heal N   : heal up to N oldest gaps; exit 0/1
    --env-file PATH       : same pattern as the backfill script

Usage:
    python data-pipeline/monitoring/reconcile_shot_coverage.py --report-only
    python data-pipeline/monitoring/reconcile_shot_coverage.py --report-only --env-file .env.prod
    python data-pipeline/monitoring/reconcile_shot_coverage.py --heal --max-heal 15 --env-file .env.prod
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "scripts", "utilities"))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv

# Reuse the backfill script's heal helpers — private-by-convention within
# our repo, imported here rather than duplicated. Forking scoring/heal logic
# is exactly what caused the 0b regression; keep them one.
import backfill_from_raw_payloads as backfill  # noqa: E402

from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa: E402


logger = logging.getLogger(__name__)


def _batches(items: List[Any], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _paginated_select(db: SupabaseRest, table: str, **kwargs) -> List[Dict[str, Any]]:
    PAGE = 1000
    out: List[Dict[str, Any]] = []
    offset = 0
    while True:
        page = db.select(table, limit=PAGE, offset=offset, **kwargs)
        if not page:
            break
        out.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return out


def find_gaps(db: SupabaseRest, season_min: int = 2025) -> List[Dict[str, Any]]:
    """Return a list of {game_id, game_date, gap_type} for every final game
    that fails coverage. Empty list = clean."""
    all_games = _paginated_select(
        db,
        "nhl_games",
        select="game_id,game_date",
        filters=[("season", "gte", season_min), ("status", "eq", "final")],
        order="game_date,game_id",
    )
    if not all_games:
        return []

    all_ids = [g["game_id"] for g in all_games]
    id_to_date = {g["game_id"]: g["game_date"] for g in all_games}
    min_id, max_id = min(all_ids), max(all_ids)

    # game_id -> gameState (or None if no row). Batched IN queries stay under
    # PostgREST's URL-length ceiling.
    payload_state: Dict[int, Optional[str]] = {}
    for batch in _batches(all_ids, 200):
        rows = db.select(
            "raw_nhl_data",
            select="game_id,gameState:raw_json->>gameState",
            filters=[("game_id", "in", batch)],
            limit=len(batch),
        )
        for r in rows:
            payload_state[r["game_id"]] = r.get("gameState")

    # game_ids that have at least one raw_shots row. Range-scan by game_id
    # is cheaper than IN-list of 1400 items and gives the same coverage.
    have_shots: set = set()
    offset = 0
    PAGE = 1000
    while True:
        page = db.select(
            "raw_shots",
            select="game_id",
            filters=[("game_id", "gte", min_id), ("game_id", "lte", max_id)],
            limit=PAGE,
            offset=offset,
            order="game_id",
        )
        if not page:
            break
        have_shots.update(r["game_id"] for r in page)
        if len(page) < PAGE:
            break
        offset += PAGE

    # Use the same terminal-state set the backfill script uses. Diverging here
    # would recreate the exact class of bug 0b was — a healer that considers a
    # payload valid while the detector calls it stale (or vice versa).
    terminal = backfill._TERMINAL_GAME_STATES

    gaps: List[Dict[str, Any]] = []
    for gid in all_ids:
        state = payload_state.get(gid)
        if state is None:
            gap_type = "no_payload"
        elif state not in terminal:
            gap_type = "stale_payload"
        elif gid not in have_shots:
            gap_type = "no_shots"
        else:
            continue
        gaps.append({"game_id": gid, "game_date": id_to_date[gid], "gap_type": gap_type, "state": state})
    return gaps


def format_report(gaps: List[Dict[str, Any]], season_min: int, project_ref: str) -> str:
    lines = [
        "=" * 72,
        "  SHOT COVERAGE RECONCILIATION",
        "=" * 72,
        f"  Target project: {project_ref}",
        f"  Season window:  {season_min}+",
        f"  Checked at:     {datetime.now(timezone.utc).isoformat()}",
        f"  Gaps found:     {len(gaps)}",
        "",
    ]
    if not gaps:
        lines.append("  OK — every final game has a fresh payload and shot rows.")
    else:
        by_type: Dict[str, int] = {}
        for g in gaps:
            by_type[g["gap_type"]] = by_type.get(g["gap_type"], 0) + 1
        lines.append(f"  By type: {by_type}")
        lines.append("")
        lines.append(f"  {'GAME_ID':<12} {'DATE':<12} {'GAP_TYPE':<14} {'STATE'}")
        lines.append("  " + "-" * 50)
        for g in gaps[:100]:
            state = g["state"] if g["state"] is not None else "-"
            lines.append(
                f"  {g['game_id']:<12} {g['game_date']:<12} {g['gap_type']:<14} {state}"
            )
        if len(gaps) > 100:
            lines.append(f"  ... {len(gaps) - 100} more")
    lines.append("=" * 72)
    return "\n".join(lines)


def heal_gap(db: SupabaseRest, gap: Dict[str, Any], warn_capture: backfill.WarningCapture) -> Dict[str, Any]:
    """Heal one gap by delegating to the backfill script's process_one.
    Refetch for no_payload/stale_payload; replay for no_shots. Raises on
    failure (fail-stop is inherited from process_one)."""
    refetch = gap["gap_type"] in ("no_payload", "stale_payload")
    return backfill._process_one(
        db,
        gap["game_id"],
        dry_run=False,
        refetch=refetch,
        warn_capture=warn_capture,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--report-only", action="store_true", default=True,
                      help="detect + print + exit (default; exits 2 if any gap)")
    mode.add_argument("--heal", action="store_true",
                      help="heal up to --max-heal oldest gaps; exit 0 on full success, 1 on any heal failure or cap exceeded")
    parser.add_argument("--max-heal", type=int, default=15,
                        help="max gaps to heal in a single --heal run (default 15). Exceeding this is treated as structural — humans should investigate cause.")
    parser.add_argument("--season-min", type=int, default=2025,
                        help="minimum NHL season to check (default 2025)")
    parser.add_argument("--env-file", type=str, default=os.path.join(_REPO_ROOT, ".env"),
                        help="path to .env with Supabase URL + service role key (default: repo-root .env)")
    args = parser.parse_args()

    env_path = os.path.abspath(args.env_file)
    if not os.path.exists(env_path):
        raise SystemExit(f"--env-file not found: {env_path}")
    load_dotenv(env_path, override=True, encoding="utf-8-sig")

    SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

    project_ref = backfill._parse_project_ref(SUPABASE_URL)
    is_heal = args.heal  # explicit --heal overrides the default --report-only

    print("=" * 72)
    print("  reconcile_shot_coverage.py")
    print(f"  Env file:       {env_path}")
    print(f"  Target project: {project_ref}  ({SUPABASE_URL})")
    print(f"  Mode:           {'HEAL (max ' + str(args.max_heal) + ')' if is_heal else 'REPORT-ONLY'}")
    print(f"  Season window:  {args.season_min}+")
    print("=" * 72)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

    try:
        gaps = find_gaps(db, season_min=args.season_min)
    except Exception as e:
        logger.exception(f"Detection query failed: {e}")
        return 3

    print(format_report(gaps, args.season_min, project_ref))

    if not gaps:
        return 0

    if not is_heal:
        # Report-only: gaps present is the failure signal for the cron.
        return 2

    if len(gaps) > args.max_heal:
        print(f"\nCAP EXCEEDED: {len(gaps)} gaps found, --max-heal={args.max_heal}. "
              f"Refusing to heal — structural outage suspected. Investigate cause first.")
        return 1

    warn_capture = backfill.WarningCapture()
    logging.getLogger("data_pipeline.acquisition.data_acquisition").addHandler(warn_capture)
    logging.getLogger().addHandler(warn_capture)

    print(f"\nHealing {len(gaps)} gap(s):")
    started = time.time()
    healed = 0
    failures: List[Tuple[Dict[str, Any], str]] = []
    for i, gap in enumerate(gaps, 1):
        print(f"\n[{i}/{len(gaps)}] game_id={gap['game_id']} gap_type={gap['gap_type']}")
        try:
            result = heal_gap(db, gap, warn_capture)
            healed += 1
            print(f"  [OK] rows_saved={result['rows_saved']} source={result['payload_source']}")
        except Exception as e:
            print(f"  [FAIL] {type(e).__name__}: {e}")
            failures.append((gap, f"{type(e).__name__}: {e}"))
            # Fail-stop: first heal failure halts the run.
            break

    elapsed = time.time() - started
    print("\n" + "=" * 72)
    print("  Heal summary")
    print("=" * 72)
    print(f"  Attempted: {healed + len(failures)}  Healed: {healed}  Failed: {len(failures)}")
    print(f"  Elapsed:   {elapsed:.1f}s")
    if failures:
        print(f"  First failure: game_id={failures[0][0]['game_id']} — {failures[0][1]}")
        return 1
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
