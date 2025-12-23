#!/usr/bin/env python3
"""
Update goalie names in raw_shots table by fetching from NHL API.
This populates goalie_name from our own data pull instead of staging data.
"""

import requests
import time
import os
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv('VITE_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

NHL_API_BASE = "https://api-web.nhle.com/v1"

def fetch_goalie_name(goalie_id):
    """Fetch goalie name from NHL API."""
    try:
        url = f"{NHL_API_BASE}/player/{goalie_id}/landing"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            first_name = data.get('firstName', {}).get('default', '')
            last_name = data.get('lastName', {}).get('default', '')
            if first_name and last_name:
                return f"{first_name} {last_name}"
        return None
    except Exception as e:
        return None

def get_goalies_needing_names():
    """Get unique goalie IDs from raw_shots that need names."""
    print("Fetching goalie IDs from raw_shots...")
    
    # Get unique goalie_ids where goalie_name is NULL
    response = supabase.table('raw_shots').select('goalie_id, goalie_name').not_.is_('goalie_id', 'null').limit(10000).execute()
    df = pd.DataFrame(response.data)
    
    # Get unique goalie_ids
    unique_goalies = df['goalie_id'].dropna().unique()
    
    # Filter to those without names
    goalies_with_names = df[df['goalie_name'].notna()]['goalie_id'].unique()
    goalies_needing_names = [gid for gid in unique_goalies if gid not in goalies_with_names]
    
    print(f"Found {len(unique_goalies)} unique goalies")
    print(f"  {len(goalies_with_names)} already have names")
    print(f"  {len(goalies_needing_names)} need names")
    
    return goalies_needing_names

def populate_goalie_names():
    """Populate goalie names in raw_shots from NHL API."""
    print("=" * 80)
    print("POPULATING GOALIE NAMES FROM NHL API")
    print("=" * 80)
    
    goalie_ids = get_goalies_needing_names()
    
    if len(goalie_ids) == 0:
        print("✅ All goalies already have names!")
        return
    
    print(f"\nFetching names for {len(goalie_ids)} goalies...")
    print("(Rate limited to avoid API throttling)")
    
    goalie_lookup = {}
    success = 0
    failed = 0
    
    for i, goalie_id in enumerate(goalie_ids[:200], 1):  # Limit to 200 for now
        if i % 20 == 0:
            print(f"  Progress: {i}/{min(len(goalie_ids), 200)}...")
        
        name = fetch_goalie_name(int(goalie_id))
        if name:
            goalie_lookup[int(goalie_id)] = name
            success += 1
        else:
            failed += 1
        
        time.sleep(0.2)  # Rate limiting
    
    print(f"\n✅ Fetched {success} names")
    if failed > 0:
        print(f"⚠️  Failed to fetch {failed} names")
    
    # Update raw_shots table
    if len(goalie_lookup) > 0:
        print(f"\nUpdating raw_shots table...")
        updated_count = 0
        
        for goalie_id, goalie_name in goalie_lookup.items():
            try:
                response = supabase.table('raw_shots').update(
                    {'goalie_name': goalie_name}
                ).eq('goalie_id', goalie_id).is_('goalie_name', 'null').execute()
                updated_count += 1
            except Exception as e:
                print(f"  Error updating goalie_id {goalie_id}: {e}")
        
        print(f"✅ Updated {updated_count} unique goalies in raw_shots")
    
    return goalie_lookup

if __name__ == "__main__":
    populate_goalie_names()

