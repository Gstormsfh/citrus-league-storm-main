#!/usr/bin/env python3
"""
test_shooting_talent.py
Validate shooting talent multipliers and adjustments.
"""

import pandas as pd
import numpy as np
import joblib

def test_shooting_talent():
    """Test shooting talent multipliers."""
    print("=" * 80)
    print("SHOOTING TALENT VALIDATION")
    print("=" * 80)
    
    # Load talent dictionary
    try:
        talent_dict = joblib.load('player_shooting_talent.joblib')
        print(f"✅ Loaded shooting talent for {len(talent_dict):,} players")
    except FileNotFoundError:
        print("❌ Shooting talent file not found. Run calculate_shooting_talent.py first.")
        return
    
    # Load CSV for inspection
    try:
        talent_df = pd.read_csv('player_shooting_talent.csv')
        print(f"✅ Loaded talent data from CSV")
    except FileNotFoundError:
        print("⚠️  CSV file not found, using dictionary only")
        talent_df = pd.DataFrame(list(talent_dict.items()), columns=['player_id', 'shooting_talent_multiplier'])
    
    # Validate multipliers
    print("\n📊 Talent Multiplier Statistics:")
    print(f"   Mean: {talent_df['shooting_talent_multiplier'].mean():.3f}")
    print(f"   Median: {talent_df['shooting_talent_multiplier'].median():.3f}")
    print(f"   Min: {talent_df['shooting_talent_multiplier'].min():.3f}")
    print(f"   Max: {talent_df['shooting_talent_multiplier'].max():.3f}")
    print(f"   Std Dev: {talent_df['shooting_talent_multiplier'].std():.3f}")
    
    # Check reasonable bounds
    min_mult = talent_df['shooting_talent_multiplier'].min()
    max_mult = talent_df['shooting_talent_multiplier'].max()
    
    if min_mult < 0.70:
        print(f"⚠️  Warning: Minimum multiplier ({min_mult:.3f}) is very low (< 0.70)")
    if max_mult > 1.40:
        print(f"⚠️  Warning: Maximum multiplier ({max_mult:.3f}) is very high (> 1.40)")
    
    # Show distribution
    print("\n📊 Talent Multiplier Distribution:")
    bins = [0.70, 0.80, 0.90, 0.95, 1.00, 1.05, 1.10, 1.20, 1.40]
    talent_df['talent_category'] = pd.cut(talent_df['shooting_talent_multiplier'], bins=bins)
    distribution = talent_df['talent_category'].value_counts().sort_index()
    
    for category, count in distribution.items():
        pct = count / len(talent_df) * 100
        print(f"   {category}: {count} players ({pct:.1f}%)")
    
    # Show top and bottom players
    print("\n🔝 Top 10 Shooters:")
    top_10 = talent_df.nlargest(10, 'shooting_talent_multiplier')
    for _, row in top_10.iterrows():
        print(f"   Player {int(row['player_id'])}: {row['shooting_talent_multiplier']:.3f} "
              f"({row.get('total_goals', 'N/A'):.0f} goals, {row.get('total_xG', 'N/A'):.2f} xG)")
    
    print("\n🔻 Bottom 10 Shooters:")
    bottom_10 = talent_df.nsmallest(10, 'shooting_talent_multiplier')
    for _, row in bottom_10.iterrows():
        print(f"   Player {int(row['player_id'])}: {row['shooting_talent_multiplier']:.3f} "
              f"({row.get('total_goals', 'N/A'):.0f} goals, {row.get('total_xG', 'N/A'):.2f} xG)")
    
    print("\n✅ Shooting talent validation complete")


if __name__ == "__main__":
    test_shooting_talent()

