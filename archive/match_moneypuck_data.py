#!/usr/bin/env python3
"""
match_moneypuck_data.py
Match our shot data to MoneyPuck's shot data for comparison.
Fixed version that matches by coordinates instead of game_id.
"""

import pandas as pd
import numpy as np
import math
from sklearn.neighbors import BallTree

def calculate_distance(x1, y1, x2, y2):
    """Calculate Euclidean distance between two points."""
    return math.sqrt((x2 - x1)**2 + (y2 - y1)**2)

def convert_time_remaining_to_elapsed(time_remaining_seconds, period_length=1200):
    """
    Convert time remaining in period to time elapsed in period.
    
    Args:
        time_remaining_seconds: Seconds remaining in period
        period_length: Length of period in seconds (default 1200 for 20 minutes)
    
    Returns:
        Time elapsed in period
    """
    return period_length - time_remaining_seconds

def time_matches(our_time_remaining, mp_time, time_tolerance=3, period_length=1200):
    """
    Check if times match within tolerance.
    
    Args:
        our_time_remaining: Our time remaining in seconds
        mp_time: MoneyPuck time (assumed to be elapsed in period)
        time_tolerance: Maximum difference in seconds (default 3)
        period_length: Length of period in seconds (default 1200)
    
    Returns:
        True if times match within tolerance
    """
    if pd.isna(our_time_remaining) or pd.isna(mp_time):
        return False
    
    our_elapsed = convert_time_remaining_to_elapsed(our_time_remaining, period_length)
    time_diff = abs(our_elapsed - mp_time)
    return time_diff <= time_tolerance

def prepare_coordinates(df, x_col, y_col, fallback_x=None, fallback_y=None):
    """
    Prepare coordinates for spatial indexing, handling NaN values.
    
    Args:
        df: DataFrame with coordinate columns
        x_col: Primary x coordinate column name
        y_col: Primary y coordinate column name
        fallback_x: Fallback x coordinate column if primary is NaN
        fallback_y: Fallback y coordinate column if primary is NaN
    
    Returns:
        Tuple of (valid_indices, coordinates_array)
    """
    # Get primary coordinates
    x_coords = df[x_col].copy()
    y_coords = df[y_col].copy()
    
    # Apply fallback if available and primary is NaN
    if fallback_x and fallback_x in df.columns:
        x_coords = x_coords.fillna(df[fallback_x])
    if fallback_y and fallback_y in df.columns:
        y_coords = y_coords.fillna(df[fallback_y])
    
    # Find valid coordinates (not NaN)
    valid_mask = x_coords.notna() & y_coords.notna()
    valid_indices = df.index[valid_mask].tolist()
    
    # Create coordinate array
    coords = np.column_stack([
        x_coords[valid_mask].values.astype(np.float64),
        y_coords[valid_mask].values.astype(np.float64)
    ])
    
    return valid_indices, coords

def match_shots(our_shots, moneypuck_shots, coord_tolerance=1.5):
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
    
    print("Step 2: Matching shots by coordinates using spatial index...")
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
            
            # Prepare MoneyPuck coordinates for spatial index
            mp_valid_indices, mp_coords = prepare_coordinates(
                mp_date_shots, 
                'xCord', 
                'yCord',
                fallback_x='arenaAdjustedXCord',
                fallback_y='arenaAdjustedYCord'
            )
            
            if len(mp_coords) == 0:
                continue
            
            # Build spatial index for this date's MoneyPuck shots
            print(f"    Building spatial index for {match_date} ({len(mp_coords):,} MP shots)...")
            mp_tree = BallTree(mp_coords, metric='euclidean')
            
            # Prepare our coordinates
            our_valid_indices, our_coords = prepare_coordinates(
                our_date_shots,
                'shot_x',
                'shot_y'
            )
            
            if len(our_coords) == 0:
                continue
            
            # Query spatial index for all our shots
            print(f"    Querying spatial index for {len(our_coords):,} our shots...")
            indices_list, distances_list = mp_tree.query_radius(
                our_coords, 
                r=coord_tolerance, 
                return_distance=True,
                sort_results=True
            )
            
            # Process matches with multi-factor filtering
            for i, (our_idx, mp_candidates, distances) in enumerate(zip(our_valid_indices, indices_list, distances_list)):
                if len(mp_candidates) == 0:
                    unmatched_ours.append(our_date_shots.loc[our_idx])
                    continue
                
                row_our = our_date_shots.loc[our_idx]
                our_x = row_our['shot_x']
                our_y = row_our['shot_y']
                our_period = row_our.get('period')
                our_time_remaining = row_our.get('time_remaining_seconds')
                our_team_code = row_our.get('team_code')
                
                # Find best match (closest distance) that passes all filters
                best_match = None
                best_distance = float('inf')
                best_mp_idx = None
                
                for j, mp_array_idx in enumerate(mp_candidates):
                    mp_original_idx = mp_valid_indices[mp_array_idx]
                    
                    if mp_original_idx in mp_used:
                        continue
                    
                    row_mp = mp_date_shots.loc[mp_original_idx]
                    
                    # MULTI-FACTOR FILTERING:
                    # 1. Period must match exactly
                    if our_period is not None and row_mp.get('period') is not None:
                        if our_period != row_mp['period']:
                            continue
                    
                    # 2. Time must be within tolerance (3 seconds)
                    if our_time_remaining is not None and row_mp.get('time') is not None:
                        if not time_matches(our_time_remaining, row_mp['time'], time_tolerance=3):
                            continue
                    
                    # 3. Team code must match exactly
                    if our_team_code is not None and row_mp.get('teamCode') is not None:
                        if our_team_code != row_mp['teamCode']:
                            continue
                    
                    # All filters passed - check distance
                    dist = distances[j]
                    if dist < best_distance:
                        best_distance = dist
                        best_mp_idx = mp_original_idx
                        best_match = row_mp
                
                if best_match is not None:
                    row_mp = best_match
                    mp_used.add(best_mp_idx)
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
        # No date grouping - match all shots using spatial index
        print("  Matching all shots using spatial index...")
        
        # Prepare MoneyPuck coordinates for spatial index
        print("    Preparing MoneyPuck coordinates...")
        mp_valid_indices, mp_coords = prepare_coordinates(
            moneypuck_shots,
            'xCord',
            'yCord',
            fallback_x='arenaAdjustedXCord',
            fallback_y='arenaAdjustedYCord'
        )
        
        if len(mp_coords) == 0:
            print("  ⚠️  No valid MoneyPuck coordinates found!")
            return None
        
        # Build spatial index for all MoneyPuck shots
        print(f"    Building spatial index for {len(mp_coords):,} MoneyPuck shots...")
        mp_tree = BallTree(mp_coords, metric='euclidean')
        
        # Prepare our coordinates
        print("    Preparing our coordinates...")
        our_valid_indices, our_coords = prepare_coordinates(
            our_shots,
            'shot_x',
            'shot_y'
        )
        
        if len(our_coords) == 0:
            print("  ⚠️  No valid our coordinates found!")
            return None
        
        # Query spatial index for all our shots
        print(f"    Querying spatial index for {len(our_coords):,} our shots...")
        indices_list, distances_list = mp_tree.query_radius(
            our_coords,
            r=coord_tolerance,
            return_distance=True,
            sort_results=True
        )
        
        # Process matches
        print("    Processing matches...")
        for i, (our_idx, mp_candidates, distances) in enumerate(zip(our_valid_indices, indices_list, distances_list)):
            if len(mp_candidates) == 0:
                unmatched_ours.append(our_shots.loc[our_idx])
                continue
            
            row_our = our_shots.loc[our_idx]
            our_x = row_our['shot_x']
            our_y = row_our['shot_y']
            our_period = row_our.get('period')
            our_time_remaining = row_our.get('time_remaining_seconds')
            our_team_code = row_our.get('team_code')
            
            # Find best match (closest distance) that passes all filters
            best_match = None
            best_distance = float('inf')
            best_mp_idx = None
            
            for j, mp_array_idx in enumerate(mp_candidates):
                mp_original_idx = mp_valid_indices[mp_array_idx]
                
                if mp_original_idx in mp_used:
                    continue
                
                row_mp = moneypuck_shots.loc[mp_original_idx]
                
                # MULTI-FACTOR FILTERING:
                # 1. Period must match exactly
                if our_period is not None and row_mp.get('period') is not None:
                    if our_period != row_mp['period']:
                        continue
                
                # 2. Time must be within tolerance (3 seconds)
                if our_time_remaining is not None and row_mp.get('time') is not None:
                    if not time_matches(our_time_remaining, row_mp['time'], time_tolerance=3):
                        continue
                
                # 3. Team code must match exactly
                if our_team_code is not None and row_mp.get('teamCode') is not None:
                    if our_team_code != row_mp['teamCode']:
                        continue
                
                # All filters passed - check distance
                dist = distances[j]
                if dist < best_distance:
                    best_distance = dist
                    best_mp_idx = mp_original_idx
                    best_match = row_mp
            
            if best_match is not None:
                row_mp = best_match
                mp_used.add(best_mp_idx)
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

