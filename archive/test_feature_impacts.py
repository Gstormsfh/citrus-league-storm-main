#!/usr/bin/env python3
"""
test_feature_impacts.py
Test and analyze the impact of new features (rebounds, shooting talent, created xG) on the dataset.
"""

import pandas as pd
import numpy as np
import os
from dotenv import load_dotenv
from supabase import create_client, Client
import joblib

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("❌ Error: Supabase credentials not found in .env file")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)

def load_shots_from_database(limit=None):
    """Load shots from database with all new features."""
    print("=" * 80)
    print("LOADING SHOTS FROM DATABASE")
    print("=" * 80)
    
    all_shots = []
    offset = 0
    batch_size = 1000
    
    while True:
        query = supabase.table('raw_shots').select('*')
        
        if limit:
            query = query.range(offset, min(offset + batch_size - 1, limit - 1))
        else:
            query = query.range(offset, offset + batch_size - 1)
        
        response = query.execute()
        batch = response.data
        
        if not batch or len(batch) == 0:
            break
        
        all_shots.extend(batch)
        print(f"  Loaded {len(all_shots):,} shots...")
        
        if len(batch) < batch_size or (limit and len(all_shots) >= limit):
            break
        
        offset += batch_size
    
    df = pd.DataFrame(all_shots)
    print(f"✅ Loaded {len(df):,} shots from database")
    
    return df

def analyze_feature_impacts(df):
    """Analyze the impact of new features on xG values."""
    print("\n" + "=" * 80)
    print("FEATURE IMPACT ANALYSIS")
    print("=" * 80)
    
    # Convert numeric columns
    numeric_cols = ['xg_value', 'flurry_adjusted_xg', 'shooting_talent_adjusted_xg', 
                    'expected_rebound_probability', 'expected_goals_of_expected_rebounds',
                    'created_expected_goals', 'shooting_talent_multiplier']
    
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
    
    # Filter to shots with valid xG
    df = df[df['xg_value'] > 0].copy()
    
    print(f"\n📊 Dataset Overview:")
    print(f"   Total shots analyzed: {len(df):,}")
    print(f"   Total base xG: {df['xg_value'].sum():.2f}")
    
    # 1. Flurry Adjustment Impact
    if 'flurry_adjusted_xg' in df.columns:
        flurry_diff = df['flurry_adjusted_xg'] - df['xg_value']
        print(f"\n🔹 Flurry Adjustment Impact:")
        print(f"   Total flurry-adjusted xG: {df['flurry_adjusted_xg'].sum():.2f}")
        print(f"   Difference from base xG: {flurry_diff.sum():.2f} ({flurry_diff.sum() / df['xg_value'].sum() * 100:.2f}%)")
        print(f"   Average adjustment per shot: {flurry_diff.mean():.4f}")
        print(f"   Shots with flurry discount: {(flurry_diff < 0).sum():,} ({(flurry_diff < 0).sum() / len(df) * 100:.1f}%)")
    
    # 2. Shooting Talent Adjustment Impact
    if 'shooting_talent_adjusted_xg' in df.columns and 'flurry_adjusted_xg' in df.columns:
        talent_diff = df['shooting_talent_adjusted_xg'] - df['flurry_adjusted_xg']
        print(f"\n🔹 Shooting Talent Adjustment Impact:")
        print(f"   Total talent-adjusted xG: {df['shooting_talent_adjusted_xg'].sum():.2f}")
        print(f"   Difference from flurry-adjusted: {talent_diff.sum():.2f} ({talent_diff.sum() / df['flurry_adjusted_xg'].sum() * 100:.2f}%)")
        print(f"   Average adjustment per shot: {talent_diff.mean():.4f}")
        
        if 'shooting_talent_multiplier' in df.columns:
            print(f"   Talent multiplier range: {df['shooting_talent_multiplier'].min():.3f} - {df['shooting_talent_multiplier'].max():.3f}")
            print(f"   Average multiplier: {df['shooting_talent_multiplier'].mean():.3f}")
            print(f"   Players with multiplier > 1.0: {(df['shooting_talent_multiplier'] > 1.0).sum():,} shots")
            print(f"   Players with multiplier < 1.0: {(df['shooting_talent_multiplier'] < 1.0).sum():,} shots")
    
    # 3. Rebound Prediction Impact
    if 'expected_rebound_probability' in df.columns:
        print(f"\n🔹 Rebound Prediction Impact:")
        print(f"   Shots with rebound probability > 0: {(df['expected_rebound_probability'] > 0).sum():,} ({(df['expected_rebound_probability'] > 0).sum() / len(df) * 100:.1f}%)")
        print(f"   Average rebound probability: {df['expected_rebound_probability'].mean():.4f}")
        print(f"   High rebound probability (>0.3): {(df['expected_rebound_probability'] > 0.3).sum():,} shots")
        print(f"   Total expected rebounds: {df['expected_rebound_probability'].sum():.1f}")
        
        if 'expected_goals_of_expected_rebounds' in df.columns:
            print(f"   Total xGoals of xRebounds: {df['expected_goals_of_expected_rebounds'].sum():.2f}")
            print(f"   Average xGoals of xRebounds per shot: {df['expected_goals_of_expected_rebounds'].mean():.4f}")
    
    # 4. Created Expected Goals Impact
    if 'created_expected_goals' in df.columns:
        created_diff = df['created_expected_goals'] - df['xg_value']
        print(f"\n🔹 Created Expected Goals Impact:")
        print(f"   Total created xG: {df['created_expected_goals'].sum():.2f}")
        print(f"   Difference from base xG: {created_diff.sum():.2f} ({created_diff.sum() / df['xg_value'].sum() * 100:.2f}%)")
        print(f"   Average created xG per shot: {df['created_expected_goals'].mean():.4f}")
        print(f"   Shots with created xG > base xG: {(created_diff > 0).sum():,} ({(created_diff > 0).sum() / len(df) * 100:.1f}%)")
    
    # 5. Overall Impact Summary
    print(f"\n📈 Overall Impact Summary:")
    print(f"   Base xG: {df['xg_value'].sum():.2f}")
    
    if 'flurry_adjusted_xg' in df.columns:
        print(f"   Flurry-adjusted xG: {df['flurry_adjusted_xg'].sum():.2f}")
    
    if 'shooting_talent_adjusted_xg' in df.columns:
        print(f"   Talent-adjusted xG: {df['shooting_talent_adjusted_xg'].sum():.2f}")
    
    if 'created_expected_goals' in df.columns:
        print(f"   Created xG: {df['created_expected_goals'].sum():.2f}")
    
    if 'expected_goals_of_expected_rebounds' in df.columns:
        print(f"   xGoals of xRebounds: {df['expected_goals_of_expected_rebounds'].sum():.2f}")
    
    return df

def analyze_by_player(df):
    """Analyze feature impacts by player."""
    print("\n" + "=" * 80)
    print("TOP PLAYERS BY NEW METRICS")
    print("=" * 80)
    
    if 'player_id' not in df.columns:
        print("⚠️  player_id column not found")
        return
    
    # Convert player_id to numeric
    df['player_id'] = pd.to_numeric(df['player_id'], errors='coerce')
    df = df[df['player_id'].notna()].copy()
    
    # Aggregate by player
    player_stats = df.groupby('player_id').agg(
        shots=('player_id', 'count'),
        base_xg=('xg_value', 'sum'),
        flurry_xg=('flurry_adjusted_xg', 'sum') if 'flurry_adjusted_xg' in df.columns else None,
        talent_xg=('shooting_talent_adjusted_xg', 'sum') if 'shooting_talent_adjusted_xg' in df.columns else None,
        created_xg=('created_expected_goals', 'sum') if 'created_expected_goals' in df.columns else None,
        xgoals_xrebounds=('expected_goals_of_expected_rebounds', 'sum') if 'expected_goals_of_expected_rebounds' in df.columns else None,
        avg_talent_mult=('shooting_talent_multiplier', 'mean') if 'shooting_talent_multiplier' in df.columns else None,
        goals=('is_goal', 'sum') if 'is_goal' in df.columns else None
    ).reset_index()
    
    # Filter to players with at least 20 shots
    player_stats = player_stats[player_stats['shots'] >= 20].copy()
    
    print(f"\n🔝 Top 10 Players by Created Expected Goals:")
    if 'created_xg' in player_stats.columns:
        top_created = player_stats.nlargest(10, 'created_xg')
        for idx, row in top_created.iterrows():
            print(f"   Player {int(row['player_id'])}: {row['created_xg']:.2f} cXG "
                  f"({row['base_xg']:.2f} base xG, {row['shots']:.0f} shots)")
    
    print(f"\n🔝 Top 10 Players by xGoals of xRebounds:")
    if 'xgoals_xrebounds' in player_stats.columns:
        top_rebounds = player_stats.nlargest(10, 'xgoals_xrebounds')
        for idx, row in top_rebounds.iterrows():
            print(f"   Player {int(row['player_id'])}: {row['xgoals_xrebounds']:.2f} xGoals of xRebounds "
                  f"({row['shots']:.0f} shots)")
    
    print(f"\n🔝 Top 10 Players by Talent-Adjusted xG:")
    if 'talent_xg' in player_stats.columns:
        top_talent = player_stats.nlargest(10, 'talent_xg')
        for idx, row in top_talent.iterrows():
            print(f"   Player {int(row['player_id'])}: {row['talent_xg']:.2f} talent xG "
                  f"({row['base_xg']:.2f} base, {row['avg_talent_mult']:.3f} avg multiplier, {row['shots']:.0f} shots)")

def main():
    """Main execution function."""
    print("=" * 80)
    print("FEATURE IMPACT ANALYSIS")
    print("=" * 80)
    print()
    
    # Load data
    df = load_shots_from_database()
    
    if df is None or len(df) == 0:
        print("❌ No data found. Run data_acquisition.py first to populate the database.")
        return
    
    # Analyze impacts
    df = analyze_feature_impacts(df)
    
    # Analyze by player
    analyze_by_player(df)
    
    print("\n" + "=" * 80)
    print("✅ FEATURE IMPACT ANALYSIS COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()

