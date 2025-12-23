#!/usr/bin/env python3
"""
match_moneypuck_data.py
Match our shot data to MoneyPuck's shot data for comparison.
Fixed version that matches by coordinates instead of game_id.
"""

import pandas as pd
import numpy as np
import math

def calculate_distance(x1, y1, x2, y2):
    """Calculate Euclidean distance between two points."""
    return math.sqrt((x2 - x1)**2 + (y2 - y1)**2)

def match_shots(our_shots, moneypuck_shots, coord_tolerance=3.0):
    """
    Match shots between our data and MoneyPuck data by coordinates.
    
    Args:
        our_shots: DataFrame with our shot data
        moneypuck_shots: DataFrame with MoneyPuck shot data
        coord_tolerance: Maximum distance in feet to consider shots matched
    
    Returns:
        DataFrame with matched shots
    """
    print("=" * 80)
    print("MATCHING SHOTS: Our Data vs MoneyPuck")
    print("=" * 80)
    print(f"Our shots: {len(our_shots):,}")
    print(f"MoneyPuck shots: {len(moneypuck_shots):,}")
    print(f"Coordinate tolerance: {coord_tolerance} feet")
    print()
    
    # Match by coordinates (game IDs use different formats)
    print("Step 1: Matching by coordinates (game IDs use different formats)...")
    matched = []
    unmatched_ours = []
    
    # Try to match by date if available for efficiency
    our_has_date = 'created_at' in our_shots.columns
    mp_has_date = 'date' in moneypuck_shots.columns or 'gameDate' in moneypuck_shots.columns
    
    if our_has_date and mp_has_date:
        our_shots = our_shots.copy()
        moneypuck_shots = moneypuck_shots.copy()
        our_shots['match_date'] = pd.to_datetime(our_shots['created_at']).dt.date
        mp_date_col = 'date' if 'date' in moneypuck_shots.columns else 'gameDate'
        moneypuck_shots['match_date'] = pd.to_datetime(moneypuck_shots[mp_date_col]).dt.date
        print("  Using date grouping to improve matching efficiency...")
        group_by_date = True
    else:
        print("  No date columns found, matching across all shots...")
        group_by_date = False
    
    print("Step 2: Matching shots by coordinates...")
    total_matched = 0
    mp_used = set()  # Track which MoneyPuck shots we've matched
    
    if group_by_date:
        our_by_date = our_shots.groupby('match_date')
        mp_by_date = moneypuck_shots.groupby('match_date')
        dates_in_both = set(our_by_date.groups.keys()) & set(mp_by_date.groups.keys())
        print(f"  Dates in both datasets: {len(dates_in_both):,}")
        
        for match_date in dates_in_both:
            our_date_shots = our_by_date.get_group(match_date)
            mp_date_shots = mp_by_date.get_group(match_date)
            
            for idx_our, row_our in our_date_shots.iterrows():
                best_match = None
                best_distance = float('inf')
                
                our_x = row_our['shot_x']
                our_y = row_our['shot_y']
                
                for idx_mp, row_mp in mp_date_shots.iterrows():
                    if idx_mp in mp_used:
                        continue
                    
                    mp_x = row_mp.get('xCord', row_mp.get('arenaAdjustedXCord', None))
                    mp_y = row_mp.get('yCord', row_mp.get('arenaAdjustedYCord', None))
                    
                    if pd.isna(mp_x) or pd.isna(mp_y):
                        continue
                    
                    dist = calculate_distance(our_x, our_y, mp_x, mp_y)
                    
                    if dist < best_distance and dist <= coord_tolerance:
                        best_distance = dist
                        best_match = (idx_mp, row_mp)
                
                if best_match:
                    idx_mp, row_mp = best_match
                    mp_used.add(idx_mp)
                    match_record = {
                        'our_game_id': row_our['game_id'],
                        'our_player_id': row_our['player_id'],
                        'our_shot_x': our_x,
                        'our_shot_y': our_y,
                        'our_distance': row_our['distance'],
                        'our_angle': row_our['angle'],
                        'our_xg': row_our['xg_value'],
                        'our_is_goal': row_our['is_goal'],
                        'our_is_rebound': row_our['is_rebound'],
                        'our_is_slot_shot': row_our.get('is_slot_shot', 0),
                        'our_has_pass': row_our['has_pass_before_shot'],
                        'mp_shotID': row_mp.get('shotID'),
                        'mp_game_id': row_mp.get('game_id'),
                        'mp_xCord': row_mp.get('xCord'),
                        'mp_yCord': row_mp.get('yCord'),
                        'mp_shotDistance': row_mp.get('shotDistance'),
                        'mp_shotAngle': row_mp.get('shotAngle'),
                        'mp_xGoal': row_mp.get('xGoal'),
                        'mp_goal': row_mp.get('goal'),
                        'mp_shotRebound': row_mp.get('shotRebound'),
                        'mp_shotRush': row_mp.get('shotRush'),
                        'mp_lastEventCategory': row_mp.get('lastEventCategory'),
                        'match_distance': best_distance,
                        'xg_difference': row_our['xg_value'] - row_mp.get('xGoal', 0),
                        'xg_ratio': row_our['xg_value'] / row_mp.get('xGoal', 1) if row_mp.get('xGoal', 0) > 0 else None
                    }
                    matched.append(match_record)
                    total_matched += 1
                else:
                    unmatched_ours.append(row_our)
                
                if total_matched % 100 == 0:
                    print(f"  Matched {total_matched:,} shots so far...")
    else:
        # No date grouping - match all shots
        print("  Matching all shots (this may take a while)...")
        
        for idx_our, row_our in our_shots.iterrows():
            best_match = None
            best_distance = float('inf')
            
            our_x = row_our['shot_x']
            our_y = row_our['shot_y']
            
            for idx_mp, row_mp in moneypuck_shots.iterrows():
                if idx_mp in mp_used:
                    continue
                
                mp_x = row_mp.get('xCord', row_mp.get('arenaAdjustedXCord', None))
                mp_y = row_mp.get('yCord', row_mp.get('arenaAdjustedYCord', None))
                
                if pd.isna(mp_x) or pd.isna(mp_y):
                    continue
                
                dist = calculate_distance(our_x, our_y, mp_x, mp_y)
                
                if dist < best_distance and dist <= coord_tolerance:
                    best_distance = dist
                    best_match = (idx_mp, row_mp)
            
            if best_match:
                idx_mp, row_mp = best_match
                mp_used.add(idx_mp)
                match_record = {
                    'our_game_id': row_our['game_id'],
                    'our_player_id': row_our['player_id'],
                    'our_shot_x': our_x,
                    'our_shot_y': our_y,
                    'our_distance': row_our['distance'],
                    'our_angle': row_our['angle'],
                    'our_xg': row_our['xg_value'],
                    'our_is_goal': row_our['is_goal'],
                    'our_is_rebound': row_our['is_rebound'],
                    'our_is_slot_shot': row_our.get('is_slot_shot', 0),
                    'our_has_pass': row_our['has_pass_before_shot'],
                    'mp_shotID': row_mp.get('shotID'),
                    'mp_game_id': row_mp.get('game_id'),
                    'mp_xCord': row_mp.get('xCord'),
                    'mp_yCord': row_mp.get('yCord'),
                    'mp_shotDistance': row_mp.get('shotDistance'),
                    'mp_shotAngle': row_mp.get('shotAngle'),
                    'mp_xGoal': row_mp.get('xGoal'),
                    'mp_goal': row_mp.get('goal'),
                    'mp_shotRebound': row_mp.get('shotRebound'),
                    'mp_shotRush': row_mp.get('shotRush'),
                    'mp_lastEventCategory': row_mp.get('lastEventCategory'),
                    'match_distance': best_distance,
                    'xg_difference': row_our['xg_value'] - row_mp.get('xGoal', 0),
                    'xg_ratio': row_our['xg_value'] / row_mp.get('xGoal', 1) if row_mp.get('xGoal', 0) > 0 else None
                }
                matched.append(match_record)
                total_matched += 1
            else:
                unmatched_ours.append(row_our)
            
            if total_matched % 100 == 0:
                print(f"  Matched {total_matched:,} shots so far...")
    
    print(f"\n✅ Total matched: {total_matched:,} shots")
    print(f"   Unmatched (ours): {len(unmatched_ours):,}")
    
    if len(matched) > 0:
        df_matched = pd.DataFrame(matched)
        
        output_file = 'data/matched_shots_2025.csv'
        df_matched.to_csv(output_file, index=False)
        print(f"\n💾 Saved matched data to {output_file}")
        
        print("\n" + "=" * 80)
        print("MATCHING SUMMARY")
        print("=" * 80)
        print(f"Matched shots: {len(df_matched):,}")
        print(f"\nxG Comparison:")
        print(f"  Our mean xG: {df_matched['our_xg'].mean():.4f}")
        print(f"  MoneyPuck mean xG: {df_matched['mp_xGoal'].mean():.4f}")
        print(f"  Mean difference: {df_matched['xg_difference'].mean():.4f}")
        print(f"  Mean ratio: {df_matched['xg_ratio'].mean():.4f}")
        print(f"\nMatch quality:")
        print(f"  Average coordinate distance: {df_matched['match_distance'].mean():.2f} feet")
        print(f"  Max coordinate distance: {df_matched['match_distance'].max():.2f} feet")
        
        return df_matched
    else:
        print("⚠️  No matches found!")
        return None

if __name__ == "__main__":
    print("Loading our shot data...")
    try:
        our_shots = pd.read_csv('data/our_shots_2025.csv')
        print(f"Loaded {len(our_shots):,} shots from our data")
    except FileNotFoundError:
        print("❌ Error: data/our_shots_2025.csv not found")
        print("   Run pull_season_data.py first")
        exit(1)
    
    print("Loading MoneyPuck shot data...")
    try:
        moneypuck_shots = pd.read_csv('data/moneypuck_shots_2025.csv.csv')
        print(f"Loaded {len(moneypuck_shots):,} shots from MoneyPuck")
    except FileNotFoundError:
        print("❌ Error: data/moneypuck_shots_2025.csv.csv not found")
        exit(1)
    
    matched = match_shots(our_shots, moneypuck_shots)
    
    if matched is not None:
        print("\n✅ Matching complete! Ready for comparison analysis.")

