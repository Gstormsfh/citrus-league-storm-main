#!/usr/bin/env python3
"""
compare_full_season_stats.py
Comprehensive full season statistics comparison.

Compares our predicted stats (xG, xA) to actual statistics (goals, assists)
at all aggregation levels: shot-level, player-season, player-game, and game-level.
"""

import pandas as pd
import numpy as np
import os
import argparse
from dotenv import load_dotenv
from supabase import create_client, Client
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from scipy.stats import pearsonr

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def load_our_shot_data(source: str = "db", csv_path: str = "data/our_shots_2025.csv"):
    """
    Load shot-level data.

    Defaults to the database to avoid stale CSV snapshots.
    """
    print("=" * 80)
    print("LOADING OUR SHOT DATA")
    print("=" * 80)

    if source == "csv":
        if not os.path.exists(csv_path):
            print(f"❌ CSV file not found: {csv_path}")
            return None
        print(f"\n📁 Loading from CSV: {csv_path}")
        df = pd.read_csv(csv_path)
        print(f"✅ Loaded {len(df):,} shots from CSV")
        return df

    # Default: database
    print("\n📁 Loading from database: raw_shots table")
    try:
        all_shots = []
        offset = 0
        batch_size = 1000

        while True:
            response = (
                supabase.table('raw_shots')
                .select('*')
                .range(offset, offset + batch_size - 1)
                .execute()
            )

            if not response.data or len(response.data) == 0:
                break

            all_shots.extend(response.data)

            if len(response.data) < batch_size:
                break

            offset += batch_size
            if offset % 10000 == 0:
                print(f"  Fetched {len(all_shots):,} records so far...")

        if not all_shots:
            print("❌ No shots found in database")
            return None

        df = pd.DataFrame(all_shots)
        print(f"✅ Loaded {len(df):,} shots from database")
        return df

    except Exception as e:
        print(f"❌ Error loading from database: {e}")
        return None

def load_our_player_stats():
    """Load aggregated player stats from raw_player_stats table."""
    print("\n" + "=" * 80)
    print("LOADING OUR PLAYER STATS")
    print("=" * 80)
    
    try:
        all_stats = []
        offset = 0
        batch_size = 1000
        
        while True:
            response = supabase.table('raw_player_stats').select('*').range(offset, offset + batch_size - 1).execute()
            
            if not response.data or len(response.data) == 0:
                break
            
            all_stats.extend(response.data)
            
            if len(response.data) < batch_size:
                break
            
            offset += batch_size
            print(f"  Fetched {len(all_stats):,} records so far...")
        
        if all_stats:
            df = pd.DataFrame(all_stats)
            print(f"✅ Loaded {len(df):,} player/game records")
            return df
        else:
            print("⚠️  No player stats found in database")
            return pd.DataFrame()
            
    except Exception as e:
        print(f"⚠️  Error loading player stats: {e}")
        return pd.DataFrame()

def load_actual_stats():
    """Load actual statistics from staging_2025_skaters table."""
    print("\n" + "=" * 80)
    print("LOADING ACTUAL STATISTICS")
    print("=" * 80)
    
    try:
        response = supabase.table('staging_2025_skaters').select(
            'playerId, name, I_F_goals, I_F_primaryAssists, I_F_secondaryAssists, games_played, situation'
        ).eq('situation', 'all').execute()
        
        if response.data:
            df = pd.DataFrame(response.data)
            
            # Calculate total assists
            df['I_F_primaryAssists'] = pd.to_numeric(df['I_F_primaryAssists'], errors='coerce').fillna(0)
            df['I_F_secondaryAssists'] = pd.to_numeric(df['I_F_secondaryAssists'], errors='coerce').fillna(0)
            df['I_F_assists'] = df['I_F_primaryAssists'] + df['I_F_secondaryAssists']
            df['I_F_goals'] = pd.to_numeric(df['I_F_goals'], errors='coerce').fillna(0)
            df['games_played'] = pd.to_numeric(df['games_played'], errors='coerce').fillna(1)
            
            print(f"✅ Loaded {len(df):,} players from staging data")
            return df
        else:
            print("⚠️  No staging data found")
            return pd.DataFrame()
            
    except Exception as e:
        print(f"⚠️  Error loading staging data: {e}")
        return pd.DataFrame()

def analyze_shot_level(shots_df):
    """Analyze shot-level statistics."""
    print("\n" + "=" * 80)
    print("SHOT-LEVEL ANALYSIS")
    print("=" * 80)
    
    if shots_df is None or len(shots_df) == 0:
        print("⚠️  No shot data available")
        return None
    
    # Get xG values
    xg_col = None
    for col in ['xg_value', 'xG_Value', 'predicted_xg', 'flurry_adjusted_xg']:
        if col in shots_df.columns:
            xg_col = col
            break
    
    if xg_col is None:
        print("⚠️  No xG column found")
        return None
    
    # Get actual goals
    if 'is_goal' in shots_df.columns:
        shots_df['actual_goals'] = shots_df['is_goal'].astype(int)
    elif 'shot_type_code' in shots_df.columns:
        shots_df['actual_goals'] = (shots_df['shot_type_code'] == 505).astype(int)
    else:
        print("⚠️  Cannot determine actual goals")
        return None
    
    # Calculate totals
    total_shots = len(shots_df)
    total_xg = shots_df[xg_col].sum()
    total_goals = shots_df['actual_goals'].sum()
    
    # Calculate rates
    shooting_pct = (total_goals / total_shots * 100) if total_shots > 0 else 0
    xg_per_shot = total_xg / total_shots if total_shots > 0 else 0
    goals_per_shot = total_goals / total_shots if total_shots > 0 else 0
    calibration_ratio = total_xg / total_goals if total_goals > 0 else 0
    
    # Correlation
    correlation, p_value = pearsonr(shots_df[xg_col], shots_df['actual_goals'])
    
    # R² Score (coefficient of determination)
    r2 = r2_score(shots_df['actual_goals'], shots_df[xg_col])
    
    # Brier score
    brier_score = np.mean((shots_df[xg_col] - shots_df['actual_goals'])**2)
    
    # Calibration by bins
    bins = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0]
    shots_df['xg_bin'] = pd.cut(shots_df[xg_col], bins=bins, 
                                labels=['0-0.05', '0.05-0.1', '0.1-0.15', '0.15-0.2', 
                                       '0.2-0.3', '0.3-0.5', '0.5+'])
    
    calibration = shots_df.groupby('xg_bin', observed=True).agg({
        xg_col: 'mean',
        'actual_goals': ['mean', 'sum', 'count']
    }).reset_index()
    calibration.columns = ['xg_bin', 'mean_predicted_xg', 'actual_goal_rate', 'goals', 'shots']
    
    # Print results
    print(f"\n📊 Shot-Level Statistics:")
    print(f"  Total Shots: {total_shots:,}")
    print(f"  Total xG: {total_xg:.2f}")
    print(f"  Total Goals: {total_goals:,}")
    print(f"  Calibration Ratio: {calibration_ratio:.3f} (xG/Goals)")
    print(f"\n📈 Rates:")
    print(f"  Shooting Percentage: {shooting_pct:.2f}%")
    print(f"  xG per Shot: {xg_per_shot:.4f}")
    print(f"  Goals per Shot: {goals_per_shot:.4f}")
    print(f"\n📊 Model Performance:")
    print(f"  R² Score: {r2:.4f} (coefficient of determination)")
    print(f"  Correlation: {correlation:.4f} (p-value: {p_value:.2e})")
    print(f"  Brier Score: {brier_score:.4f} (lower is better)")
    
    print(f"\n📉 Calibration by xG Bins:")
    print(f"{'xG Bin':<15} {'Mean Predicted':<15} {'Actual Goal Rate':<15} {'Goals':<8} {'Shots':<8}")
    print("-" * 80)
    for _, row in calibration.iterrows():
        print(f"{row['xg_bin']:<15} {row['mean_predicted_xg']:<15.3f} {row['actual_goal_rate']:<15.3f} {row['goals']:<8.0f} {row['shots']:<8.0f}")
    
    return {
        'total_shots': total_shots,
        'total_xg': total_xg,
        'total_goals': total_goals,
        'calibration_ratio': calibration_ratio,
        'shooting_pct': shooting_pct,
        'xg_per_shot': xg_per_shot,
        'goals_per_shot': goals_per_shot,
        'r2_score': r2,
        'correlation': correlation,
        'brier_score': brier_score,
        'calibration_bins': calibration
    }

def analyze_player_season(our_player_stats, actual_stats):
    """Analyze player-season totals."""
    print("\n" + "=" * 80)
    print("PLAYER-SEASON TOTALS ANALYSIS")
    print("=" * 80)
    
    if our_player_stats is None or len(our_player_stats) == 0:
        print("⚠️  No player stats data available")
        return None
    
    if actual_stats is None or len(actual_stats) == 0:
        print("⚠️  No actual stats data available")
        return None
    
    # Aggregate our stats by player
    xg_col = 'I_F_xGoals' if 'I_F_xGoals' in our_player_stats.columns else None
    xa_col = 'I_F_xAssists' if 'I_F_xAssists' in our_player_stats.columns else None
    
    if xg_col is None:
        print("⚠️  No xG column found in player stats")
        return None
    
    # Aggregate by player
    agg_dict = {xg_col: 'sum'}
    if xa_col:
        agg_dict[xa_col] = 'sum'
    
    our_agg = our_player_stats.groupby('playerId').agg(agg_dict).reset_index()
    
    if xa_col:
        our_agg.columns = ['playerId', 'our_xG_total', 'our_xA_total']
    else:
        our_agg.columns = ['playerId', 'our_xG_total']
        our_agg['our_xA_total'] = 0.0
    
    # Convert playerId to string for matching
    our_agg['playerId'] = our_agg['playerId'].astype(str)
    actual_stats['playerId'] = actual_stats['playerId'].astype(str)
    
    # Merge
    comparison = our_agg.merge(
        actual_stats[['playerId', 'name', 'I_F_goals', 'I_F_assists', 'games_played']],
        on='playerId',
        how='inner'
    )
    
    if len(comparison) == 0:
        print("⚠️  No matching players found")
        return None
    
    # Calculate ratios
    comparison['xG_to_goals_ratio'] = comparison['our_xG_total'] / comparison['I_F_goals'].replace(0, 1)
    comparison['xA_to_assists_ratio'] = comparison['our_xA_total'] / comparison['I_F_assists'].replace(0, 1)
    
    # Calculate per-game rates
    comparison['our_xG_per_game'] = comparison['our_xG_total'] / comparison['games_played']
    comparison['our_xA_per_game'] = comparison['our_xA_total'] / comparison['games_played']
    comparison['actual_goals_per_game'] = comparison['I_F_goals'] / comparison['games_played']
    comparison['actual_assists_per_game'] = comparison['I_F_assists'] / comparison['games_played']
    
    # Calculate correlations
    xg_corr, xg_p = pearsonr(comparison['our_xG_total'], comparison['I_F_goals'])
    xa_corr, xa_p = pearsonr(comparison['our_xA_total'], comparison['I_F_assists']) if xa_col else (0, 1)
    
    # Calculate R² scores
    xg_r2 = r2_score(comparison['I_F_goals'], comparison['our_xG_total'])
    xa_r2 = r2_score(comparison['I_F_assists'], comparison['our_xA_total']) if xa_col else 0.0
    
    # Print results
    print(f"\n📊 Player-Season Statistics ({len(comparison)} players):")
    print(f"  Total xG: {comparison['our_xG_total'].sum():.2f}")
    print(f"  Total Goals: {comparison['I_F_goals'].sum():.0f}")
    print(f"  Total xA: {comparison['our_xA_total'].sum():.2f}")
    print(f"  Total Assists: {comparison['I_F_assists'].sum():.0f}")
    print(f"\n📈 Averages:")
    print(f"  Average xG/player: {comparison['our_xG_total'].mean():.2f}")
    print(f"  Average Goals/player: {comparison['I_F_goals'].mean():.2f}")
    print(f"  Average xG/goals ratio: {comparison['xG_to_goals_ratio'].mean():.2f}x")
    print(f"  Median xG/goals ratio: {comparison['xG_to_goals_ratio'].median():.2f}x")
    print(f"\n📊 Model Performance:")
    print(f"  xG vs Goals R²: {xg_r2:.4f}")
    print(f"  xG vs Goals Correlation: {xg_corr:.4f} (p-value: {xg_p:.2e})")
    if xa_col:
        print(f"  xA vs Assists R²: {xa_r2:.4f}")
        print(f"  xA vs Assists Correlation: {xa_corr:.4f} (p-value: {xa_p:.2e})")
    
    print(f"\n🏆 Top 10 by xG:")
    top_xg = comparison.nlargest(10, 'our_xG_total')[
        ['name', 'our_xG_total', 'I_F_goals', 'xG_to_goals_ratio', 'games_played']
    ]
    print(top_xg.to_string(index=False))
    
    if xa_col:
        print(f"\n🏆 Top 10 by xA:")
        top_xa = comparison[comparison['our_xA_total'] > 0].nlargest(10, 'our_xA_total')[
            ['name', 'our_xA_total', 'I_F_assists', 'xA_to_assists_ratio', 'games_played']
        ]
        if len(top_xa) > 0:
            print(top_xa.to_string(index=False))
    
    return comparison

def analyze_player_game(our_player_stats, actual_stats):
    """Analyze player-game level statistics."""
    print("\n" + "=" * 80)
    print("PLAYER-GAME LEVEL ANALYSIS")
    print("=" * 80)
    
    if our_player_stats is None or len(our_player_stats) == 0:
        print("⚠️  No player stats data available")
        return None
    
    if actual_stats is None or len(actual_stats) == 0:
        print("⚠️  No actual stats data available")
        return None
    
    # Get xG/xA columns
    xg_col = 'I_F_xGoals' if 'I_F_xGoals' in our_player_stats.columns else None
    xa_col = 'I_F_xAssists' if 'I_F_xAssists' in our_player_stats.columns else None
    
    if xg_col is None:
        print("⚠️  No xG column found")
        return None
    
    # We need to get per-game actual stats from staging or calculate from shots
    # For now, calculate per-game from our aggregated data
    our_player_stats['playerId'] = our_player_stats['playerId'].astype(str)
    
    # Calculate per-game averages
    agg_dict = {xg_col: 'sum'}
    if xa_col:
        agg_dict[xa_col] = 'sum'
    
    player_game_stats = our_player_stats.groupby(['playerId', 'game_id']).agg(agg_dict).reset_index()
    
    if xa_col:
        player_game_stats.columns = ['playerId', 'game_id', 'our_xG', 'our_xA']
    else:
        player_game_stats.columns = ['playerId', 'game_id', 'our_xG']
        player_game_stats['our_xA'] = 0.0
    
    # Get player names
    actual_stats['playerId'] = actual_stats['playerId'].astype(str)
    player_game_stats = player_game_stats.merge(
        actual_stats[['playerId', 'name', 'games_played']],
        on='playerId',
        how='left'
    )
    
    # Calculate per-game rates (using games_played from staging)
    player_game_stats['our_xG_per_game'] = player_game_stats['our_xG']
    player_game_stats['our_xA_per_game'] = player_game_stats['our_xA']
    
    # Aggregate to get averages
    per_game_avg = player_game_stats.groupby('playerId').agg({
        'our_xG': 'mean',
        'our_xA': 'mean',
        'name': 'first',
        'games_played': 'first'
    }).reset_index()
    
    # Merge with actual per-game stats
    actual_stats['actual_goals_per_game'] = actual_stats['I_F_goals'] / actual_stats['games_played']
    actual_stats['actual_assists_per_game'] = actual_stats['I_F_assists'] / actual_stats['games_played']
    
    comparison = per_game_avg.merge(
        actual_stats[['playerId', 'actual_goals_per_game', 'actual_assists_per_game']],
        on='playerId',
        how='inner'
    )
    
    comparison.columns = ['playerId', 'our_xG_per_game', 'our_xA_per_game', 'name', 'games_played', 
                         'actual_goals_per_game', 'actual_assists_per_game']
    
    # Calculate ratios
    comparison['xG_to_goals_ratio'] = comparison['our_xG_per_game'] / comparison['actual_goals_per_game'].replace(0, 1)
    comparison['xA_to_assists_ratio'] = comparison['our_xA_per_game'] / comparison['actual_assists_per_game'].replace(0, 1)
    
    # Calculate R² scores
    xg_r2 = r2_score(comparison['actual_goals_per_game'], comparison['our_xG_per_game'])
    xa_r2 = r2_score(comparison['actual_assists_per_game'], comparison['our_xA_per_game']) if xa_col else 0.0
    
    # Calculate correlations
    xg_corr, xg_p = pearsonr(comparison['our_xG_per_game'], comparison['actual_goals_per_game'])
    xa_corr, xa_p = pearsonr(comparison['our_xA_per_game'], comparison['actual_assists_per_game']) if xa_col else (0, 1)
    
    # Print results
    print(f"\n📊 Player-Game Statistics ({len(comparison)} players):")
    print(f"  Average xG/game: {comparison['our_xG_per_game'].mean():.3f}")
    print(f"  Average Goals/game: {comparison['actual_goals_per_game'].mean():.3f}")
    print(f"  Average xA/game: {comparison['our_xA_per_game'].mean():.3f}")
    print(f"  Average Assists/game: {comparison['actual_assists_per_game'].mean():.3f}")
    print(f"  Average xG/goals ratio: {comparison['xG_to_goals_ratio'].mean():.2f}x")
    print(f"  Median xG/goals ratio: {comparison['xG_to_goals_ratio'].median():.2f}x")
    print(f"\n📊 Model Performance:")
    print(f"  xG vs Goals R²: {xg_r2:.4f}")
    print(f"  xG vs Goals Correlation: {xg_corr:.4f} (p-value: {xg_p:.2e})")
    if xa_col:
        print(f"  xA vs Assists R²: {xa_r2:.4f}")
        print(f"  xA vs Assists Correlation: {xa_corr:.4f} (p-value: {xa_p:.2e})")
    
    print(f"\n🏆 Top 10 by xG/game:")
    top_xg = comparison.nlargest(10, 'our_xG_per_game')[
        ['name', 'our_xG_per_game', 'actual_goals_per_game', 'xG_to_goals_ratio', 'games_played']
    ]
    print(top_xg.to_string(index=False))
    
    return comparison

def analyze_game_level(shots_df, our_player_stats):
    """Analyze game-level totals."""
    print("\n" + "=" * 80)
    print("GAME-LEVEL ANALYSIS")
    print("=" * 80)
    
    if shots_df is None or len(shots_df) == 0:
        print("⚠️  No shot data available")
        return None
    
    # Get xG column
    xg_col = None
    for col in ['xg_value', 'xG_Value', 'predicted_xg', 'flurry_adjusted_xg']:
        if col in shots_df.columns:
            xg_col = col
            break
    
    if xg_col is None:
        print("⚠️  No xG column found")
        return None
    
    # Get actual goals
    if 'is_goal' in shots_df.columns:
        shots_df['actual_goals'] = shots_df['is_goal'].astype(int)
    elif 'shot_type_code' in shots_df.columns:
        shots_df['actual_goals'] = (shots_df['shot_type_code'] == 505).astype(int)
    else:
        print("⚠️  Cannot determine actual goals")
        return None
    
    # Aggregate by game
    game_stats = shots_df.groupby('game_id').agg({
        xg_col: 'sum',
        'actual_goals': 'sum',
        'player_id': 'count'  # Shot count
    }).reset_index()
    game_stats.columns = ['game_id', 'total_xg', 'total_goals', 'shot_count']
    
    # Get xA from player stats if available
    if our_player_stats is not None and len(our_player_stats) > 0:
        xa_col = 'I_F_xAssists' if 'I_F_xAssists' in our_player_stats.columns else None
        if xa_col:
            game_xa = our_player_stats.groupby('game_id')[xa_col].sum().reset_index()
            game_xa.columns = ['game_id', 'total_xa']
            game_stats = game_stats.merge(game_xa, on='game_id', how='left')
            game_stats['total_xa'] = game_stats['total_xa'].fillna(0)
        else:
            game_stats['total_xa'] = 0
    else:
        game_stats['total_xa'] = 0
    
    # Calculate ratios
    game_stats['xg_to_goals_ratio'] = game_stats['total_xg'] / game_stats['total_goals'].replace(0, 1)
    
    # Calculate R² score
    game_r2 = r2_score(game_stats['total_goals'], game_stats['total_xg'])
    
    # Calculate correlation
    game_corr, game_p = pearsonr(game_stats['total_xg'], game_stats['total_goals'])
    
    # Calculate MAE and RMSE
    game_mae = mean_absolute_error(game_stats['total_goals'], game_stats['total_xg'])
    game_rmse = np.sqrt(mean_squared_error(game_stats['total_goals'], game_stats['total_xg']))
    
    # Print results
    print(f"\n📊 Game-Level Statistics ({len(game_stats)} games):")
    print(f"  Total xG: {game_stats['total_xg'].sum():.2f}")
    print(f"  Total Goals: {game_stats['total_goals'].sum():.0f}")
    print(f"  Total xA: {game_stats['total_xa'].sum():.2f}")
    print(f"  Average xG/game: {game_stats['total_xg'].mean():.3f}")
    print(f"  Average Goals/game: {game_stats['total_goals'].mean():.3f}")
    print(f"  Average xG/goals ratio: {game_stats['xg_to_goals_ratio'].mean():.2f}x")
    print(f"  Median xG/goals ratio: {game_stats['xg_to_goals_ratio'].median():.2f}x")
    print(f"\n📊 Model Performance:")
    print(f"  R² Score: {game_r2:.4f}")
    print(f"  Correlation: {game_corr:.4f} (p-value: {game_p:.2e})")
    print(f"  MAE: {game_mae:.3f} goals/game")
    print(f"  RMSE: {game_rmse:.3f} goals/game")
    
    # Identify games with large discrepancies
    game_stats['discrepancy'] = abs(game_stats['total_xg'] - game_stats['total_goals'])
    print(f"\n⚠️  Games with largest discrepancies (xG vs Goals):")
    top_discrepancies = game_stats.nlargest(10, 'discrepancy')[
        ['game_id', 'total_xg', 'total_goals', 'xg_to_goals_ratio', 'shot_count']
    ]
    print(top_discrepancies.to_string(index=False))
    
    # Add metrics to stats dict for summary
    game_stats_dict = {
        'game_stats': game_stats,
        'r2_score': game_r2,
        'correlation': game_corr,
        'mae': game_mae,
        'rmse': game_rmse
    }
    
    return game_stats_dict

def save_outputs(shot_level_stats, player_season_stats, player_game_stats, game_level_stats):
    """Save all comparison data to CSV files."""
    print("\n" + "=" * 80)
    print("SAVING OUTPUTS")
    print("=" * 80)
    
    os.makedirs('data', exist_ok=True)
    
    # Save shot-level calibration
    if shot_level_stats and 'calibration_bins' in shot_level_stats:
        shot_level_stats['calibration_bins'].to_csv('data/shot_level_stats.csv', index=False)
        print("✅ Saved: data/shot_level_stats.csv")
    
    # Save player-season comparison
    if player_season_stats is not None and len(player_season_stats) > 0:
        player_season_stats.to_csv('data/player_season_comparison.csv', index=False)
        print("✅ Saved: data/player_season_comparison.csv")
    
    # Save player-game comparison
    if player_game_stats is not None and len(player_game_stats) > 0:
        player_game_stats.to_csv('data/player_game_comparison.csv', index=False)
        print("✅ Saved: data/player_game_comparison.csv")
    
    # Save game-level comparison
    if game_level_stats is not None and 'game_stats' in game_level_stats:
        game_level_stats['game_stats'].to_csv('data/game_level_comparison.csv', index=False)
        print("✅ Saved: data/game_level_comparison.csv")

def main():
    """Main function."""
    print("=" * 80)
    print("FULL SEASON STATISTICS COMPARISON")
    print("=" * 80)
    print("\nThis script compares our predicted stats (xG, xA) to actual statistics")
    print("at all aggregation levels: shot, player-season, player-game, and game.")
    print()
    
    parser = argparse.ArgumentParser(description="Compare full season stats vs actuals.")
    parser.add_argument(
        "--source",
        choices=["db", "csv"],
        default="db",
        help="Shot data source. Default: db (Supabase raw_shots).",
    )
    parser.add_argument(
        "--csv-path",
        default="data/our_shots_2025.csv",
        help="Path to CSV when --source csv is used.",
    )
    args = parser.parse_args()

    # Load data
    shots_df = load_our_shot_data(source=args.source, csv_path=args.csv_path)
    our_player_stats = load_our_player_stats()
    actual_stats = load_actual_stats()
    
    # Analyze at all levels
    shot_level_stats = analyze_shot_level(shots_df)
    player_season_stats = analyze_player_season(our_player_stats, actual_stats)
    player_game_stats = analyze_player_game(our_player_stats, actual_stats)
    game_level_stats = analyze_game_level(shots_df, our_player_stats)
    
    # Save outputs
    save_outputs(shot_level_stats, player_season_stats, player_game_stats, game_level_stats)
    
    # Final summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    if shot_level_stats:
        print(f"\n✅ Shot-Level: {shot_level_stats['total_shots']:,} shots analyzed")
        print(f"   Calibration Ratio: {shot_level_stats['calibration_ratio']:.3f}")
        print(f"   R² Score: {shot_level_stats['r2_score']:.4f}")
        print(f"   Correlation: {shot_level_stats['correlation']:.4f}")
    
    if player_season_stats is not None and len(player_season_stats) > 0:
        print(f"\n✅ Player-Season: {len(player_season_stats)} players compared")
        xg_ratio = player_season_stats['xG_to_goals_ratio'].median()
        print(f"   Median xG/Goals Ratio: {xg_ratio:.2f}x")
    
    if player_game_stats is not None and len(player_game_stats) > 0:
        print(f"\n✅ Player-Game: {len(player_game_stats)} players analyzed")
        print(f"   Average xG/game: {player_game_stats['our_xG_per_game'].mean():.3f}")
    
    if game_level_stats is not None and 'game_stats' in game_level_stats:
        game_stats_df = game_level_stats['game_stats']
        print(f"\n✅ Game-Level: {len(game_stats_df)} games analyzed")
        print(f"   Average xG/game: {game_stats_df['total_xg'].mean():.3f}")
        print(f"   Average Goals/game: {game_stats_df['total_goals'].mean():.3f}")
        print(f"   R² Score: {game_level_stats['r2_score']:.4f}")
        print(f"   MAE: {game_level_stats['mae']:.3f} goals/game")
        print(f"   RMSE: {game_level_stats['rmse']:.3f} goals/game")
    
    print("\n" + "=" * 80)
    print("✅ COMPARISON COMPLETE!")
    print("=" * 80)
    print("\n📁 All results saved to data/ directory")
    print("   - shot_level_stats.csv")
    print("   - player_season_comparison.csv")
    print("   - player_game_comparison.csv")
    print("   - game_level_comparison.csv")

if __name__ == "__main__":
    main()

