#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: UTILITY
# Purpose:     Phase 0c step 4c (fill phase) — copy moat + companion columns
#              from staging.raw_shots into prod._moat_transfer.
# Last active: 2026-07-31
# Invoked:     manual per-season runs (resumable):
#                python scripts/utilities/transfer_moat_to_prod.py \
#                    --season 2020 --target-env-file .env.prod
# Reads:       (STAGING) raw_shots — WHERE game_id = X AND event_id IS NOT NULL
# Writes:      (PROD)    _moat_transfer  — plain INSERT, per-game batches
# NEVER:       touches raw_shots on either side. The apply step (SQL
#              UPDATE ... FROM) is intentionally separate.
# ────────────────────────────────────────────────────────────
"""
transfer_moat_to_prod.py

Copies the 17 moat + companion columns computed in staging (Phase 0c) into a
TRANSIENT prod table `_moat_transfer` for later application to raw_shots via a
separate SQL step.

Iteration is PER-GAME (never id-keyset), because at end-of-season boundaries
an id-keyset scan across staging raw_shots hits Postgres statement timeout
(57014) even with a game_id BETWEEN bound — the planner keeps scanning
forward under `id > last_id` looking for more matching rows. Per-game queries
are cheap (~50-150 rows per game, bounded by game_id equality) and
predictably fast.

RESUMABLE / IDEMPOTENT — required so a failure mid-run does not force a
destructive truncate: at season start we read the already-present game_ids
from prod (SELECT DISTINCT game_id FROM _moat_transfer WHERE season = X)
and skip those games. A re-run after any failure is safe to fire immediately
without deduping across INSERT boundaries.

The 22 columns transferred (5 unique-constraint keys + season + 17 payload)
are EXACTLY the set the historical loader omits from raw_shots writes
(`load_historical_shots_csv.py` MOAT_FEATURES_NOT_LOADED_BY_THIS_SCRIPT
+ COMPANION_COLS_MUST_BE_ABSENT + the derived key columns). See §15.

Two different Supabase projects are addressed in one run. To avoid the
`load_dotenv(override=True)` global-mutation footgun, env files are parsed
via `dotenv_values` (returns a dict; does not touch os.environ), then the
URL/key are passed to SupabaseRest explicitly.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any, Dict, List, Optional, Set, Tuple

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401

from dotenv import dotenv_values

from data_pipeline.utils.supabase_rest import SupabaseRest


# 5 unique-constraint key columns (mirror raw_shots_unique_shot)
KEY_COLS: Tuple[str, ...] = (
    "game_id", "player_id", "shot_x", "shot_y", "shot_type_code",
)

# 7 moat + 10 companion columns — must match the historical loader's OMIT list
# (load_historical_shots_csv.py) EXACTLY. Any divergence means a column is
# double-written or orphaned across the 4b/4c pipeline.
PAYLOAD_COLS: Tuple[str, ...] = (
    # 7 moat
    "has_pass_before_shot", "pass_quality_score", "pass_immediacy_score",
    "goalie_movement_score", "pass_zone_encoded",
    "pass_lateral_distance", "pass_to_net_distance",
    # 10 companions
    "passer_id", "pass_x", "pass_y", "pass_angle",
    "time_before_shot", "normalized_lateral_distance",
    "zone_relative_distance", "pass_zone",
    "event_id", "sort_order",
)

# 23 columns written into _moat_transfer (season is stored so the apply step
# can shard by season and audit per-season row counts)
INSERT_COLS: Tuple[str, ...] = KEY_COLS + ("season",) + PAYLOAD_COLS
assert len(INSERT_COLS) == 23, f"expected 23 columns, got {len(INSERT_COLS)}"


def _parse_ref(url: str) -> str:
    try:
        if url.startswith("https://") and ".supabase.co" in url:
            return url[len("https://"):url.index(".supabase.co")]
    except Exception:
        pass
    return "<unset>"


def _load_env_file(path: Optional[str]) -> Dict[str, str]:
    if path is None:
        vals = dotenv_values(".env", encoding="utf-8-sig") if os.path.exists(".env") else {}
    else:
        p = os.path.abspath(path)
        if not os.path.exists(p):
            raise SystemExit(f"env file not found: {p}")
        vals = dotenv_values(p, encoding="utf-8-sig")
    url = vals.get("VITE_SUPABASE_URL") or vals.get("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = vals.get("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(
            f"missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (env_file={path or '.env'})"
        )
    return {"VITE_SUPABASE_URL": url, "SUPABASE_SERVICE_ROLE_KEY": key}


def _fmt(sec: float) -> str:
    if sec < 60:
        return f"{sec:.1f}s"
    if sec < 3600:
        return f"{sec/60:.1f}m"
    return f"{sec/3600:.2f}h"


def _get_game_ids_for_season(source: SupabaseRest, season: int) -> List[int]:
    """Return distinct game_ids in staging for the given season, filtered to
    featured rows only (event_id IS NOT NULL). Paginated by game_id keyset.

    Uses a SINGLE lower-bound filter on game_id (upper bound enforced in
    Python) because SupabaseRest._build_query collapses multi-filter-per-
    column (last-wins on params dict) — passing both gte + lte on game_id
    would drop the lower bound and scan the whole table."""
    season_min_gid = season * 1_000_000
    season_max_gid = (season + 1) * 1_000_000 - 1
    seen: Set[int] = set()
    # Cursor starts just below the season's min game_id.
    last_gid: int = season_min_gid - 1
    PAGE = 1000
    while True:
        rows = source.select(
            "raw_shots",
            select="game_id",
            filters=[
                ("game_id", "gt", last_gid),
                ("event_id", "gte", 0),
            ],
            limit=PAGE,
            order="game_id",
        )
        if not rows:
            break
        page_gids = sorted({int(r["game_id"]) for r in rows if r.get("game_id") is not None})
        if not page_gids or page_gids[0] > season_max_gid:
            break
        in_range = [g for g in page_gids if g <= season_max_gid]
        seen.update(in_range)
        # Stop if any game_id in this page exceeds season_max_gid — we've
        # walked off the end of the season.
        if page_gids[-1] > season_max_gid:
            break
        last_gid = page_gids[-1]
        if len(rows) < PAGE:
            break
    return sorted(seen)


def _fetch_game(source: SupabaseRest, game_id: int, select_cols: str) -> List[Dict[str, Any]]:
    """Fetch all featured rows for one game_id — bounded (~50-200 rows)."""
    return source.select(
        "raw_shots",
        select=select_cols,
        filters=[("game_id", "eq", game_id), ("event_id", "gte", 0)],
        limit=1000,
        order="id",
    )


def _already_transferred_games(target: SupabaseRest, season: int) -> Set[int]:
    """Read distinct game_ids already present in prod._moat_transfer for
    this season. Keyset-paginated on game_id. Single-lower-bound filter
    plus in-Python upper bound (same reason as _get_game_ids_for_season)."""
    season_min_gid = season * 1_000_000
    season_max_gid = (season + 1) * 1_000_000 - 1
    seen: Set[int] = set()
    last_gid: int = season_min_gid - 1
    PAGE = 1000
    while True:
        rows = target.select(
            "_moat_transfer",
            select="game_id",
            filters=[
                ("season", "eq", season),
                ("game_id", "gt", last_gid),
            ],
            limit=PAGE,
            order="game_id",
        )
        if not rows:
            break
        page_gids = sorted({int(r["game_id"]) for r in rows if r.get("game_id") is not None})
        if not page_gids or page_gids[0] > season_max_gid:
            break
        in_range = [g for g in page_gids if g <= season_max_gid]
        seen.update(in_range)
        if page_gids[-1] > season_max_gid:
            break
        last_gid = page_gids[-1]
        if len(rows) < PAGE:
            break
    return seen


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--season", type=int, required=True,
                    help="4-digit season start year (e.g. 2020).")
    ap.add_argument("--target-env-file", type=str, required=True,
                    help="Env file for PROD target (typically .env.prod).")
    ap.add_argument("--source-env-file", type=str, default=None,
                    help="Env file for STAGING source. Default = load .env in cwd.")
    ap.add_argument("--insert-batch", type=int, default=1000,
                    help="Rows per INSERT batch into prod (default 1000).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Read + count from staging; do NOT insert into prod.")
    args = ap.parse_args()

    src_env = _load_env_file(args.source_env_file)
    tgt_env = _load_env_file(args.target_env_file)

    if src_env["VITE_SUPABASE_URL"] == tgt_env["VITE_SUPABASE_URL"]:
        raise SystemExit(
            "REFUSING TO RUN: source and target URLs are identical. "
            "This script is a cross-project copy — same-project runs are unsafe."
        )

    source = SupabaseRest(src_env["VITE_SUPABASE_URL"], src_env["SUPABASE_SERVICE_ROLE_KEY"])
    target = SupabaseRest(tgt_env["VITE_SUPABASE_URL"], tgt_env["SUPABASE_SERVICE_ROLE_KEY"])

    src_ref = _parse_ref(src_env["VITE_SUPABASE_URL"])
    tgt_ref = _parse_ref(tgt_env["VITE_SUPABASE_URL"])

    print("=" * 80)
    print(f"transfer_moat_to_prod  season={args.season}")
    print(f"  SOURCE (staging): {src_ref}")
    print(f"  TARGET (prod):    {tgt_ref}")
    print(f"  Mode:             {'DRY-RUN (no writes)' if args.dry_run else 'LIVE (writes to _moat_transfer)'}")
    print(f"  Insert batch:     {args.insert_batch}")
    print(f"  Columns written:  {len(INSERT_COLS)} (5 key + season + 17 payload)")
    print("=" * 80, flush=True)

    started = time.time()

    # Step 1: enumerate the season's featured game_ids from staging.
    print(f"  [1/3] Enumerating featured game_ids in staging for season {args.season}...", flush=True)
    all_games = _get_game_ids_for_season(source, args.season)
    print(f"        found {len(all_games)} distinct game_ids "
          f"(range: {all_games[0] if all_games else 'n/a'} .. {all_games[-1] if all_games else 'n/a'})",
          flush=True)

    # Step 2: read already-present game_ids from prod (resume).
    print(f"  [2/3] Reading already-present game_ids from prod _moat_transfer...", flush=True)
    already = _already_transferred_games(target, args.season)
    to_process = [gid for gid in all_games if gid not in already]
    print(f"        {len(already)} games already present, {len(to_process)} games to process",
          flush=True)

    # Step 3: iterate games, fetch featured rows, insert in batches.
    print(f"  [3/3] Processing games...", flush=True)
    select_cols = ",".join(INSERT_COLS)  # do NOT include 'id' — target has no id col
    rows_read_total = 0
    rows_inserted_total = 0
    games_processed = 0
    batch_buffer: List[Dict[str, Any]] = []
    last_progress = time.time()

    def _flush() -> bool:
        nonlocal rows_inserted_total
        if not batch_buffer:
            return True
        if args.dry_run:
            rows_inserted_total += len(batch_buffer)
            batch_buffer.clear()
            return True
        try:
            target.insert("_moat_transfer", batch_buffer)
        except Exception as e:
            print(f"\nERROR insert to prod._moat_transfer (batch {len(batch_buffer)} rows): {e}",
                  flush=True)
            return False
        rows_inserted_total += len(batch_buffer)
        batch_buffer.clear()
        return True

    for gid in to_process:
        try:
            page = _fetch_game(source, gid, select_cols)
        except Exception as e:
            print(f"\nERROR fetching game {gid}: {e}", flush=True)
            _flush()
            return 2
        if not page:
            games_processed += 1
            continue
        rows_read_total += len(page)
        for row in page:
            batch_buffer.append({c: row.get(c) for c in INSERT_COLS})
        # Flush when buffer reaches insert_batch
        while len(batch_buffer) >= args.insert_batch:
            head, tail = batch_buffer[:args.insert_batch], batch_buffer[args.insert_batch:]
            batch_buffer[:] = head
            if not _flush():
                return 2
            batch_buffer.extend(tail)
        games_processed += 1

        now = time.time()
        if now - last_progress >= 10:
            elapsed = now - started
            per_game = elapsed / max(1, games_processed)
            remaining = (len(to_process) - games_processed) * per_game
            print(
                f"  [progress] games={games_processed}/{len(to_process)} "
                f"read={rows_read_total:,} pending_buffer={len(batch_buffer):,} "
                f"inserted={rows_inserted_total:,} elapsed={_fmt(elapsed)} "
                f"eta={_fmt(remaining)}",
                flush=True,
            )
            last_progress = now

    # Flush final partial batch
    if not _flush():
        return 2

    elapsed = time.time() - started
    print("\n" + "=" * 80)
    print(f"Summary — season {args.season}")
    print("=" * 80)
    print(f"  games total (staging):       {len(all_games)}")
    print(f"  games skipped-as-present:    {len(already)}")
    print(f"  games processed this run:    {games_processed}")
    print(f"  rows read from staging:      {rows_read_total:,}")
    print(f"  rows inserted to prod:       {rows_inserted_total:,}")
    print(f"  wall-clock:                  {_fmt(elapsed)}")
    print("DONE.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
