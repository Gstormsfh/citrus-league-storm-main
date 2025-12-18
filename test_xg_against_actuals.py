#!/usr/bin/env python3
"""
test_xg_against_actuals.py
Test the xG model against actual goal statistics from the database.
Compares predicted xG values to actual goals scored.
"""

import pandas as pd
import numpy as np
import joblib
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
from scipy.stats import pearsonr
from dotenv import load_dotenv
from supabase import create_client, Client
import os
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize Supabase client
SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Missing Supabase credentials in .env file")
    print("   Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def load_model():
    """Load the trained xG model and required components."""
    print("=" * 80)
    print("LOADING MODEL")
    print("=" * 80)
    
    try:
        model = joblib.load('xg_model_moneypuck.joblib')
        print("✅ Model loaded: xg_model_moneypuck.joblib")
    except FileNotFoundError:
        print("❌ Error: xg_model_moneypuck.joblib not found")
        print("   Run retrain_xg_with_moneypuck.py first")
        return None, None, None
    
    try:
        feature_names = joblib.load('model_features_moneypuck.joblib')
        print(f"✅ Features loaded: {len(feature_names)} features")
    except FileNotFoundError:
        print("❌ Error: model_features_moneypuck.joblib not found")
        return None, None, None
    
    encoder = None
    try:
        encoder = joblib.load('last_event_category_encoder.joblib')
        print("✅ Encoder loaded: last_event_category_encoder.joblib")
    except FileNotFoundError:
        print("⚠️  Encoder not found (will encode on-the-fly if needed)")
    
    return model, feature_names, encoder

def fetch_shots_from_db(date_from=None, date_to=None, limit=None):
    """Fetch shot data from Supabase raw_shots table with pagination."""
    print("\n" + "=" * 80)
    print("FETCHING SHOT DATA FROM DATABASE")
    print("=" * 80)
    
    all_data = []
    batch_size = 1000
    offset = 0
    
    try:
        while True:
            query = supabase.table('raw_shots').select('*')
            
            if date_from:
                query = query.gte('created_at', date_from)
            if date_to:
                query = query.lte('created_at', date_to)
            
            # Use pagination
            response = query.range(offset, offset + batch_size - 1).execute()
            batch = response.data
            
            if not batch or len(batch) == 0:
                break
            
            all_data.extend(batch)
            print(f"  Fetched {len(all_data):,} shots so far...")
            
            if len(batch) < batch_size:
                break
            
            offset += batch_size
            
            if limit and len(all_data) >= limit:
                all_data = all_data[:limit]
                break
        
        df = pd.DataFrame(all_data)
        print(f"✅ Fetched {len(df):,} shots from database")
        
        if len(df) == 0:
            print("⚠️  No shots found in database")
            return None
        
        return df
    except Exception as e:
        print(f"❌ Error fetching data: {e}")
        return None

def prepare_features(df, feature_names, encoder):
    """Prepare features for prediction from database data."""
    print("\n" + "=" * 80)
    print("PREPARING FEATURES")
    print("=" * 80)
    
    # Create a copy to avoid modifying original
    df_features = df.copy()
    
    # Check for required columns
    missing_cols = []
    for feat in feature_names:
        if feat not in df_features.columns:
            missing_cols.append(feat)
    
    if missing_cols:
        print(f"⚠️  Missing columns: {missing_cols}")
        print("   Filling with default values...")
        for col in missing_cols:
            if 'encoded' in col or 'category' in col.lower():
                df_features[col] = 0
            else:
                df_features[col] = 0.0
    
    # Handle last_event_category encoding if needed
    if 'last_event_category_encoded' in feature_names:
        if encoder is not None and 'last_event_category' in df_features.columns:
            # Encode the category
            def encode_category(x):
                if pd.isna(x) or x is None:
                    return 0
                try:
                    return encoder.transform([x])[0] if x in encoder.classes_ else 0
                except:
                    return 0
            df_features['last_event_category_encoded'] = df_features['last_event_category'].apply(encode_category)
        else:
            df_features['last_event_category_encoded'] = 0
    
    # Select only the features needed for prediction
    X = df_features[feature_names].copy()
    
    # Fill NaN values
    for col in X.columns:
        if X[col].isna().any():
            if X[col].dtype in ['int64', 'int32', 'int', 'Int64', 'Int32']:
                X[col] = X[col].fillna(0).astype(int)
            elif pd.api.types.is_numeric_dtype(X[col]):
                median_val = X[col].median() if X[col].notna().any() else 0
                X[col] = X[col].fillna(median_val)
            else:
                X[col] = X[col].fillna(0)
    
    print(f"✅ Features prepared: {X.shape[0]} shots, {X.shape[1]} features")
    print(f"   Feature ranges:")
    for feat in feature_names[:10]:  # Show first 10
        if feat in X.columns:
            print(f"     {feat}: [{X[feat].min():.2f}, {X[feat].max():.2f}]")
    
    return X

def calculate_metrics(y_true, y_pred):
    """Calculate performance metrics."""
    metrics = {
        'total_shots': len(y_true),
        'total_goals': int(y_true.sum()),
        'total_xg': float(y_pred.sum()),
        'goals_per_shot': float(y_true.mean()),
        'xg_per_shot': float(y_pred.mean()),
        'r2': float(r2_score(y_true, y_pred)),
        'mae': float(mean_absolute_error(y_true, y_pred)),
        'rmse': float(np.sqrt(mean_squared_error(y_true, y_pred))),
        'correlation': float(pearsonr(y_true, y_pred)[0]) if len(y_true) > 1 else 0.0,
    }
    return metrics

def calculate_calibration(df):
    """Calculate calibration by xG bins."""
    print("\n" + "=" * 80)
    print("CALIBRATION ANALYSIS (Goal Rate by xG Bins)")
    print("=" * 80)
    
    # Create xG bins
    bins = [0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 1.0]
    df['xg_bin'] = pd.cut(df['predicted_xg'], bins=bins, labels=[
        '0.00-0.05', '0.05-0.10', '0.10-0.15', '0.15-0.20', 
        '0.20-0.30', '0.30-0.40', '0.40-0.50', '0.50+'
    ])
    
    calibration = df.groupby('xg_bin', observed=False).agg({
        'predicted_xg': ['count', 'sum', 'mean'],
        'is_goal': 'sum',
        'actual_goals': 'sum'
    }).round(4)
    
    calibration.columns = ['shots', 'total_xg', 'avg_xg', 'goals', 'actual_goals']
    calibration['goal_rate'] = calibration['goals'] / calibration['shots']
    calibration['xg_vs_actual'] = calibration['total_xg'] - calibration['actual_goals']
    calibration['xg_vs_actual_pct'] = (calibration['xg_vs_actual'] / calibration['total_xg'] * 100).round(2)
    
    print(calibration.to_string())
    
    return calibration

def aggregate_by_game(df):
    """Aggregate xG and goals by game."""
    print("\n" + "=" * 80)
    print("PER-GAME AGGREGATION")
    print("=" * 80)
    
    game_stats = df.groupby('game_id').agg({
        'predicted_xg': 'sum',
        'is_goal': 'sum',
        'actual_goals': 'sum',
        'player_id': 'count'
    }).round(2)
    
    game_stats.columns = ['total_xg', 'goals', 'actual_goals', 'shots']
    game_stats['xg_error'] = game_stats['total_xg'] - game_stats['actual_goals']
    game_stats['xg_error_pct'] = (game_stats['xg_error'] / game_stats['total_xg'] * 100).round(2)
    
    print(f"\nGame-level statistics:")
    print(f"  Total games: {len(game_stats)}")
    print(f"  Avg xG per game: {game_stats['total_xg'].mean():.2f}")
    print(f"  Avg goals per game: {game_stats['actual_goals'].mean():.2f}")
    print(f"  Avg xG error: {game_stats['xg_error'].mean():.2f}")
    print(f"  RMSE per game: {np.sqrt((game_stats['xg_error']**2).mean()):.2f}")
    
    return game_stats

def aggregate_by_team(df):
    """Aggregate xG and goals by team."""
    print("\n" + "=" * 80)
    print("PER-TEAM AGGREGATION")
    print("=" * 80)
    
    if 'team_code' not in df.columns:
        print("⚠️  team_code column not found, skipping team aggregation")
        return None
    
    team_stats = df.groupby('team_code').agg({
        'predicted_xg': 'sum',
        'is_goal': 'sum',
        'actual_goals': 'sum',
        'player_id': 'count'
    }).round(2)
    
    team_stats.columns = ['total_xg', 'goals', 'actual_goals', 'shots']
    team_stats['xg_error'] = team_stats['total_xg'] - team_stats['actual_goals']
    team_stats['xg_error_pct'] = (team_stats['xg_error'] / team_stats['total_xg'] * 100).round(2)
    team_stats = team_stats.sort_values('total_xg', ascending=False)
    
    print(f"\nTop 10 teams by xG:")
    print(team_stats.head(10).to_string())
    
    return team_stats

def main():
    """Main test function."""
    print("\n" + "=" * 80)
    print("xG MODEL TESTING AGAINST ACTUAL STATISTICS")
    print("=" * 80)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # Load model
    model, feature_names, encoder = load_model()
    if model is None:
        return
    
    # Fetch shot data from database
    df = fetch_shots_from_db()
    if df is None or len(df) == 0:
        print("\n❌ No data available. Make sure you've run pull_season_data.py")
        return
    
    # Prepare features
    X = prepare_features(df, feature_names, encoder)
    
    # Make predictions
    print("\n" + "=" * 80)
    print("MAKING PREDICTIONS")
    print("=" * 80)
    predictions = model.predict(X)
    df['predicted_xg'] = predictions
    
    # Ensure is_goal is numeric
    if 'is_goal' in df.columns:
        df['actual_goals'] = df['is_goal'].astype(int)
    else:
        # Try to infer from shot_type_code
        if 'shot_type_code' in df.columns:
            df['actual_goals'] = (df['shot_type_code'] == 505).astype(int)
        else:
            print("❌ Cannot determine actual goals - missing is_goal and shot_type_code")
            return
    
    # Calculate overall metrics
    print("\n" + "=" * 80)
    print("OVERALL PERFORMANCE METRICS")
    print("=" * 80)
    
    metrics = calculate_metrics(df['actual_goals'], df['predicted_xg'])
    
    print(f"\n📊 Overall Statistics:")
    print(f"  Total Shots: {metrics['total_shots']:,}")
    print(f"  Total Goals: {metrics['total_goals']:,}")
    print(f"  Total xG: {metrics['total_xg']:.2f}")
    print(f"  Goals per Shot: {metrics['goals_per_shot']:.4f}")
    print(f"  xG per Shot: {metrics['xg_per_shot']:.4f}")
    print(f"\n📈 Model Performance:")
    print(f"  R² Score: {metrics['r2']:.4f}")
    print(f"  MAE (Mean Absolute Error): {metrics['mae']:.4f}")
    print(f"  RMSE (Root Mean Squared Error): {metrics['rmse']:.4f}")
    print(f"  Pearson Correlation: {metrics['correlation']:.4f}")
    print(f"\n🎯 Accuracy:")
    print(f"  xG Total: {metrics['total_xg']:.2f}")
    print(f"  Actual Goals: {metrics['total_goals']}")
    print(f"  Difference: {metrics['total_xg'] - metrics['total_goals']:.2f}")
    print(f"  Error %: {((metrics['total_xg'] - metrics['total_goals']) / metrics['total_goals'] * 100):.2f}%")
    
    # Calibration analysis
    calibration = calculate_calibration(df)
    
    # Per-game aggregation
    game_stats = aggregate_by_game(df)
    
    # Per-team aggregation
    team_stats = aggregate_by_team(df)
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"✅ Model tested on {metrics['total_shots']:,} shots")
    print(f"✅ Total predicted xG: {metrics['total_xg']:.2f}")
    print(f"✅ Total actual goals: {metrics['total_goals']}")
    print(f"✅ Model accuracy: {metrics['r2']:.4f} R²")
    print(f"✅ Average error: {metrics['mae']:.4f} xG per shot")
    
    if abs(metrics['total_xg'] - metrics['total_goals']) / metrics['total_goals'] < 0.10:
        print("✅ Model is well-calibrated (within 10% of actual goals)")
    elif abs(metrics['total_xg'] - metrics['total_goals']) / metrics['total_goals'] < 0.20:
        print("⚠️  Model is reasonably calibrated (within 20% of actual goals)")
    else:
        print("❌ Model may need recalibration (error > 20%)")
    
    print(f"\nCompleted at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == '__main__':
    main()

