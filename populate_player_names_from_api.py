#!/usr/bin/env python3
"""
Populate player_names table with player and goalie names from NHL API.
This creates our own internal player name database, replacing staging file dependencies.

This script:
1. Fetches unique player IDs from raw_shots (shooters and goalies)
2. Fetches player names from NHL API
3. Stores them in player_names table for fast lookups
"""

import requests
import time
import os
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client
from datetime import datetime

load_dotenv()

supabase = create_client(
    os.getenv('VITE_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

NHL_API_BASE = "https://api-web.nhle.com/v1"

def fetch_player_details(player_id):
    """Fetch player details from NHL API."""
    try:
        url = f"{NHL_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            return {
                'first_name': data.get('firstName', {}).get('default', ''),
                'last_name': data.get('lastName', {}).get('default', ''),
                'full_name': f"{data.get('firstName', {}).get('default', '')} {data.get('lastName', {}).get('default', '')}".strip(),
                'position': data.get('position', ''),
                'team': data.get('currentTeamAbbrev', ''),
                'jersey_number': data.get('sweaterNumber'),
                'is_active': data.get('isActive', True),
                'headshot_url': data.get('headshot', '')
            }
        return None
    except Exception as e:
        return None

def get_unique_player_ids_from_raw_shots():
    """Get unique player IDs (shooters and goalies) from raw_shots."""
    print("=" * 80)
    print("FETCHING UNIQUE PLAYER IDS FROM RAW_SHOTS")
    print("=" * 80)
    
    print("Loading player IDs from raw_shots...")
    
    # Get unique player_ids (shooters)
    response = supabase.table('raw_shots').select('player_id').not_.is_('player_id', 'null').limit(50000).execute()
    df_players = pd.DataFrame(response.data)
    
    # Get unique goalie_ids
    response_goalies = supabase.table('raw_shots').select('goalie_id').not_.is_('goalie_id', 'null').limit(50000).execute()
    df_goalies = pd.DataFrame(response_goalies.data)
    
    # Combine and get unique IDs
    player_ids = set(df_players['player_id'].dropna().unique())
    goalie_ids = set(df_goalies['goalie_id'].dropna().unique())
    all_ids = player_ids.union(goalie_ids)
    
    print(f"Found {len(player_ids)} unique shooters")
    print(f"Found {len(goalie_ids)} unique goalies")
    print(f"Total unique player IDs: {len(all_ids)}")
    
    return sorted(list(all_ids))

def get_existing_player_ids():
    """Get player IDs that already have names in player_names table."""
    print("\nChecking existing player names...")
    response = supabase.table('player_names').select('player_id').execute()
    existing_df = pd.DataFrame(response.data)
    
    if len(existing_df) > 0:
        existing_ids = set(existing_df['player_id'].unique())
        print(f"Found {len(existing_ids)} players with existing names")
        return existing_ids
    else:
        print("No existing player names found")
        return set()

def populate_player_names():
    """Main function to populate player_names table."""
    print("=" * 80)
    print("POPULATING PLAYER NAMES FROM NHL API")
    print("=" * 80)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Get unique player IDs from raw_shots
    all_player_ids = get_unique_player_ids_from_raw_shots()
    
    if len(all_player_ids) == 0:
        print("ERROR: No player IDs found in raw_shots")
        return
    
    # Get existing player IDs
    existing_ids = get_existing_player_ids()
    
    # Filter to only new players
    new_player_ids = [pid for pid in all_player_ids if pid not in existing_ids]
    
    print(f"\nPlayers needing names: {len(new_player_ids)}")
    print(f"Players already have names: {len(existing_ids)}")
    
    if len(new_player_ids) == 0:
        print("\n✅ All players already have names!")
        return
    
    # Fetch and store player names
    print(f"\nFetching names for {len(new_player_ids)} players from NHL API...")
    print("(Rate limited to avoid API throttling)")
    
    success_count = 0
    error_count = 0
    records = []
    
    for i, player_id in enumerate(new_player_ids, 1):
        if i % 50 == 0:
            print(f"  Progress: {i}/{len(new_player_ids)}... ({success_count} success, {error_count} errors)")
        
        # Fetch player details
        details = fetch_player_details(int(player_id))
        
        if details and details['full_name']:
            record = {
                'player_id': int(player_id),
                'full_name': details['full_name'],
                'first_name': details['first_name'],
                'last_name': details['last_name'],
                'position': details['position'],
                'team': details['team'],
                'jersey_number': details['jersey_number'],
                'is_active': details['is_active'],
                'headshot_url': details['headshot_url'],
                'last_updated': datetime.now().isoformat()
            }
            records.append(record)
            success_count += 1
        else:
            error_count += 1
        
        # Rate limiting
        time.sleep(0.2)
    
    print(f"\n✅ Fetched {success_count} player names")
    if error_count > 0:
        print(f"⚠️  Failed to fetch {error_count} names")
    
    # Batch upsert to database
    if len(records) > 0:
        print(f"\nUpserting {len(records)} player names to database...")
        batch_size = 100
        total_batches = (len(records) + batch_size - 1) // batch_size
        
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            batch_num = (i // batch_size) + 1
            
            try:
                response = supabase.table('player_names').upsert(
                    batch,
                    on_conflict='player_id'
                ).execute()
                print(f"  Upserted batch {batch_num}/{total_batches} ({len(batch)} players)")
            except Exception as e:
                print(f"  ERROR: Failed to upsert batch {batch_num}: {e}")
                # Try individual inserts
                for record in batch:
                    try:
                        supabase.table('player_names').upsert(
                            record,
                            on_conflict='player_id'
                        ).execute()
                    except Exception as e2:
                        print(f"    ERROR: Failed to upsert player_id {record['player_id']}: {e2}")
        
        print(f"\n✅ Upserted {len(records)} player names to database")
    
    print(f"\nCompleted at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    
    # Summary
    print("\nSUMMARY")
    print("=" * 80)
    print(f"Total unique players in raw_shots: {len(all_player_ids)}")
    print(f"Players with names (before): {len(existing_ids)}")
    print(f"Players with names (after): {len(existing_ids) + len(records)}")
    print(f"Coverage: {(len(existing_ids) + len(records)) / len(all_player_ids) * 100:.1f}%")

if __name__ == "__main__":
    populate_player_names()

