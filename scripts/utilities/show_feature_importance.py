#!/usr/bin/env python3
"""Show actual feature importance from trained model."""
import joblib
import pandas as pd

try:
    model = joblib.load('xg_model_moneypuck.joblib')
    features = joblib.load('model_features_moneypuck.joblib')
    
    importance = pd.DataFrame({
        'feature': features,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)
    
    print('=' * 80)
    print('FEATURE IMPORTANCE (Actual Weights from Trained Model)')
    print('=' * 80)
    print()
    print(importance.to_string(index=False))
    print()
    print(f'Total Importance: {importance["importance"].sum():.4f}')
    print()
    print('Top 5 Features:')
    for i, row in importance.head(5).iterrows():
        print(f'  {i+1}. {row["feature"]:40s} {row["importance"]*100:6.2f}%')
    
except FileNotFoundError as e:
    print(f'Model file not found: {e}')
    print('Please run retrain_xg_with_moneypuck.py first')

