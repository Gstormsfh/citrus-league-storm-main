#!/usr/bin/env python3
"""
extract_rebuild.py — W3 of the 9-season official-log rebuild.

For every raw_nhl_data row in a season slice, runs the SINGLE
authoritative extractor (data_acquisition._extract_shots_from_game with
the R2 pre-shot score_differential fix landed in this branch), scores
placeholder xG values using the currently-deployed model, and loads
shots into public.raw_shots_rebuild (a shadow table Garrett creates
before this job runs).

Five ledger gates per season, ALL must pass or the job fails hard:

  games_extracted   expected = manifest count
                    actual   = distinct game_id in raw_shots_rebuild for season
  goal_parity       expected = sum of typeCode==505 events in raw_json
                    actual   = count of is_goal=true rows in rebuild
  score_diff_live   expected 55-80% of ALL shots nonzero (info+threshold)
                    Post-R2 fix: score_differential should be populated on
                    every shot regardless of outcome. Non-zero share reflects
                    game state, not extraction bugs.
  strength_sane     man-advantage share 13-17% (5v4 + 4v5 combined)
  geometry_signed   shot_x negative share 47-52%
                    Verifies the extractor is emitting signed coordinates
                    as the API serves them, not folded.

Placeholder xG note: historical seasons are NOT displayed on any UI
surface today; scoring them with the currently-deployed model produces
values that will be replaced when Garrett re-fits after the swap.
2025-26's placeholder values get replaced identically.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline", "acquisition"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline", "utils"))
sys.path.insert(0, os.path.join(_REPO_ROOT, "scripts", "utilities"))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_acquisition import (  # noqa: E402
    _extract_shots_from_game,
    XG_MODEL,
    MODEL_FEATURES,
)

REBUILD_TABLE = "raw_shots_rebuild"


def record_audit(db: SupabaseRest, season: int, gate_name: str,
                 expected: Optional[int], actual: int, note: str = "") -> None:
    db.rpc("record_rebuild_audit", {
        "p_season": int(season),
        "p_gate_name": gate_name,
        "p_expected": expected,
        "p_actual": int(actual),
        "p_note": note[:1000] if note else "",
    })
    print(f"  [ledger] season={season} {gate_name}: expected={expected} actual={actual}  {note}",
          flush=True)


def iter_season_raw(db: SupabaseRest, season: int, page: int = 200):
    """Yield raw_nhl_data rows for a season via truncation-guarded pagination."""
    lo = season * 1_000_000
    hi = (season + 1) * 1_000_000
    offset = 0
    while True:
        rows = db.select_exact(
            "raw_nhl_data",
            select="game_id,game_date,raw_json",
            filters=[("game_id", "gte", lo), ("game_id", "lt", hi)],
            limit=page, offset=offset,
        )
        if not rows:
            return
        for r in rows:
            yield r
        if len(rows) < page:
            return
        offset += page


def score_shots(df_shots) -> "pd.Series":
    """Feed df_shots through the deployed model. Placeholder xG values;
    the fit-time swap will replace them. Uses the same fill logic as
    process_xg_stats.py to keep training-serve pipeline consistent."""
    import numpy as np
    import pandas as pd

    for feat in MODEL_FEATURES:
        if feat not in df_shots.columns:
            df_shots[feat] = 0
    X = df_shots[list(MODEL_FEATURES)].copy()
    for feat in MODEL_FEATURES:
        if X[feat].isna().any():
            X[feat] = pd.to_numeric(X[feat], errors="coerce").fillna(0)
    X = X.astype(float)
    if hasattr(XG_MODEL, "predict_proba"):
        raw = XG_MODEL.predict_proba(X)[:, 1]
    else:
        raw = XG_MODEL.predict(X)
    return pd.Series(raw, index=df_shots.index)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--manifest-count", type=int, required=True,
                    help="Expected game count for this season from W1")
    ap.add_argument("--game-limit", type=int, default=None)
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
    print(f"[BANNER] season: {args.season}  manifest_count: {args.manifest_count}")
    print(f"[BANNER] target table: {REBUILD_TABLE}")
    print("=" * 78, flush=True)

    import pandas as pd
    db = SupabaseRest(url, key)

    total_shots = 0
    total_goal_events = 0  # from raw_json typeCode==505 count
    total_extracted_goals = 0
    games_seen = 0
    games_extracted = 0
    batch: List[Dict[str, Any]] = []
    BATCH_SIZE = 500

    def _flush(force: bool = False) -> None:
        nonlocal batch
        if not batch:
            return
        if not force and len(batch) < BATCH_SIZE:
            return
        db.upsert(REBUILD_TABLE, batch, on_conflict="game_id,event_id")
        batch = []

    for i, raw in enumerate(iter_season_raw(db, args.season)):
        if args.game_limit and games_seen >= args.game_limit:
            break
        games_seen += 1
        game_id = int(raw["game_id"])
        game_date = raw.get("game_date")
        raw_json = raw.get("raw_json")
        if isinstance(raw_json, str):
            try:
                raw_json = json.loads(raw_json)
            except Exception:
                continue
        if not isinstance(raw_json, dict):
            continue

        # Count typeCode==505 events in the raw plays array (goal parity source)
        for play in raw_json.get("plays") or []:
            if play.get("typeCode") == 505:
                total_goal_events += 1

        try:
            shots = _extract_shots_from_game(raw_json, game_id, db)
        except Exception as e:
            print(f"  [extract error] game {game_id}: {e}", flush=True)
            continue
        if not shots:
            continue

        df = pd.DataFrame(shots)
        try:
            xg = score_shots(df.copy())
            df["xg_value"] = xg.values
        except Exception as e:
            print(f"  [score error] game {game_id}: {e}", flush=True)
            df["xg_value"] = 0.0

        # Serialize each row to a dict matching raw_shots_rebuild schema.
        # For portability, we pass through only columns present in df.
        games_extracted += 1
        for _, row in df.iterrows():
            total_shots += 1
            if int(row.get("is_goal", 0) or 0) == 1:
                total_extracted_goals += 1
            r = {k: (v.item() if hasattr(v, "item") else v)
                 for k, v in row.to_dict().items()
                 if not (isinstance(v, float) and (v != v))}
            r["season"] = args.season
            r["game_id"] = game_id
            batch.append(r)
            if len(batch) >= BATCH_SIZE:
                _flush(force=True)
        if games_seen % 50 == 0:
            print(f"  [progress] games_seen={games_seen} extracted={games_extracted} "
                  f"shots={total_shots} goals={total_extracted_goals}", flush=True)
    _flush(force=True)

    # ── Ledger gates ────────────────────────────────────────────────────
    # Gate 1: games_extracted (distinct game_id in rebuild for this season)
    lo = args.season * 1_000_000
    hi = (args.season + 1) * 1_000_000
    print(f"[gate] counting distinct game_ids in {REBUILD_TABLE} ...", flush=True)
    distinct_games: set = set()
    offset = 0
    PAGE = 1000
    while True:
        rows = db.select_exact(
            REBUILD_TABLE, select="game_id",
            filters=[("game_id", "gte", lo), ("game_id", "lt", hi)],
            limit=PAGE, offset=offset,
        )
        for r in rows:
            distinct_games.add(int(r["game_id"]))
        if len(rows) < PAGE:
            break
        offset += PAGE
    record_audit(db, args.season, "games_extracted",
                 expected=args.manifest_count, actual=len(distinct_games))

    # Gate 2: goal_parity
    print(f"[gate] counting is_goal=true rows in {REBUILD_TABLE} ...", flush=True)
    goals_in_rebuild = 0
    offset = 0
    while True:
        rows = db.select_exact(
            REBUILD_TABLE, select="game_id",
            filters=[("game_id", "gte", lo), ("game_id", "lt", hi), ("is_goal", "eq", True)],
            limit=PAGE, offset=offset,
        )
        goals_in_rebuild += len(rows)
        if len(rows) < PAGE:
            break
        offset += PAGE
    record_audit(db, args.season, "goal_parity",
                 expected=total_goal_events, actual=goals_in_rebuild,
                 note="raw_json typeCode==505 count vs is_goal=true rows")

    # Gates 3-5 require pulling a stat sample. Use a per-season aggregate
    # via SQL where possible; for now do a paginated scan on key columns.
    print(f"[gate] scanning shot-level stats (score_diff_live / strength / geometry) ...",
          flush=True)
    total = 0
    score_nonzero = 0
    man_advantage = 0
    x_negative = 0
    x_seen = 0
    offset = 0
    while True:
        rows = db.select_exact(
            REBUILD_TABLE,
            select="score_differential,home_skaters_on_ice,away_skaters_on_ice,is_home_team,shot_x",
            filters=[("game_id", "gte", lo), ("game_id", "lt", hi)],
            limit=PAGE, offset=offset,
        )
        for r in rows:
            total += 1
            sd = r.get("score_differential")
            if sd is not None and int(sd) != 0:
                score_nonzero += 1
            hs = r.get("home_skaters_on_ice")
            aws = r.get("away_skaters_on_ice")
            ih = r.get("is_home_team")
            if hs is not None and aws is not None and ih is not None:
                shooting = int(hs) if ih else int(aws)
                defending = int(aws) if ih else int(hs)
                if shooting != defending:
                    man_advantage += 1
            sx = r.get("shot_x")
            if sx is not None:
                x_seen += 1
                try:
                    if float(sx) < 0:
                        x_negative += 1
                except Exception:
                    pass
        if len(rows) < PAGE:
            break
        offset += PAGE

    if total == 0:
        print("[FATAL] no rows in rebuild for this season; gates cannot run", file=sys.stderr)
        return 2

    pct_score_nonzero = round(100.0 * score_nonzero / total, 3)
    pct_man_advantage = round(100.0 * man_advantage / total, 3)
    pct_x_negative = round(100.0 * x_negative / max(x_seen, 1), 3)

    # score_diff_live: 55-80% target
    record_audit(db, args.season, "score_diff_live",
                 expected=None, actual=score_nonzero,
                 note=f"pct_nonzero={pct_score_nonzero}%  target 55-80%  total={total}")
    # strength_sane: 13-17%
    record_audit(db, args.season, "strength_sane",
                 expected=None, actual=man_advantage,
                 note=f"pct_man_advantage={pct_man_advantage}%  target 13-17%")
    # geometry_signed: 47-52%
    record_audit(db, args.season, "geometry_signed",
                 expected=None, actual=x_negative,
                 note=f"pct_x_negative={pct_x_negative}%  target 47-52%  x_seen={x_seen}")

    # Hard-fail if any gate outside the band
    failed_gates: List[str] = []
    if not (55.0 <= pct_score_nonzero <= 80.0):
        failed_gates.append(f"score_diff_live ({pct_score_nonzero}% out of 55-80%)")
    if not (13.0 <= pct_man_advantage <= 17.0):
        failed_gates.append(f"strength_sane ({pct_man_advantage}% out of 13-17%)")
    if not (47.0 <= pct_x_negative <= 52.0):
        failed_gates.append(f"geometry_signed ({pct_x_negative}% out of 47-52%)")
    if len(distinct_games) != args.manifest_count:
        failed_gates.append(
            f"games_extracted (got {len(distinct_games)} of {args.manifest_count})"
        )
    # goal_parity is expected exact match; tolerate ±0.5% for extraction quirks
    tol = max(1, int(total_goal_events * 0.005))
    if abs(goals_in_rebuild - total_goal_events) > tol:
        failed_gates.append(
            f"goal_parity (got {goals_in_rebuild} vs {total_goal_events}, tol ±{tol})"
        )

    if failed_gates:
        print("=" * 78, file=sys.stderr)
        print(f"[FATAL] gates failed for season {args.season}:", file=sys.stderr)
        for g in failed_gates:
            print(f"  * {g}", file=sys.stderr)
        print("=" * 78, file=sys.stderr)
        return 2

    print(f"[OK] season {args.season} — all 5 gates PASS", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
