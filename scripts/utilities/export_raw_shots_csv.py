#!/usr/bin/env python3
"""
export_raw_shots_csv.py

Exports the full `raw_shots` table from Supabase to a local CSV (batched/paginated).

Why this exists:
- Avoids re-scraping NHL API (works entirely from Supabase)
- Produces a stable "season snapshot" file for spreadsheets / comparisons
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


def main() -> None:
    _configure_stdout_utf8()

    # Default output name includes timestamp to avoid accidental overwrite.
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = os.path.join("data", f"raw_shots_export_{ts}.csv")

    export_raw_shots(output_file=output_file, batch_size=1000, select_columns="*")


if __name__ == "__main__":
    main()


