#!/usr/bin/env python3
"""
train_rebound_model.py
Train XGBoost classifier to predict rebound probability from shot features.
Uses the same features as the xG model to predict whether a shot will generate a rebound.
"""

import pandas as pd
import numpy as np
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, classification_report
import joblib
import os

def load_and_prepare_training_data(data_file='data/our_shots_2025.csv'):
    """
    Load shot data and prepare features (X) and target (y = shot_generated_rebound).
    
    Args:
        data_file: Path to shots CSV file
    
    Returns:
        X (features), y (target), feature_names
    """
    print("=" * 80)
    print("LOADING TRAINING DATA FOR REBOUND MODEL")
    print("=" * 80)
    
    if not os.path.exists(data_file):
        print(f"❌ Data file not found: {data_file}")
        print("   Please run pull_season_data.py first to generate the data file")
        return None, None, None, None
    
    print(f"Loading data from {data_file}...")
    df = pd.read_csv(data_file)
    print(f"Loaded {len(df):,} shots")
    
    # Filter to shots that were on goal (type 506) - rebounds only occur after saves
    # Also include goals (505) as they could theoretically generate rebounds if not scored
    initial_count = len(df)
    df = df[df['shot_type_code'].isin([505, 506])].copy()
    print(f"Filtered to {len(df):,} shots on goal (types 505, 506)")
    
    # Check for target variable
    if 'shot_generated_rebound' not in df.columns:
        print("❌ Target variable 'shot_generated_rebound' not found in data")
        print("   This column should be populated by data_acquisition.py")
        return None, None, None, None
    
    # Convert target to binary (ensure it's 0 or 1)
    df['shot_generated_rebound'] = pd.to_numeric(df['shot_generated_rebound'], errors='coerce').fillna(0).astype(int)
    df = df[df['shot_generated_rebound'].isin([0, 1])]
    
    # Check class distribution
    rebound_count = df['shot_generated_rebound'].sum()
    no_rebound_count = len(df) - rebound_count
    rebound_rate = rebound_count / len(df) * 100
    
    print(f"\n📊 Target Variable Distribution:")
    print(f"   Rebounds generated: {rebound_count:,} ({rebound_rate:.2f}%)")
    print(f"   No rebounds: {no_rebound_count:,} ({100 - rebound_rate:.2f}%)")
    
    if rebound_count < 100:
        print("⚠️  Warning: Very few rebound examples. Model may have limited accuracy.")
    
    # Define features - Use same features as xG model
    REBOUND_MODEL_FEATURES = [
        # Core shot features
        'distance',
        'angle',
        'shot_type_encoded',
        'is_power_play',
        'is_empty_net',
        # Location features
        'east_west_location_of_shot',
        'north_south_location_of_shot',
        'east_west_location_of_last_event',
        # Speed and time features
        'speed_from_last_event',
        'time_since_last_event',
        'distance_from_last_event',
        'time_since_powerplay_started',
        # Situation features
        'defending_team_skaters_on_ice',
        'is_rebound',  # Shots that are rebounds themselves may generate rebounds differently
        # Last event features
        'last_event_category_encoded',
        # Derived features
        'distance_angle_interaction',
        'speed_from_last_event_log',
    ]
    
    # Create derived features if they don't exist
    if 'distance' in df.columns and 'angle' in df.columns:
        if 'distance_angle_interaction' not in df.columns:
            df['distance_angle_interaction'] = (df['distance'] * df['angle']) / 100
    
    if 'speed_from_last_event' in df.columns:
        if 'speed_from_last_event_log' not in df.columns:
            df['speed_from_last_event_log'] = np.log1p(df['speed_from_last_event'].fillna(0))
    
    # Handle last_event_category encoding
    if 'last_event_category' in df.columns and 'last_event_category_encoded' not in df.columns:
        le = LabelEncoder()
        df['last_event_category_encoded'] = le.fit_transform(
            df['last_event_category'].fillna('unknown').astype(str)
        )
    
    # Check which features we have
    available_features = [f for f in REBOUND_MODEL_FEATURES if f in df.columns]
    missing_features = [f for f in REBOUND_MODEL_FEATURES if f not in df.columns]
    
    if missing_features:
        print(f"\n⚠️  Missing features: {missing_features}")
        print("   Will use available features only")
    
    if len(available_features) == 0:
        print("❌ No features available for training!")
        return None, None, None, None
    
    print(f"\n✅ Using {len(available_features)} features for training")
    
    # Prepare feature matrix
    X = df[available_features].copy()
    y = df['shot_generated_rebound'].copy()
    
    # Fill missing values
    for feature in available_features:
        if X[feature].isna().any():
            if feature in ['is_power_play', 'is_empty_net', 'is_rebound']:
                X[feature] = X[feature].fillna(0)
            elif feature in ['defending_team_skaters_on_ice']:
                X[feature] = X[feature].fillna(5)
            else:
                # Fill with median for continuous features
                median_val = X[feature].median()
                X[feature] = X[feature].fillna(median_val if not pd.isna(median_val) else 0)
    
    # Remove any remaining NaN
    X = X.fillna(0)
    
    # Ensure all features are numeric
    for col in X.columns:
        if X[col].dtype == 'object':
            print(f"⚠️  Converting {col} from object to numeric")
            X[col] = pd.to_numeric(X[col], errors='coerce').fillna(0)
    
    print(f"\n✅ Prepared {len(X):,} samples with {len(available_features)} features")
    
    return X, y, available_features, None


def train_rebound_model(X, y, feature_names, test_size=0.2, random_state=42):
    """
    Train XGBoost classifier to predict rebound probability.
    
    Args:
        X: Feature matrix
        y: Target vector (0 = no rebound, 1 = rebound)
        feature_names: List of feature names
        test_size: Proportion of data for testing
        random_state: Random seed
    
    Returns:
        Trained model, X_test, y_test, predictions
    """
    print("\n" + "=" * 80)
    print("TRAINING REBOUND MODEL")
    print("=" * 80)
    
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state, stratify=y
    )
    
    print(f"Training set: {len(X_train):,} samples")
    print(f"Test set: {len(X_test):,} samples")
    print(f"Training rebound rate: {y_train.mean()*100:.2f}%")
    print(f"Test rebound rate: {y_test.mean()*100:.2f}%")
    
    # Train XGBoost classifier
    print("\n🔧 Training XGBoost Classifier...")
    model = XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=random_state,
        eval_metric='logloss',
        scale_pos_weight=(1 - y_train.mean()) / y_train.mean() if y_train.mean() > 0 else 1.0  # Handle class imbalance
    )
    
    model.fit(X_train, y_train)
    
    # Predictions
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
    
    print("\n📋 Classification Report:")
    print(classification_report(y_test, y_pred, target_names=['No Rebound', 'Rebound']))
    
    # Feature importance
    print("\n🔍 Top 10 Most Important Features:")
    feature_importance = pd.DataFrame({
        'feature': feature_names,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)
    
    for i, row in feature_importance.head(10).iterrows():
        print(f"   {row['feature']}: {row['importance']:.4f}")
    
    return model, X_test, y_test, y_pred_proba


def save_rebound_model(model, feature_names, encoder=None, model_filename='rebound_model.joblib'):
    """
    Save the trained rebound model, feature list, and any encoders.
    
    Args:
        model: Trained XGBoost model
        feature_names: List of feature names
        encoder: Optional LabelEncoder for last_event_category
        model_filename: Filename for saved model
    """
    print("\n" + "=" * 80)
    print("SAVING REBOUND MODEL")
    print("=" * 80)
    
    # Save model
    joblib.dump(model, model_filename)
    print(f"✅ Saved model to {model_filename}")
    
    # Save feature list
    features_filename = 'rebound_model_features.joblib'
    joblib.dump(feature_names, features_filename)
    print(f"✅ Saved feature list to {features_filename}")
    
    # Save encoder if provided
    if encoder is not None:
        encoder_filename = 'rebound_model_encoder.joblib'
        joblib.dump(encoder, encoder_filename)
        print(f"✅ Saved encoder to {encoder_filename}")
    
    print("\n💡 To use this model in data_acquisition.py:")
    print(f"   1. Load model: model = joblib.load('{model_filename}')")
    print(f"   2. Load features: features = joblib.load('{features_filename}')")
    print(f"   3. Predict: rebound_prob = model.predict_proba(X[features])[:, 1]")


def main():
    """Main execution function."""
    print("=" * 80)
    print("REBOUND MODEL TRAINING")
    print("=" * 80)
    print()
    
    # Load and prepare data
    X, y, feature_names, encoder = load_and_prepare_training_data()
    
    if X is None or y is None:
        print("❌ Failed to load training data. Exiting.")
        return
    
    # Train model
    model, X_test, y_test, y_pred_proba = train_rebound_model(X, y, feature_names)
    
    if model is None:
        print("❌ Model training failed. Exiting.")
        return
    
    # Save model
    save_rebound_model(model, feature_names, encoder)
    
    print("\n" + "=" * 80)
    print("✅ REBOUND MODEL TRAINING COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    main()

