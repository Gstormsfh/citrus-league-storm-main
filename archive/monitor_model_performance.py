#!/usr/bin/env python3
"""
Monitor model performance as the season progresses.

This script provides a template for tracking model performance metrics
over time to identify trends and potential issues.
"""

import pandas as pd
import numpy as np
from datetime import datetime
import os

def load_current_data():
    """Load current season data."""
    if not os.path.exists('data/player_season_comparison.csv'):
        print("❌ Error: data/player_season_comparison.csv not found")
        print("   Run compare_full_season_stats.py first")
        return None
    
    df = pd.read_csv('data/player_season_comparison.csv')
    return df

def calculate_key_metrics(df):
    """Calculate key performance metrics."""
    metrics = {}
    
    # Overall calibration
    total_xg = df['our_xG_total'].sum()
    total_goals = df['I_F_goals'].sum()
    metrics['overall_xg_goals_ratio'] = total_xg / total_goals if total_goals > 0 else 0
    metrics['median_xg_goals_ratio'] = df['xG_to_goals_ratio'].median()
    metrics['mean_xg_goals_ratio'] = df['xG_to_goals_ratio'].mean()
    
    # Player counts
    metrics['total_players'] = len(df)
    metrics['players_with_xg_10_plus'] = len(df[df['our_xG_total'] >= 10])
    metrics['players_with_goals_10_plus'] = len(df[df['I_F_goals'] >= 10])
    
    # Top performers
    top_10_xg = df.nlargest(10, 'our_xG_total')
    metrics['top_10_xg_total'] = top_10_xg['our_xG_total'].sum()
    metrics['top_10_goals_total'] = top_10_xg['I_F_goals'].sum()
    metrics['top_10_ratio'] = metrics['top_10_xg_total'] / metrics['top_10_goals_total'] if metrics['top_10_goals_total'] > 0 else 0
    
    # Overestimation tracking
    overestimated = df[(df['I_F_goals'] >= 5) & (df['xG_to_goals_ratio'] >= 1.5)]
    metrics['overestimated_players_count'] = len(overestimated)
    metrics['overestimated_mean_ratio'] = overestimated['xG_to_goals_ratio'].mean() if len(overestimated) > 0 else 0
    
    # Underestimation tracking
    underestimated = df[(df['I_F_goals'] >= 5) & (df['xG_to_goals_ratio'] <= 0.7)]
    metrics['underestimated_players_count'] = len(underestimated)
    metrics['underestimated_mean_ratio'] = underestimated['xG_to_goals_ratio'].mean() if len(underestimated) > 0 else 0
    
    return metrics

def save_metrics(metrics, output_file='data/model_performance_history.csv'):
    """Save metrics to history file."""
    # Add timestamp
    metrics['timestamp'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    metrics['date'] = datetime.now().strftime('%Y-%m-%d')
    
    # Load existing history or create new
    if os.path.exists(output_file):
        history = pd.read_csv(output_file)
        history = pd.concat([history, pd.DataFrame([metrics])], ignore_index=True)
    else:
        history = pd.DataFrame([metrics])
    
    # Save
    history.to_csv(output_file, index=False)
    return history

def print_metrics(metrics):
    """Print current metrics."""
    print("=" * 80)
    print("MODEL PERFORMANCE MONITORING")
    print("=" * 80)
    print(f"\n📅 Date: {metrics.get('date', 'N/A')}")
    print(f"⏰ Time: {metrics.get('timestamp', 'N/A')}")
    
    print(f"\n📊 Overall Calibration:")
    print(f"   Overall xG/Goals Ratio: {metrics['overall_xg_goals_ratio']:.3f}x")
    print(f"   Median xG/Goals Ratio: {metrics['median_xg_goals_ratio']:.3f}x")
    print(f"   Mean xG/Goals Ratio: {metrics['mean_xg_goals_ratio']:.3f}x")
    
    print(f"\n👥 Player Statistics:")
    print(f"   Total Players: {metrics['total_players']}")
    print(f"   Players with xG >= 10: {metrics['players_with_xg_10_plus']}")
    print(f"   Players with Goals >= 10: {metrics['players_with_goals_10_plus']}")
    
    print(f"\n🏆 Top 10 Players:")
    print(f"   Total xG: {metrics['top_10_xg_total']:.2f}")
    print(f"   Total Goals: {metrics['top_10_goals_total']:.0f}")
    print(f"   Ratio: {metrics['top_10_ratio']:.3f}x")
    
    print(f"\n⚠️  Overestimation (Ratio >= 1.5x, min 5 goals):")
    print(f"   Count: {metrics['overestimated_players_count']}")
    print(f"   Mean Ratio: {metrics['overestimated_mean_ratio']:.3f}x")
    
    print(f"\n⚠️  Underestimation (Ratio <= 0.7x, min 5 goals):")
    print(f"   Count: {metrics['underestimated_players_count']}")
    print(f"   Mean Ratio: {metrics['underestimated_mean_ratio']:.3f}x")
    
    print("\n" + "=" * 80)

def compare_to_baseline(current_metrics, baseline_file='data/model_performance_baseline.csv'):
    """Compare current metrics to baseline."""
    if not os.path.exists(baseline_file):
        print(f"\n💡 No baseline found. Saving current metrics as baseline...")
        save_metrics(current_metrics, baseline_file)
        return
    
    baseline = pd.read_csv(baseline_file).iloc[-1]  # Get most recent baseline
    
    print("\n" + "=" * 80)
    print("COMPARISON TO BASELINE")
    print("=" * 80)
    
    key_metrics = [
        'overall_xg_goals_ratio',
        'median_xg_goals_ratio',
        'overestimated_players_count',
        'underestimated_players_count'
    ]
    
    for metric in key_metrics:
        current = current_metrics.get(metric, 0)
        baseline_val = baseline.get(metric, 0)
        diff = current - baseline_val
        pct_change = (diff / baseline_val * 100) if baseline_val != 0 else 0
        
        print(f"\n{metric}:")
        print(f"   Current: {current:.3f}")
        print(f"   Baseline: {baseline_val:.3f}")
        print(f"   Change: {diff:+.3f} ({pct_change:+.1f}%)")

def main():
    """Main monitoring function."""
    print("=" * 80)
    print("MODEL PERFORMANCE MONITORING")
    print("=" * 80)
    
    # Load data
    df = load_current_data()
    if df is None:
        return
    
    # Calculate metrics
    metrics = calculate_key_metrics(df)
    
    # Print current metrics
    print_metrics(metrics)
    
    # Compare to baseline
    compare_to_baseline(metrics)
    
    # Save to history
    history = save_metrics(metrics)
    print(f"\n✅ Metrics saved to data/model_performance_history.csv")
    print(f"   Total records: {len(history)}")
    
    print("\n" + "=" * 80)
    print("✅ MONITORING COMPLETE")
    print("=" * 80)
    print("\n💡 Run this script regularly (e.g., weekly) to track performance trends")

if __name__ == '__main__':
    main()

