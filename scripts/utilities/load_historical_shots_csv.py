#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Phase 0 / 0a — load MoneyPuck historical shots CSV into raw_shots
# Last active: 2026-05-12 (Phase 0 0a authoring)
# Invoked:     manual per-season runs:
#                python scripts/utilities/load_historical_shots_csv.py
#                    --csv data-pipeline/data/historical/shots_2018-2024.csv
#                    --season 2024  [--dry-run]  [--batch-size 5000]
# Reads:       data-pipeline/data/historical/shots_*.csv
# Writes:      raw_shots (UPSERT) — DOES NOT TOUCH any other table
# ────────────────────────────────────────────────────────────
"""
Phase 0 / 0a: Historical CSV load.

Loads MoneyPuck shots CSV data into `raw_shots` for seasons 2017-18 through 2024-25.
The 7 moat features are strict NULL for historical rows — MoneyPuck does not surface
these for pre-2025-26 seasons. Setting them to 0 would silently corrupt training data
for the xG v3 model and downstream consumers.

See apps/web/docs/PHASE_0_EXECUTION_PLAN.md for sequencing context.

Usage:
    python scripts/utilities/load_historical_shots_csv.py \
        --csv data-pipeline/data/historical/shots_2018-2024.csv \
        --season 2024 \
        --dry-run

    # Then, after dry-run inspection:
    python scripts/utilities/load_historical_shots_csv.py \
        --csv data-pipeline/data/historical/shots_2018-2024.csv \
        --season 2024

Conventions:
    --season takes the 4-digit short form (2024 = 2024-25 season),
    matching both MoneyPuck CSV's `season` column AND our `raw_shots.season`.
    NHL game_id = season * 1_000_000 + moneypuck_game_id (e.g. 2024020001).
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from typing import Any, Dict, List, Optional

# Bootstrap data_pipeline package
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401

import pandas as pd
from dotenv import load_dotenv

from data_pipeline.utils.supabase_rest import SupabaseRest

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

# ─── MoneyPuck → raw_shots column mapping ──────────────────────────────────────
# Static dict for review. Every entry has a clear MoneyPuck source.
# The 7 moat features are NOT in this dict — they're written as None below.
COLUMN_MAP: Dict[str, str] = {
    # Identity (NHL game_id derived from season + game_id below; not a direct map)
    "shooterPlayerId":          "player_id",
    # Shot geometry
    "xCord":                    "shot_x",
    "yCord":                    "shot_y",
    "arenaAdjustedXCord":       "arena_adjusted_x",
    "arenaAdjustedYCord":       "arena_adjusted_y",
    "arenaAdjustedXCordABS":    "arena_adjusted_x_abs",
    "arenaAdjustedYCordAbs":    "arena_adjusted_y_abs",
    "arenaAdjustedShotDistance":"arena_adjusted_shot_distance",
    "shotDistance":             "distance",
    "shotAngle":                "angle",
    "shotAngleAdjusted":        "shot_angle_adjusted",
    "shotAnglePlusRebound":     "shot_angle_plus_rebound",
    "shotAnglePlusReboundSpeed":"shot_angle_plus_rebound_speed",
    "shotAngleReboundRoyalRoad":"shot_angle_rebound_royal_road",
    # Outcomes (bools)
    "goal":                     "is_goal",
    "shotRebound":              "is_rebound",
    "shotRush":                 "is_rush",
    "shotOnEmptyNet":           "is_empty_net",
    "shotGoalieFroze":          "shot_goalie_froze",
    "shotGeneratedRebound":     "shot_generated_rebound",
    "shotPlayStopped":          "shot_play_stopped",
    "shotPlayContinuedInZone":  "shot_play_continued_in_zone",
    "shotPlayContinuedOutsideZone": "shot_play_continued_outside_zone",
    "shotWasOnGoal":            "shot_was_on_goal",
    # xG family
    "xGoal":                    "xg_value",
    "xRebound":                 "expected_rebound_probability",
    # Last-event context
    "lastEventCategory":        "last_event_category",
    "lastEventxCord":           "last_event_x",
    "lastEventyCord":           "last_event_y",
    "lastEventTeam":            "last_event_team",
    "lastEventShotAngle":       "last_event_shot_angle",
    "lastEventShotDistance":    "last_event_shot_distance",
    "distanceFromLastEvent":    "distance_from_last_event",
    "timeSinceLastEvent":       "time_since_last_event",
    "speedFromLastEvent":       "speed_from_last_event",
    "timeSinceFaceoff":         "time_since_faceoff",
    "playerNumThatDidLastEvent":"player_num_that_did_last_event",
    # Strength + sides
    "homeSkatersOnIce":         "home_skaters_on_ice",
    "awaySkatersOnIce":         "away_skaters_on_ice",
    "homeEmptyNet":             "home_empty_net",
    "awayEmptyNet":             "away_empty_net",
    "isHomeTeam":               "is_home_team",
    "teamCode":                 "team_code",
    # TOI cascade (36 columns) — MoneyPuck supplies real shift-derived values for historical
    "shooterTimeOnIce":                                         "shooter_time_on_ice",
    "shooterTimeOnIceSinceFaceoff":                             "shooter_time_on_ice_since_faceoff",
    "shootingTeamAverageTimeOnIce":                             "shooting_team_average_time_on_ice",
    "shootingTeamMaxTimeOnIce":                                 "shooting_team_max_time_on_ice",
    "shootingTeamMinTimeOnIce":                                 "shooting_team_min_time_on_ice",
    "shootingTeamAverageTimeOnIceOfForwards":                   "shooting_team_average_time_on_ice_of_forwards",
    "shootingTeamMaxTimeOnIceOfForwards":                       "shooting_team_max_time_on_ice_of_forwards",
    "shootingTeamMinTimeOnIceOfForwards":                       "shooting_team_min_time_on_ice_of_forwards",
    "shootingTeamAverageTimeOnIceOfDefencemen":                 "shooting_team_average_time_on_ice_of_defencemen",
    "shootingTeamMaxTimeOnIceOfDefencemen":                     "shooting_team_max_time_on_ice_of_defencemen",
    "shootingTeamMinTimeOnIceOfDefencemen":                     "shooting_team_min_time_on_ice_of_defencemen",
    "shootingTeamAverageTimeOnIceSinceFaceoff":                 "shooting_team_average_time_on_ice_since_faceoff",
    "shootingTeamMaxTimeOnIceSinceFaceoff":                     "shooting_team_max_time_on_ice_since_faceoff",
    "shootingTeamMinTimeOnIceSinceFaceoff":                     "shooting_team_min_time_on_ice_since_faceoff",
    "shootingTeamAverageTimeOnIceOfForwardsSinceFaceoff":       "shooting_team_average_time_on_ice_of_forwards_since_faceoff",
    "shootingTeamMaxTimeOnIceOfForwardsSinceFaceoff":           "shooting_team_max_time_on_ice_of_forwards_since_faceoff",
    "shootingTeamMinTimeOnIceOfForwardsSinceFaceoff":           "shooting_team_min_time_on_ice_of_forwards_since_faceoff",
    "shootingTeamAverageTimeOnIceOfDefencemenSinceFaceoff":     "shooting_team_average_time_on_ice_of_defencemen_since_faceoff",
    "shootingTeamMaxTimeOnIceOfDefencemenSinceFaceoff":         "shooting_team_max_time_on_ice_of_defencemen_since_faceoff",
    "shootingTeamMinTimeOnIceOfDefencemenSinceFaceoff":         "shooting_team_min_time_on_ice_of_defencemen_since_faceoff",
    "defendingTeamAverageTimeOnIce":                            "defending_team_average_time_on_ice",
    "defendingTeamMaxTimeOnIce":                                "defending_team_max_time_on_ice",
    "defendingTeamMinTimeOnIce":                                "defending_team_min_time_on_ice",
    "defendingTeamAverageTimeOnIceOfForwards":                  "defending_team_average_time_on_ice_of_forwards",
    "defendingTeamMaxTimeOnIceOfForwards":                      "defending_team_max_time_on_ice_of_forwards",
    "defendingTeamMinTimeOnIceOfForwards":                      "defending_team_min_time_on_ice_of_forwards",
    "defendingTeamAverageTimeOnIceOfDefencemen":                "defending_team_average_time_on_ice_of_defencemen",
    "defendingTeamMaxTimeOnIceOfDefencemen":                    "defending_team_max_time_on_ice_of_defencemen",
    "defendingTeamMinTimeOnIceOfDefencemen":                    "defending_team_min_time_on_ice_of_defencemen",
    "defendingTeamAverageTimeOnIceSinceFaceoff":                "defending_team_average_time_on_ice_since_faceoff",
    "defendingTeamMaxTimeOnIceSinceFaceoff":                    "defending_team_max_time_on_ice_since_faceoff",
    "defendingTeamMinTimeOnIceSinceFaceoff":                    "defending_team_min_time_on_ice_since_faceoff",
    "defendingTeamAverageTimeOnIceOfForwardsSinceFaceoff":      "defending_team_average_time_on_ice_of_forwards_since_faceoff",
    "defendingTeamMaxTimeOnIceOfForwardsSinceFaceoff":          "defending_team_max_time_on_ice_of_forwards_since_faceoff",
    "defendingTeamMinTimeOnIceOfForwardsSinceFaceoff":          "defending_team_min_time_on_ice_of_forwards_since_faceoff",
    # Rest difference
    "timeDifferenceSinceChange":"time_difference_since_change",
    "averageRestDifference":    "average_rest_difference",
    # Goalie
    "goalieIdForShot":          "goalie_id",
    # Period / time
    "period":                   "period",
}

# The 7 moat features — STRICT NULL for historical rows.
# Setting these to 0 would silently corrupt the xG v3 training corpus.
MOAT_FEATURES_NULL_FOR_HISTORICAL = [
    "pass_quality_score",
    "pass_immediacy_score",
    "goalie_movement_score",
    "pass_zone_encoded",
    "pass_lateral_distance",
    "pass_to_net_distance",
    "has_pass_before_shot",
]


def _safe_int(v: Any) -> Optional[int]:
    if v is None or v == "" or pd.isna(v):
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def _safe_float(v: Any) -> Optional[float]:
    if v is None or v == "" or pd.isna(v):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _safe_bool(v: Any) -> Optional[bool]:
    if v is None or v == "" or pd.isna(v):
        return None
    try:
        return bool(int(float(v)))
    except (ValueError, TypeError):
        return None


def _safe_str(v: Any) -> Optional[str]:
    if v is None or pd.isna(v):
        return None
    s = str(v).strip()
    return s if s else None


# Coercion table — column → (function, target python type)
INT_COLUMNS = {
    "player_id", "shot_x", "shot_y", "period",
    "home_skaters_on_ice", "away_skaters_on_ice",
    "goalie_id", "player_num_that_did_last_event",
    "shot_type_code", "season", "game_id",
}
FLOAT_COLUMNS = {
    "arena_adjusted_x", "arena_adjusted_y", "arena_adjusted_x_abs", "arena_adjusted_y_abs",
    "arena_adjusted_shot_distance", "distance", "angle", "shot_angle_adjusted",
    "shot_angle_plus_rebound", "shot_angle_plus_rebound_speed",
    "xg_value", "expected_rebound_probability",
    "last_event_x", "last_event_y", "last_event_shot_angle", "last_event_shot_distance",
    "distance_from_last_event", "time_since_last_event", "speed_from_last_event",
    "time_since_faceoff", "time_difference_since_change", "average_rest_difference",
    "shooter_time_on_ice", "shooter_time_on_ice_since_faceoff",
    "shooting_team_average_time_on_ice", "shooting_team_max_time_on_ice", "shooting_team_min_time_on_ice",
    "shooting_team_average_time_on_ice_of_forwards", "shooting_team_max_time_on_ice_of_forwards", "shooting_team_min_time_on_ice_of_forwards",
    "shooting_team_average_time_on_ice_of_defencemen", "shooting_team_max_time_on_ice_of_defencemen", "shooting_team_min_time_on_ice_of_defencemen",
    "shooting_team_average_time_on_ice_since_faceoff", "shooting_team_max_time_on_ice_since_faceoff", "shooting_team_min_time_on_ice_since_faceoff",
    "shooting_team_average_time_on_ice_of_forwards_since_faceoff", "shooting_team_max_time_on_ice_of_forwards_since_faceoff", "shooting_team_min_time_on_ice_of_forwards_since_faceoff",
    "shooting_team_average_time_on_ice_of_defencemen_since_faceoff", "shooting_team_max_time_on_ice_of_defencemen_since_faceoff", "shooting_team_min_time_on_ice_of_defencemen_since_faceoff",
    "defending_team_average_time_on_ice", "defending_team_max_time_on_ice", "defending_team_min_time_on_ice",
    "defending_team_average_time_on_ice_of_forwards", "defending_team_max_time_on_ice_of_forwards", "defending_team_min_time_on_ice_of_forwards",
    "defending_team_average_time_on_ice_of_defencemen", "defending_team_max_time_on_ice_of_defencemen", "defending_team_min_time_on_ice_of_defencemen",
    "defending_team_average_time_on_ice_since_faceoff", "defending_team_max_time_on_ice_since_faceoff", "defending_team_min_time_on_ice_since_faceoff",
    "defending_team_average_time_on_ice_of_forwards_since_faceoff", "defending_team_max_time_on_ice_of_forwards_since_faceoff", "defending_team_min_time_on_ice_of_forwards_since_faceoff",
    "shot_angle_rebound_royal_road",
}
BOOL_COLUMNS = {
    "is_goal", "is_rebound", "is_rush", "is_empty_net",
    "shot_goalie_froze", "shot_generated_rebound",
    "shot_play_stopped", "shot_play_continued_in_zone", "shot_play_continued_outside_zone",
    "shot_was_on_goal", "is_home_team",
    "home_empty_net", "away_empty_net",
}
STR_COLUMNS = {
    "last_event_category", "last_event_team",
    "team_code", "shot_type",
}


# MoneyPuck event → NHL typeCode mapping (mirrors data_acquisition.py)
EVENT_TO_TYPECODE = {
    "GOAL": 505,
    "SHOT": 506,
    "MISS": 507,
}

# MoneyPuck shotType → lowercase form used by 2025-26 extractor.
# Will not blow up on unseen values — passes through lowercased.
SHOT_TYPE_NORMALIZE = lambda v: _safe_str(v).lower() if _safe_str(v) else None


def map_row(row: dict, season: int) -> Optional[dict]:
    """Convert one MoneyPuck CSV row dict → raw_shots record dict.

    Returns None if the row is unmappable (e.g. missing required fields).
    """
    # Build NHL-format game_id: season * 1_000_000 + moneypuck_game_id
    mp_game_id = _safe_int(row.get("game_id"))
    if mp_game_id is None:
        return None
    nhl_game_id = season * 1_000_000 + mp_game_id

    out: Dict[str, Any] = {
        "game_id": nhl_game_id,
        "season":  season,
    }

    # Apply direct mapping
    for mp_col, rs_col in COLUMN_MAP.items():
        v = row.get(mp_col)
        if rs_col in INT_COLUMNS:
            out[rs_col] = _safe_int(v)
        elif rs_col in FLOAT_COLUMNS:
            out[rs_col] = _safe_float(v)
        elif rs_col in BOOL_COLUMNS:
            out[rs_col] = _safe_bool(v)
        elif rs_col in STR_COLUMNS:
            out[rs_col] = _safe_str(v)
        else:
            out[rs_col] = v  # passthrough — should not happen if maps are complete

    # Derived: shot_type_code from MoneyPuck event
    event = _safe_str(row.get("event"))
    out["shot_type_code"] = EVENT_TO_TYPECODE.get(event) if event else None

    # Derived: shot_type (lowercase form)
    out["shot_type"] = SHOT_TYPE_NORMALIZE(row.get("shotType"))

    # STRICT NULL on the 7 moat features (NEVER 0 — would corrupt xG v3 training)
    for moat_col in MOAT_FEATURES_NULL_FOR_HISTORICAL:
        out[moat_col] = None

    # Require core identity + geometry to be present
    if out["player_id"] is None or out["shot_x"] is None or out["shot_y"] is None:
        return None

    return out


def _format_elapsed(s: float) -> str:
    if s < 60:
        return f"{s:.1f}s"
    if s < 3600:
        return f"{s/60:.1f}m"
    return f"{s/3600:.2f}h"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--csv", required=True, help="Path to MoneyPuck shots CSV")
    parser.add_argument("--season", type=int, required=True,
                        help="4-digit short-form season to load (e.g. 2024 = 2024-25)")
    parser.add_argument("--batch-size", type=int, default=5000,
                        help="Chunked-CSV pandas read size and DB upsert batch size")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse + map + summarize without writing")
    parser.add_argument("--game-id", type=int, default=None,
                        help="Filter to a single NHL game_id (10-digit form, "
                             "e.g. 2024020001). Applied post-mapping against "
                             "the derived NHL game_id, not the MoneyPuck 5-digit "
                             "source value. Default None = no filter.")
    args = parser.parse_args()

    if not os.path.exists(args.csv):
        print(f"ERROR: CSV not found at {args.csv}")
        return 1

    print("=" * 80)
    print(f"Load Historical Shots CSV — season={args.season}  csv={args.csv}")
    print(f"Mode: {'DRY-RUN (no writes)' if args.dry_run else 'LIVE (UPSERTs to prod)'}")
    print(f"Batch size: {args.batch_size}")
    if args.game_id is not None:
        print(f"Filter: --game-id {args.game_id} (single-game post-mapping filter)")
    print("=" * 80)

    # Print the mapping for visual inspection
    print("\nMoneyPuck → raw_shots column map (alphabetical by source):")
    for mp_col in sorted(COLUMN_MAP.keys()):
        print(f"  {mp_col:60} → {COLUMN_MAP[mp_col]}")
    print(f"  (derived)                                              → game_id  [season*1_000_000 + moneypuck_game_id]")
    print(f"  (derived)                                              → season   [from --season]")
    print(f"  event                                                  → shot_type_code  [SHOT→506 GOAL→505 MISS→507]")
    print(f"  shotType                                               → shot_type       [lowercased]")
    print(f"  (NULL)                                                 → {{7 moat features — never 0}}")

    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY) if not args.dry_run else None

    mapped_rows: List[dict] = []
    unmappable = 0
    filtered_by_game_id = 0
    total_seen = 0
    season_filtered = 0
    first_5_examples: List[dict] = []
    distinct_game_ids: set = set()
    moat_check: Dict[str, int] = {k: 0 for k in MOAT_FEATURES_NULL_FOR_HISTORICAL}

    start_ts = time.time()
    upserted = 0
    batches_done = 0
    last_progress = start_ts

    chunksize = args.batch_size
    print(f"\nReading {args.csv} in chunks of {chunksize}...")
    for chunk in pd.read_csv(args.csv, chunksize=chunksize, low_memory=False):
        total_seen += len(chunk)
        # Filter to the target season — MoneyPuck `season` is 4-digit short form integer
        chunk_filtered = chunk[chunk["season"].astype(str).astype(int) == args.season]
        season_filtered += len(chunk_filtered)
        if chunk_filtered.empty:
            continue

        batch: List[dict] = []
        for _, row in chunk_filtered.iterrows():
            row_dict = row.to_dict()
            mapped = map_row(row_dict, args.season)
            if mapped is None:
                unmappable += 1
                continue
            if args.game_id is not None and mapped["game_id"] != args.game_id:
                filtered_by_game_id += 1
                continue
            batch.append(mapped)
            distinct_game_ids.add(mapped["game_id"])
            if len(first_5_examples) < 5:
                first_5_examples.append(mapped)
            for moat_col in MOAT_FEATURES_NULL_FOR_HISTORICAL:
                if mapped.get(moat_col) is None:
                    moat_check[moat_col] += 1

        if not batch:
            continue

        if args.dry_run:
            mapped_rows.extend(batch)
        else:
            try:
                # ============================================================
                # TRAP-DOOR: DO NOT RE-RUN AFTER PHASE 0C COMPLETION
                # ------------------------------------------------------------
                # This loader explicitly writes NULL to the 7 moat features:
                #   pass_quality_score, pass_immediacy_score, goalie_movement_score,
                #   pass_zone_encoded, pass_lateral_distance, pass_to_net_distance,
                #   has_pass_before_shot
                #
                # Supabase REST UPSERT uses Prefer: resolution=merge-duplicates,
                # which overwrites ALL payload columns INCLUDING NULLs on conflict.
                # Re-running this loader after Phase 0c populates moat features for
                # historical seasons WILL CLOBBER those features back to NULL.
                #
                # Safe re-run paths post-0c:
                #   (a) Modify loader to omit the 7 moat columns from the payload
                #       entirely (so they are not written at all on conflict), OR
                #   (b) Add precondition filter: WHERE season < 2025
                #                                AND has_pass_before_shot IS NULL
                #
                # See apps/web/docs/GAPS_AND_FUTURE_CAPABILITIES.md §15.
                # ============================================================
                db.upsert("raw_shots", batch,
                          on_conflict="game_id,player_id,shot_x,shot_y,shot_type_code")
                upserted += len(batch)
            except Exception as e:
                print(f"\nERROR upserting batch ({len(batch)} rows): {e}")
                print(f"Aborting — investigate the failed batch then re-run.")
                return 2

        batches_done += 1
        now = time.time()
        if now - last_progress >= 10:
            elapsed = now - start_ts
            print(f"  [progress] {season_filtered:,} rows filtered, "
                  f"{(upserted if not args.dry_run else len(mapped_rows)):,} processed, "
                  f"{batches_done} batches, elapsed {_format_elapsed(elapsed)}")
            last_progress = now

    total_elapsed = time.time() - start_ts
    rows_processed = len(mapped_rows) if args.dry_run else upserted

    print("\n" + "=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"Total CSV rows scanned:    {total_seen:,}")
    print(f"Rows matching season {args.season}: {season_filtered:,}")
    print(f"Unmappable rows:           {unmappable}")
    if args.game_id is not None:
        print(f"Filtered by --game-id {args.game_id}: {filtered_by_game_id:,}")
    print(f"{'Mapped (dry-run)' if args.dry_run else 'Upserted to raw_shots'}: {rows_processed:,}")
    print(f"Distinct game_ids:         {len(distinct_game_ids)}  (range: {min(distinct_game_ids) if distinct_game_ids else 'n/a'} .. {max(distinct_game_ids) if distinct_game_ids else 'n/a'})")
    print(f"Wall-clock:                {_format_elapsed(total_elapsed)}")

    print("\nMoat-feature NULL check (must all equal mapped row count):")
    for moat_col in MOAT_FEATURES_NULL_FOR_HISTORICAL:
        ok = "OK " if moat_check[moat_col] == rows_processed else "FAIL"
        print(f"  [{ok}] {moat_col:32} NULL on {moat_check[moat_col]} / {rows_processed} rows")

    if args.dry_run and first_5_examples:
        print("\nFirst 5 mapped rows (raw_shots dict shape — for review):")
        for i, ex in enumerate(first_5_examples, 1):
            print(f"\n  --- row {i} ---")
            for k, v in sorted(ex.items()):
                print(f"    {k:50} = {v!r}")

    print("\nDONE.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
