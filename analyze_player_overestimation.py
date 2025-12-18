#!/usr/bin/env python3
"""
Analyze player overestimation patterns to identify why certain players
are consistently overestimated by the xG model.

This script helps identify patterns in players who have high xG/Goals ratios,
which can inform future model improvements.
"""

import pandas as pd
import numpy as np
import os

def load_player_data():
    """Load player-season comparison data."""
    if not os.path.exists('data/player_season_comparison.csv'):
        print("❌ Error: data/player_season_comparison.csv not found")
        print("   Run compare_full_season_stats.py first to generate this file")
        return None
    
    df = pd.read_csv('data/player_season_comparison.csv')
    return df

def load_shot_data():
    """Load shot-level data for detailed analysis."""
    if not os.path.exists('data/our_shots_2025.csv'):
        print("❌ Error: data/our_shots_2025.csv not found")
        return None
    
    df = pd.read_csv('data/our_shots_2025.csv')
    return df

def analyze_overestimated_players(df_players, threshold_ratio=1.5, min_goals=5):
    """
    Analyze players with high xG/Goals ratios.
    
    Args:
        df_players: DataFrame with player-season data
        threshold_ratio: Minimum xG/Goals ratio to consider "overestimated"
        min_goals: Minimum goals required for analysis
    """
    print("=" * 80)
    print("PLAYER OVERESTIMATION ANALYSIS")
    print("=" * 80)
    
    # Filter to players with sufficient goals and high ratios
    overestimated = df_players[
        (df_players['I_F_goals'] >= min_goals) & 
        (df_players['xG_to_goals_ratio'] >= threshold_ratio)
    ].copy()
    
    overestimated = overestimated.sort_values('xG_to_goals_ratio', ascending=False)
    
    print(f"\n📊 Players with xG/Goals ratio >= {threshold_ratio} (min {min_goals} goals):")
    print(f"   Total: {len(overestimated)} players")
    
    if len(overestimated) > 0:
        print(f"\n🏆 Top 20 Most Overestimated Players:")
        print(overestimated[['name', 'our_xG_total', 'I_F_goals', 'xG_to_goals_ratio', 'games_played']].head(20).to_string(index=False))
        
        # Calculate statistics
        print(f"\n📈 Statistics for Overestimated Players:")
        print(f"   Mean xG: {overestimated['our_xG_total'].mean():.2f}")
        print(f"   Mean Goals: {overestimated['I_F_goals'].mean():.2f}")
        print(f"   Mean Ratio: {overestimated['xG_to_goals_ratio'].mean():.2f}x")
        print(f"   Mean Games: {overestimated['games_played'].mean():.1f}")
    
    return overestimated

def analyze_shot_characteristics(df_shots, player_ids, player_names):
    """
    Analyze shot characteristics for overestimated players.
    
    Args:
        df_shots: DataFrame with shot-level data
        player_ids: List of player IDs to analyze
        player_names: Dictionary mapping player IDs to names
    """
    if df_shots is None:
        return None
    
    print("\n" + "=" * 80)
    print("SHOT CHARACTERISTICS ANALYSIS")
    print("=" * 80)
    
    # Filter shots from overestimated players
    player_shots = df_shots[df_shots['playerId'].isin(player_ids)].copy()
    
    if len(player_shots) == 0:
        print("⚠️  No shot data found for overestimated players")
        return None
    
    print(f"\n📊 Shot Statistics for Overestimated Players:")
    print(f"   Total Shots: {len(player_shots)}")
    print(f"   Mean xG per shot: {player_shots['xG_Value'].mean():.4f}")
    print(f"   Median xG per shot: {player_shots['xG_Value'].median():.4f}")
    print(f"   Shots with xG > 0.3: {len(player_shots[player_shots['xG_Value'] > 0.3])} ({len(player_shots[player_shots['xG_Value'] > 0.3])/len(player_shots)*100:.1f}%)")
    print(f"   Shots with xG > 0.2: {len(player_shots[player_shots['xG_Value'] > 0.2])} ({len(player_shots[player_shots['xG_Value'] > 0.2])/len(player_shots)*100:.1f}%)")
    
    # Analyze shot types
    if 'shot_type_encoded' in player_shots.columns:
        print(f"\n📊 Shot Type Distribution:")
        shot_types = player_shots['shot_type_encoded'].value_counts()
        for shot_type, count in shot_types.head(10).items():
            print(f"   Type {shot_type}: {count} shots ({count/len(player_shots)*100:.1f}%)")
    
    # Analyze shot locations
    if 'distance' in player_shots.columns:
        print(f"\n📊 Shot Distance Statistics:")
        print(f"   Mean Distance: {player_shots['distance'].mean():.1f} feet")
        print(f"   Median Distance: {player_shots['distance'].median():.1f} feet")
        print(f"   Shots from < 20 feet: {len(player_shots[player_shots['distance'] < 20])} ({len(player_shots[player_shots['distance'] < 20])/len(player_shots)*100:.1f}%)")
        print(f"   Shots from < 30 feet: {len(player_shots[player_shots['distance'] < 30])} ({len(player_shots[player_shots['distance'] < 30])/len(player_shots)*100:.1f}%)")
    
    # Analyze rebounds
    if 'is_rebound' in player_shots.columns:
        rebound_count = player_shots['is_rebound'].sum() if player_shots['is_rebound'].dtype == bool else (player_shots['is_rebound'] == 1).sum()
        print(f"\n📊 Rebound Statistics:")
        print(f"   Rebound Shots: {rebound_count} ({rebound_count/len(player_shots)*100:.1f}%)")
    
    return player_shots

def generate_recommendations(overestimated_players, player_shots):
    """Generate recommendations based on analysis."""
    print("\n" + "=" * 80)
    print("RECOMMENDATIONS")
    print("=" * 80)
    
    print("\n💡 Potential Causes of Overestimation:")
    print("   1. Player shooting style not well-captured by model features")
    print("   2. Player positioning/role creates high xG shots that don't convert")
    print("   3. Player-specific shooting talent (should be separate adjustment)")
    print("   4. Shot quality features may not capture all relevant factors")
    
    print("\n💡 Suggested Actions:")
    print("   1. Consider player shooting talent adjustment (Bayesian model)")
    print("   2. Review shot type encoding for these players")
    print("   3. Investigate if these players take shots from specific locations")
    print("   4. Consider adding player position/role features")
    print("   5. Document findings for future model improvements")
    
    print("\n💡 Note:")
    print("   Some overestimation is expected and can be addressed with")
    print("   a separate 'Shooting Talent Adjusted Expected Goals' model")
    print("   that uses Bayesian statistics to account for individual skill.")

def main():
    """Main analysis function."""
    print("=" * 80)
    print("PLAYER OVERESTIMATION PATTERN ANALYSIS")
    print("=" * 80)
    
    # Load data
    df_players = load_player_data()
    if df_players is None:
        return
    
    df_shots = load_shot_data()
    
    # Analyze overestimated players
    overestimated = analyze_overestimated_players(df_players, threshold_ratio=1.5, min_goals=5)
    
    if len(overestimated) > 0 and df_shots is not None:
        # Get player IDs and names
        player_ids = overestimated['playerId'].tolist()
        player_names = dict(zip(overestimated['playerId'], overestimated['name']))
        
        # Analyze shot characteristics
        player_shots = analyze_shot_characteristics(df_shots, player_ids, player_names)
        
        # Generate recommendations
        generate_recommendations(overestimated, player_shots)
        
        # Save results
        output_file = 'data/overestimated_players_analysis.csv'
        overestimated.to_csv(output_file, index=False)
        print(f"\n✅ Saved analysis to {output_file}")
    else:
        generate_recommendations(overestimated, None)
    
    print("\n" + "=" * 80)
    print("✅ ANALYSIS COMPLETE")
    print("=" * 80)

if __name__ == '__main__':
    main()

