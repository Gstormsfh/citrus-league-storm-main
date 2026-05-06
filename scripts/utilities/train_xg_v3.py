#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose: Train xG v3 model on 786K MoneyPuck + 77K Citrus PBP shots (XGBoost, AUC 0.817)
# Invoked: manual operator run after raw_shots refresh; produces models/xg_model_moneypuck.joblib
# Reads:   data-pipeline/data/historical/shots_2018-2024.csv, data/shots_full_features_2025.csv
# Writes:  models/xg_model_moneypuck.joblib + feature/encoder joblibs
# ────────────────────────────────────────────────────────────
"""
train_xg_v3.py  --  xG Model v3 Training Pipeline
===================================================
Trains on ~863K real NHL shots:
  - 786K MoneyPuck historical  (data-pipeline/data/historical/shots_2018-2024.csv)
  -  77K from our PBP pipeline (data/shots_full_features_2025.csv)

Per the R3 reorg (2026-05-05) the historical training data lives at
data-pipeline/data/historical/ instead of data/. See that directory's
README.md for re-download instructions if the file is missing locally.

Key design principle:
  Every feature MUST be derivable from live NHL play-by-play data.
  The 7 pass-context features (our moat) are set to 0 / "no_pass" for
  historical MoneyPuck data because that source does not contain pass info.

Usage:
    python scripts/utilities/train_xg_v3.py
"""

import os
import sys
import shutil
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import roc_auc_score, brier_score_loss, log_loss, r2_score
from xgboost import XGBClassifier
import joblib

warnings.filterwarnings("ignore", category=UserWarning)

# ---------------------------------------------------------------------------
# Constants & Config
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent.parent          # two dirs up
DATA_DIR = ROOT / "data"
MODEL_DIR = ROOT / "models"
# Historical MoneyPuck CSV moved to data-pipeline/data/historical/ in the
# R2/R3 data-reorg. Current-season Citrus PbP exports stay at data/.
HISTORICAL_DIR = ROOT / "data-pipeline" / "data" / "historical"
MP_HISTORICAL = HISTORICAL_DIR / "shots_2018-2024.csv"
OUR_SHOTS = DATA_DIR / "shots_full_features_2025.csv"

# 31 features the v3 model uses  (order matters at prediction time)
V3_FEATURES = [
    # Core geometry (3)
    "distance",
    "angle",
    "is_slot_shot",
    # Shot context (6)
    "shot_type_encoded",
    "is_rebound",
    "is_rush",
    "is_empty_net",
    "is_power_play",
    "score_differential",
    # Game state (3)
    "defending_team_skaters_on_ice",
    "period",
    "time_since_powerplay_started",
    # Spatial (5)
    "east_west_location_of_shot",
    "north_south_location_of_shot",
    "east_west_location_of_last_event",
    "arena_adjusted_shot_distance",
    "distance_angle_interaction",
    # Last event (7)
    "last_event_category_encoded",
    "time_since_last_event",
    "distance_from_last_event",
    "speed_from_last_event",
    "speed_from_last_event_log",
    "shot_angle_plus_rebound_speed",
    "shot_angle_rebound_royal_road",
    # Pass context / MOAT (7)
    "has_pass_before_shot",
    "pass_lateral_distance",
    "pass_to_net_distance",
    "pass_immediacy_score",
    "goalie_movement_score",
    "pass_quality_score",
    "pass_zone_encoded",
]

assert len(V3_FEATURES) == 31, f"Expected 31 features, got {len(V3_FEATURES)}"

# MoneyPuck uppercase shot type -> our lowercase
SHOT_TYPE_MAP = {
    "WRIST": "wrist",
    "SNAP": "snap",
    "SLAP": "slap",
    "BACK": "backhand",
    "BACKHAND": "backhand",
    "TIP": "tip-in",
    "TIP-IN": "tip-in",
    "DEFL": "deflected",
    "DEFLECTED": "deflected",
    "WRAP": "wrap-around",
    "WRAP-AROUND": "wrap-around",
    "BAT": "bat",
    "BETWEEN LEGS": "between-legs",
    "POKE": "poke",
    "CRADLE": "wrist",
}

ALL_SHOT_TYPES = sorted(list(set(SHOT_TYPE_MAP.values())))       # 10 unique
LAST_EVENT_CATEGORIES = [
    "BLOCK", "CHL", "FAC", "GIVE", "GOAL",
    "HIT", "MISS", "OTHER", "PENL", "SHOT", "STOP", "TAKE",
]
ALL_PASS_ZONES = sorted([
    "blue_line_high_angle", "blue_line_low_angle", "crease", "deep",
    "high_slot_high_angle", "high_slot_low_angle", "no_pass",
    "slot_high_angle", "slot_low_angle",
])

MOAT_FEATS = {
    "has_pass_before_shot",
    "pass_lateral_distance",
    "pass_to_net_distance",
    "pass_immediacy_score",
    "goalie_movement_score",
    "pass_quality_score",
    "pass_zone_encoded",
}

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def compute_slot_shot(distance, y_coord):
    """
    Vectorised slot-shot score (same formula as data_acquisition.py).
    Returns a float Series in [0, 1] -- 0 when outside the slot.
    """
    distance = pd.to_numeric(distance, errors="coerce").fillna(999)
    y_coord = pd.to_numeric(y_coord, errors="coerce").fillna(999)
    in_slot = (distance < 25) & (y_coord.abs() < 15)
    dist_comp = np.maximum(0.0, 1.0 - distance / 25.0)
    lat_comp = np.maximum(0.0, 1.0 - y_coord.abs() / 15.0)
    score = dist_comp * 0.6 + lat_comp * 0.4
    return score.where(in_slot, 0.0)


def safe_col(df, col, default=0.0):
    """Return df[col].fillna(default) if col exists, else a constant Series."""
    if col in df.columns:
        return pd.to_numeric(df[col], errors="coerce").fillna(default)
    return pd.Series(default, index=df.index)


# ---------------------------------------------------------------------------
# load_moneypuck_historical
# ---------------------------------------------------------------------------

def load_moneypuck_historical(path):
    """Load & transform MoneyPuck shots_2018-2024.csv into v3 feature space."""
    print(f"Loading MoneyPuck historical data from {path} ...")
    df = pd.read_csv(path, low_memory=False)
    print(f"  Raw rows: {len(df):,}")

    # Keep only real shot events
    df = df[df["event"].isin(["SHOT", "MISS", "GOAL"])].copy()
    print(f"  After SHOT/MISS/GOAL filter: {len(df):,}")

    # --- Target ---
    df["is_goal"] = df["goal"].astype(int)

    # --- Core geometry ---
    df["distance"] = pd.to_numeric(df["shotDistance"], errors="coerce").fillna(0)
    df["angle"] = pd.to_numeric(df["shotAngle"], errors="coerce").fillna(0)
    df["is_slot_shot"] = compute_slot_shot(df["distance"], df["yCordAdjusted"])

    # --- Shot type ---
    df["shot_type_raw"] = (
        df["shotType"]
        .astype(str)
        .str.strip()
        .str.upper()
        .map(SHOT_TYPE_MAP)
        .fillna("wrist")
    )

    # --- Shot context ---
    df["is_rebound"] = pd.to_numeric(df["shotRebound"], errors="coerce").fillna(0).astype(int)
    df["is_rush"] = pd.to_numeric(df["shotRush"], errors="coerce").fillna(0).astype(int)
    df["is_empty_net"] = pd.to_numeric(df["shotOnEmptyNet"], errors="coerce").fillna(0).astype(int)

    # --- Skater / power-play logic ---
    home_sk = pd.to_numeric(df["homeSkatersOnIce"], errors="coerce").fillna(5)
    away_sk = pd.to_numeric(df["awaySkatersOnIce"], errors="coerce").fillna(5)
    is_home = (df["team"] == "HOME")
    shooting_sk = np.where(is_home, home_sk, away_sk)
    defending_sk = np.where(is_home, away_sk, home_sk)
    df["defending_team_skaters_on_ice"] = defending_sk
    df["is_power_play"] = (shooting_sk > defending_sk).astype(int)

    # --- Score differential ---
    home_goals = pd.to_numeric(df["homeTeamGoals"], errors="coerce").fillna(0)
    away_goals = pd.to_numeric(df["awayTeamGoals"], errors="coerce").fillna(0)
    df["score_differential"] = np.where(is_home, home_goals - away_goals, away_goals - home_goals)

    # --- Period ---
    df["period"] = pd.to_numeric(df["period"], errors="coerce").fillna(1).astype(int)

    # --- Power-play time approximation ---
    pen_time_left = pd.to_numeric(
        df.get("homePenalty1TimeLeft", df.get("awayPenalty1TimeLeft", pd.Series(0, index=df.index))),
        errors="coerce",
    ).fillna(0)
    pen_length = pd.to_numeric(
        df.get("homePenalty1Length", df.get("awayPenalty1Length", pd.Series(0, index=df.index))),
        errors="coerce",
    ).fillna(0)
    df["time_since_powerplay_started"] = np.where(
        df["is_power_play"] == 1,
        np.maximum(0, pen_length - pen_time_left),
        0,
    )

    # --- Spatial ---
    df["east_west_location_of_shot"] = pd.to_numeric(df["xCordAdjusted"], errors="coerce").fillna(0)
    df["north_south_location_of_shot"] = pd.to_numeric(df["yCordAdjusted"], errors="coerce").fillna(0)
    df["east_west_location_of_last_event"] = pd.to_numeric(df["lastEventxCord_adjusted"], errors="coerce").fillna(0)
    df["arena_adjusted_shot_distance"] = pd.to_numeric(df["arenaAdjustedShotDistance"], errors="coerce").fillna(df["distance"])
    df["distance_angle_interaction"] = df["distance"] * df["angle"].abs() / 100.0

    # --- Last event ---
    df["last_event_category_raw"] = df["lastEventCategory"].astype(str).str.strip().str.upper().fillna("OTHER")
    df["time_since_last_event"] = pd.to_numeric(df["timeSinceLastEvent"], errors="coerce").fillna(0)
    df["distance_from_last_event"] = pd.to_numeric(df["distanceFromLastEvent"], errors="coerce").fillna(0)
    df["speed_from_last_event"] = pd.to_numeric(df["speedFromLastEvent"], errors="coerce").fillna(0)
    df["speed_from_last_event_log"] = np.log1p(df["speed_from_last_event"].abs())
    df["shot_angle_plus_rebound_speed"] = pd.to_numeric(df["shotAnglePlusReboundSpeed"], errors="coerce").fillna(0)
    df["shot_angle_rebound_royal_road"] = pd.to_numeric(df["shotAngleReboundRoyalRoad"], errors="coerce").fillna(0)

    # --- Pass context (NOT available in MoneyPuck data -- zero them out) ---
    df["has_pass_before_shot"] = 0
    df["pass_lateral_distance"] = 0.0
    df["pass_to_net_distance"] = 0.0
    df["pass_immediacy_score"] = 0.0
    df["goalie_movement_score"] = 0.0
    df["pass_quality_score"] = 0.0
    df["pass_zone_raw"] = "no_pass"

    df["source"] = "moneypuck"
    print(f"  Goals: {df['is_goal'].sum():,} ({df['is_goal'].mean()*100:.2f}%)")
    return df


# ---------------------------------------------------------------------------
# load_our_shots
# ---------------------------------------------------------------------------

def load_our_shots(path):
    """Load & transform our PBP-pipeline shots into v3 feature space."""
    print(f"\nLoading our PBP shots from {path} ...")
    df = pd.read_csv(path, low_memory=False)
    print(f"  Raw rows: {len(df):,}")

    # --- Target ---
    df["is_goal"] = safe_col(df, "is_goal", 0).astype(int)

    # --- Core geometry ---
    df["distance"] = safe_col(df, "distance")
    df["angle"] = safe_col(df, "angle")
    df["is_slot_shot"] = compute_slot_shot(
        df["distance"],
        safe_col(df, "north_south_location_of_shot", 0),
    )

    # --- Shot type (already lowercase in our data) ---
    if "shot_type" in df.columns:
        df["shot_type_raw"] = df["shot_type"].astype(str).str.strip().str.lower()
    else:
        df["shot_type_raw"] = "wrist"

    # --- Shot context ---
    df["is_rebound"] = safe_col(df, "is_rebound", 0).astype(int)
    df["is_rush"] = safe_col(df, "is_rush", 0).astype(int)
    df["is_empty_net"] = safe_col(df, "is_empty_net", 0).astype(int)
    df["is_power_play"] = safe_col(df, "is_power_play", 0).astype(int)
    df["score_differential"] = safe_col(df, "score_differential", 0)

    # --- Game state ---
    df["defending_team_skaters_on_ice"] = safe_col(df, "defending_team_skaters_on_ice", 5)
    df["period"] = safe_col(df, "period", 1).astype(int)
    df["time_since_powerplay_started"] = safe_col(df, "time_since_powerplay_started", 0)

    # --- Spatial ---
    df["east_west_location_of_shot"] = safe_col(df, "east_west_location_of_shot", 0)
    df["north_south_location_of_shot"] = safe_col(df, "north_south_location_of_shot", 0)
    df["east_west_location_of_last_event"] = safe_col(df, "east_west_location_of_last_event", 0)
    df["arena_adjusted_shot_distance"] = safe_col(df, "arena_adjusted_shot_distance", df["distance"])
    df["distance_angle_interaction"] = df["distance"] * df["angle"].abs() / 100.0

    # --- Last event ---
    if "last_event_category" in df.columns:
        df["last_event_category_raw"] = df["last_event_category"].astype(str).str.strip().str.upper().fillna("OTHER")
    else:
        df["last_event_category_raw"] = "OTHER"
    df["time_since_last_event"] = safe_col(df, "time_since_last_event", 0)
    df["distance_from_last_event"] = safe_col(df, "distance_from_last_event", 0)
    df["speed_from_last_event"] = safe_col(df, "speed_from_last_event", 0)
    df["speed_from_last_event_log"] = np.log1p(df["speed_from_last_event"].abs())
    df["shot_angle_plus_rebound_speed"] = safe_col(df, "shot_angle_plus_rebound_speed", 0)
    df["shot_angle_rebound_royal_road"] = safe_col(df, "shot_angle_rebound_royal_road", 0)

    # --- Pass context (REAL values from our PBP pipeline -- our MOAT) ---
    df["has_pass_before_shot"] = safe_col(df, "has_pass_before_shot", 0)
    df["pass_lateral_distance"] = safe_col(df, "pass_lateral_distance", 0)
    df["pass_to_net_distance"] = safe_col(df, "pass_to_net_distance", 0)
    df["pass_immediacy_score"] = safe_col(df, "pass_immediacy_score", 0)
    df["goalie_movement_score"] = safe_col(df, "goalie_movement_score", 0)
    df["pass_quality_score"] = safe_col(df, "pass_quality_score", 0)

    # pass_zone handling: if already numeric (encoded), set to "no_pass" for re-encoding
    if "pass_zone_encoded" in df.columns and df["pass_zone_encoded"].dtype in ("int64", "float64"):
        df["pass_zone_raw"] = "no_pass"
    elif "pass_zone" in df.columns:
        df["pass_zone_raw"] = df["pass_zone"].astype(str).str.strip().fillna("no_pass")
    else:
        df["pass_zone_raw"] = "no_pass"

    df["source"] = "our_pbp"
    print(f"  Goals: {df['is_goal'].sum():,} ({df['is_goal'].mean()*100:.2f}%)")
    return df


# ---------------------------------------------------------------------------
# encode_categoricals
# ---------------------------------------------------------------------------

def encode_categoricals(df, shot_enc, event_enc, zone_enc):
    """
    Encode shot_type_raw, last_event_category_raw, pass_zone_raw using the
    fitted LabelEncoders.  Unknown values are mapped to a safe default before
    transform().
    """
    # Shot type
    known_shots = set(shot_enc.classes_)
    df["shot_type_raw"] = df["shot_type_raw"].apply(
        lambda v: v if v in known_shots else "wrist"
    )
    df["shot_type_encoded"] = shot_enc.transform(df["shot_type_raw"])

    # Last event category
    known_events = set(event_enc.classes_)
    df["last_event_category_raw"] = df["last_event_category_raw"].apply(
        lambda v: v if v in known_events else "OTHER"
    )
    df["last_event_category_encoded"] = event_enc.transform(df["last_event_category_raw"])

    # Pass zone
    known_zones = set(zone_enc.classes_)
    df["pass_zone_raw"] = df["pass_zone_raw"].apply(
        lambda v: v if v in known_zones else "no_pass"
    )
    df["pass_zone_encoded"] = zone_enc.transform(df["pass_zone_raw"])

    return df


# ---------------------------------------------------------------------------
# evaluate
# ---------------------------------------------------------------------------

def evaluate(model, X, y, label):
    """Compute AUC-ROC, Brier, log-loss, R^2 and print. Returns dict."""
    probs = model.predict_proba(X)[:, 1]
    auc = roc_auc_score(y, probs)
    brier = brier_score_loss(y, probs)
    ll = log_loss(y, probs)
    r2 = r2_score(y, probs)
    print(f"  [{label:12s}]  AUC={auc:.4f}  Brier={brier:.4f}  LogLoss={ll:.4f}  R2={r2:.4f}  (n={len(y):,})")
    return {"label": label, "auc": auc, "brier": brier, "logloss": ll, "r2": r2, "n": len(y)}


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    print("=" * 80)
    print("xG MODEL v3 TRAINING PIPELINE")
    print("=" * 80)
    print(f"  ROOT      : {ROOT}")
    print(f"  DATA_DIR  : {DATA_DIR}")
    print(f"  MODEL_DIR : {MODEL_DIR}")
    print(f"  Features  : {len(V3_FEATURES)}")
    print()

    # ------------------------------------------------------------------
    # 1. Load both datasets
    # ------------------------------------------------------------------
    df_mp = load_moneypuck_historical(MP_HISTORICAL)
    df_our = load_our_shots(OUR_SHOTS)
    df = pd.concat([df_mp, df_our], ignore_index=True)
    print(f"\nCombined dataset: {len(df):,} shots  ({df['is_goal'].sum():,} goals, {df['is_goal'].mean()*100:.2f}%)")
    print(f"  MoneyPuck : {(df['source']=='moneypuck').sum():,}")
    print(f"  Our PBP   : {(df['source']=='our_pbp').sum():,}")

    # ------------------------------------------------------------------
    # 2. Fit LabelEncoders on predefined category lists & encode
    # ------------------------------------------------------------------
    shot_enc = LabelEncoder()
    shot_enc.fit(ALL_SHOT_TYPES)

    event_enc = LabelEncoder()
    event_enc.fit(LAST_EVENT_CATEGORIES)

    zone_enc = LabelEncoder()
    zone_enc.fit(ALL_PASS_ZONES)

    print(f"\nShot types  ({len(ALL_SHOT_TYPES)}): {ALL_SHOT_TYPES}")
    print(f"Event cats  ({len(LAST_EVENT_CATEGORIES)}): {LAST_EVENT_CATEGORIES}")
    print(f"Pass zones  ({len(ALL_PASS_ZONES)}): {ALL_PASS_ZONES}")

    df = encode_categoricals(df, shot_enc, event_enc, zone_enc)

    # ------------------------------------------------------------------
    # 3. Prepare feature matrix
    # ------------------------------------------------------------------
    for feat in V3_FEATURES:
        if feat not in df.columns:
            print(f"  [WARNING] Missing feature '{feat}' -- filling with 0")
            df[feat] = 0.0
        df[feat] = pd.to_numeric(df[feat], errors="coerce").fillna(0)

    # Replace any remaining inf / -inf
    df[V3_FEATURES] = df[V3_FEATURES].replace([np.inf, -np.inf], 0)

    X = df[V3_FEATURES].values
    y = df["is_goal"].values

    print(f"\nFeature matrix: {X.shape}")
    print(f"Target balance: {y.sum():,} goals / {len(y):,} shots ({y.mean()*100:.2f}%)")

    # ------------------------------------------------------------------
    # 4. Split 80/10/10 (train / val / test), stratified
    # ------------------------------------------------------------------
    X_train, X_temp, y_train, y_temp, idx_train, idx_temp = train_test_split(
        X, y, df.index.values, test_size=0.20, random_state=42, stratify=y,
    )
    X_val, X_test, y_val, y_test, idx_val, idx_test = train_test_split(
        X_temp, y_temp, idx_temp, test_size=0.50, random_state=42, stratify=y_temp,
    )
    print(f"  Train : {len(y_train):,}  Val : {len(y_val):,}  Test : {len(y_test):,}")

    # ------------------------------------------------------------------
    # 5. Train XGBClassifier
    # ------------------------------------------------------------------
    print("\nTraining XGBoost v3 ...")
    model = XGBClassifier(
        n_estimators=1000,
        max_depth=7,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=10,
        reg_alpha=0.1,
        reg_lambda=1.0,
        eval_metric="logloss",
        early_stopping_rounds=50,
        random_state=42,
        n_jobs=-1,
        use_label_encoder=False,
    )
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=50,
    )
    print(f"Best iteration: {model.best_iteration}")

    # ------------------------------------------------------------------
    # 6. Evaluate
    # ------------------------------------------------------------------
    print("\n--- Evaluation ---")
    evaluate(model, X_train, y_train, "Train")
    eval_val = evaluate(model, X_val, y_val, "Validation")
    eval_test = evaluate(model, X_test, y_test, "Test")

    # Evaluate on our_pbp subset only
    our_mask = df.loc[idx_test, "source"].values == "our_pbp"
    if our_mask.sum() > 0:
        evaluate(model, X_test[our_mask], y_test[our_mask], "OurPBP_test")
    else:
        print("  [OurPBP_test] No our_pbp samples in test split.")

    # ------------------------------------------------------------------
    # 7. Feature importance
    # ------------------------------------------------------------------
    print("\n--- Feature Importance ---")
    importances = model.feature_importances_
    fi = sorted(zip(V3_FEATURES, importances), key=lambda t: t[1], reverse=True)
    for feat, imp in fi:
        tag = " [MOAT]" if feat in MOAT_FEATS else ""
        print(f"  {feat:40s} {imp:.4f}{tag}")

    # ------------------------------------------------------------------
    # 8. Calibration check (8 buckets)
    # ------------------------------------------------------------------
    print("\n--- Calibration Check (Test Set) ---")
    test_probs = model.predict_proba(X_test)[:, 1]
    bins = [0, 0.02, 0.05, 0.08, 0.12, 0.20, 0.35, 0.50, 1.01]
    bin_labels = ["0-2%", "2-5%", "5-8%", "8-12%", "12-20%", "20-35%", "35-50%", "50%+"]
    bucket_idx = np.digitize(test_probs, bins) - 1
    bucket_idx = np.clip(bucket_idx, 0, len(bin_labels) - 1)

    print(f"  {'Bucket':>10s}  {'Count':>8s}  {'Pred%':>8s}  {'Actual%':>8s}  {'Diff':>8s}")
    print(f"  {'-'*10}  {'-'*8}  {'-'*8}  {'-'*8}  {'-'*8}")
    for i, lbl in enumerate(bin_labels):
        mask = bucket_idx == i
        if mask.sum() == 0:
            continue
        pred_pct = test_probs[mask].mean() * 100
        actual_pct = y_test[mask].mean() * 100
        diff = pred_pct - actual_pct
        print(f"  {lbl:>10s}  {mask.sum():>8,}  {pred_pct:>7.2f}%  {actual_pct:>7.2f}%  {diff:>+7.2f}%")

    # ------------------------------------------------------------------
    # 9. Save model & artefacts
    # ------------------------------------------------------------------
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # Backup v2 model if no backup exists yet
    v2_model_path = MODEL_DIR / "xg_model_moneypuck.joblib"
    v2_backup_path = MODEL_DIR / "xg_model_moneypuck_v2_backup.joblib"
    if v2_model_path.exists() and not v2_backup_path.exists():
        shutil.copy2(v2_model_path, v2_backup_path)
        print(f"\n  Backed up v2 model -> {v2_backup_path.name}")

    v2_feat_path = MODEL_DIR / "model_features_moneypuck.joblib"
    v2_feat_backup = MODEL_DIR / "model_features_moneypuck_v2_backup.joblib"
    if v2_feat_path.exists() and not v2_feat_backup.exists():
        shutil.copy2(v2_feat_path, v2_feat_backup)
        print(f"  Backed up v2 features -> {v2_feat_backup.name}")

    v2_enc_path = MODEL_DIR / "last_event_category_encoder.joblib"
    v2_enc_backup = MODEL_DIR / "last_event_category_encoder_v2_backup.joblib"
    if v2_enc_path.exists() and not v2_enc_backup.exists():
        shutil.copy2(v2_enc_path, v2_enc_backup)
        print(f"  Backed up v2 event encoder -> {v2_enc_backup.name}")

    # Save new model
    joblib.dump(model, MODEL_DIR / "xg_model_moneypuck.joblib")
    print(f"\n  Saved model            -> xg_model_moneypuck.joblib")

    # Save feature list
    joblib.dump(V3_FEATURES, MODEL_DIR / "model_features_moneypuck.joblib")
    print(f"  Saved feature list     -> model_features_moneypuck.joblib")

    # Save all 3 encoders
    joblib.dump(shot_enc, MODEL_DIR / "shot_type_encoder.joblib")
    print(f"  Saved shot_type enc    -> shot_type_encoder.joblib")

    joblib.dump(event_enc, MODEL_DIR / "last_event_category_encoder.joblib")
    print(f"  Saved event_cat enc    -> last_event_category_encoder.joblib")

    joblib.dump(zone_enc, MODEL_DIR / "pass_zone_encoder.joblib")
    print(f"  Saved pass_zone enc    -> pass_zone_encoder.joblib")

    # ------------------------------------------------------------------
    # 10. Summary
    # ------------------------------------------------------------------
    print("\n" + "=" * 80)
    print("TRAINING COMPLETE -- xG Model v3 Summary")
    print("=" * 80)
    print(f"  Total shots trained on : {len(y):,}")
    print(f"    MoneyPuck historical : {(df['source']=='moneypuck').sum():,}")
    print(f"    Our PBP pipeline     : {(df['source']=='our_pbp').sum():,}")
    print(f"  Features               : {len(V3_FEATURES)}")
    print(f"    MOAT (pass context)  : {len(MOAT_FEATS)}")
    print(f"  Best iteration         : {model.best_iteration}")
    print(f"  Test AUC               : {eval_test['auc']:.4f}")
    print(f"  Test Brier             : {eval_test['brier']:.4f}")
    print(f"  Test LogLoss           : {eval_test['logloss']:.4f}")
    print(f"  Artefacts saved to     : {MODEL_DIR}")
    print("=" * 80)


if __name__ == "__main__":
    main()
