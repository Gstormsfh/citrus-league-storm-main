#!/usr/bin/env python3
"""
calculate_shooting_talent.py
Calculate player shooting talent using Bayesian statistics (MoneyPuck methodology).

This script:
1. Aggregates historical goals vs xG for each player
2. Uses Bayesian inference to estimate true shooting talent
3. Outputs shooting_talent_multiplier for each player
"""

import pandas as pd
import numpy as np
from scipy import stats
import os
from dotenv import load_dotenv
from supabase import create_client, Client
import joblib

# Load environment variables
load_dotenv()

# Initialize Supabase client
# CRITICAL: Use the same variable names as data_acquisition.py
supabase_url = os.getenv('VITE_SUPABASE_URL')
# The Service Role Key uses a different name (without VITE_ prefix)
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("❌ Error: Supabase credentials not found in .env file")
    print("   Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set")
    print("   (These should match the variables used in data_acquisition.py)")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)


def load_historical_shooting_data(source='database'):
    """
    Load historical shooting data (goals, xG, shots) per player.
    
    Args:
        source: 'database' to load from Supabase, 'csv' to load from our_shots_2025.csv
    
    Returns:
        DataFrame with columns: player_id, total_goals, total_xG, total_shots
    """
    print("=" * 80)
    print("LOADING HISTORICAL SHOOTING DATA")
    print("=" * 80)
    
    if source == 'database':
        print("Loading from Supabase raw_shots table...")
        print("(Using pagination to fetch all records, not just the first 1000)")
        try:
            # Load all shots from database with pagination
            all_shots = []
            offset = 0
            batch_size = 1000
            
            while True:
                response = supabase.table('raw_shots').select(
                    'player_id, is_goal, xg_value'
                ).range(offset, offset + batch_size - 1).execute()
                
                if not response.data or len(response.data) == 0:
                    break
                
                all_shots.extend(response.data)
                
                if len(response.data) < batch_size:
                    break  # Last batch - we've fetched all records
                
                offset += batch_size
                print(f"  Fetched {len(all_shots):,} records so far...")
            
            if len(all_shots) == 0:
                print("⚠️  No data found in database (0 rows returned)")
                print("   Trying CSV file...")
                return load_historical_shooting_data(source='csv')
            
            df = pd.DataFrame(all_shots)
            
            # Convert types
            df['player_id'] = pd.to_numeric(df['player_id'], errors='coerce')
            df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
            df['xg_value'] = pd.to_numeric(df['xg_value'], errors='coerce').fillna(0.0)
            
            # Remove rows with invalid player_id
            df = df[df['player_id'].notna()].copy()
            
            print(f"✅ Loaded {len(df):,} shots from database")
            if len(df) == 0:
                print("⚠️  All rows had invalid player_id. Trying CSV file...")
                return load_historical_shooting_data(source='csv')
            
        except Exception as e:
            print(f"⚠️  Error loading from database: {e}")
            import traceback
            traceback.print_exc()
            print("   Falling back to CSV file...")
            return load_historical_shooting_data(source='csv')
    
    if source == 'csv':
        csv_file = 'data/our_shots_2025.csv'
        if not os.path.exists(csv_file):
            print(f"❌ CSV file not found: {csv_file}")
            print("   Please run pull_season_data.py first to generate the data file")
            return None
        
        print(f"Loading from {csv_file}...")
        df = pd.read_csv(csv_file)
        
        # Map column names
        if 'is_goal' in df.columns:
            df['is_goal'] = pd.to_numeric(df['is_goal'], errors='coerce').fillna(0).astype(int)
        elif 'shot_type_code' in df.columns:
            # Type 505 = goal
            df['is_goal'] = (df['shot_type_code'] == 505).astype(int)
        else:
            print("❌ Could not determine goals from data")
            return None
        
        if 'xg_value' in df.columns:
            df['xg_value'] = pd.to_numeric(df['xg_value'], errors='coerce').fillna(0.0)
        elif 'xG_Value' in df.columns:
            df['xg_value'] = pd.to_numeric(df['xG_Value'], errors='coerce').fillna(0.0)
        else:
            print("❌ Could not find xG values in data")
            return None
        
        if 'player_id' not in df.columns and 'playerId' in df.columns:
            df['player_id'] = df['playerId']
        
        print(f"Loaded {len(df):,} shots from CSV")
    
    # Check if we have any data
    if df is None or len(df) == 0:
        print("❌ No data available to process")
        return None
    
    # Aggregate by player
    print("\n📊 Aggregating shooting statistics by player...")
    player_stats = df.groupby('player_id').agg(
        total_goals=('is_goal', 'sum'),
        total_xG=('xg_value', 'sum'),
        total_shots=('player_id', 'count')
    ).reset_index()
    
    print(f"   Found {len(player_stats):,} unique players")
    if len(player_stats) > 0:
        print(f"   Shots per player: min={player_stats['total_shots'].min()}, max={player_stats['total_shots'].max()}, mean={player_stats['total_shots'].mean():.1f}")
    
    # Filter to players with minimum shots (need sufficient data for Bayesian estimation)
    MIN_SHOTS = 50  # Minimum shots for reliable talent estimation
    player_stats_filtered = player_stats[player_stats['total_shots'] >= MIN_SHOTS].copy()
    
    if len(player_stats_filtered) == 0:
        print(f"\n⚠️  No players found with ≥{MIN_SHOTS} shots")
        print(f"   Top 10 players by shot count:")
        top_players = player_stats.nlargest(10, 'total_shots')
        for _, row in top_players.iterrows():
            print(f"      Player {int(row['player_id'])}: {int(row['total_shots'])} shots, {int(row['total_goals'])} goals, {row['total_xG']:.2f} xG")
        print(f"\n   Consider lowering MIN_SHOTS or ensuring data has been processed")
        return None
    
    # Calculate goals above expected
    player_stats_filtered['goals_above_expected'] = player_stats_filtered['total_goals'] - player_stats_filtered['total_xG']
    player_stats_filtered['shooting_percentage_above_expected'] = (
        player_stats_filtered['goals_above_expected'] / player_stats_filtered['total_xG'] * 100
    ).fillna(0.0)
    
    print(f"\n✅ Found {len(player_stats_filtered):,} players with ≥{MIN_SHOTS} shots")
    print(f"   Total goals: {player_stats_filtered['total_goals'].sum():,.0f}")
    print(f"   Total xG: {player_stats_filtered['total_xG'].sum():,.2f}")
    print(f"   Average goals above expected: {player_stats_filtered['goals_above_expected'].mean():.2f}")
    
    return player_stats_filtered


def calculate_bayesian_shooting_talent(player_stats, talent_levels=None):
    """
    Calculate Bayesian shooting talent multipliers for each player.
    
    Uses MoneyPuck's methodology:
    P(talent_level | performance) = P(performance | talent_level) × P(talent_level) / P(performance)
    
    Args:
        player_stats: DataFrame with player_id, total_goals, total_xG, total_shots
        talent_levels: List of talent levels to consider (e.g., [-0.20, -0.10, 0.0, 0.10, 0.20])
    
    Returns:
        DataFrame with player_id and shooting_talent_multiplier
    """
    print("\n" + "=" * 80)
    print("CALCULATING BAYESIAN SHOOTING TALENT")
    print("=" * 80)
    
    if talent_levels is None:
        # Define talent levels as multipliers (e.g., 0.80 = 20% below average, 1.20 = 20% above average)
        talent_levels = np.arange(-0.30, 0.35, 0.05)  # -30% to +30% in 5% increments
    
    print(f"Using {len(talent_levels)} talent levels: {talent_levels.min():.0%} to {talent_levels.max():.0%}")
    
    # Prior distribution: Assume normal distribution centered at 0 (average shooter)
    # Standard deviation based on historical NHL data (typically ~10-15%)
    PRIOR_MEAN = 0.0
    PRIOR_STD = 0.12  # 12% standard deviation (reasonable for NHL shooters)
    
    # Calculate prior probabilities for each talent level
    prior_probs = stats.norm.pdf(talent_levels, PRIOR_MEAN, PRIOR_STD)
    prior_probs = prior_probs / prior_probs.sum()  # Normalize
    
    print(f"Prior distribution: Mean={PRIOR_MEAN:.0%}, Std={PRIOR_STD:.0%}")
    
    # For each player, calculate posterior probability distribution
    talent_multipliers = []
    
    for idx, row in player_stats.iterrows():
        player_id = row['player_id']
        total_goals = row['total_goals']
        total_xG = row['total_xG']
        total_shots = row['total_shots']
        
        # Observed performance: goals / xG ratio
        observed_ratio = total_goals / total_xG if total_xG > 0 else 1.0
        
        # Calculate likelihood for each talent level
        # Likelihood: P(observed_ratio | talent_level)
        # Use binomial distribution: goals ~ Binomial(total_xG, true_shooting_rate)
        # Where true_shooting_rate = (1 + talent_level) × average_rate
        # For simplicity, we model the ratio directly with a normal approximation
        
        likelihoods = []
        for talent_level in talent_levels:
            # Expected ratio given this talent level
            expected_ratio = 1.0 + talent_level
            
            # Likelihood: probability of observing this ratio given the talent level
            # Use normal approximation with variance based on sample size
            # Variance decreases with more shots (more confidence)
            variance = 1.0 / total_xG if total_xG > 0 else 1.0
            likelihood = stats.norm.pdf(observed_ratio, expected_ratio, np.sqrt(variance))
            likelihoods.append(likelihood)
        
        # Normalize likelihoods
        likelihoods = np.array(likelihoods)
        if likelihoods.sum() > 0:
            likelihoods = likelihoods / likelihoods.sum()
        
        # Calculate posterior: P(talent | performance) ∝ P(performance | talent) × P(talent)
        posterior_probs = likelihoods * prior_probs
        if posterior_probs.sum() > 0:
            posterior_probs = posterior_probs / posterior_probs.sum()
        else:
            # Fallback: use prior if likelihood is zero everywhere
            posterior_probs = prior_probs
        
        # Calculate expected talent (weighted average)
        expected_talent = np.sum(talent_levels * posterior_probs)
        
        # Convert to multiplier (1.0 = average, 1.15 = 15% above average)
        talent_multiplier = 1.0 + expected_talent
        
        # Cap at reasonable bounds (0.70 to 1.40)
        talent_multiplier = np.clip(talent_multiplier, 0.70, 1.40)
        
        talent_multipliers.append({
            'player_id': player_id,
            'shooting_talent_multiplier': talent_multiplier,
            'observed_ratio': observed_ratio,
            'total_shots': total_shots,
            'total_goals': total_goals,
            'total_xG': total_xG
        })
    
    result_df = pd.DataFrame(talent_multipliers)
    
    print(f"\n✅ Calculated talent multipliers for {len(result_df):,} players")
    print(f"   Average multiplier: {result_df['shooting_talent_multiplier'].mean():.3f}")
    print(f"   Min multiplier: {result_df['shooting_talent_multiplier'].min():.3f}")
    print(f"   Max multiplier: {result_df['shooting_talent_multiplier'].max():.3f}")
    print(f"   Std deviation: {result_df['shooting_talent_multiplier'].std():.3f}")
    
    # Show top and bottom shooters
    print("\n🔝 Top 10 Shooters (by talent multiplier):")
    top_shooters = result_df.nlargest(10, 'shooting_talent_multiplier')
    for _, row in top_shooters.iterrows():
        print(f"   Player {int(row['player_id'])}: {row['shooting_talent_multiplier']:.3f} "
              f"({row['total_goals']:.0f} goals, {row['total_xG']:.2f} xG, {int(row['total_shots'])} shots)")
    
    print("\n🔻 Bottom 10 Shooters (by talent multiplier):")
    bottom_shooters = result_df.nsmallest(10, 'shooting_talent_multiplier')
    for _, row in bottom_shooters.iterrows():
        print(f"   Player {int(row['player_id'])}: {row['shooting_talent_multiplier']:.3f} "
              f"({row['total_goals']:.0f} goals, {row['total_xG']:.2f} xG, {int(row['total_shots'])} shots)")
    
    return result_df


def save_shooting_talent_dict(talent_df, filename='player_shooting_talent.joblib'):
    """
    Save shooting talent multipliers as a dictionary for easy lookup.
    
    Args:
        talent_df: DataFrame with player_id and shooting_talent_multiplier
        filename: Output filename
    """
    print(f"\n💾 Saving shooting talent dictionary to {filename}...")
    
    # Create dictionary: {player_id: multiplier}
    talent_dict = dict(zip(
        talent_df['player_id'].astype(int),
        talent_df['shooting_talent_multiplier']
    ))
    
    joblib.dump(talent_dict, filename)
    print(f"✅ Saved {len(talent_dict):,} player talent multipliers")
    
    # Also save as CSV for inspection
    csv_filename = filename.replace('.joblib', '.csv')
    talent_df.to_csv(csv_filename, index=False)
    print(f"✅ Also saved as CSV: {csv_filename}")


def main():
    """Main execution function."""
    print("=" * 80)
    print("SHOOTING TALENT CALCULATION")
    print("=" * 80)
    print()
    
    # Load historical data
    player_stats = load_historical_shooting_data(source='database')
    
    if player_stats is None or len(player_stats) == 0:
        print("❌ Failed to load historical data. Exiting.")
        return
    
    # Calculate Bayesian shooting talent
    talent_df = calculate_bayesian_shooting_talent(player_stats)
    
    if talent_df is None or len(talent_df) == 0:
        print("❌ Failed to calculate shooting talent. Exiting.")
        return
    
    # Save results
    save_shooting_talent_dict(talent_df)
    
    print("\n" + "=" * 80)
    print("✅ SHOOTING TALENT CALCULATION COMPLETE")
    print("=" * 80)
    print("\n💡 To use in data_acquisition.py:")
    print("   1. Load: talent_dict = joblib.load('player_shooting_talent.joblib')")
    print("   2. Apply: adjusted_xg = base_xg × talent_dict.get(player_id, 1.0)")


if __name__ == "__main__":
    main()

