#!/usr/bin/env python3
"""
apply_shooting_talent_to_raw_shots.py

After generating `player_shooting_talent.joblib`, this script applies the talent
multiplier to every shot in `raw_shots` and writes:
- shooting_talent_multiplier
- shooting_talent_adjusted_xg

This avoids re-scraping/reprocessing games just to populate these columns.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

import joblib
import pandas as pd
from dotenv import load_dotenv
from supabase import Client, create_client


def _configure_stdout_utf8() -> None:
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


def load_talent_dict(path: str = "player_shooting_talent.joblib") -> Dict[int, float]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing {path}. Run calculate_shooting_talent.py first.")
    talent_dict = joblib.load(path)
    if not isinstance(talent_dict, dict):
        raise TypeError(f"Expected dict in {path}, got {type(talent_dict)}")
    # Normalize keys to int
    normalized: Dict[int, float] = {}
    for k, v in talent_dict.items():
        try:
            normalized[int(k)] = float(v)
        except Exception:
            continue
    return normalized


def fetch_shots_for_update(supabase: Client, batch_size: int = 2000) -> pd.DataFrame:
    # NOTE: PostgREST commonly enforces a max page size of 1000 rows.
    # Keep batch_size <= 1000 for reliable pagination.
    batch_size = min(int(batch_size), 1000)
    print("Fetching raw_shots (keys + xG columns) ...")
    all_rows: List[Dict[str, Any]] = []
    offset = 0
    while True:
        resp = (
            supabase.table("raw_shots")
            .select(
                "game_id, player_id, shot_x, shot_y, shot_type_code, distance, angle, "
                "xg_value, flurry_adjusted_xg"
            )
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break
        all_rows.extend(rows)
        offset += batch_size
        if len(all_rows) % (batch_size * 5) == 0:
            print(f"  fetched {len(all_rows):,}...")
        if len(rows) < batch_size:
            break
    df = pd.DataFrame(all_rows)
    if df.empty:
        raise RuntimeError("raw_shots returned 0 rows; cannot apply shooting talent.")
    return df


def apply_and_upsert(supabase: Client, df: pd.DataFrame, talent_dict: Dict[int, float]) -> None:
    # Coerce types
    df["player_id"] = pd.to_numeric(df["player_id"], errors="coerce")
    df["game_id"] = pd.to_numeric(df["game_id"], errors="coerce")
    df["shot_x"] = pd.to_numeric(df["shot_x"], errors="coerce")
    df["shot_y"] = pd.to_numeric(df["shot_y"], errors="coerce")
    df["shot_type_code"] = pd.to_numeric(df["shot_type_code"], errors="coerce")
    df["distance"] = pd.to_numeric(df["distance"], errors="coerce")
    df["angle"] = pd.to_numeric(df["angle"], errors="coerce")
    df["flurry_adjusted_xg"] = pd.to_numeric(df["flurry_adjusted_xg"], errors="coerce")
    df["xg_value"] = pd.to_numeric(df["xg_value"], errors="coerce")

    # Ensure we only operate on rows with the full natural-key + required not-null fields.
    df = df[
        df["game_id"].notna()
        & df["player_id"].notna()
        & df["shot_x"].notna()
        & df["shot_y"].notna()
        & df["distance"].notna()
        & df["angle"].notna()
        & df["xg_value"].notna()
    ].copy()

    base_xg = df["flurry_adjusted_xg"].fillna(df["xg_value"]).fillna(0.0).clip(lower=0.0)
    multipliers = df["player_id"].map(lambda pid: talent_dict.get(int(pid), 1.0) if pd.notna(pid) else 1.0)
    adjusted = (base_xg * multipliers).clip(upper=0.50)

    df_out = pd.DataFrame(
        {
            # Use the table's unique natural key for a safe UPSERT update.
            # This avoids relying on BIGSERIAL `id` which may not be a usable ON CONFLICT target via PostgREST.
            "game_id": df["game_id"].astype(int),
            "player_id": df["player_id"].astype(int),
            "shot_x": df["shot_x"].astype(float),
            "shot_y": df["shot_y"].astype(float),
            "shot_type_code": df["shot_type_code"].fillna(0).astype(int),
            # Include required NOT NULL fields so even if an insert is attempted, it won't violate constraints.
            "distance": df["distance"].astype(float),
            "angle": df["angle"].astype(float),
            "xg_value": df["xg_value"].astype(float),
            "shooting_talent_multiplier": multipliers.astype(float),
            "shooting_talent_adjusted_xg": adjusted.astype(float),
        }
    )

    print("=" * 80)
    print("APPLY SHOOTING TALENT -> raw_shots")
    print("=" * 80)
    print(f"Rows to update: {len(df_out):,}")
    print(f"Players with custom multipliers: {(df_out['shooting_talent_multiplier'] != 1.0).sum():,}")
    print()

    BATCH = 1000
    updated = 0
    for i in range(0, len(df_out), BATCH):
        batch_df = df_out.iloc[i : i + BATCH]
        payload = batch_df.to_dict(orient="records")
        supabase.table("raw_shots").upsert(
            payload,
            on_conflict="game_id,player_id,shot_x,shot_y,shot_type_code",
        ).execute()
        updated += len(payload)
        if updated % (BATCH * 10) == 0 or updated == len(df_out):
            print(f"Updated {updated:,}/{len(df_out):,}...")

    print()
    print("[OK] shooting_talent_adjusted_xg + shooting_talent_multiplier updated on raw_shots")


def main() -> None:
    _configure_stdout_utf8()
    supabase = get_supabase_client()
    talent_dict = load_talent_dict()
    df = fetch_shots_for_update(supabase=supabase, batch_size=2000)
    apply_and_upsert(supabase=supabase, df=df, talent_dict=talent_dict)


if __name__ == "__main__":
    main()


