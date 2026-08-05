#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     xG v4 retrain — 0E-XG-6. Regenerate 2025 slice via fixed extractor,
#              JOIN Phase 0c moat features from prod raw_shots across ALL 9 seasons,
#              DROP is_rush (never fires at inference), NO clipping anywhere,
#              per-shot-type isotonic calibration on a held-out slice of the train set,
#              train 2017-2022, hold out 2023-2024, report metrics side-by-side vs v3.
# Last active: 2026-08-04
# Invoked:     manual one-shot:
#                python scripts/utilities/train_xg_v4.py --env-file .env.prod \
#                    [--skip-2025] [--out-suffix v4]
# Reads:       data-pipeline/data/historical/shots_2017.csv + shots_2018-2024.csv
#              PROD raw_shots (moat cols for 2017-2024, entire row for 2025)
#              PROD raw_nhl_data (2025 raw_json for re-extraction — optional, see --skip-2025)
# Writes:      LOCAL disk only:
#              data-pipeline/models/xg_model_moneypuck_v4.joblib
#              data-pipeline/models/model_features_moneypuck_v4.joblib
#              data-pipeline/models/xg_shot_type_calibration_v4.joblib
#              data-pipeline/models/train_xg_v4_report.json
# NOT:         prod raw_shots, prod xg_value, prod xg_value_recomputed
# ────────────────────────────────────────────────────────────
"""
xG v4 training pipeline — 0E-XG-6.

Design decisions
================

R1  2025 slice regenerated from raw_nhl_data.raw_json using the fixed extractor
    on this branch (fix/0e-xg-5-inference-feature-contract). The old
    data/shots_full_features_2025.csv is discarded — it carries the mirrored
    geometry from before the S1+S2 fix.

R2  Moat features are joined from prod raw_shots for the 2017-2024 seasons on
    (game_id, player_id, shot_x, shot_y, shot_type_code). Populated ratio per
    season is reported before training and captured in the JSON report. Rows
    without a moat match retain 0 / "no_pass" as before, BUT the ratio is now
    visible and the model is no longer implicitly told "moat === 0 for historic".

R3  is_rush is DROPPED from the feature set. Rationale: inference never
    populates the field on shot records (data_acquisition.py:3381 comment
    `NOTE: is_rush removed`). Training on a feature that is always 0 in
    production ships a systematic bias into every prediction — better to drop
    it than train on it. This is a deliberate, non-recoverable choice for v4;
    if a valid pre-shot rush signal is engineered later, add it back and
    retrain.

R4  Per-shot-type isotonic calibration is fit on a held-out 10% slice of the
    2017-2022 training set (calibration split, not the eval hold-out).
    Applied at prediction time. Save as xg_shot_type_calibration_v4.joblib.

R5  Train: 2017-2022. Hold-out for evaluation: 2023-2024. Metrics computed
    on the held-out shots ONLY, printed to stdout AND persisted to
    train_xg_v4_report.json.

R6  Zero clip() calls anywhere in the training script or the calibration path.

R7  Nothing is written to prod. Model artifacts land under
    data-pipeline/models/. Operator moves them into place after review.

Feature set (30 features = V3 minus is_rush):
    distance, angle (SIGNED), is_slot_shot, shot_type_encoded, is_rebound,
    is_empty_net, is_power_play, score_differential,
    defending_team_skaters_on_ice, period, time_since_powerplay_started,
    east_west_location_of_shot, north_south_location_of_shot,
    east_west_location_of_last_event, arena_adjusted_shot_distance,
    distance_angle_interaction, last_event_category_encoded,
    time_since_last_event, distance_from_last_event, speed_from_last_event,
    speed_from_last_event_log, shot_angle_plus_rebound_speed,
    shot_angle_rebound_royal_road, has_pass_before_shot,
    pass_lateral_distance, pass_to_net_distance, pass_immediacy_score,
    goalie_movement_score, pass_quality_score, pass_zone_encoded

Metrics vs MoneyPuck reference (from user):
    calibration       target within +/-6%     (MP: -0.43%)
    separation        target 2.0 - 6.0        (MP:  3.38)
    non-goals > 0.30  target 0.8 - 5.0%       (MP:  1.892%)
    modal share       target < 3% on any value (MP: 0.675-1.775%)
    Pearson r vs MP xg_value on same held-out shots (report only)
    AUC (v4 vs v3) side-by-side on the held-out set
    Top 15 feature importances
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from scipy.stats import pearsonr
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score, brier_score_loss, log_loss
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier
import joblib

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

# ---------------------------------------------------------------------------
# Paths + bootstrap
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "data-pipeline"))
sys.path.insert(0, str(_REPO_ROOT / "data-pipeline" / "acquisition"))
sys.path.insert(0, str(_REPO_ROOT / "data-pipeline" / "utils"))
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "utilities"))
import _bootstrap  # noqa: F401

from dotenv import dotenv_values

MODEL_DIR = _REPO_ROOT / "data-pipeline" / "models"
HISTORICAL_DIR = _REPO_ROOT / "data-pipeline" / "data" / "historical"
CSV_2017 = HISTORICAL_DIR / "shots_2017.csv"
CSV_2018_2024 = HISTORICAL_DIR / "shots_2018-2024.csv"

# ---------------------------------------------------------------------------
# Feature set (V3 minus is_rush) + shared enums
# ---------------------------------------------------------------------------
V4_FEATURES: Tuple[str, ...] = (
    # Core geometry
    "distance", "angle", "is_slot_shot",
    # Shot context
    "shot_type_encoded", "is_rebound", "is_empty_net", "is_power_play", "score_differential",
    # Game state
    "defending_team_skaters_on_ice", "period", "time_since_powerplay_started",
    # Spatial
    "east_west_location_of_shot", "north_south_location_of_shot",
    "east_west_location_of_last_event", "arena_adjusted_shot_distance",
    "distance_angle_interaction",
    # Last event
    "last_event_category_encoded", "time_since_last_event",
    "distance_from_last_event", "speed_from_last_event", "speed_from_last_event_log",
    "shot_angle_plus_rebound_speed", "shot_angle_rebound_royal_road",
    # Pass context / MOAT (7)
    "has_pass_before_shot", "pass_lateral_distance", "pass_to_net_distance",
    "pass_immediacy_score", "goalie_movement_score", "pass_quality_score",
    "pass_zone_encoded",
)
assert len(V4_FEATURES) == 30, f"expected 30 features, got {len(V4_FEATURES)}"

SHOT_TYPE_MAP = {
    "WRIST": "wrist", "SNAP": "snap", "SLAP": "slap", "BACK": "backhand",
    "BACKHAND": "backhand", "TIP": "tip-in", "TIP-IN": "tip-in",
    "DEFL": "deflected", "DEFLECTED": "deflected", "WRAP": "wrap-around",
    "WRAP-AROUND": "wrap-around", "BAT": "bat", "BETWEEN LEGS": "between-legs",
    "POKE": "poke", "CRADLE": "wrist",
}
ALL_SHOT_TYPES = sorted(set(SHOT_TYPE_MAP.values()))
LAST_EVENT_CATEGORIES = ["BLOCK", "CHL", "FAC", "GIVE", "GOAL",
                         "HIT", "MISS", "OTHER", "PENL", "SHOT", "STOP", "TAKE"]
ALL_PASS_ZONES = sorted([
    "blue_line_high_angle", "blue_line_low_angle", "crease", "deep",
    "high_slot_high_angle", "high_slot_low_angle", "no_pass",
    "slot_high_angle", "slot_low_angle",
])

MOAT_COLS: Tuple[str, ...] = (
    "has_pass_before_shot", "pass_lateral_distance", "pass_to_net_distance",
    "pass_immediacy_score", "goalie_movement_score", "pass_quality_score",
    "pass_zone",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
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


def _fmt(sec: float) -> str:
    if sec < 60:
        return f"{sec:.1f}s"
    if sec < 3600:
        return f"{sec / 60:.1f}m"
    return f"{sec / 3600:.2f}h"


def _safe_num(s: pd.Series, default: float = 0.0) -> pd.Series:
    return pd.to_numeric(s, errors="coerce").fillna(default)


def compute_slot_shot(distance: pd.Series, y_coord: pd.Series) -> pd.Series:
    d = _safe_num(distance, 999)
    y = _safe_num(y_coord, 999)
    in_slot = (d < 25) & (y.abs() < 15)
    dist_comp = np.maximum(0.0, 1.0 - d / 25.0)
    lat_comp = np.maximum(0.0, 1.0 - y.abs() / 15.0)
    score = dist_comp * 0.6 + lat_comp * 0.4
    return score.where(in_slot, 0.0)


# ---------------------------------------------------------------------------
# Step 1 — MoneyPuck loader (2017-2024). Uses signed shotAngle / xCordAdjusted.
# ---------------------------------------------------------------------------
def load_moneypuck_seasons(csvs: List[Path], seasons_wanted: Optional[List[int]] = None) -> pd.DataFrame:
    frames: List[pd.DataFrame] = []
    for path in csvs:
        if not path.exists():
            raise SystemExit(f"MoneyPuck CSV missing: {path}")
        print(f"  Loading {path.name} ...", flush=True)
        df = pd.read_csv(path, low_memory=False)
        df["season"] = pd.to_numeric(df["season"], errors="coerce").astype("Int64")
        if seasons_wanted:
            df = df[df["season"].isin(seasons_wanted)]
        df = df[df["event"].isin(["SHOT", "MISS", "GOAL"])].copy()
        frames.append(df)
    full = pd.concat(frames, ignore_index=True)
    print(f"  Raw MoneyPuck rows across CSVs: {len(full):,}", flush=True)

    # Build NHL game_id: season * 1_000_000 + game_id (MoneyPuck's 5-digit)
    full["nhl_game_id"] = (
        full["season"].astype("int64") * 1_000_000 + full["game_id"].astype("int64")
    )

    # ---- Target ----
    full["is_goal"] = full["goal"].astype(int)

    # ---- Geometry (SIGNED — same convention v3 trained against, keeps parity) ----
    full["distance"] = _safe_num(full["shotDistance"])
    full["angle"] = _safe_num(full["shotAngle"])  # SIGNED
    full["is_slot_shot"] = compute_slot_shot(full["distance"], full["yCordAdjusted"])

    # ---- Shot type ----
    full["shot_type_raw"] = (
        full["shotType"].astype(str).str.strip().str.upper().map(SHOT_TYPE_MAP).fillna("wrist")
    )

    # ---- Shot context ----
    full["is_rebound"] = _safe_num(full["shotRebound"]).astype(int)
    full["is_empty_net"] = _safe_num(full["shotOnEmptyNet"]).astype(int)

    home_sk = _safe_num(full["homeSkatersOnIce"], 5)
    away_sk = _safe_num(full["awaySkatersOnIce"], 5)
    is_home = (full["team"] == "HOME")
    shooting_sk = np.where(is_home, home_sk, away_sk)
    defending_sk = np.where(is_home, away_sk, home_sk)
    full["defending_team_skaters_on_ice"] = defending_sk
    full["is_power_play"] = (shooting_sk > defending_sk).astype(int)

    home_goals = _safe_num(full["homeTeamGoals"])
    away_goals = _safe_num(full["awayTeamGoals"])
    full["score_differential"] = np.where(is_home, home_goals - away_goals, away_goals - home_goals)

    full["period"] = _safe_num(full["period"], 1).astype(int)
    pen_time_left = _safe_num(full.get("homePenalty1TimeLeft", pd.Series(0, index=full.index)))
    pen_length = _safe_num(full.get("homePenalty1Length", pd.Series(0, index=full.index)))
    full["time_since_powerplay_started"] = np.where(
        full["is_power_play"] == 1, np.maximum(0, pen_length - pen_time_left), 0
    )

    # ---- Spatial (SIGNED) ----
    full["east_west_location_of_shot"] = _safe_num(full["xCordAdjusted"])
    full["north_south_location_of_shot"] = _safe_num(full["yCordAdjusted"])
    full["east_west_location_of_last_event"] = _safe_num(full["lastEventxCord_adjusted"])
    full["arena_adjusted_shot_distance"] = _safe_num(full["arenaAdjustedShotDistance"]).fillna(full["distance"])
    full["distance_angle_interaction"] = full["distance"] * full["angle"].abs() / 100.0

    # ---- Last event ----
    full["last_event_category_raw"] = full["lastEventCategory"].astype(str).str.strip().str.upper().fillna("OTHER")
    full["time_since_last_event"] = _safe_num(full["timeSinceLastEvent"])
    full["distance_from_last_event"] = _safe_num(full["distanceFromLastEvent"])
    full["speed_from_last_event"] = _safe_num(full["speedFromLastEvent"])
    full["speed_from_last_event_log"] = np.log1p(full["speed_from_last_event"].abs())
    full["shot_angle_plus_rebound_speed"] = _safe_num(full.get("shotAnglePlusReboundSpeed"))
    full["shot_angle_rebound_royal_road"] = _safe_num(full.get("shotAngleReboundRoyalRoad"))

    # ---- Moat placeholders (filled by join in step 3) ----
    full["has_pass_before_shot"] = 0
    full["pass_lateral_distance"] = 0.0
    full["pass_to_net_distance"] = 0.0
    full["pass_immediacy_score"] = 0.0
    full["goalie_movement_score"] = 0.0
    full["pass_quality_score"] = 0.0
    full["pass_zone_raw"] = "no_pass"

    # ---- MoneyPuck key columns for the join (raw NHL xCord/yCord + player + shot_type_code) ----
    # MoneyPuck 'event' maps to typeCode: GOAL=505, SHOT=506, MISS=507
    _event_tc = {"GOAL": 505, "SHOT": 506, "MISS": 507}
    full["shot_type_code"] = full["event"].map(_event_tc).astype("Int64")
    full["player_id_join"] = _safe_num(full["shooterPlayerId"], 0).astype("Int64")
    # Round the raw (unflipped, matches loader) to int for join
    full["shot_x_join"] = _safe_num(full["xCord"], 0).round().astype("Int64")
    full["shot_y_join"] = _safe_num(full["yCord"], 0).round().astype("Int64")

    return full


# ---------------------------------------------------------------------------
# Step 2 — 2025 slice regen from raw_nhl_data (uses fixed extractor)
# ---------------------------------------------------------------------------
def regen_2025_slice(env_url: str, env_key: str) -> pd.DataFrame:
    from data_acquisition import (  # noqa
        _extract_shots_from_game,
        SHOT_TYPE_ENCODER,
    )
    from data_pipeline.utils.supabase_rest import SupabaseRest
    db = SupabaseRest(env_url, env_key)

    print("  [2025-regen] enumerating processed games ...", flush=True)
    gids: List[int] = []
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
        page = sorted({int(r["game_id"]) for r in rows if r.get("game_id") is not None})
        in_range = [g for g in page if 2025 * 1_000_000 <= g < 2026 * 1_000_000]
        gids.extend(in_range)
        if page[-1] >= 2026 * 1_000_000:
            break
        last_gid = page[-1]
        if len(rows) < PAGE:
            break
    gids = sorted(set(gids))
    print(f"  [2025-regen] {len(gids)} games", flush=True)

    frames = []
    last = time.time()
    for i, gid in enumerate(gids, 1):
        try:
            r = db.select("raw_nhl_data", select="raw_json",
                          filters=[("game_id", "eq", gid)], limit=1)
        except Exception:
            continue
        if not r:
            continue
        raw_json = r[0].get("raw_json")
        if isinstance(raw_json, str):
            try:
                raw_json = json.loads(raw_json)
            except Exception:
                continue
        if not isinstance(raw_json, dict):
            continue
        try:
            shots = _extract_shots_from_game(raw_json, game_id=gid, db_client=db)
        except Exception:
            continue
        if not shots:
            continue
        df = pd.DataFrame(shots)
        df["nhl_game_id"] = gid
        df["season"] = 2025
        frames.append(df)
        if time.time() - last >= 10:
            print(f"    [2025-regen] game {i}/{len(gids)}  rows_so_far={sum(len(f) for f in frames):,}",
                  flush=True)
            last = time.time()

    if not frames:
        print("  [2025-regen] no rows produced", flush=True)
        return pd.DataFrame()

    df25 = pd.concat(frames, ignore_index=True)
    print(f"  [2025-regen] {len(df25):,} rows extracted", flush=True)

    # Map inference schema → training schema
    # is_goal from shot_type_code == 505
    df25["is_goal"] = (df25.get("shot_type_code", 0).fillna(0).astype(int) == 505).astype(int)
    # angle already signed thanks to the S1+S2 fix on this branch
    df25.rename(columns={"pass_zone": "pass_zone_raw"}, inplace=True, errors="ignore")
    if "pass_zone_raw" not in df25.columns:
        df25["pass_zone_raw"] = "no_pass"
    df25["pass_zone_raw"] = df25["pass_zone_raw"].fillna("no_pass")

    # Shot type text: extractor already stored 'shot_type' (lowercase technique)
    df25["shot_type_raw"] = df25.get("shot_type", "wrist").astype(str).str.lower().fillna("wrist")

    # last_event_category was written as a text label ('SHOT', 'FAC', etc.)
    df25["last_event_category_raw"] = df25.get("last_event_category", "OTHER").astype(str).str.upper().fillna("OTHER")

    # is_slot_shot in inference is already a float [0,1] — keep as is
    # north_south_location_of_shot / east_west_location_of_shot etc. are populated
    # by the FIXED extractor (post-S1+S2) with the correct axis convention.

    # Fill numeric NaNs on the model features
    for col in ("distance", "angle", "arena_adjusted_shot_distance",
                "distance_angle_interaction",
                "east_west_location_of_shot", "north_south_location_of_shot",
                "east_west_location_of_last_event",
                "time_since_last_event", "distance_from_last_event",
                "speed_from_last_event", "speed_from_last_event_log",
                "shot_angle_plus_rebound_speed", "shot_angle_rebound_royal_road",
                "score_differential", "period", "time_since_powerplay_started",
                "defending_team_skaters_on_ice", "is_rebound", "is_empty_net",
                "is_power_play", "has_pass_before_shot", "pass_lateral_distance",
                "pass_to_net_distance", "pass_immediacy_score", "goalie_movement_score",
                "pass_quality_score"):
        if col in df25.columns:
            df25[col] = pd.to_numeric(df25[col], errors="coerce").fillna(0)

    if "distance_angle_interaction" not in df25.columns:
        df25["distance_angle_interaction"] = df25["distance"] * df25["angle"].abs() / 100.0
    if "speed_from_last_event_log" not in df25.columns and "speed_from_last_event" in df25.columns:
        df25["speed_from_last_event_log"] = np.log1p(df25["speed_from_last_event"].abs())
    if "is_slot_shot" not in df25.columns and "distance" in df25.columns:
        df25["is_slot_shot"] = compute_slot_shot(df25["distance"], df25.get("north_south_location_of_shot", pd.Series(0, index=df25.index)))

    return df25


# ---------------------------------------------------------------------------
# Step 3 — moat join from prod raw_shots (2017-2024). Report hit-rate per season.
# ---------------------------------------------------------------------------
def _fetch_moat_for_season(db, season: int) -> pd.DataFrame:
    """Per-game iteration mirroring scripts/utilities/transfer_moat_to_prod.py.

    Rationale for NOT id-keyset here: the previous version keyset on `id` with
    `seen_last = season_min - 1 = 2016999999` — but `id` is the BIGSERIAL
    primary key (range ~1..1M), not game_id. `id > 2016999999` matched zero
    rows for every season and 8 identical empty results were silently
    concatenated into the training frame. Fixed by walking distinct game_ids
    within the season's band and fetching each game's rows directly (each
    call bounded to ~85 rows, so no scan-forward statement-timeout risk
    either — the same pattern that unblocked the moat transfer).
    """
    from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa
    season_min = season * 1_000_000
    season_max = (season + 1) * 1_000_000 - 1
    select_cols = "game_id,player_id,shot_x,shot_y,shot_type_code," + ",".join(MOAT_COLS)

    # (a) enumerate distinct game_ids in the season by paginating game_id (not id)
    game_ids: List[int] = []
    last_gid: int = season_min - 1  # game_id-space cursor now, not id
    PAGE_GAMES = 1000
    while True:
        rows = db.select(
            "raw_shots",
            select="game_id",
            filters=[("game_id", "gt", last_gid)],
            limit=PAGE_GAMES,
            order="game_id",
        )
        if not rows:
            break
        page_gids = sorted({int(r["game_id"]) for r in rows if r.get("game_id") is not None})
        if not page_gids or page_gids[0] > season_max:
            break
        in_range = [g for g in page_gids if g <= season_max]
        game_ids.extend(in_range)
        if page_gids[-1] > season_max:
            break
        last_gid = page_gids[-1]
        if len(rows) < PAGE_GAMES:
            break
    game_ids = sorted(set(game_ids))
    print(f"    [moat-fetch] season {season}: {len(game_ids)} distinct game_ids", flush=True)

    # (b) per-game fetch — each call is bounded to the game's shot count (~85)
    frames: List[pd.DataFrame] = []
    for i, gid in enumerate(game_ids, 1):
        try:
            page = db.select(
                "raw_shots",
                select=select_cols,
                filters=[("game_id", "eq", gid)],
                limit=1000, order="id",
            )
        except Exception as e:
            # RAISE, not swallow. This is what was hiding the id-keyset bug before.
            raise RuntimeError(f"[moat-fetch] season {season} game {gid} select failed: {e}") from e
        if page:
            frames.append(pd.DataFrame(page))
        if i % 200 == 0:
            print(f"      [moat-fetch] season {season}: {i}/{len(game_ids)} games", flush=True)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def join_moat_into_mp(mp: pd.DataFrame, env_url: str, env_key: str) -> Tuple[pd.DataFrame, Dict[int, Dict[str, Any]]]:
    from data_pipeline.utils.supabase_rest import SupabaseRest
    db = SupabaseRest(env_url, env_key)
    hitrate: Dict[int, Dict[str, Any]] = {}
    seasons = sorted(mp["season"].dropna().unique().astype(int))
    for season in seasons:
        print(f"  [moat-join] season {season}: fetching raw_shots ...", flush=True)
        rs = _fetch_moat_for_season(db, int(season))
        if rs.empty:
            print(f"  [moat-join] season {season}: 0 rows returned from raw_shots", flush=True)
            hitrate[int(season)] = {"mp_rows": int((mp["season"] == season).sum()),
                                    "rs_rows": 0, "joined": 0, "pct_joined": 0.0}
            continue
        # Round key numerics for stable join
        rs["shot_x"] = pd.to_numeric(rs["shot_x"], errors="coerce").round().astype("Int64")
        rs["shot_y"] = pd.to_numeric(rs["shot_y"], errors="coerce").round().astype("Int64")
        rs["player_id_join"] = pd.to_numeric(rs["player_id"], errors="coerce").astype("Int64")
        rs["shot_type_code"] = pd.to_numeric(rs["shot_type_code"], errors="coerce").astype("Int64")
        rs["nhl_game_id"] = pd.to_numeric(rs["game_id"], errors="coerce").astype("int64")
        mask_season = (mp["season"] == season)
        left = mp.loc[mask_season, ["nhl_game_id", "player_id_join", "shot_x_join", "shot_y_join", "shot_type_code"]].copy()
        left["shot_x_join"] = left["shot_x_join"].astype("Int64")
        left["shot_y_join"] = left["shot_y_join"].astype("Int64")
        right = rs[["nhl_game_id", "player_id_join", "shot_x", "shot_y", "shot_type_code"] + list(MOAT_COLS)].copy()
        # Dedupe right on the join key (multiple raw_shots rows per (game, player, x, y, type) rare but real)
        right = right.drop_duplicates(subset=["nhl_game_id", "player_id_join", "shot_x", "shot_y", "shot_type_code"], keep="first")
        merged = left.merge(
            right,
            left_on=["nhl_game_id", "player_id_join", "shot_x_join", "shot_y_join", "shot_type_code"],
            right_on=["nhl_game_id", "player_id_join", "shot_x", "shot_y", "shot_type_code"],
            how="left",
        )
        joined_mask = merged["has_pass_before_shot"].notna()
        n_mp = int(mask_season.sum())
        n_joined = int(joined_mask.sum())
        pct = (n_joined / n_mp * 100) if n_mp else 0.0
        hitrate[int(season)] = {"mp_rows": n_mp, "rs_rows": int(len(rs)),
                                "joined": n_joined, "pct_joined": round(pct, 3)}
        print(f"  [moat-join] season {season}: mp={n_mp:,}, rs={len(rs):,}, joined={n_joined:,} ({pct:.2f}%)",
              flush=True)
        # Fill moat cols on the MP frame in place
        for col in MOAT_COLS:
            if col == "pass_zone":
                mp.loc[mask_season, "pass_zone_raw"] = merged[col].fillna("no_pass").values
            else:
                default = 0 if col == "has_pass_before_shot" else 0.0
                mp.loc[mask_season, col] = pd.to_numeric(merged[col], errors="coerce").fillna(default).values
    return mp, hitrate


# ---------------------------------------------------------------------------
# Step 4 — Encode categoricals (fit fresh encoders on the training superset)
# ---------------------------------------------------------------------------
def fit_and_encode(df_all: pd.DataFrame) -> Tuple[pd.DataFrame, LabelEncoder, LabelEncoder, LabelEncoder]:
    shot_enc = LabelEncoder().fit(ALL_SHOT_TYPES)
    event_enc = LabelEncoder().fit(LAST_EVENT_CATEGORIES)
    zone_enc = LabelEncoder().fit(ALL_PASS_ZONES)

    df_all["shot_type_raw"] = df_all["shot_type_raw"].apply(
        lambda v: v if v in set(shot_enc.classes_) else "wrist"
    )
    df_all["shot_type_encoded"] = shot_enc.transform(df_all["shot_type_raw"])
    df_all["last_event_category_raw"] = df_all["last_event_category_raw"].apply(
        lambda v: v if v in set(event_enc.classes_) else "OTHER"
    )
    df_all["last_event_category_encoded"] = event_enc.transform(df_all["last_event_category_raw"])
    df_all["pass_zone_raw"] = df_all["pass_zone_raw"].apply(
        lambda v: v if v in set(zone_enc.classes_) else "no_pass"
    )
    df_all["pass_zone_encoded"] = zone_enc.transform(df_all["pass_zone_raw"])
    return df_all, shot_enc, event_enc, zone_enc


# ---------------------------------------------------------------------------
# Step 5 — Train + hold-out evaluate + per-shot-type calibration
# ---------------------------------------------------------------------------
def train_and_eval(df_all: pd.DataFrame) -> Dict[str, Any]:
    train_mask = df_all["season"].between(2017, 2022)
    hold_mask  = df_all["season"].isin([2023, 2024])
    train = df_all[train_mask].copy()
    hold  = df_all[hold_mask].copy()
    print(f"  train rows: {len(train):,}  (seasons 2017-2022)", flush=True)
    print(f"  hold  rows: {len(hold):,}   (seasons 2023-2024)", flush=True)

    # Split train into train + calibration slice (90/10).
    # NOTE: train_test_split unpacks 2*N arrays for N inputs; passing X, y AND
    # shot_type returns 6 values. Split into two passes with a shared random
    # index instead (cleaner and avoids the unpack pitfall).
    X_train_all = train[list(V4_FEATURES)]
    y_train_all = train["is_goal"].astype(int)
    shot_type_train_all = train["shot_type_raw"].reset_index(drop=True)
    X_train_all = X_train_all.reset_index(drop=True)
    y_train_all = y_train_all.reset_index(drop=True)
    idx_tr, idx_cal = train_test_split(
        np.arange(len(X_train_all)),
        test_size=0.10, stratify=y_train_all.values, random_state=42,
    )
    X_tr = X_train_all.iloc[idx_tr]
    X_cal = X_train_all.iloc[idx_cal]
    y_tr = y_train_all.iloc[idx_tr]
    y_cal = y_train_all.iloc[idx_cal]
    cal_shot_type = shot_type_train_all.iloc[idx_cal].reset_index(drop=True)
    print(f"  fitting XGBClassifier on {len(X_tr):,} rows (cal split held: {len(X_cal):,}) ...", flush=True)
    t0 = time.time()
    model = XGBClassifier(
        n_estimators=800,
        max_depth=6,
        learning_rate=0.05,
        min_child_weight=5,
        subsample=0.85,
        colsample_bytree=0.85,
        objective="binary:logistic",
        eval_metric="auc",
        n_jobs=-1,
        tree_method="hist",
        random_state=42,
    )
    model.fit(X_tr, y_tr, verbose=False)
    print(f"  trained in {_fmt(time.time() - t0)}", flush=True)

    # Fit per-shot-type isotonic calibrators on the held-out cal slice
    print("  fitting per-shot-type isotonic calibration ...", flush=True)
    raw_cal = model.predict_proba(X_cal)[:, 1]
    iso_global = IsotonicRegression(out_of_bounds="clip").fit(raw_cal, y_cal.values)
    iso_by_type: Dict[str, IsotonicRegression] = {}
    for st in ALL_SHOT_TYPES:
        m = (cal_shot_type == st)
        if m.sum() >= 500:
            iso = IsotonicRegression(out_of_bounds="clip").fit(raw_cal[m.values], y_cal.values[m.values])
            iso_by_type[st] = iso
    calibrators = {"global": iso_global, "by_shot_type": iso_by_type}

    # Predict on held-out (uncalibrated + calibrated) — NO CLIP
    print("  predicting on hold-out ...", flush=True)
    X_hold = hold[list(V4_FEATURES)]
    y_hold = hold["is_goal"].astype(int).values
    raw_hold = model.predict_proba(X_hold)[:, 1]
    cal_hold = np.empty_like(raw_hold)
    for i in range(len(raw_hold)):
        st = hold["shot_type_raw"].iloc[i]
        iso = iso_by_type.get(st, iso_global)
        cal_hold[i] = iso.predict([raw_hold[i]])[0]

    # Metrics
    def _metrics(pred: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
        goals_actual = int(y.sum())
        goals_pred = float(pred.sum())
        calib_pct = ((goals_pred - goals_actual) / goals_actual * 100) if goals_actual else float("nan")
        mask_g = (y == 1)
        avg_g = float(pred[mask_g].mean()) if mask_g.any() else float("nan")
        avg_ng = float(pred[~mask_g].mean()) if (~mask_g).any() else float("nan")
        sep = (avg_g / avg_ng) if avg_ng > 0 else float("nan")
        nongoal_over_030 = float((pred[~mask_g] > 0.30).mean() * 100)
        # Modal share: round to 3 decimals and take max bin fraction
        rounded = np.round(pred, 3)
        _, counts = np.unique(rounded, return_counts=True)
        modal_share_pct = float(counts.max() / len(pred) * 100)
        try:
            auc = float(roc_auc_score(y, pred))
        except Exception:
            auc = float("nan")
        try:
            brier = float(brier_score_loss(y, pred))
        except Exception:
            brier = float("nan")
        return {
            "n": int(len(pred)),
            "goals_actual": goals_actual,
            "sum_pred": round(goals_pred, 2),
            "calibration_pct": round(calib_pct, 3),
            "avg_pred_on_goals": round(avg_g, 4),
            "avg_pred_on_nongoals": round(avg_ng, 4),
            "separation_ratio": round(sep, 3),
            "nongoals_over_0_30_pct": round(nongoal_over_030, 3),
            "modal_share_pct": round(modal_share_pct, 3),
            "auc": round(auc, 4),
            "brier": round(brier, 5),
        }

    m_raw = _metrics(raw_hold, y_hold)
    m_cal = _metrics(cal_hold, y_hold)

    # Pearson r vs MoneyPuck's xg_value on the same held-out shots (MP xg column
    # is `xGoal` in the raw CSV — pulled through as `xg_value` in MP-frame).
    mp_pred = pd.to_numeric(hold.get("xGoal", pd.Series(np.nan, index=hold.index)), errors="coerce").values
    valid = ~np.isnan(mp_pred)
    corr_raw = corr_cal = float("nan")
    if valid.any():
        try:
            corr_raw = float(pearsonr(raw_hold[valid], mp_pred[valid])[0])
        except Exception:
            corr_raw = float("nan")
        try:
            corr_cal = float(pearsonr(cal_hold[valid], mp_pred[valid])[0])
        except Exception:
            corr_cal = float("nan")

    # AUC of v3 model on the same held-out slice (if the joblib is present).
    v3_auc: Optional[float] = None
    v3_path = MODEL_DIR / "xg_model_moneypuck.joblib"
    v3_feat_path = MODEL_DIR / "model_features_moneypuck.joblib"
    if v3_path.exists() and v3_feat_path.exists():
        try:
            v3 = joblib.load(v3_path)
            v3_feats = joblib.load(v3_feat_path)
            # Provide 0 for is_rush (v3 has it, v4 doesn't)
            X_v3 = hold.copy()
            if "is_rush" not in X_v3.columns:
                X_v3["is_rush"] = 0
            X_v3 = X_v3[list(v3_feats)]
            pred_v3 = v3.predict_proba(X_v3)[:, 1]
            v3_auc = float(roc_auc_score(y_hold, pred_v3))
        except Exception as e:
            print(f"  [warn] could not evaluate v3 on hold-out: {e}", flush=True)

    # Top 15 feature importances
    fi = model.get_booster().get_score(importance_type="gain")
    top_importances = sorted(fi.items(), key=lambda kv: kv[1], reverse=True)[:15]
    top_importances_named = [{"feature": k, "gain": round(v, 2)} for k, v in top_importances]

    return {
        "train_rows": int(len(X_train_all)),
        "cal_rows": int(len(X_cal)),
        "hold_rows": int(len(hold)),
        "hold_uncalibrated": m_raw,
        "hold_calibrated": m_cal,
        "pearson_vs_moneypuck": {
            "n_valid": int(valid.sum()),
            "raw": round(corr_raw, 4) if corr_raw == corr_raw else None,
            "calibrated": round(corr_cal, 4) if corr_cal == corr_cal else None,
        },
        "auc_v4_hold": m_raw["auc"],
        "auc_v4_calibrated_hold": m_cal["auc"],
        "auc_v3_hold": round(v3_auc, 4) if v3_auc is not None else None,
        "top_importances": top_importances_named,
        "_artifacts": {
            "model": model,
            "calibrators": calibrators,
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="0E-XG-6 — xG v4 retrain")
    ap.add_argument("--env-file", type=str, required=True, help="Env file for prod (moat join + 2025 regen)")
    ap.add_argument("--skip-2025", action="store_true",
                    help="Skip the 2025 slice regeneration (fast dev iteration only)")
    ap.add_argument("--out-suffix", type=str, default="v4",
                    help="Suffix for saved model / feature / calibration joblibs")
    args = ap.parse_args()

    env = _load_env(args.env_file)
    print("=" * 80)
    print(f"xG v4 retrain — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"features: {len(V4_FEATURES)} (v3 minus is_rush)")
    print(f"out suffix: {args.out_suffix}")
    print(f"skip 2025: {args.skip_2025}")
    print("=" * 80, flush=True)

    print("\n[1/5] Loading MoneyPuck 2017-2024 ...", flush=True)
    csvs = [CSV_2017, CSV_2018_2024]
    mp = load_moneypuck_seasons(csvs, seasons_wanted=list(range(2017, 2025)))
    print(f"  MoneyPuck total: {len(mp):,} rows across {mp['season'].nunique()} seasons", flush=True)

    print("\n[2/5] Joining Phase 0c moat features from prod raw_shots ...", flush=True)
    mp, moat_hitrate = join_moat_into_mp(mp, env["url"], env["key"])
    # F4: hard gate on moat hit-rate per season. If we're materially below the
    # empirically-verified target rate, the join key is wrong and training on
    # zero-filled moat columns would silently degrade v4 — abort.
    MIN_HIT_PCT = 90.0
    bad = [(s, h) for s, h in moat_hitrate.items() if h["pct_joined"] < MIN_HIT_PCT]
    if bad:
        print("\nABORT: moat-join hit-rate below 90% for one or more seasons.", flush=True)
        for s, h in sorted(bad):
            print(f"  season {s}: joined {h['joined']:,}/{h['mp_rows']:,} = {h['pct_joined']:.2f}%",
                  flush=True)
        print("Do NOT proceed to training. Verify the join key first.", flush=True)
        return 3

    print("\n[3/5] Regenerating 2025 slice from raw_nhl_data ...", flush=True)
    if args.skip_2025:
        print("  --skip-2025 set; using empty frame for 2025 slice", flush=True)
        df25 = pd.DataFrame()
    else:
        df25 = regen_2025_slice(env["url"], env["key"])

    print("\n[4/5] Combining frames + encoding + fit ...", flush=True)
    # Ensure both frames have the same schema on the training columns
    keep = [
        "season", "is_goal", "shot_type_raw", "last_event_category_raw", "pass_zone_raw",
    ] + list(V4_FEATURES)
    # For MP frame we also carry xGoal for Pearson r later
    if "xGoal" in mp.columns:
        keep_mp = keep + ["xGoal"]
    else:
        keep_mp = keep
    mp_sub = mp[[c for c in keep_mp if c in mp.columns]].copy()
    if not df25.empty:
        # 2025 rows don't have xGoal (no MP reference for the current season)
        df25["xGoal"] = np.nan
        df25["season"] = 2025
        df25_sub = df25[[c for c in keep_mp if c in df25.columns]].copy()
        # Add any missing columns as defaults
        for c in keep_mp:
            if c not in df25_sub.columns:
                df25_sub[c] = 0 if c in V4_FEATURES else "no_pass" if "raw" in c else np.nan
        df_all = pd.concat([mp_sub, df25_sub], ignore_index=True)
    else:
        df_all = mp_sub

    print(f"  combined rows: {len(df_all):,}", flush=True)
    df_all, shot_enc, event_enc, zone_enc = fit_and_encode(df_all)

    print("\n[5/5] Train + hold-out evaluate ...", flush=True)
    result = train_and_eval(df_all)

    # ── Persist artifacts locally ─────────────────────────────────────────
    artifacts = result.pop("_artifacts")
    model = artifacts["model"]
    calibrators = artifacts["calibrators"]
    model_out = MODEL_DIR / f"xg_model_moneypuck_{args.out_suffix}.joblib"
    feat_out = MODEL_DIR / f"model_features_moneypuck_{args.out_suffix}.joblib"
    enc_shot_out = MODEL_DIR / f"shot_type_encoder_{args.out_suffix}.joblib"
    enc_event_out = MODEL_DIR / f"last_event_category_encoder_{args.out_suffix}.joblib"
    enc_zone_out = MODEL_DIR / f"pass_zone_encoder_{args.out_suffix}.joblib"
    calib_out = MODEL_DIR / f"xg_shot_type_calibration_{args.out_suffix}.joblib"
    report_out = MODEL_DIR / f"train_xg_{args.out_suffix}_report.json"

    joblib.dump(model, model_out)
    joblib.dump(list(V4_FEATURES), feat_out)
    joblib.dump(shot_enc, enc_shot_out)
    joblib.dump(event_enc, enc_event_out)
    joblib.dump(zone_enc, enc_zone_out)
    joblib.dump(calibrators, calib_out)

    report = {
        "features": list(V4_FEATURES),
        "n_features": len(V4_FEATURES),
        "moat_join_hit_rate_by_season": moat_hitrate,
        "train_rows": result["train_rows"],
        "cal_rows": result["cal_rows"],
        "hold_rows": result["hold_rows"],
        "hold_uncalibrated": result["hold_uncalibrated"],
        "hold_calibrated": result["hold_calibrated"],
        "pearson_vs_moneypuck": result["pearson_vs_moneypuck"],
        "auc_v3_hold": result["auc_v3_hold"],
        "auc_v4_hold": result["auc_v4_hold"],
        "auc_v4_calibrated_hold": result["auc_v4_calibrated_hold"],
        "top_importances_gain": result["top_importances"],
        "notes": {
            "is_rush": "DROPPED — inference never populates. See data_acquisition.py:3381.",
            "clipping": "NONE anywhere in this training or in prediction.",
            "calibration": "Per-shot-type isotonic on a 10% held-out slice of 2017-2022.",
            "geometry": "Signed angle + MP-consistent flip inherited from fix branch fix/0e-xg-5-inference-feature-contract.",
        },
    }
    with open(report_out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    # ── Console summary ───────────────────────────────────────────────────
    print("\n" + "=" * 80)
    print("R5 REPORT — v4 held-out (2023-2024)")
    print("=" * 80)
    for k, v in report["hold_uncalibrated"].items():
        print(f"  raw.{k:<25}  {v}")
    print()
    for k, v in report["hold_calibrated"].items():
        print(f"  cal.{k:<25}  {v}")
    print()
    print(f"  Pearson r vs MoneyPuck xg_value: raw={report['pearson_vs_moneypuck']['raw']}  "
          f"calibrated={report['pearson_vs_moneypuck']['calibrated']}  "
          f"(n={report['pearson_vs_moneypuck']['n_valid']})")
    print()
    print(f"  AUC v3 on same hold-out: {report['auc_v3_hold']}")
    print(f"  AUC v4 raw:              {report['auc_v4_hold']}")
    print(f"  AUC v4 calibrated:       {report['auc_v4_calibrated_hold']}")
    print()
    print("  Top 15 features by gain:")
    for row in report["top_importances_gain"]:
        print(f"    {row['gain']:>10.1f}  {row['feature']}")
    print()
    print("  Moat-join hit rate by season:")
    for season, h in sorted(report["moat_join_hit_rate_by_season"].items()):
        print(f"    {season}: mp={h['mp_rows']:,}  rs={h['rs_rows']:,}  "
              f"joined={h['joined']:,} ({h['pct_joined']:.2f}%)")
    print()
    print(f"  Artifacts written:")
    for p in (model_out, feat_out, enc_shot_out, enc_event_out, enc_zone_out, calib_out, report_out):
        print(f"    {p}")
    print("=" * 80)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
