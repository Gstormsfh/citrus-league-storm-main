#!/usr/bin/env python3
"""
fetch_pbp.py — W2 of the 9-season official-log rebuild.

For every game_id in a season slice of manifest.csv, fetches
  /v1/gamecenter/{id}/play-by-play  → raw_json
  /v1/gamecenter/{id}/boxscore       → boxscore_json

Upserts into public.raw_nhl_data with content_sha256 for change
detection. Fully resumable: games whose stored hash matches the freshly-
fetched bytes are skipped (idempotent full re-run).

Uses SupabaseRest with the truncation guard (select_exact) for the
pre-check "which games already have this content_sha256?" query, so a
short page cannot silently make the resumability check look complete.

Rate limit ~2 requests/sec/job. Retries: 3× exponential backoff on 5xx
/ 429 (already handled inside citrus_request). All errors on a single
game are logged and the run continues; end-of-season ledger writes
capture actual coverage.

Ledger writes, per season:
  raw_pbp        expected=manifest_count actual=count(distinct game_id) in raw_nhl_data for season
  pbp_nonempty   expected=manifest_count actual=count where plays array length > 0

Refuses without VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.utils.citrus_request import citrus_request


NHL_API_BASE = "https://api-web.nhle.com/v1"


def _sha256_of(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode("utf-8")).hexdigest()


def load_manifest_for_season(manifest_path: str, season: int) -> List[Dict[str, Any]]:
    with open(manifest_path, "r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        return [row for row in r if int(row.get("season", 0)) == season]


def existing_content_hashes(db: SupabaseRest, season: int) -> Dict[int, str]:
    """Return {game_id: content_sha256} for rows already in raw_nhl_data.
    Uses select_exact so a short page cannot lie about completeness."""
    # game_ids for a season fit inside [season*1_000_000, (season+1)*1_000_000)
    lo = season * 1_000_000
    hi = (season + 1) * 1_000_000
    all_rows: Dict[int, str] = {}
    offset = 0
    PAGE = 1000
    while True:
        rows = db.select_exact(
            "raw_nhl_data",
            select="game_id,content_sha256",
            filters=[("game_id", "gte", lo), ("game_id", "lt", hi)],
            limit=PAGE, offset=offset,
        )
        for r in rows:
            gid = r.get("game_id")
            if gid is not None:
                all_rows[int(gid)] = r.get("content_sha256") or ""
        if len(rows) < PAGE:
            break
        offset += PAGE
    return all_rows


def fetch_game(game_id: int) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Fetch PBP + boxscore JSON for one game. Returns (pbp, box) or (None, None)."""
    pbp = None
    box = None
    try:
        r_pbp = citrus_request(f"{NHL_API_BASE}/gamecenter/{game_id}/play-by-play", timeout=25)
        if r_pbp.status_code == 200:
            pbp = r_pbp.json()
    except Exception as e:
        print(f"  [warn] game {game_id} PBP fetch: {e}", flush=True)
    try:
        r_box = citrus_request(f"{NHL_API_BASE}/gamecenter/{game_id}/boxscore", timeout=25)
        if r_box.status_code == 200:
            box = r_box.json()
    except Exception as e:
        print(f"  [warn] game {game_id} boxscore fetch: {e}", flush=True)
    return pbp, box


def upsert_raw(db: SupabaseRest, game_id: int, game_date: str, pbp: Dict[str, Any],
               box: Optional[Dict[str, Any]], source_url: str, content_sha256: str) -> None:
    row = {
        "game_id": int(game_id),
        "game_date": game_date,
        "raw_json": pbp,
        "boxscore_json": box,
        "source_url": source_url,
        "content_sha256": content_sha256,
        "processed": False,  # extractor sets this true after successful extraction
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    db.upsert("raw_nhl_data", [row], on_conflict="game_id")


def record_audit(db: SupabaseRest, season: int, gate_name: str,
                 expected: Optional[int], actual: int, note: str = "") -> None:
    db.rpc("record_rebuild_audit", {
        "p_season": int(season),
        "p_gate_name": gate_name,
        "p_expected": expected,
        "p_actual": int(actual),
        "p_note": note[:1000] if note else "",
    })
    print(f"  [ledger] season={season} {gate_name}: expected={expected} actual={actual}",
          flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True,
                    help="Which season to fetch (single season per matrix job)")
    ap.add_argument("--manifest", type=str, default="manifest.csv",
                    help="Path to manifest.csv from W1")
    ap.add_argument("--rate-sleep", type=float, default=0.5,
                    help="Seconds between game fetches (default 0.5 → ~2/s)")
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap games processed (smoke tests)")
    args = ap.parse_args()

    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required", file=sys.stderr)
        return 1
    from urllib.parse import urlparse
    host = urlparse(url).hostname or ""

    manifest_rows = load_manifest_for_season(args.manifest, args.season)
    if args.limit:
        manifest_rows = manifest_rows[: args.limit]
    print("=" * 78)
    print(f"[BANNER] destination host: {host}")
    print(f"[BANNER] season: {args.season}  manifest rows: {len(manifest_rows)}")
    print(f"[BANNER] rate: 1 request per {args.rate_sleep}s (~{1/args.rate_sleep:.1f}/s)")
    print("=" * 78, flush=True)

    if not manifest_rows:
        print(f"[FATAL] no manifest rows for season {args.season}", file=sys.stderr)
        return 2

    db = SupabaseRest(url, key)
    print(f"[fetch] loading existing content hashes for season {args.season} ...", flush=True)
    existing = existing_content_hashes(db, args.season)
    print(f"[fetch] existing rows in raw_nhl_data for season {args.season}: {len(existing)}",
          flush=True)

    total = len(manifest_rows)
    upserted = 0
    skipped_unchanged = 0
    errored = 0
    last_progress = time.time()
    for i, m in enumerate(manifest_rows, 1):
        game_id = int(m["game_id"])
        game_date = m.get("date") or ""
        pbp, box = fetch_game(game_id)
        if pbp is None:
            errored += 1
            time.sleep(args.rate_sleep)
            continue
        sha = _sha256_of(pbp)
        if existing.get(game_id) == sha:
            skipped_unchanged += 1
        else:
            source_url = f"{NHL_API_BASE}/gamecenter/{game_id}/play-by-play"
            try:
                upsert_raw(db, game_id, game_date, pbp, box, source_url, sha)
                upserted += 1
            except Exception as e:
                errored += 1
                print(f"  [error] game {game_id} upsert: {e}", flush=True)
        time.sleep(args.rate_sleep)
        now = time.time()
        if now - last_progress >= 30:
            print(f"  [progress] {i}/{total} upserted={upserted} skipped={skipped_unchanged} errors={errored}",
                  flush=True)
            last_progress = now

    # Ledger writes
    # raw_pbp — distinct game_ids present for this season
    present = existing_content_hashes(db, args.season)
    record_audit(db, args.season, "raw_pbp",
                 expected=total, actual=len(present),
                 note=f"upserted={upserted} skipped_unchanged={skipped_unchanged} errors={errored}")

    # pbp_nonempty — how many stored PBPs have a non-empty plays array
    # Uses paginated select_exact to count reliably.
    print(f"[fetch] counting non-empty PBPs for season {args.season} ...", flush=True)
    nonempty = 0
    total_scanned = 0
    offset = 0
    PAGE = 500  # smaller page — raw_json is big
    lo = args.season * 1_000_000
    hi = (args.season + 1) * 1_000_000
    while True:
        rows = db.select_exact(
            "raw_nhl_data",
            select="game_id,raw_json",
            filters=[("game_id", "gte", lo), ("game_id", "lt", hi)],
            limit=PAGE, offset=offset,
        )
        for r in rows:
            total_scanned += 1
            rj = r.get("raw_json") or {}
            plays = rj.get("plays") if isinstance(rj, dict) else None
            if plays and len(plays) > 0:
                nonempty += 1
        if len(rows) < PAGE:
            break
        offset += PAGE
    record_audit(db, args.season, "pbp_nonempty",
                 expected=total, actual=nonempty,
                 note=f"scanned {total_scanned} rows")

    if errored > 0:
        print(f"[fetch] {errored} games errored — see logs above", file=sys.stderr)
        return 1 if errored > total * 0.05 else 0  # >5% failures = job fail
    return 0


if __name__ == "__main__":
    sys.exit(main())
