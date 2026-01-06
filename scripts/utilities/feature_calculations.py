#!/usr/bin/env python3
"""
feature_calculations.py
Calculation functions for derived features that MoneyPuck computes.
These functions take raw extracted data and compute additional features.
"""

import math
import pandas as pd
import numpy as np
from scipy import stats
from collections import defaultdict

# Arena adjustment mappings (some arenas have different coordinate systems)
# This is a simplified version - MoneyPuck likely has more sophisticated arena adjustments
ARENA_ADJUSTMENTS = {
    # Most arenas use standard NHL coordinates, but some may need adjustment
    # Format: {arena_id or team_abbrev: {'x_offset': 0, 'y_offset': 0, 'x_flip': False, 'y_flip': False}}
    # For now, we'll use standard coordinates (no adjustment)
    # This can be enhanced later with actual arena-specific adjustments
}

# Cache for Schuckers/Curro CDFs (computed once per rink/shot_type combination)
_SCHUCKERS_CDFS = {}
_SCHUCKERS_LEAGUE_CDF = None

def calculate_schuckers_adjusted_coordinates(x, y, shot_type, is_home_team, team_abbrev=None, 
                                             all_shots_df=None, rink_key=None):
    """
    Calculate Schuckers/Curro adjusted coordinates using quantile matching.
    
    This implements the War On Ice methodology from Schuckers and Curro (Sloan Sports Conference).
    The algorithm de-biases shot distances by normalizing distributions across rinks.
    
    Algorithm:
    1. Calculate raw distance from shot to goal (89, 0)
    2. Find quantile of raw distance in rink-specific CDF (for away teams)
    3. Find distance at same quantile in league-wide average CDF
    4. Project original coordinates along line to goal, adjust to new distance
    
    Args:
        x: Raw X coordinate
        y: Raw Y coordinate
        shot_type: Shot type ('slap', 'wrist', 'snap', etc.) or None
        is_home_team: Whether shooting team is home (True) or away (False)
        team_abbrev: Team abbreviation (for rink identification)
        all_shots_df: DataFrame with all shots for CDF calculation (optional, for batch processing)
        rink_key: Pre-computed rink key (e.g., 'TOR_slap') for CDF lookup
    
    Returns:
        Tuple of (adjusted_x, adjusted_y, adjusted_distance)
    """
    NET_X = 89
    NET_Y = 0
    
    # Calculate raw distance
    raw_distance = math.sqrt((NET_X - x)**2 + (NET_Y - y)**2)
    
    # If no CDF data available, return original coordinates
    if _SCHUCKERS_LEAGUE_CDF is None or rink_key is None:
        # Fallback: return original coordinates
        adjusted_x = x
        adjusted_y = y
        adjusted_distance = raw_distance
        return adjusted_x, adjusted_y, adjusted_distance
    
    # Get rink-specific CDF
    rink_cdf = _SCHUCKERS_CDFS.get(rink_key)
    if rink_cdf is None:
        # No rink-specific data, return original
        adjusted_x = x
        adjusted_y = y
        adjusted_distance = raw_distance
        return adjusted_x, adjusted_y, adjusted_distance
    
    # Find quantile of raw distance in rink CDF
    quantile = np.searchsorted(rink_cdf, raw_distance) / len(rink_cdf)
    quantile = max(0.0, min(1.0, quantile))  # Clamp to [0, 1]
    
    # Find adjusted distance at same quantile in league CDF
    adjusted_distance = np.percentile(_SCHUCKERS_LEAGUE_CDF, quantile * 100)
    
    # Project original coordinates along line to goal, adjust to new distance
    # Vector from goal to shot
    dx = x - NET_X
    dy = y - NET_Y
    
    # Normalize vector
    if raw_distance > 0:
        unit_x = dx / raw_distance
        unit_y = dy / raw_distance
    else:
        # Shot at goal, no adjustment needed
        unit_x = 0
        unit_y = 0
    
    # Project to adjusted distance
    adjusted_x = NET_X + unit_x * adjusted_distance
    adjusted_y = NET_Y + unit_y * adjusted_distance
    
    return adjusted_x, adjusted_y, adjusted_distance


def build_schuckers_cdfs(df, shot_type_col='shot_type', is_home_col='is_home_team', 
                          x_col='shot_x', y_col='shot_y', home_team_abbrev_col='home_team_abbrev'):
    """
    Build CDFs for Schuckers/Curro arena adjustment.
    
    This function should be called once with a large dataset (e.g., full season)
    to build the CDFs used for adjustment.
    
    Methodology: For away team shots, group by the home team's arena (rink) and shot type.
    This creates rink-specific CDFs that capture measurement bias at each venue.
    
    Args:
        df: DataFrame with shot data
        shot_type_col: Column name for shot type
        is_home_col: Column name for is_home_team flag
        x_col: Column name for X coordinate
        y_col: Column name for Y coordinate
        home_team_abbrev_col: Column name for home team abbreviation (for rink identification)
    
    Returns:
        None (updates global _SCHUCKERS_CDFS and _SCHUCKERS_LEAGUE_CDF)
    """
    global _SCHUCKERS_CDFS, _SCHUCKERS_LEAGUE_CDF
    
    NET_X = 89
    NET_Y = 0
    
    # Calculate distances for all shots
    df = df.copy()
    df['_raw_distance'] = np.sqrt((NET_X - df[x_col])**2 + (NET_Y - df[y_col])**2)
    
    # Filter to away team shots only (as per Schuckers/Curro methodology)
    # We use away shots because they're measured at the home team's rink
    away_shots = df[df[is_home_col] == 0].copy()
    
    if len(away_shots) == 0:
        print("Warning: No away team shots found for Schuckers adjustment")
        return
    
    # Build league-wide CDF (all away shots across all rinks)
    _SCHUCKERS_LEAGUE_CDF = np.sort(away_shots['_raw_distance'].values)
    
    # Build rink-specific CDFs
    # Group by rink (home team's arena) and shot type
    # For away shots, the rink is identified by the home team
    if home_team_abbrev_col not in away_shots.columns:
        print(f"Warning: {home_team_abbrev_col} column not found. Cannot build rink-specific CDFs.")
        return
    
    # Fill missing shot types with 'unknown'
    away_shots[shot_type_col] = away_shots[shot_type_col].fillna('unknown')
    
    # Group by home team (rink) and shot type
    for (home_team, shot_type), group in away_shots.groupby([home_team_abbrev_col, shot_type_col]):
        if pd.isna(home_team) or pd.isna(shot_type):
            continue
        rink_key = f"{home_team}_{shot_type}"
        distances = group['_raw_distance'].values
        if len(distances) > 0:
            _SCHUCKERS_CDFS[rink_key] = np.sort(distances)
    
    print(f"Built Schuckers CDFs: {len(_SCHUCKERS_CDFS)} rink/shot_type combinations")
    print(f"League CDF: {len(_SCHUCKERS_LEAGUE_CDF)} away shots")


def calculate_arena_adjusted_coordinates(x, y, team_abbrev=None, arena_id=None, 
                                         shot_type=None, is_home_team=None, rink_key=None):
    """
    Calculate arena-adjusted coordinates using Schuckers/Curro method.
    
    Args:
        x: Raw X coordinate
        y: Raw Y coordinate
        team_abbrev: Team abbreviation (for arena lookup)
        arena_id: Arena ID (if available)
        shot_type: Shot type for Schuckers adjustment
        is_home_team: Whether shooting team is home
        rink_key: Pre-computed rink key for CDF lookup
    
    Returns:
        Tuple of (adjusted_x, adjusted_y, adjusted_x_abs, adjusted_y_abs)
    """
    # Use Schuckers/Curro method if we have the necessary data
    if shot_type is not None and is_home_team is not None:
        if rink_key is None and team_abbrev is not None:
            # Determine rink (opposite of shooting team if away, same if home)
            # For away shots, rink is the home team
            # For home shots, we still need to identify the rink
            # For simplicity, we'll use the shooting team's arena
            rink_team = team_abbrev  # Use shooting team's arena
            rink_key = f"{rink_team}_{shot_type}"
        
        adjusted_x, adjusted_y, adjusted_distance = calculate_schuckers_adjusted_coordinates(
            x, y, shot_type, is_home_team, team_abbrev, rink_key=rink_key
        )
    else:
        # Fallback to original coordinates
        adjusted_x = x
        adjusted_y = y
    
    adjusted_x_abs = abs(adjusted_x)
    adjusted_y_abs = abs(adjusted_y)
    
    return adjusted_x, adjusted_y, adjusted_x_abs, adjusted_y_abs

def calculate_arena_adjusted_distance(x, y, adjusted_x, adjusted_y):
    """
    Calculate distance using arena-adjusted coordinates.
    
    Args:
        x, y: Original coordinates
        adjusted_x, adjusted_y: Arena-adjusted coordinates
    
    Returns:
        Arena-adjusted distance to net
    """
    NET_X = 89
    NET_Y = 0
    
    return math.sqrt((NET_X - adjusted_x)**2 + (NET_Y - adjusted_y)**2)

def calculate_last_event_shot_metrics(last_event_type_code, last_event_x, last_event_y):
    """
    Calculate shot-specific metrics for last event if it was a shot.
    
    Args:
        last_event_type_code: Type code of last event
        last_event_x: X coordinate of last event
        last_event_y: Y coordinate of last event
    
    Returns:
        Tuple of (last_event_shot_angle, last_event_shot_distance) or (None, None)
    """
    # Only calculate if last event was a shot (505, 506, 507)
    if last_event_type_code not in [505, 506, 507]:
        return None, None
    
    NET_X = 89
    NET_Y = 0
    
    # Calculate distance
    distance = math.sqrt((NET_X - last_event_x)**2 + (NET_Y - last_event_y)**2)
    
    # Calculate angle
    dx = abs(NET_X - last_event_x)
    dy = abs(last_event_y - NET_Y)
    
    if dx == 0:
        angle = 90.0
    else:
        angle = math.degrees(math.atan2(dy, dx))
    
    angle = max(0.0, min(90.0, angle))
    
    return angle, distance

def calculate_shot_angle_plus_rebound(shot_angle, is_rebound, shot_angle_rebound_royal_road=0):
    """
    Calculate enhanced shot angle metrics that account for rebounds.
    
    Args:
        shot_angle: Base shot angle
        is_rebound: Whether shot is a rebound
        shot_angle_rebound_royal_road: Royal road rebound angle (if available)
    
    Returns:
        Tuple of (shot_angle_plus_rebound, shot_angle_plus_rebound_speed)
    """
    # Simplified calculation - MoneyPuck likely has more sophisticated logic
    if is_rebound:
        # Rebound shots typically have better angles (goalie out of position)
        shot_angle_plus_rebound = shot_angle * 0.9  # Slight boost
        shot_angle_plus_rebound_speed = shot_angle_plus_rebound  # Simplified
    else:
        shot_angle_plus_rebound = shot_angle
        shot_angle_plus_rebound_speed = shot_angle
    
    return shot_angle_plus_rebound, shot_angle_plus_rebound_speed

def calculate_time_on_ice_metrics(plays, current_play_index, player_id, team_id, period):
    """
    Calculate time on ice metrics for a player.
    This requires tracking shifts from the play-by-play data.
    
    Args:
        plays: List of all plays in the game
        current_play_index: Index of current play
        player_id: Player ID to calculate TOI for
        team_id: Team ID
        period: Period number
    
    Returns:
        Dictionary with TOI metrics (simplified - would need shift tracking)
    """
    # This is a placeholder - actual TOI calculation requires:
    # 1. Tracking shift changes (typeCode for line changes)
    # 2. Calculating time between shift start and current play
    # 3. Aggregating across all shifts
    
    # For now, return None values - this would need shift tracking implementation
    return {
        'shooter_time_on_ice': None,
        'shooter_time_on_ice_since_faceoff': None,
        'shooting_team_average_time_on_ice': None,
        'shooting_team_max_time_on_ice': None,
        'shooting_team_min_time_on_ice': None,
        'defending_team_average_time_on_ice': None,
        'defending_team_max_time_on_ice': None,
        'defending_team_min_time_on_ice': None,
    }

def calculate_off_wing(shot_x, shot_y, shooter_left_right, is_home_team):
    """
    Determine if shot is from off-wing (shooter on opposite side of ice from handedness).
    
    Args:
        shot_x: X coordinate
        shot_y: Y coordinate
        shooter_left_right: 'L' or 'R' for shooter handedness
        is_home_team: Whether shooting team is home
    
    Returns:
        Boolean: True if off-wing shot
    """
    # Off-wing: Right-handed shooter on left side, or left-handed on right side
    # Simplified logic - would need actual shooter handedness data
    if not shooter_left_right:
        return None
    
    # Determine which side of ice shooter is on
    on_left_side = shot_y < 0 if is_home_team else shot_y > 0
    
    if shooter_left_right == 'R':
        # Right-handed shooter
        return on_left_side  # Off-wing if on left side
    else:
        # Left-handed shooter
        return not on_left_side  # Off-wing if on right side

def calculate_average_rest_difference(shooting_team_toi, defending_team_toi):
    """
    Calculate average rest difference between teams.
    
    Args:
        shooting_team_toi: Average TOI for shooting team
        defending_team_toi: Average TOI for defending team
    
    Returns:
        Rest difference (positive = shooting team more rested)
    """
    if shooting_team_toi is None or defending_team_toi is None:
        return None
    
    return defending_team_toi - shooting_team_toi  # How much more tired defending team is

def apply_calculated_features_to_dataframe(df, build_schuckers_cdfs=False):
    """
    Apply all calculated features to a DataFrame of shot records.
    
    Args:
        df: DataFrame with raw extracted shot data
        build_schuckers_cdfs: If True, build Schuckers CDFs from this dataframe first
    
    Returns:
        DataFrame with calculated features added
    """
    df = df.copy()
    
    # Build Schuckers CDFs if requested (should be done once with large dataset)
    if build_schuckers_cdfs:
        required_cols = ['shot_x', 'shot_y', 'team_code', 'shot_type', 'is_home_team']
        if all(col in df.columns for col in required_cols):
            build_schuckers_cdfs(df)
        else:
            print("Warning: Missing columns for Schuckers CDF building")
    
    # Arena-adjusted coordinates (using Schuckers/Curro method)
    if 'shot_x' in df.columns and 'shot_y' in df.columns:
        # Determine rink key for each shot
        def get_rink_key(row):
            """Determine rink key for Schuckers adjustment."""
            if 'shot_type' not in row or pd.isna(row.get('shot_type')):
                shot_type = 'unknown'
            else:
                shot_type = str(row['shot_type']).lower()
            
            # For away shots, rink is the home team
            # For home shots, rink is the shooting team
            if 'is_home_team' in row and row.get('is_home_team') == 1:
                # Home team shooting - rink is their arena
                if 'team_code' in row and pd.notna(row.get('team_code')):
                    return f"{row['team_code']}_{shot_type}"
            else:
                # Away team shooting - rink is the home team's arena
                # We need to infer home team from game context
                # For now, use shooting team as proxy (will be corrected in full implementation)
                if 'team_code' in row and pd.notna(row.get('team_code')):
                    return f"{row['team_code']}_{shot_type}"
            return None
        
        df['_rink_key'] = df.apply(get_rink_key, axis=1)
        
        adjusted_coords = df.apply(
            lambda row: calculate_arena_adjusted_coordinates(
                row['shot_x'], row['shot_y'],
                team_abbrev=row.get('team_code'),
                shot_type=row.get('shot_type'),
                is_home_team=row.get('is_home_team'),
                rink_key=row.get('_rink_key')
            ),
            axis=1
        )
        df['arena_adjusted_x'] = [c[0] for c in adjusted_coords]
        df['arena_adjusted_y'] = [c[1] for c in adjusted_coords]
        df['arena_adjusted_x_abs'] = [c[2] for c in adjusted_coords]
        df['arena_adjusted_y_abs'] = [c[3] for c in adjusted_coords]
        
        # Arena-adjusted distance (recalculate from adjusted coordinates)
        df['arena_adjusted_shot_distance'] = df.apply(
            lambda row: calculate_arena_adjusted_distance(
                row['shot_x'], row['shot_y'],
                row['arena_adjusted_x'], row['arena_adjusted_y']
            ),
            axis=1
        )
        
        # Drop temporary column
        if '_rink_key' in df.columns:
            df = df.drop(columns=['_rink_key'])
    
    # Shot angle plus rebound
    if 'angle' in df.columns and 'is_rebound' in df.columns:
        angle_metrics = df.apply(
            lambda row: calculate_shot_angle_plus_rebound(
                row['angle'], row['is_rebound']
            ),
            axis=1
        )
        df['shot_angle_plus_rebound'] = [m[0] for m in angle_metrics]
        df['shot_angle_plus_rebound_speed'] = [m[1] for m in angle_metrics]
    
    # Off-wing (if we have shooter handedness)
    if 'shot_x' in df.columns and 'shot_y' in df.columns:
        # This would need shooter_left_right from player data
        # For now, skip - would need player roster lookup
        pass
    
    return df


def calculate_flurry_adjusted_xg(df_shots, xg_column='xG_Value', game_id_col='game_id', 
                                  team_code_col='team_code', period_col='period',
                                  time_in_period_col='time_in_period', 
                                  time_since_last_event_col='time_since_last_event'):
    """
    Calculate Flurry Adjusted Expected Goals using MoneyPuck's DISCOUNTING methodology.
    
    MoneyPuck's approach: Discount subsequent shots in a flurry by the cumulative probability
    that all prior shots failed. This reflects that if the first shot had scored, the flurry
    would have ended.
    
    APPROACH: DISCOUNTING (MoneyPuck methodology)
    - First shot in flurry: Regular xG (no change)
    - Second shot: xG2 * (1 - xG1) - discounted by probability first shot failed
    - Third shot: xG3 * (1 - xG1) * (1 - xG2) - discounted by probability both prior shots failed
    - Nth shot: xG_N * ∏(1 - xG_i) for i = 1 to N-1
    
    This reduces total xG in flurries, which improves calibration and aligns with MoneyPuck's
    methodology that flurries should not have inflated total xG values.
    
    Args:
        df_shots: DataFrame with shot data including xG values
        xg_column: Column name for regular xG values
        game_id_col: Column name for game ID
        team_code_col: Column name for team code
        period_col: Column name for period number
        time_in_period_col: Column name for time in period (string format "MM:SS")
        time_since_last_event_col: Column name for time since last event (seconds)
    
    Returns:
        DataFrame with 'flurry_adjusted_xg' column added
    """
    import pandas as pd
    import numpy as np
    
    df = df_shots.copy()
    
    # ============================================================================
    # INPUT VALIDATION
    # ============================================================================
    required_columns = [xg_column, game_id_col, team_code_col, period_col, time_in_period_col]
    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        raise ValueError(f"Missing required columns for flurry adjustment: {missing_columns}")
    
    # Check for missing values in critical columns
    missing_game_id = df[game_id_col].isna().sum()
    missing_team_code = df[team_code_col].isna().sum()
    missing_period = df[period_col].isna().sum()
    missing_time = df[time_in_period_col].isna().sum()
    missing_xg = df[xg_column].isna().sum()
    
    if missing_game_id > 0:
        print(f"⚠️  Warning: {missing_game_id} shots missing {game_id_col} - will skip flurry detection for these")
    if missing_team_code > 0:
        print(f"⚠️  Warning: {missing_team_code} shots missing {team_code_col} - will skip flurry detection for these")
    if missing_period > 0:
        print(f"⚠️  Warning: {missing_period} shots missing {period_col} - will skip flurry detection for these")
    if missing_time > 0:
        print(f"⚠️  Warning: {missing_time} shots missing {time_in_period_col} - will skip flurry detection for these")
    if missing_xg > 0:
        print(f"⚠️  Warning: {missing_xg} shots missing {xg_column} - will use 0.0 for these")
    
    # Parse time_in_period to seconds for sorting
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
    
    # Add parsed time column for sorting
    df['_time_seconds'] = df[time_in_period_col].apply(parse_time_to_seconds)
    
    # Initialize flurry adjusted xG column (start with regular xG)
    df['flurry_adjusted_xg'] = pd.to_numeric(df[xg_column], errors='coerce').fillna(0.0)
    
    # Bounds check: Ensure xG values are between 0 and 1
    df['flurry_adjusted_xg'] = df['flurry_adjusted_xg'].clip(lower=0.0, upper=1.0)
    
    # Group by game, team, and period to detect flurries
    # Process all groups, skip invalid rows within each group
    for (game_id, team_code, period), group in df.groupby([game_id_col, team_code_col, period_col]):
        # Filter out invalid rows within this group
        group_valid = group[
            group[game_id_col].notna() & 
            group[team_code_col].notna() & 
            group[period_col].notna() &
            (group['_time_seconds'] > 0)
        ].copy()
        
        if len(group_valid) < 2:
            continue  # Need at least 2 valid shots for a flurry
        
        # Sort by time within period
        group_sorted = group_valid.sort_values('_time_seconds')
        
        # Store original indices for updating df later
        original_indices = group_sorted.index.values
        
        # Identify flurry sequences (consecutive shots within 3 seconds, same team)
        flurry_sequence = []
        
        for i in range(len(group_sorted)):
            # Access by position in sorted group
            current_idx = original_indices[i]  # Original index in df
            current_row = group_sorted.iloc[i]
            current_time = current_row['_time_seconds']
            current_xg = current_row[xg_column]
            
            if pd.isna(current_xg) or current_xg <= 0:
                continue  # Skip invalid xG values
            
            if not flurry_sequence:
                # Start new potential flurry
                flurry_sequence = [{
                    'idx': current_idx,
                    'time': current_time,
                    'xg': current_xg
                }]
                continue
            
            last_shot = flurry_sequence[-1]
            time_diff = current_time - last_shot['time']
            
            # Also check time_since_last_event as backup (if available)
            # Use time_since_last_event if it's smaller and valid (more accurate)
            if time_since_last_event_col in group_sorted.columns:
                try:
                    time_since_last = current_row[time_since_last_event_col]
                    if pd.notna(time_since_last) and time_since_last > 0:
                        # Use the smaller of the two (more conservative)
                        time_diff = min(time_diff, time_since_last) if time_diff > 0 else time_since_last
                except (KeyError, IndexError):
                    pass  # Column might not be accessible, use time_diff from period time
            
            if 0 < time_diff <= 3.0:  # Within 3 seconds = flurry continues
                flurry_sequence.append({
                    'idx': current_idx,
                    'time': current_time,
                    'xg': current_xg
                })
            else:  # Flurry ended, process it
                if len(flurry_sequence) > 1:  # Actual flurry (2+ shots)
                    # Apply MoneyPuck discounting: each subsequent shot discounted by cumulative failure probability
                    for j, shot in enumerate(flurry_sequence):
                        if j > 0:  # Discount subsequent shots (not the first one)
                            # Calculate cumulative failure probability of all prior shots
                            cumulative_failure_prob = 1.0
                            for k in range(j):  # For all shots before this one
                                prior_xg = flurry_sequence[k]['xg']
                                cumulative_failure_prob *= (1.0 - prior_xg)
                            
                            # Discount this shot's xG by cumulative failure probability
                            discounted_xg = shot['xg'] * cumulative_failure_prob
                            # Ensure value stays within [0, 1] bounds
                            discounted_xg = max(0.0, min(discounted_xg, 1.0))
                            # Update using original index
                            df.at[shot['idx'], 'flurry_adjusted_xg'] = discounted_xg
                        # First shot in flurry remains unchanged (already set to regular xG)
                
                # Start new potential flurry
                flurry_sequence = [{
                    'idx': current_idx,
                    'time': current_time,
                    'xg': current_xg
                }]
        
        # Process last flurry if exists
        if len(flurry_sequence) > 1:
            for j, shot in enumerate(flurry_sequence):
                if j > 0:  # Discount subsequent shots
                    # Calculate cumulative failure probability of all prior shots
                    cumulative_failure_prob = 1.0
                    for k in range(j):  # For all shots before this one
                        prior_xg = flurry_sequence[k]['xg']
                        cumulative_failure_prob *= (1.0 - prior_xg)
                    
                    # Discount this shot's xG by cumulative failure probability
                    discounted_xg = shot['xg'] * cumulative_failure_prob
                    # Ensure value stays within [0, 1] bounds
                    discounted_xg = max(0.0, min(discounted_xg, 1.0))
                    # Update using original index
                    df.at[shot['idx'], 'flurry_adjusted_xg'] = discounted_xg
    
    # Final bounds check: Ensure all values are between 0 and 1
    df['flurry_adjusted_xg'] = df['flurry_adjusted_xg'].clip(lower=0.0, upper=1.0)
    
    # Clean up temporary column
    df = df.drop(columns=['_time_seconds'])
    
    return df


def calculate_expected_goals_of_expected_rebounds(df_shots, rebound_prob_col='expected_rebound_probability',
                                                   xg_col='xG_Value'):
    """
    Calculate Expected Goals of Expected Rebounds (xGoals of xRebounds).
    
    This metric credits players for shots that are likely to generate rebounds,
    even if the rebound doesn't actually occur. It's calculated as:
    
    xGoals_of_xRebounds = Probability_of_Rebound × Expected_Goals_of_Potential_Rebound_Shot
    
    For simplicity, we estimate the rebound shot's xG as a function of the original shot's xG
    and location. Rebounds typically occur closer to the net with better angles.
    
    Args:
        df_shots: DataFrame with shot data including rebound probabilities and xG values
        rebound_prob_col: Column name for rebound probability
        xg_col: Column name for xG values
    
    Returns:
        DataFrame with 'expected_goals_of_expected_rebounds' column added
    """
    df = df_shots.copy()
    
    # Initialize column
    df['expected_goals_of_expected_rebounds'] = 0.0
    
    # For shots that could generate rebounds, estimate the xG of the potential rebound shot
    # Rebounds typically occur:
    # - Closer to the net (distance reduced by ~30-50%)
    # - With better angles (angle reduced by ~20-40%)
    # - Higher base xG due to goalie being out of position
    
    # Estimate rebound shot xG as a multiplier of original xG
    # This is a simplified approach - MoneyPuck likely has more sophisticated logic
    REBOUND_XG_MULTIPLIER = 1.5  # Rebounds are typically more dangerous
    
    # Calculate: rebound_prob × (estimated rebound shot xG)
    # Cap rebound shot xG at 0.5 (50% max probability)
    rebound_shot_xg = (df[xg_col] * REBOUND_XG_MULTIPLIER).clip(upper=0.5)
    
    # Expected goals of expected rebounds = P(rebound) × xG(rebound shot)
    df['expected_goals_of_expected_rebounds'] = (
        df[rebound_prob_col] * rebound_shot_xg
    )
    
    return df


def calculate_shooting_talent_adjusted_xg(df_shots, player_talent_dict, xg_column='flurry_adjusted_xg',
                                           player_id_col='playerId'):
    """
    Apply shooting talent multipliers to xG values.
    
    This adjusts xG based on individual player shooting talent, using Bayesian
    estimates from historical performance. Players with above-average shooting
    talent get a multiplier > 1.0, while below-average shooters get < 1.0.
    
    Args:
        df_shots: DataFrame with shot data
        player_talent_dict: Dictionary mapping player_id -> talent_multiplier
        xg_column: Column name for xG values to adjust
        player_id_col: Column name for player ID
    
    Returns:
        DataFrame with 'shooting_talent_adjusted_xg' and 'shooting_talent_multiplier' columns
    """
    df = df_shots.copy()
    
    # Initialize columns
    df['shooting_talent_multiplier'] = 1.0
    df['shooting_talent_adjusted_xg'] = df[xg_column].copy()
    
    # Apply talent multipliers
    # Default to 1.0 (average) if player not in dictionary
    df['shooting_talent_multiplier'] = df[player_id_col].map(
        lambda pid: player_talent_dict.get(int(pid), 1.0)
    )
    
    # Apply multiplier to xG
    df['shooting_talent_adjusted_xg'] = (
        df[xg_column] * df['shooting_talent_multiplier']
    )
    
    # Cap adjusted xG at 0.50 (50% max probability)
    df['shooting_talent_adjusted_xg'] = df['shooting_talent_adjusted_xg'].clip(upper=0.50)
    
    return df


def calculate_created_expected_goals(df_shots, xg_col='xG_Value', is_rebound_col='is_rebound',
                                     xgoals_of_xrebounds_col='expected_goals_of_expected_rebounds'):
    """
    Calculate Created Expected Goals (cXG).
    
    Created Expected Goals = Non-Rebound xG + Expected Goals of Expected Rebounds
    
    This metric credits players for:
    1. Their direct shot attempts (non-rebound shots)
    2. The expected value of rebounds their shots are likely to generate
    
    This is MoneyPuck's "Created Expected Goals" metric, which captures both
    direct scoring chances and rebound opportunities created.
    
    Args:
        df_shots: DataFrame with shot data
        xg_col: Column name for base xG values
        is_rebound_col: Column name for rebound flag (True/False or 1/0)
        xgoals_of_xrebounds_col: Column name for expected goals of expected rebounds
    
    Returns:
        DataFrame with 'created_expected_goals' column added
    """
    df = df_shots.copy()
    
    # Initialize column
    df['created_expected_goals'] = 0.0
    
    # For non-rebound shots, use the base xG
    # For rebound shots, we don't count the xG (it was already counted for the original shot)
    # Instead, we add the xGoals of xRebounds from the original shot
    
    # Non-rebound shots contribute their xG
    non_rebound_mask = ~df[is_rebound_col].astype(bool)
    df.loc[non_rebound_mask, 'created_expected_goals'] = df.loc[non_rebound_mask, xg_col]
    
    # All shots (including rebounds) contribute their xGoals of xRebounds
    # This credits the shooter for creating rebound opportunities
    if xgoals_of_xrebounds_col in df.columns:
        df['created_expected_goals'] = (
            df['created_expected_goals'] + 
            df[xgoals_of_xrebounds_col].fillna(0.0)
        )
    else:
        # Fallback: if column doesn't exist, just use non-rebound xG
        pass
    
    return df

