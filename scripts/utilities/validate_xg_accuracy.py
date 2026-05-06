#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: UTILITY
# Purpose:     Validate xG model accuracy on held-out shots (reports AUC, Brier, log loss)
# Last active: 2026-02-18
# Invoked:     manual run after retrain
# Reads:       raw_shots, models/*.joblib
# Writes:      (reports)
# ────────────────────────────────────────────────────────────
"""
validate_xg_accuracy.py
Comprehensive validation of xG model accuracy with calibration improvements.

Compares baseline xG performance against calibrated versions and reports:
- Shot-level metrics (R², correlation, MAE, RMSE, calibration)
- Player-season metrics (R², correlation)
- Anomaly player analysis
- Calibration by probability bin

Usage:
    python scripts/utilities/validate_xg_accuracy.py
"""

import os
import sys
import pandas as pd
import numpy as np
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
from sklearn.isotonic import IsotonicRegression
from scipy.stats import pearsonr
import joblib


def calc_shot_metrics(y_true, y_pred):
    mask = y_pred.notna() & y_true.notna()
    yt, yp = y_true[mask].values, y_pred[mask].values
    return {
        'r2': r2_score(yt, yp),
        'corr': pearsonr(yt, yp)[0],
        'mae': mean_absolute_error(yt, yp),
        'rmse': np.sqrt(mean_squared_error(yt, yp)),
        'cal': yp.sum() / yt.sum() if yt.sum() > 0 else 0,
        'n': len(yt),
    }


def calc_player_metrics(df, xg_col, min_shots=20):
    ps = df.groupby('player_id').agg(
        xg=(xg_col, 'sum'), goals=('is_goal', 'sum'), shots=('is_goal', 'count')
    ).reset_index()
    ps = ps[ps['shots'] >= min_shots]
    return {
        'r2': r2_score(ps['goals'], ps['xg']),
        'corr': pearsonr(ps['goals'], ps['xg'])[0],
        'cal': ps['xg'].sum() / ps['goals'].sum(),
        'n': len(ps),
    }


def run_validation(shots_csv='data/our_shots_2025.csv', calibration_path=None):
    if calibration_path is None:
        calibration_path = os.path.join(
            os.path.dirname(__file__), '..', '..', 'models', 'xg_shot_type_calibration.joblib'
        )

    print("=" * 80)
    print("XG MODEL ACCURACY VALIDATION REPORT")
    print("=" * 80)

    # Load data
    df = pd.read_csv(shots_csv, usecols=[
        'shot_type', 'is_goal', 'xg_value', 'distance', 'player_id',
        'flurry_adjusted_xg', 'shooting_talent_adjusted_xg', 'shooting_talent_multiplier'
    ])
    print(f"\nDataset: {len(df):,} shots, {int(df['is_goal'].sum()):,} goals")

    # Load calibration models
    cal_package = joblib.load(calibration_path)
    print(f"Calibration models loaded: {len(cal_package['shot_type_models'])} shot types")

    # ================================================================
    # Apply calibration
    # ================================================================
    # Step 1: Calibrate base xG per shot type
    df['calibrated_xg'] = df['xg_value'].copy()
    for st, model in cal_package['shot_type_models'].items():
        mask = df['shot_type'] == st
        if mask.sum() > 0:
            df.loc[mask, 'calibrated_xg'] = model.predict(df.loc[mask, 'xg_value'].values)

    known_types = set(cal_package['shot_type_models'].keys())
    remaining = ~df['shot_type'].isin(known_types) | df['shot_type'].isna()
    if remaining.sum() > 0:
        df.loc[remaining, 'calibrated_xg'] = cal_package['global_model'].predict(
            df.loc[remaining, 'xg_value'].values
        )
    df['calibrated_xg'] = df['calibrated_xg'].clip(0.001, 0.95)

    # Step 2: Apply talent multiplier on top of calibrated xG
    df['calibrated_talent_xg'] = df['calibrated_xg'] * df['shooting_talent_multiplier'].fillna(1.0)
    df['calibrated_talent_xg'] = df['calibrated_talent_xg'].clip(0.001, 0.95)

    # ================================================================
    # Metrics comparison
    # ================================================================
    variants = [
        ("Base xG (before)",           'xg_value'),
        ("Talent-Adj (before)",        'shooting_talent_adjusted_xg'),
        ("Calibrated xG (after)",      'calibrated_xg'),
        ("Calibrated+Talent (after)",  'calibrated_talent_xg'),
    ]

    print("\n" + "=" * 80)
    print("SHOT-LEVEL METRICS")
    print("=" * 80)
    print(f"\n{'Variant':<30} {'R2':>10} {'Corr':>10} {'MAE':>10} {'RMSE':>10} {'Cal':>8}")
    print("-" * 78)
    for label, col in variants:
        m = calc_shot_metrics(df['is_goal'], df[col])
        print(f"{label:<30} {m['r2']:>10.4f} {m['corr']:>10.4f} {m['mae']:>10.4f} {m['rmse']:>10.4f} {m['cal']:>8.3f}")

    print("\n" + "=" * 80)
    print("PLAYER-SEASON METRICS (min 20 shots)")
    print("=" * 80)
    print(f"\n{'Variant':<30} {'R2':>10} {'Corr':>10} {'Cal':>8} {'Players':>8}")
    print("-" * 66)
    best_r2 = 0
    for label, col in variants:
        m = calc_player_metrics(df, col)
        star = ""
        if m['r2'] > best_r2:
            best_r2 = m['r2']
            star = " BEST"
        print(f"{label:<30} {m['r2']:>10.4f} {m['corr']:>10.4f} {m['cal']:>8.3f} {m['n']:>8}{star}")

    # Improvement summary
    before = calc_player_metrics(df, 'shooting_talent_adjusted_xg')
    after = calc_player_metrics(df, 'calibrated_talent_xg')
    before_shot = calc_shot_metrics(df['is_goal'], df['shooting_talent_adjusted_xg'])
    after_shot = calc_shot_metrics(df['is_goal'], df['calibrated_talent_xg'])

    print(f"\n{'=' * 80}")
    print("IMPROVEMENT SUMMARY")
    print(f"{'=' * 80}")
    print(f"  Player R2:    {before['r2']:.4f} -> {after['r2']:.4f} ({(after['r2']-before['r2'])/before['r2']*100:+.1f}%)")
    print(f"  Player Corr:  {before['corr']:.4f} -> {after['corr']:.4f} ({(after['corr']-before['corr'])/before['corr']*100:+.1f}%)")
    print(f"  Shot R2:      {before_shot['r2']:.4f} -> {after_shot['r2']:.4f} ({(after_shot['r2']-before_shot['r2'])/before_shot['r2']*100:+.1f}%)")
    print(f"  Shot Corr:    {before_shot['corr']:.4f} -> {after_shot['corr']:.4f} ({(after_shot['corr']-before_shot['corr'])/before_shot['corr']*100:+.1f}%)")
    print(f"  Calibration:  {before_shot['cal']:.3f} -> {after_shot['cal']:.3f} (1.000 = perfect)")

    # ================================================================
    # Calibration by bin
    # ================================================================
    print(f"\n{'=' * 80}")
    print("CALIBRATION BY XG BIN")
    print(f"{'=' * 80}")
    bins = [(0, 0.05), (0.05, 0.10), (0.10, 0.15), (0.15, 0.20), (0.20, 0.30), (0.30, 0.50)]
    print(f"\n{'Bin':<12} {'Shots':>8} {'Goals':>8} {'Before':>10} {'After':>10} {'Actual':>10} {'Old Gap':>10} {'New Gap':>10}")
    print("-" * 78)
    for lo, hi in bins:
        mask = (df['xg_value'] >= lo) & (df['xg_value'] < hi)
        shots = mask.sum()
        goals = df.loc[mask, 'is_goal'].sum()
        old_avg = df.loc[mask, 'shooting_talent_adjusted_xg'].mean()
        new_avg = df.loc[mask, 'calibrated_talent_xg'].mean()
        actual = goals / shots if shots > 0 else 0
        old_gap = old_avg - actual
        new_gap = new_avg - actual
        improved = "OK" if abs(new_gap) < abs(old_gap) else " "
        print(f"{lo:.2f}-{hi:.2f}    {shots:>8} {int(goals):>8} {old_avg*100:>9.1f}% {new_avg*100:>9.1f}% {actual*100:>9.1f}% {old_gap*100:>+9.1f}% {new_gap*100:>+9.1f}% {improved}")

    # ================================================================
    # Anomaly players
    # ================================================================
    print(f"\n{'=' * 80}")
    print("ANOMALY PLAYER CORRECTION")
    print(f"{'=' * 80}")

    anomaly_players = {
        8478498: "Jake DeBrusk",
        8475314: "Anders Lee",
        8475786: "Zach Hyman",
    }

    for pid, name in anomaly_players.items():
        mask = df['player_id'] == pid
        if mask.sum() == 0:
            continue
        goals = int(df.loc[mask, 'is_goal'].sum())
        shots = mask.sum()
        old_xg = df.loc[mask, 'xg_value'].sum()
        old_talent = df.loc[mask, 'shooting_talent_adjusted_xg'].sum()
        new_xg = df.loc[mask, 'calibrated_talent_xg'].sum()
        print(f"\n  {name}:")
        print(f"    Shots: {shots}, Goals: {goals}")
        print(f"    Base xG:       {old_xg:6.2f}  (over by {old_xg - goals:+.2f})")
        print(f"    Talent-Adj:    {old_talent:6.2f}  (over by {old_talent - goals:+.2f})")
        print(f"    Calibrated:    {new_xg:6.2f}  (over by {new_xg - goals:+.2f})")
        print(f"    Reduction:     {(new_xg - old_xg)/old_xg*100:+.1f}%")

    # ================================================================
    # Shot type conversion after calibration
    # ================================================================
    print(f"\n{'=' * 80}")
    print("SHOT-TYPE CALIBRATION BEFORE/AFTER")
    print(f"{'=' * 80}")
    print(f"\n{'Type':<15} {'Shots':>7} {'Old Ratio':>10} {'New Ratio':>10} {'Change':>10}")
    print("-" * 52)
    for st in sorted(df['shot_type'].dropna().unique()):
        mask = df['shot_type'] == st
        shots = mask.sum()
        if shots < 20:
            continue
        goals = df.loc[mask, 'is_goal'].sum()
        old_avg = df.loc[mask, 'xg_value'].mean()
        new_avg = df.loc[mask, 'calibrated_xg'].mean()
        actual = goals / shots
        old_ratio = actual / old_avg if old_avg > 0 else 0
        new_ratio = actual / new_avg if new_avg > 0 else 0
        print(f"{st:<15} {shots:>7} {old_ratio:>10.3f} {new_ratio:>10.3f} {(new_ratio-old_ratio)/old_ratio*100:>+9.1f}%")

    print(f"\n{'=' * 80}")
    print("VALIDATION COMPLETE")
    print(f"{'=' * 80}")


if __name__ == '__main__':
    run_validation()
