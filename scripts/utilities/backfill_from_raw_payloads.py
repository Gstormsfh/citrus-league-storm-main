#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: UTILITY
# Purpose:     Phase 0b backfill — replay stored raw_nhl_data payloads through the
#              fixed extract → score → save path. General payload-replay tool.
# Last active: 2026-07-21
# Invoked:     manual, per-run:
#                python scripts/utilities/backfill_from_raw_payloads.py \
#                    --game-id 2025030416 [--dry-run] [--refetch]
#                python scripts/utilities/backfill_from_raw_payloads.py \
#                    --game-ids-file /tmp/0b_backfill_inventory.json [--dry-run]
# Reads:       raw_nhl_data (payloads), .env (Supabase URL + service role key),
#              NHL API (only when --refetch is used for games missing a payload)
# Writes:      raw_shots (via data_acquisition.process_game_from_raw_data),
#              raw_nhl_data (only under --refetch, to store the fresh payload)
# ────────────────────────────────────────────────────────────
"""
Phase 0b backfill: replay stored raw PBP payloads through the fixed extraction
path so games that landed with 0 shots (encoder regression from 0d-pre Bug C)
get reprocessed without re-hitting the NHL API.

Design intent: call data_acquisition.process_game_from_raw_data directly.
Do NOT fork the scoring logic. The 0b root cause was a divergence between
runtime scoring (fillna('unknown')) and training-script scoring
(fillna('OTHER')); the fix restored parity, and this script keeps parity by
sharing the module's real code path.

Fail-stop by design: in backfill we want to see every failure, not power
through with partial success.

Usage:
    # Single game, dry-run (no writes)
    python scripts/utilities/backfill_from_raw_payloads.py \
        --game-id 2025030416 --dry-run

    # Single game, live
    python scripts/utilities/backfill_from_raw_payloads.py --game-id 2025030416

    # Batch from inventory JSON
    python scripts/utilities/backfill_from_raw_payloads.py \
        --game-ids-file /tmp/0b_backfill_inventory.json

    # Refetch a game whose payload isn't in raw_nhl_data
    python scripts/utilities/backfill_from_raw_payloads.py \
        --game-id 2025021222 --refetch
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv

load_dotenv(os.path.join(_REPO_ROOT, ".env"), override=True)

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.acquisition import data_acquisition as da


# --- Warning-capture handler ---------------------------------------------------
# The encoder's defensive wrap emits WARNING logs when it maps unseen labels.
# Capture them so the per-game report line can name the labels that fired.

class WarningCapture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.records: List[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)

    def drain(self) -> List[str]:
        msgs = [r.getMessage() for r in self.records]
        self.records.clear()
        return msgs


def _parse_project_ref(url: str) -> str:
    # https://<ref>.supabase.co → <ref>
    try:
        return url.split("//", 1)[1].split(".", 1)[0]
    except Exception:
        return "<unparseable>"


def _load_game_ids(args: argparse.Namespace) -> List[int]:
    if args.game_id is not None:
        return [args.game_id]
    if not args.game_ids_file:
        raise SystemExit("Provide either --game-id or --game-ids-file.")
    with open(args.game_ids_file, "r", encoding="utf-8") as f:
        payload = json.load(f)
    ids: List[int] = []
    if isinstance(payload, list):
        for entry in payload:
            ids.append(int(entry["game_id"] if isinstance(entry, dict) else entry))
    elif isinstance(payload, dict):
        # Inventory-style: has "replay_set" and/or "refetch_set" arrays of {game_id, ...}
        for key in ("replay_set", "refetch_set"):
            for entry in payload.get(key, []):
                ids.append(int(entry["game_id"]))
        if not ids and "game_ids" in payload:
            ids = [int(x) for x in payload["game_ids"]]
    else:
        raise SystemExit(f"Unrecognized --game-ids-file structure: {type(payload).__name__}")
    if not ids:
        raise SystemExit("No game_ids found in --game-ids-file.")
    return ids


def _load_payload(db: SupabaseRest, game_id: int) -> Optional[Dict[str, Any]]:
    rows = db.select(
        "raw_nhl_data",
        select="raw_json",
        filters=[("game_id", "eq", game_id)],
        limit=1,
    )
    if not rows:
        return None
    return rows[0].get("raw_json")


def _refetch_payload(game_id: int, db: SupabaseRest, cache: bool) -> Dict[str, Any]:
    # Plain requests, not data_pipeline.utils.citrus_request: the latter mandates
    # proxy-rotation env vars intended for the high-frequency live scraper.
    # Backfill is at most ~50 one-shot fetches — well under any rate limit.
    import requests

    url = f"{da.NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"
    headers = {"User-Agent": "citrus-backfill/0b (contact: gstormsff@gmail.com)"}
    response = requests.get(url, timeout=15, headers=headers)
    response.raise_for_status()
    raw_data = response.json()
    if cache:
        game_date = raw_data.get("gameDate")  # NOT NULL in schema
        if not game_date:
            raise RuntimeError(f"Game {game_id}: NHL payload missing gameDate — cannot upsert to raw_nhl_data")
        db.upsert(
            "raw_nhl_data",
            [{"game_id": game_id, "game_date": game_date, "raw_json": raw_data}],
            on_conflict="game_id",
        )
    return raw_data


def _process_one(
    db: SupabaseRest,
    game_id: int,
    dry_run: bool,
    refetch: bool,
    warn_capture: WarningCapture,
) -> Dict[str, Any]:
    """Process one game. Raises on failure (backfill fail-stop)."""
    raw_data = _load_payload(db, game_id)
    payload_source = "raw_nhl_data"
    if raw_data is None:
        if not refetch:
            raise RuntimeError(
                f"Game {game_id}: no payload in raw_nhl_data; rerun with --refetch to fetch from NHL API"
            )
        # Dry-run keeps the zero-writes invariant: fetch to memory only,
        # skip the raw_nhl_data cache write. Live mode caches so subsequent
        # runs don't refetch.
        cache_after_fetch = not dry_run
        raw_data = _refetch_payload(game_id, db, cache=cache_after_fetch)
        payload_source = (
            "NHL API (stored to raw_nhl_data)"
            if cache_after_fetch
            else "NHL API (dry-run — would cache to raw_nhl_data)"
        )

    warn_capture.drain()  # clear any prior warnings before this game

    if dry_run:
        # Full extract → score path via the module, save monkey-patched to no-op.
        # Exercises the encoder fix + scoring so dry-run reflects real behavior;
        # only the DB write is skipped.
        original_save = da._save_shots_to_database
        saved_rows: List[int] = []

        def _noop_save(df_shots, db_client, game_id):
            saved_rows.append(len(df_shots))

        da._save_shots_to_database = _noop_save
        try:
            result_df = da.process_game_from_raw_data(game_id, raw_data, db)
        finally:
            da._save_shots_to_database = original_save

        return {
            "game_id": game_id,
            "payload_source": payload_source,
            "dry_run": True,
            "rows_extracted": int(len(result_df)) if result_df is not None else 0,
            "rows_saved": 0,
            "rows_would_save": saved_rows[0] if saved_rows else 0,
            "unseen_warnings": warn_capture.drain(),
        }

    result_df = da.process_game_from_raw_data(game_id, raw_data, db)
    rows_saved = int(len(result_df)) if result_df is not None else 0
    return {
        "game_id": game_id,
        "payload_source": payload_source,
        "dry_run": False,
        "rows_extracted": rows_saved,  # extraction+scoring returns df on save
        "rows_saved": rows_saved,
        "unseen_warnings": warn_capture.drain(),
    }


def _parse_unseen_labels(msg: str) -> List[str]:
    # Format from da: "... last_event_category unseen by encoder (['DELPEN', 'PEND']) — ..."
    import re
    m = re.search(r"unseen by encoder \((\[[^\]]*\])\)", msg)
    if not m:
        return []
    try:
        # eval-safe: repr of a list of str literals from our own code
        return json.loads(m.group(1).replace("'", '"'))
    except Exception:
        return []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--game-id", type=int, help="single game_id to process")
    src.add_argument("--game-ids-file", type=str, help="path to JSON file with list of game_ids or inventory-style {replay_set, refetch_set}")
    parser.add_argument("--dry-run", action="store_true", help="extract + summarize; no writes")
    parser.add_argument("--refetch", action="store_true", help="for games without a stored payload, fetch fresh from NHL API and store to raw_nhl_data")
    args = parser.parse_args()

    SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

    project_ref = _parse_project_ref(SUPABASE_URL)
    game_ids = _load_game_ids(args)

    # Startup banner — every run surfaces its target and scope.
    print("=" * 72)
    print("  backfill_from_raw_payloads.py")
    print(f"  Target project: {project_ref}  ({SUPABASE_URL})")
    print(f"  Mode:           {'DRY-RUN' if args.dry_run else 'LIVE'}"
          f"{'  (--refetch enabled)' if args.refetch else ''}")
    print(f"  Games:          {len(game_ids)}")
    print("=" * 72)

    # Wire warning capture into the data_acquisition logger
    warn_capture = WarningCapture()
    da_logger = logging.getLogger("data_pipeline.acquisition.data_acquisition")
    da_logger.addHandler(warn_capture)
    # Also root, in case the module logs via root elsewhere
    logging.getLogger().addHandler(warn_capture)
    # Ensure module info/warning messages surface
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

    results: List[Dict[str, Any]] = []
    aggregate_unseen: Dict[str, int] = {}
    started = time.time()

    for idx, game_id in enumerate(game_ids, 1):
        print(f"\n[{idx}/{len(game_ids)}] game_id={game_id}")
        try:
            result = _process_one(db, game_id, args.dry_run, args.refetch, warn_capture)
        except Exception as e:
            print(f"  ERROR: {type(e).__name__}: {e}")
            print(f"\nFAIL-STOP after {idx - 1} successful games. Aborting run.")
            raise

        results.append(result)
        unseen_msgs = result["unseen_warnings"]
        unseen_labels_all: List[str] = []
        for m in unseen_msgs:
            unseen_labels_all.extend(_parse_unseen_labels(m))
        for lbl in unseen_labels_all:
            aggregate_unseen[lbl] = aggregate_unseen.get(lbl, 0) + 1

        marker = "DRY" if result["dry_run"] else "SAVED"
        would = f" rows_would_save={result['rows_would_save']}" if result.get("dry_run") else ""
        print(
            f"  [{marker}] rows_extracted={result['rows_extracted']} "
            f"rows_saved={result['rows_saved']}{would} "
            f"source={result['payload_source']} "
            f"unseen_warnings={len(unseen_msgs)}"
            + (f" labels={sorted(set(unseen_labels_all))}" if unseen_labels_all else "")
        )

    elapsed = time.time() - started
    print("\n" + "=" * 72)
    print("  Summary")
    print("=" * 72)
    total_saved = sum(r["rows_saved"] for r in results)
    total_extracted = sum(r["rows_extracted"] for r in results)
    print(f"  Games processed:   {len(results)}")
    print(f"  Games succeeded:   {len(results)}")  # fail-stop means failures don't reach here
    print(f"  Rows extracted:    {total_extracted}")
    print(f"  Rows saved:        {total_saved}"
          + ("  (DRY-RUN — no writes)" if args.dry_run else ""))
    if aggregate_unseen:
        print(f"  Unseen-label warnings by label:")
        for lbl in sorted(aggregate_unseen, key=lambda k: (-aggregate_unseen[k], k)):
            print(f"    {lbl}: {aggregate_unseen[lbl]} game(s)")
    else:
        print(f"  Unseen-label warnings: none")
    print(f"  Elapsed:           {elapsed:.1f}s")
    print("=" * 72)

    return 0


if __name__ == "__main__":
    sys.exit(main())
