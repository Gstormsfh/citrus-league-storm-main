#!/usr/bin/env python3
"""
enhanced_flurry_adjustment.py
Enhanced flurry adjustment that BOOSTS flurry shots (user's insight).
Flurries create chaos and defensive breakdowns, making them MORE dangerous.
"""

import pandas as pd
import numpy as np

def calculate_enhanced_flurry_xg(df_shots, xg_column='xG_Value', game_id_col='game_id',
                                 team_code_col='team_code', period_col='period',
                                 time_in_period_col='time_in_period',
                                 flurry_boost_factor=1.15):
    """
    Calculate Enhanced Flurry Adjusted Expected Goals.
    
    APPROACH 1 (User's Insight): Flurries are MORE dangerous
    - First shot in flurry: Regular xG
    - Subsequent shots: BOOSTED xG (flurry creates chaos, defensive breakdowns)
    - Boost factor: 1.15 (15% increase) - can be tuned
    
    APPROACH 2 (MoneyPuck): Flurries are discounted
    - Prevents double-counting
    - Formula: (Chance of Not Scoring Yet) × (Regular xG)
    
    This function implements APPROACH 1 (user's suggestion).
    
    Args:
        df_shots: DataFrame with shot data
        xg_column: Column name for regular xG values
        flurry_boost_factor: Multiplier for flurry shots (default 1.15 = 15% boost)
    
    Returns:
        DataFrame with 'flurry_adjusted_xg' and 'is_in_flurry' columns
    """
    df = df_shots.copy()
    
    def parse_time_to_seconds(time_str):
        """Convert time string (MM:SS) to total seconds."""
        if pd.isna(time_str) or not time_str or ':' not in str(time_str):
            return 0
        try:
            parts = str(time_str).split(':')
            minutes = int(parts[0])
            seconds = int(parts[1])
            return minutes * 60 + seconds
        except (ValueError, IndexError):
            return 0
    
    # Initialize
    df['flurry_adjusted_xg'] = df[xg_column].copy()  # Start with regular xG
    df['is_in_flurry'] = 0
    df['flurry_position'] = 0  # 1 = first shot, 2 = second, etc.
    
    # Convert time to seconds
    df['_time_seconds'] = df[time_in_period_col].apply(parse_time_to_seconds)
    
    # Sort by game, period, and time
    df = df.sort_values(by=[game_id_col, period_col, '_time_seconds']).reset_index(drop=True)
    
    # Group by game, team, and period
    for (game_id, team_code, period), group in df.groupby([game_id_col, team_code_col, period_col]):
        if len(group) < 2:
            continue  # Need at least 2 shots for a flurry
        
        # Identify flurries (consecutive shots within 3 seconds)
        flurry_sequence = []
        for i in range(len(group)):
            current_idx = group.index[i]
            current_time = group.loc[current_idx, '_time_seconds']
            
            if not flurry_sequence:
                # Start new potential flurry
                flurry_sequence = [{'idx': current_idx, 'time': current_time, 'xg': group.loc[current_idx, xg_column]}]
                continue
            
            last_shot = flurry_sequence[-1]
            time_diff = current_time - last_shot['time']
            
            if 0 < time_diff <= 3.0:  # Continue flurry
                flurry_sequence.append({
                    'idx': current_idx,
                    'time': current_time,
                    'xg': group.loc[current_idx, xg_column]
                })
            else:  # Flurry ended, process it
                if len(flurry_sequence) > 1:  # Actual flurry (2+ shots)
                    # Apply flurry boost to subsequent shots
                    for j, shot in enumerate(flurry_sequence):
                        df.loc[shot['idx'], 'is_in_flurry'] = 1
                        df.loc[shot['idx'], 'flurry_position'] = j + 1
                        
                        if j > 0:  # Boost subsequent shots
                            boosted_xg = shot['xg'] * flurry_boost_factor
                            df.loc[shot['idx'], 'flurry_adjusted_xg'] = min(boosted_xg, 0.95)  # Cap at 95%
                
                # Start new flurry
                flurry_sequence = [{'idx': current_idx, 'time': current_time, 'xg': group.loc[current_idx, xg_column]}]
        
        # Process last flurry if exists
        if len(flurry_sequence) > 1:
            for j, shot in enumerate(flurry_sequence):
                df.loc[shot['idx'], 'is_in_flurry'] = 1
                df.loc[shot['idx'], 'flurry_position'] = j + 1
                
                if j > 0:  # Boost subsequent shots
                    boosted_xg = shot['xg'] * flurry_boost_factor
                    df.loc[shot['idx'], 'flurry_adjusted_xg'] = min(boosted_xg, 0.95)
    
    # Clean up
    df = df.drop(columns=['_time_seconds'])
    
    return df

if __name__ == "__main__":
    print("Enhanced Flurry Adjustment")
    print("=" * 80)
    print("\nThis implements user's insight: Flurries are MORE dangerous!")
    print(f"  - First shot: Regular xG")
    print(f"  - Subsequent shots: {1.15*100:.0f}% boost (creates chaos)")
    print("\nUse this instead of MoneyPuck's discounting approach.")

