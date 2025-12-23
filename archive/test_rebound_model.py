#!/usr/bin/env python3
"""
test_rebound_model.py
Validate rebound model accuracy and calibration.
"""

import pandas as pd
import numpy as np
import joblib
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, classification_report

def test_rebound_model():
    """Test rebound model on validation data."""
    print("=" * 80)
    print("REBOUND MODEL VALIDATION")
    print("=" * 80)
    
    # Load model
    try:
        model = joblib.load('rebound_model.joblib')
        features = joblib.load('rebound_model_features.joblib')
        print("✅ Loaded rebound model and features")
    except FileNotFoundError:
        print("❌ Rebound model not found. Run train_rebound_model.py first.")
        return
    
    # Load test data
    data_file = 'data/our_shots_2025.csv'
    if not pd.io.common.file_exists(data_file):
        print(f"❌ Data file not found: {data_file}")
        return
    
    print(f"\nLoading test data from {data_file}...")
    df = pd.read_csv(data_file)
    
    # Filter to shots on goal
    df = df[df['shot_type_code'].isin([505, 506])].copy()
    
    # Check for target variable
    if 'shot_generated_rebound' not in df.columns:
        print("❌ Target variable 'shot_generated_rebound' not found in data")
        print("   This column should be populated by data_acquisition.py")
        return
    
    y_test = df['shot_generated_rebound'].copy()
    
    # Prepare features - add missing features with default values BEFORE selecting
    print(f"\nPreparing {len(features)} features...")
    missing_features = []
    for feature in features:
        if feature not in df.columns:
            missing_features.append(feature)
            # Add missing feature with default value
            if feature in ['is_power_play', 'is_empty_net', 'is_rebound']:
                df[feature] = 0
            elif 'log' in feature.lower() or 'interaction' in feature.lower():
                # Derived features - set to 0 or calculate if possible
                df[feature] = 0.0
            elif 'encoded' in feature.lower():
                # Encoded features - set to 0
                df[feature] = 0
            else:
                df[feature] = 0.0
    
    if missing_features:
        print(f"⚠️  {len(missing_features)} features missing from CSV (using defaults):")
        for feat in missing_features[:10]:  # Show first 10
            print(f"      - {feat}")
        if len(missing_features) > 10:
            print(f"      ... and {len(missing_features) - 10} more")
    
    # Now select features
    X_test = df[features].copy()
    
    # Fill missing values
    for feature in features:
        if X_test[feature].isna().any():
            if feature in ['is_power_play', 'is_empty_net', 'is_rebound']:
                X_test[feature] = X_test[feature].fillna(0)
            else:
                X_test[feature] = X_test[feature].fillna(0.0)
    
    # Predict
    y_pred = model.predict(X_test)
    y_pred_proba = model.predict_proba(X_test)[:, 1]
    
    # Evaluate
    accuracy = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall = recall_score(y_test, y_pred, zero_division=0)
    f1 = f1_score(y_test, y_pred, zero_division=0)
    
    try:
        roc_auc = roc_auc_score(y_test, y_pred_proba)
    except ValueError:
        roc_auc = 0.0
    
    print("\n📊 Model Performance:")
    print(f"   Accuracy: {accuracy:.4f}")
    print(f"   Precision: {precision:.4f}")
    print(f"   Recall: {recall:.4f}")
    print(f"   F1 Score: {f1:.4f}")
    print(f"   ROC-AUC: {roc_auc:.4f}")
    
    # Calibration check
    print("\n📊 Calibration Check:")
    df_test = df.copy()
    df_test['predicted_rebound_prob'] = y_pred_proba
    df_test['actual_rebound'] = y_test
    
    # Bin predictions and compare to actual rates
    bins = np.linspace(0, 1, 11)
    df_test['prob_bin'] = pd.cut(df_test['predicted_rebound_prob'], bins=bins)
    
    calibration = df_test.groupby('prob_bin').agg(
        predicted_rate=('predicted_rebound_prob', 'mean'),
        actual_rate=('actual_rebound', 'mean'),
        count=('actual_rebound', 'count')
    ).reset_index()
    
    print("\n   Predicted vs Actual Rebound Rates by Probability Bin:")
    for _, row in calibration.iterrows():
        if row['count'] > 0:
            print(f"   {row['prob_bin']}: Predicted={row['predicted_rate']:.3f}, "
                  f"Actual={row['actual_rate']:.3f}, Count={int(row['count'])}")
    
    print("\n✅ Rebound model validation complete")


if __name__ == "__main__":
    test_rebound_model()

