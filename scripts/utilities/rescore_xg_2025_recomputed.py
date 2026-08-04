#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: UTILITY
# Purpose:     0E-XG-5 (S4) — Re-score every 2025 shot with the repaired inference
#              feature contract, writing ONLY to raw_shots.xg_value_recomputed.
# Last active: 2026-08-04
# Invoked:     manual one-shot:
#                python scripts/utilities/rescore_xg_2025_recomputed.py --env-file .env.prod
# Reads:       raw_nhl_data (season 2025, processed=true) — raw play-by-play JSON
# Writes:      _xg_recompute_2025 (transient staging table)
# NOT:         touching raw_shots.xg_value or any other model output column
# ────────────────────────────────────────────────────────────
"""
Re-score 2025 shots against the currently-trained xG model with the fixed
feature contract (0E-XG-5 S1+S2). Does NOT overwrite raw_shots.xg_value.

Flow:
  1. Enumerate 2025 games from raw_nhl_data (processed=true).
  2. For each game, re-extract shots via the FIXED _extract_shots_from_game
     (signed angle, MP-consistent flip, tandem-flipped last_event coords,
     corrected axis labels, distance_angle_interaction with abs).
  3. Feature-engineer + predict xG (mirrors process_xg_stats.py section 5-6).
  4. Bulk-insert (game_id, event_id, xg_new) into _xg_recompute_2025.

A separate SQL UPDATE FROM step (run by the operator after this completes)
backfills raw_shots.xg_value_recomputed from the staging table.

Nothing else in the pipeline is touched. The nightly scraper's xg_value
column continues to receive the old (still-broken-with-model) prediction
until the accompanying model retrain lands.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline", "acquisition"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline", "utils"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "scripts", "utilities"))
import _bootstrap  # noqa: F401

from dotenv import dotenv_values

# Import model + feature engineering entrypoints. data_acquisition preloads
# XG_MODEL, MODEL_FEATURES, USE_MONEYPUCK_MODEL as module globals.
from data_acquisition import (  # noqa: E402
    _extract_shots_from_game,
    XG_MODEL,
    MODEL_FEATURES,
    USE_MONEYPUCK_MODEL,
    LAST_EVENT_CATEGORY_ENCODER,
)
from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa: E402


STAGING_TABLE = "_xg_recompute_2025"


def _load_env(path: Optional[str]) -> Dict[str, str]:
    if path is None:
        vals = dotenv_values(".env", encoding="utf-8-sig") if os.path.exists(".env") else {}
    else:
        p = os.path.abspath(path)
        if not os.path.exists(p):
            raise SystemExit(f"env file not found: {p}")
        vals = dotenv_values(p, encoding="utf-8-sig")
    url = (vals.get("VITE_SUPABASE_URL") or vals.get("SUPABASE_URL")
           or os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL"))
    key = vals.get("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(f"missing SUPABASE creds in {path or '.env'}")
    return {"url": url, "key": key}


def _parse_ref(url: str) -> str:
    try:
        return url.split("//", 1)[1].split(".", 1)[0]
    except Exception:
        return "<unset>"


def _fmt(sec: float) -> str:
    if sec < 60:
        return f"{sec:.1f}s"
    if sec < 3600:
        return f"{sec / 60:.1f}m"
    return f"{sec / 3600:.2f}h"


def _get_2025_game_ids(db: SupabaseRest) -> List[int]:
    """Enumerate every game_id in raw_nhl_data whose game_id encodes season 2025
    and which has been processed. Keyset-paginated on game_id."""
    seen: List[int] = []
    last_gid = 2025 * 1_000_000 - 1
    PAGE = 1000
    while True:
        rows = db.select(
            "raw_nhl_data",
            select="game_id",
            filters=[("game_id", "gt", last_gid), ("processed", "eq", True)],
            limit=PAGE,
            order="game_id",
        )
        if not rows:
            break
        page_gids = sorted({int(r["game_id"]) for r in rows if r.get("game_id") is not None})
        if not page_gids:
            break
        # Bound to season 2025 (game_id encodes season * 1_000_000 + n)
        in_range = [g for g in page_gids if 2025 * 1_000_000 <= g < 2026 * 1_000_000]
        seen.extend(in_range)
        if page_gids[-1] >= 2026 * 1_000_000:
            break
        last_gid = page_gids[-1]
        if len(rows) < PAGE:
            break
    return sorted(set(seen))


def _predict_xg_for_df(df_shots: pd.DataFrame) -> pd.Series:
    """Mirror the section-5+6 feature-engineering + predict block in
    process_xg_stats.py, but run only the xG prediction (no writes, no
    flurry / no shooting-talent). Returns a Series of xG values, one per
    row of df_shots. Uses XG_MODEL / MODEL_FEATURES from data_acquisition."""

    from sklearn.preprocessing import LabelEncoder  # local import

    # Encode last_event_category if the model needs it
    if USE_MONEYPUCK_MODEL and "last_event_category_encoded" in MODEL_FEATURES:
        if "last_event_category" in df_shots.columns and "last_event_category_encoded" not in df_shots.columns:
            if LAST_EVENT_CATEGORY_ENCODER is not None:
                df_shots["last_event_category_encoded"] = LAST_EVENT_CATEGORY_ENCODER.transform(
                    df_shots["last_event_category"].fillna("OTHER").astype(str)
                )
            else:
                le = LabelEncoder()
                df_shots["last_event_category_encoded"] = le.fit_transform(
                    df_shots["last_event_category"].fillna("unknown").astype(str)
                )

    # Derived features (mirrors process_xg_stats.py:267-272 — post-fix
    # includes .abs() on the angle interaction now that angle is signed).
    if "distance" in df_shots.columns and "angle" in df_shots.columns:
        df_shots["distance_angle_interaction"] = (
            df_shots["distance"] * df_shots["angle"].abs()
        ) / 100
    if "speed_from_last_event" in df_shots.columns:
        speed_series = pd.to_numeric(df_shots["speed_from_last_event"], errors="coerce").fillna(0)
        df_shots["speed_from_last_event_log"] = np.log1p(speed_series)

    # Ensure every model feature exists (mirrors process_xg_stats.py:275-295)
    for feature in MODEL_FEATURES:
        if feature not in df_shots.columns:
            if feature in ("home_empty_net", "away_empty_net", "is_empty_net",
                           "has_pass_before_shot", "is_rebound", "is_slot_shot", "is_power_play"):
                df_shots[feature] = 0
            elif feature == "shot_angle_adjusted":
                df_shots[feature] = df_shots["angle"].abs() if "angle" in df_shots.columns else 0
            elif feature == "last_event_category_encoded":
                df_shots[feature] = 0
            elif feature == "distance_angle_interaction":
                df_shots[feature] = (df_shots["distance"] * df_shots["angle"].abs()) / 100 \
                    if "distance" in df_shots.columns and "angle" in df_shots.columns else 0
            elif feature == "speed_from_last_event_log":
                df_shots[feature] = np.log1p(
                    pd.to_numeric(df_shots.get("speed_from_last_event", 0), errors="coerce").fillna(0)
                )
            else:
                df_shots[feature] = 0

    X_predict = df_shots[list(MODEL_FEATURES)].copy()

    # Fill NaN (mirrors process_xg_stats.py:301-323)
    for feature in MODEL_FEATURES:
        if X_predict[feature].isna().any():
            if feature in ("pass_lateral_distance", "pass_to_net_distance", "pass_immediacy_score",
                           "goalie_movement_score", "pass_quality_score", "pass_zone_encoded",
                           "has_pass_before_shot", "is_rebound", "is_slot_shot", "is_power_play",
                           "is_empty_net", "home_empty_net", "away_empty_net"):
                X_predict[feature] = pd.to_numeric(X_predict[feature], errors="coerce").fillna(0)
            elif feature in ("time_since_last_event", "distance_from_last_event", "speed_from_last_event",
                             "last_event_shot_angle", "last_event_shot_distance", "last_event_category_encoded"):
                s = pd.to_numeric(X_predict[feature], errors="coerce")
                nz = s[s > 0]
                fill_value = nz.median() if len(nz) > 0 else 0
                X_predict[feature] = s.fillna(fill_value)
            elif feature == "shot_angle_adjusted":
                X_predict[feature] = pd.to_numeric(X_predict[feature], errors="coerce").fillna(
                    df_shots["angle"].abs() if "angle" in df_shots.columns else 0
                )
            else:
                s = pd.to_numeric(X_predict[feature], errors="coerce")
                X_predict[feature] = s.fillna(s.median())

    # Predict — no .clip() call. Removed per S4 gate: "A correct model does not
    # produce values needing a cap."
    if hasattr(XG_MODEL, "predict_proba"):
        raw = XG_MODEL.predict_proba(X_predict)[:, 1]
    else:
        raw = XG_MODEL.predict(X_predict)
    return pd.Series(raw, index=df_shots.index)


def main() -> int:
    ap = argparse.ArgumentParser(description="0E-XG-5 S4 — re-score 2025 shots with fixed feature contract.")
    ap.add_argument("--env-file", type=str, required=True, help="Env file (e.g. .env.prod).")
    ap.add_argument("--insert-batch", type=int, default=1000, help="Rows per INSERT to _xg_recompute_2025.")
    ap.add_argument("--game-limit", type=int, default=None, help="Cap games processed (smoke tests).")
    args = ap.parse_args()

    env = _load_env(args.env_file)
    db = SupabaseRest(env["url"], env["key"])
    print("=" * 80)
    print(f"rescore_xg_2025_recomputed  target={_parse_ref(env['url'])}")
    print(f"USE_MONEYPUCK_MODEL={USE_MONEYPUCK_MODEL}  MODEL_FEATURES count={len(MODEL_FEATURES)}")
    print(f"insert_batch={args.insert_batch}")
    print("=" * 80, flush=True)

    print("[1/3] Enumerating 2025 processed games from raw_nhl_data ...", flush=True)
    gids = _get_2025_game_ids(db)
    if args.game_limit:
        gids = gids[: args.game_limit]
    print(f"       found {len(gids)} game_ids "
          f"(range: {gids[0] if gids else 'n/a'} .. {gids[-1] if gids else 'n/a'})", flush=True)

    print("[2/3] Re-extracting + predicting per game ...", flush=True)
    total_predicted = 0
    total_missing_event_id = 0
    total_inserted = 0
    total_games = 0
    buffer: List[Dict[str, Any]] = []
    started = time.time()
    last_progress = started

    for i, gid in enumerate(gids, 1):
        try:
            rows = db.select(
                "raw_nhl_data",
                select="raw_json",
                filters=[("game_id", "eq", gid)],
                limit=1,
            )
        except Exception as e:
            print(f"    game {gid}: fetch raw_json ERROR: {e}", flush=True)
            continue
        if not rows:
            continue
        raw_json = rows[0].get("raw_json")
        if isinstance(raw_json, str):
            try:
                raw_json = json.loads(raw_json)
            except Exception:
                continue
        if not isinstance(raw_json, dict):
            continue

        try:
            shots = _extract_shots_from_game(raw_json, game_id=gid, db_client=db)
        except Exception as e:
            print(f"    game {gid}: extract ERROR: {e}", flush=True)
            continue
        if not shots:
            continue

        df = pd.DataFrame(shots)
        try:
            xg_pred = _predict_xg_for_df(df)
        except Exception as e:
            print(f"    game {gid}: predict ERROR: {e}", flush=True)
            continue

        for idx, xg_val in xg_pred.items():
            ev_id = df.at[idx, "event_id"] if "event_id" in df.columns else None
            if ev_id is None or (isinstance(ev_id, float) and np.isnan(ev_id)):
                total_missing_event_id += 1
                continue
            buffer.append({
                "game_id": int(gid),
                "event_id": int(ev_id),
                "xg_new": float(xg_val),
            })
            total_predicted += 1

        total_games += 1

        while len(buffer) >= args.insert_batch:
            head = buffer[: args.insert_batch]
            del buffer[: args.insert_batch]
            try:
                db.insert(STAGING_TABLE, head)
                total_inserted += len(head)
            except Exception as e:
                print(f"    insert ERROR ({len(head)} rows): {e}", flush=True)
                return 2

        now = time.time()
        if now - last_progress >= 10:
            elapsed = now - started
            per_game = elapsed / max(1, total_games)
            remaining = (len(gids) - i) * per_game
            print(
                f"  [progress] game {i}/{len(gids)}  predicted={total_predicted:,}  "
                f"inserted={total_inserted:,}  buffer={len(buffer)}  "
                f"elapsed={_fmt(elapsed)}  eta={_fmt(remaining)}",
                flush=True,
            )
            last_progress = now

    # Flush tail
    if buffer:
        try:
            db.insert(STAGING_TABLE, buffer)
            total_inserted += len(buffer)
            buffer.clear()
        except Exception as e:
            print(f"    tail insert ERROR ({len(buffer)} rows): {e}", flush=True)
            return 2

    elapsed = time.time() - started
    print("\n" + "=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"  games processed:       {total_games}")
    print(f"  rows predicted:        {total_predicted:,}")
    print(f"  rows missing event_id: {total_missing_event_id:,}  (not inserted)")
    print(f"  rows inserted:         {total_inserted:,}  (into {STAGING_TABLE})")
    print(f"  wall-clock:            {_fmt(elapsed)}")
    print()
    print("Next step (operator): SQL UPDATE FROM staging table to backfill "
          "raw_shots.xg_value_recomputed.")
    print("DONE.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
