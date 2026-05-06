#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose: Train per-shot-type isotonic calibration on top of xG v3 (commit 6e18851)
# Invoked: manual operator run after train_xg_v3.py
# Reads:   models/xg_model_moneypuck.joblib + held-out validation shots
# Writes:  models/xg_shot_type_calibration.joblib
# ────────────────────────────────────────────────────────────
"""
train_xg_calibration.py
Trains per-shot-type isotonic regression calibration models for xG.

The base XGBoost xG model systematically overvalues certain shot types
(tip-ins, deflections, wrap-arounds, bat shots) and slightly undervalues
others (slap shots, snap shots). This script trains isotonic regression
models per shot type to correct the calibration.

Usage:
    python scripts/utilities/train_xg_calibration.py

Output:
    models/xg_shot_type_calibration.joblib
"""

import os
import sys
import pandas as pd
import numpy as np
from sklearn.isotonic import IsotonicRegression
import joblib

def train_calibration_models(shots_csv='data/our_shots_2025.csv', output_path=None, min_shots=30):
    """
    Train per-shot-type isotonic regression calibration models.

    Uses empirical data to learn the mapping from raw xG predictions
    to calibrated probabilities, separately for each shot type.

    Args:
        shots_csv: Path to shot-level data CSV
        output_path: Where to save the calibration models
        min_shots: Minimum shots for a shot type to get its own model

    Returns:
        Dictionary with calibration models and metadata
    """
    if output_path is None:
        output_path = os.path.join(os.path.dirname(__file__), '..', '..', 'models', 'xg_shot_type_calibration.joblib')

    print("=" * 70)
    print("TRAINING XG SHOT-TYPE CALIBRATION MODELS")
    print("=" * 70)

    # Load shot data
    df = pd.read_csv(shots_csv, usecols=['shot_type', 'is_goal', 'xg_value', 'distance'])
    print(f"Loaded {len(df):,} shots, {int(df['is_goal'].sum()):,} goals")

    # Train global isotonic model (fallback)
    iso_global = IsotonicRegression(out_of_bounds='clip', y_min=0.001, y_max=0.95)
    iso_global.fit(df['xg_value'].values, df['is_goal'].values)
    print(f"\nGlobal isotonic model trained on {len(df):,} shots")

    # Train per-shot-type models
    shot_type_models = {}
    shot_type_stats = {}

    for st in sorted(df['shot_type'].dropna().unique()):
        mask = df['shot_type'] == st
        n_shots = mask.sum()
        n_goals = int(df.loc[mask, 'is_goal'].sum())
        avg_xg = df.loc[mask, 'xg_value'].mean()
        actual_rate = n_goals / n_shots if n_shots > 0 else 0
        ratio = actual_rate / avg_xg if avg_xg > 0 else 1.0

        if n_shots >= min_shots:
            iso_st = IsotonicRegression(out_of_bounds='clip', y_min=0.001, y_max=0.95)
            iso_st.fit(df.loc[mask, 'xg_value'].values, df.loc[mask, 'is_goal'].values)
            shot_type_models[st] = iso_st
            status = "TRAINED"
        else:
            status = "GLOBAL FALLBACK"

        shot_type_stats[st] = {
            'shots': n_shots,
            'goals': n_goals,
            'avg_xg': avg_xg,
            'actual_rate': actual_rate,
            'conversion_ratio': ratio,
        }

        direction = "OVER " if ratio < 0.85 else "UNDER" if ratio > 1.15 else "OK   "
        print(f"  {st:15s}: {n_shots:5d} shots, ratio={ratio:.3f} ({direction}) [{status}]")

    # Package everything
    calibration_package = {
        'global_model': iso_global,
        'shot_type_models': shot_type_models,
        'shot_type_stats': shot_type_stats,
        'training_shots': len(df),
        'training_goals': int(df['is_goal'].sum()),
        'version': '1.0',
    }

    # Save
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    joblib.dump(calibration_package, output_path)
    print(f"\nSaved calibration models to: {output_path}")
    print(f"  Shot types with dedicated models: {len(shot_type_models)}")
    print(f"  Global fallback model: included")

    return calibration_package


def apply_calibration(xg_value, shot_type, calibration_package):
    """
    Apply shot-type-specific isotonic calibration to a single xG value.

    Args:
        xg_value: Raw xG prediction from XGBoost model
        shot_type: Shot type string (e.g., 'tip-in', 'wrist')
        calibration_package: Loaded calibration models

    Returns:
        Calibrated xG value
    """
    if calibration_package is None:
        return xg_value

    # Use shot-type-specific model if available, otherwise global
    if shot_type in calibration_package['shot_type_models']:
        model = calibration_package['shot_type_models'][shot_type]
    else:
        model = calibration_package['global_model']

    calibrated = model.predict([xg_value])[0]
    return float(np.clip(calibrated, 0.001, 0.95))


def apply_calibration_batch(df, xg_col='xg_value', shot_type_col='shot_type',
                            calibration_package=None, output_col='calibrated_xg'):
    """
    Apply shot-type-specific isotonic calibration to a DataFrame of shots.

    Args:
        df: DataFrame with shot data
        xg_col: Column name for raw xG values
        shot_type_col: Column name for shot type
        calibration_package: Loaded calibration models
        output_col: Name for the output column

    Returns:
        DataFrame with calibrated xG column added
    """
    if calibration_package is None:
        df[output_col] = df[xg_col]
        return df

    df = df.copy()
    df[output_col] = df[xg_col].copy()

    # Apply per-shot-type models
    for st, model in calibration_package['shot_type_models'].items():
        mask = df[shot_type_col] == st
        if mask.sum() > 0:
            df.loc[mask, output_col] = model.predict(df.loc[mask, xg_col].values)

    # Apply global model to any remaining shot types
    known_types = set(calibration_package['shot_type_models'].keys())
    remaining = ~df[shot_type_col].isin(known_types) | df[shot_type_col].isna()
    if remaining.sum() > 0:
        global_model = calibration_package['global_model']
        df.loc[remaining, output_col] = global_model.predict(df.loc[remaining, xg_col].values)

    df[output_col] = df[output_col].clip(0.001, 0.95)

    return df


if __name__ == '__main__':
    train_calibration_models()
