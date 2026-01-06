#!/usr/bin/env python3
"""
Update data_acquisition.py to fetch and store player/goalie names during processing.
This ensures names are populated in real-time as we scrape data.
"""

import requests
import time

NHL_API_BASE = "https://api-web.nhle.com/v1"

def fetch_player_name_from_api(player_id):
    """
    Fetch player name from NHL API.
    Returns full name as string, or None if fetch fails.
    """
    try:
        url = f"{NHL_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=3)
        if response.status_code == 200:
            data = response.json()
            first_name = data.get('firstName', {}).get('default', '')
            last_name = data.get('lastName', {}).get('default', '')
            if first_name and last_name:
                return f"{first_name} {last_name}"
        return None
    except:
        return None

# This function should be added to data_acquisition.py
# Replace line 1554: goalie_name = None
# With:
"""
# GOALIE INFORMATION
goalie_id = details.get('goalieInNetId')
goalie_name = None
if goalie_id:
    # Try to fetch from player_names table first (fast lookup)
    try:
        name_response = supabase.table('player_names').select('full_name').eq('player_id', goalie_id).limit(1).execute()
        if name_response.data:
            goalie_name = name_response.data[0]['full_name']
        else:
            # Fallback to API fetch (slower, but ensures we get the name)
            goalie_name = fetch_player_name_from_api(goalie_id)
            # Store in player_names for future lookups
            if goalie_name:
                try:
                    supabase.table('player_names').upsert({
                        'player_id': goalie_id,
                        'full_name': goalie_name
                    }, on_conflict='player_id').execute()
                except:
                    pass  # Don't fail if upsert fails
    except:
        # Fallback to API if table lookup fails
        goalie_name = fetch_player_name_from_api(goalie_id)
"""

# Similarly for shooter names:
"""
# PLAYER INFORMATION (shooter)
player_id = details.get('shootingPlayerId') or details.get('scoringPlayerId')
player_name = None
if player_id:
    # Try to fetch from player_names table first
    try:
        name_response = supabase.table('player_names').select('full_name').eq('player_id', player_id).limit(1).execute()
        if name_response.data:
            player_name = name_response.data[0]['full_name']
        else:
            # Fallback to API fetch
            player_name = fetch_player_name_from_api(player_id)
            if player_name:
                try:
                    supabase.table('player_names').upsert({
                        'player_id': player_id,
                        'full_name': player_name
                    }, on_conflict='player_id').execute()
                except:
                    pass
    except:
        player_name = fetch_player_name_from_api(player_id)
"""

print("""
This script shows the code changes needed for data_acquisition.py.

To implement:
1. Add fetch_player_name_from_api() function to data_acquisition.py
2. Replace goalie_name = None with the lookup code above
3. Optionally add player_name field for shooters

This ensures names are populated in real-time during data scraping.
""")

