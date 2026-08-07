#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Export prod raw_shots to CSV for training / analysis (--training flag for xG v3)
# Last active: 2026-02-18
# Invoked:     manual operator run before training; documented in TRAINING_DATA_MANIFEST.md
# Reads:       raw_shots
# Writes:      data/shots_full_features_2025.csv
# ────────────────────────────────────────────────────────────
"""
export_raw_shots_csv.py

Exports the full `raw_shots` table from Supabase to a local CSV (batched/paginated).

Why this exists:
- Avoids re-scraping NHL API (works entirely from Supabase)
- Produces a stable "season snapshot" file for spreadsheets / comparisons

NOTE: raw_shots is MULTI-SEASON since phase 0c (seasons 2017-2024
backfilled alongside the current season). This exporter now emits the full
historical corpus unless the caller adds a season filter. Consider slicing
downstream if you specifically wanted a single-season snapshot.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

import pandas as pd
from dotenv import load_dotenv
from supabase import Client, create_client


def _configure_stdout_utf8() -> None:
    # Helps on Windows consoles.
    if getattr(sys.stdout, "encoding", None) != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass


def get_supabase_client() -> Client:
    load_dotenv()
    supabase_url = os.getenv("VITE_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        raise RuntimeError(
            "Supabase credentials not found. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"
        )
    return create_client(supabase_url, supabase_key)


def get_table_count(supabase: Client, table: str) -> int:
    resp = supabase.table(table).select("id", count="exact").execute()
    count = getattr(resp, "count", None)
    if isinstance(count, int):
        return count
    # Fallback: best-effort
    data = getattr(resp, "data", None) or []
    return len(data)


def export_raw_shots(
    output_file: str,
    batch_size: int = 1000,
    select_columns: str = "*",
) -> str:
    supabase = get_supabase_client()

    total = get_table_count(supabase, "raw_shots")
    if total == 0:
        raise RuntimeError("raw_shots is empty (0 rows). Nothing to export.")

    os.makedirs(os.path.dirname(output_file) or ".", exist_ok=True)

    print("=" * 80)
    print("EXPORT RAW_SHOTS -> CSV")
    print("=" * 80)
    print(f"Rows: {total:,}")
    print(f"Batch size: {batch_size}")
    print(f"Output: {output_file}")
    print()

    offset = 0
    wrote_header = False
    exported = 0

    while True:
        resp = (
            supabase.table("raw_shots")
            .select(select_columns)
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows: List[Dict[str, Any]] = resp.data or []
        if not rows:
            break

        df = pd.DataFrame(rows)
        df.to_csv(output_file, index=False, mode="a", header=not wrote_header)
        wrote_header = True

        exported += len(rows)
        offset += batch_size

        if exported % (batch_size * 10) == 0 or exported >= total:
            print(f"Exported {exported:,}/{total:,}...")

        if len(rows) < batch_size:
            break

    print()
    print(f"[OK] Export complete: {exported:,} rows -> {output_file}")
    return output_file


def export_training_data(output_file: str = None) -> str:
    """Export shots in the format needed by train_xg_v3.py.

    Overwrites data/shots_full_features_2025.csv (the file the v3 training
    pipeline reads).  Run this before retraining to pick up newly scraped games.

    Usage:
        python scripts/utilities/export_raw_shots_csv.py --training
    """
    if output_file is None:
        output_file = os.path.join("data", "shots_full_features_2025.csv")

    print("=" * 80)
    print("EXPORT TRAINING DATA  ->  shots_full_features_2025.csv")
    print("=" * 80)

    return export_raw_shots(
        output_file=output_file,
        batch_size=1000,
        select_columns="*",
    )


def main() -> None:
    _configure_stdout_utf8()

    if "--training" in sys.argv:
        # Export in training-ready format (overwrites stable filename)
        export_training_data()
        print("\nNext step: python scripts/utilities/train_xg_v3.py")
    else:
        # Default: timestamped snapshot
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = os.path.join("data", f"raw_shots_export_{ts}.csv")
        export_raw_shots(output_file=output_file, batch_size=1000, select_columns="*")


if __name__ == "__main__":
    main()


