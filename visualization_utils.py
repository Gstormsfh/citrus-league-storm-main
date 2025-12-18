# visualization_utils.py
# Shared utilities for shot and pass visualization

import os
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client
from hockey_rink import NHLRink
import matplotlib.pyplot as plt

# Load environment variables
load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def fetch_raw_shots(game_id=None, player_id=None, date_from=None, date_to=None, limit=None):
    """
    Fetch raw shot data from database with optional filters.
    
    Args:
        game_id: Filter by specific game ID (integer)
        player_id: Filter by specific player ID (integer)
        date_from: Filter shots from this date onwards (YYYY-MM-DD)
        date_to: Filter shots up to this date (YYYY-MM-DD)
        limit: Maximum number of records to return
    
    Returns:
        pandas.DataFrame with shot data
    """
    try:
        query = supabase.table('raw_shots').select('*')
        
        if game_id:
            query = query.eq('game_id', game_id)
        if player_id:
            query = query.eq('player_id', player_id)
        if date_from:
            query = query.gte('created_at', date_from)
        if date_to:
            query = query.lte('created_at', date_to)
        if limit:
            query = query.limit(limit)
        
        response = query.execute()
        
        if not response.data:
            print("No shot data found with specified filters.")
            return pd.DataFrame()
        
        df = pd.DataFrame(response.data)
        print(f"Fetched {len(df)} shot records from database.")
        return df
    
    except Exception as e:
        print(f"Error fetching raw shots: {e}")
        return pd.DataFrame()

def setup_rink(ax=None, display_range='ozone'):
    """
    Set up NHL rink for plotting.
    
    Args:
        ax: Matplotlib axes (if None, creates new figure)
        display_range: 'ozone' (offensive zone), 'dzone' (defensive zone), or 'full'
    
    Returns:
        rink object and axes
    """
    if ax is None:
        fig, ax = plt.subplots(figsize=(12, 10))
    else:
        fig = ax.figure
    
    rink = NHLRink()
    rink.draw(ax=ax, display_range=display_range)
    
    return rink, ax, fig

def get_zone_colors():
    """
    Return color mapping for pass zones.
    
    Returns:
        dict mapping zone names to colors
    """
    return {
        'crease': '#FF0000',  # Red - highest danger
        'slot_low_angle': '#FF6600',  # Orange-red
        'slot_high_angle': '#FF9900',  # Orange
        'high_slot_low_angle': '#FFCC00',  # Yellow-orange
        'high_slot_high_angle': '#FFFF00',  # Yellow
        'blue_line_low_angle': '#CCFF00',  # Yellow-green
        'blue_line_high_angle': '#99FF00',  # Green
        'deep': '#66FF00',  # Light green
        'no_pass': '#CCCCCC'  # Gray
    }

def get_zone_display_name(zone):
    """
    Convert zone code to display name.
    
    Args:
        zone: Zone code (e.g., 'slot_low_angle')
    
    Returns:
        Display name (e.g., 'Slot (Low Angle)')
    """
    zone_names = {
        'crease': 'Crease',
        'slot_low_angle': 'Slot (Low Angle)',
        'slot_high_angle': 'Slot (High Angle)',
        'high_slot_low_angle': 'High Slot (Low Angle)',
        'high_slot_high_angle': 'High Slot (High Angle)',
        'blue_line_low_angle': 'Blue Line (Low Angle)',
        'blue_line_high_angle': 'Blue Line (High Angle)',
        'deep': 'Deep',
        'no_pass': 'No Pass'
    }
    return zone_names.get(zone, zone)

def filter_shots_with_passes(df):
    """
    Filter dataframe to only shots with passes.
    
    Args:
        df: DataFrame with shot data
    
    Returns:
        Filtered DataFrame
    """
    return df[df['has_pass_before_shot'] == True].copy()

def filter_shots_by_zone(df, zone):
    """
    Filter shots by pass zone.
    
    Args:
        df: DataFrame with shot data
        zone: Zone name to filter by
    
    Returns:
        Filtered DataFrame
    """
    if zone == 'all':
        return df.copy()
    return df[df['pass_zone'] == zone].copy()

def calculate_zone_statistics(df):
    """
    Calculate statistics by zone.
    
    Args:
        df: DataFrame with shot data
    
    Returns:
        DataFrame with zone statistics
    """
    if df.empty:
        return pd.DataFrame()
    
    zone_stats = df.groupby('pass_zone').agg({
        'xg_value': ['count', 'mean', 'sum'],
        'is_goal': 'sum',
        'pass_lateral_distance': 'mean',
        'pass_immediacy_score': 'mean',
        'goalie_movement_score': 'mean',
        'pass_quality_score': 'mean'
    }).reset_index()
    
    zone_stats.columns = ['zone', 'shot_count', 'avg_xg', 'total_xg', 'goals', 
                          'avg_lateral_distance', 'avg_immediacy', 'avg_goalie_movement', 'avg_quality']
    
    zone_stats['goal_rate'] = zone_stats['goals'] / zone_stats['shot_count']
    
    return zone_stats

