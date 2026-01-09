#!/usr/bin/env python3
"""
Populate goalie names in raw_shots table by fetching from NHL API.
This replaces dependency on staging data with our own data pull.
"""

import requests
import time
import os
from dotenv import load_dotenv
from supabase import create_client
import pandas as pd
from src.utils.citrus_request import citrus_request

load_dotenv()

supabase = create_client(
    os.getenv('VITE_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

NHL_API_BASE = "https://api-web.nhle.com/v1"

def fetch_goalie_name_from_api(goalie_id):
    """Fetch goalie name from NHL API."""
    try:
        url = f"{NHL_API_BASE}/player/{goalie_id}/landing"
        response = citrus_request(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            first_name = data.get('firstName', {}).get('default', '')
            last_name = data.get('lastName', {}).get('default', '')
            if first_name and last_name:
                return f"{first_name} {last_name}"
        return None
    except Exception as e:
        print(f"  Error fetching goalie {goalie_id}: {e}")
        return None

def get_unique_goalie_ids():
    """Get unique goalie IDs from raw_shots that don't have names."""
    print("Fetching unique goalie IDs from raw_shots...")
    
    # Get all unique goalie_ids where goalie_name is NULL
    response = supabase.table('raw_shots').select('goalie_id').not_.is_('goalie_id', 'null').execute()
    df = pd.DataFrame(response.data)
    
    unique_goalies = df['goalie_id'].dropna().unique()
    print(f"Found {len(unique_goalies)} unique goalie IDs")
    
    # Check which ones already have names
    response_with_names = supabase.table('raw_shots').select('goalie_id, goalie_name').not_.is_('goalie_id', 'null').not_.is_('goalie_name', 'null').limit(1000).execute()
    df_with_names = pd.DataFrame(response_with_names.data)
    
    if len(df_with_names) > 0:
        goalies_with_names = df_with_names['goalie_id'].unique()
        goalies_needing_names = [gid for gid in unique_goalies if gid not in goalies_with_names]
        print(f"  Goalies with names: {len(goalies_with_names)}")
        print(f"  Goalies needing names: {len(goalies_needing_names)}")
        return goalies_needing_names
    else:
        print(f"  No goalies have names yet - will fetch all {len(unique_goalies)}")
        return unique_goalies.tolist()

def create_goalie_name_lookup():
    """Create a lookup table of goalie_id -> goalie_name from NHL API."""
    print("=" * 80)
    print("CREATING GOALIE NAME LOOKUP FROM NHL API")
    print("=" * 80)
    
    goalie_ids = get_unique_goalie_ids()
    
    if len(goalie_ids) == 0:
        print("✅ All goalies already have names!")
        return {}
    
    print(f"\nFetching names for {len(goalie_ids)} goalies from NHL API...")
    print("(This may take a few minutes due to rate limiting)")
    
    goalie_lookup = {}
    success_count = 0
    error_count = 0
    
    for i, goalie_id in enumerate(goalie_ids[:100], 1):  # Limit to 100 for now
        if i % 10 == 0:
            print(f"  Progress: {i}/{min(len(goalie_ids), 100)}...")
        
        name = fetch_goalie_name_from_api(int(goalie_id))
        if name:
            goalie_lookup[int(goalie_id)] = name
            success_count += 1
        else:
            error_count += 1
        
        # Rate limiting
        time.sleep(0.2)
    
    print(f"\n✅ Fetched {success_count} goalie names")
    if error_count > 0:
        print(f"⚠️  Failed to fetch {error_count} names")
    
    return goalie_lookup

def update_raw_shots_with_names(goalie_lookup):
    """Update raw_shots table with goalie names."""
    print("\n" + "=" * 80)
    print("UPDATING RAW_SHOTS WITH GOALIE NAMES")
    print("=" * 80)
    
    if len(goalie_lookup) == 0:
        print("No goalie names to update")
        return
    
    # Update in batches
    batch_size = 100
    total_updated = 0
    
    for goalie_id, goalie_name in goalie_lookup.items():
        try:
            # Update all rows with this goalie_id
            response = supabase.table('raw_shots').update(
                {'goalie_name': goalie_name}
            ).eq('goalie_id', goalie_id).is_('goalie_name', 'null').execute()
            
            # Count updated rows (Supabase doesn't return count, so we estimate)
            total_updated += 1
            
        except Exception as e:
            print(f"  Error updating goalie_id {goalie_id}: {e}")
    
    print(f"✅ Updated goalie names for {len(goalie_lookup)} unique goalies")
    print(f"   (Note: This updates all rows with matching goalie_id)")

def aggregate_goalie_names_for_gsax():
    """Create a goalie names lookup from raw_shots for GSAx table."""
    print("\n" + "=" * 80)
    print("AGGREGATING GOALIE NAMES FOR GSAX")
    print("=" * 80)
    
    # Get unique goalie_id, goalie_name pairs from raw_shots
    print("Fetching goalie names from raw_shots...")
    response = supabase.table('raw_shots').select('goalie_id, goalie_name').not_.is_('goalie_id', 'null').not_.is_('goalie_name', 'null').limit(10000).execute()
    df = pd.DataFrame(response.data)
    
    if len(df) == 0:
        print("⚠️  No goalie names found in raw_shots")
        return None
    
    # Get unique goalie_id -> goalie_name mapping
    goalie_names = df.groupby('goalie_id')['goalie_name'].first().reset_index()
    print(f"✅ Found {len(goalie_names)} unique goalies with names")
    
    # Save to CSV for GSAx calculation
    goalie_names.to_csv('goalie_names_lookup.csv', index=False)
    print(f"✅ Saved to goalie_names_lookup.csv")
    
    return goalie_names

def main():
    """Main execution."""
    print("=" * 80)
    print("POPULATE GOALIE NAMES FROM NHL API")
    print("=" * 80)
    print("\nThis script:")
    print("1. Fetches goalie names from NHL API")
    print("2. Updates raw_shots table with goalie names")
    print("3. Creates a lookup file for GSAx calculations")
    print()
    
    # Step 1: Create lookup from API
    goalie_lookup = create_goalie_name_lookup()
    
    # Step 2: Update raw_shots
    if len(goalie_lookup) > 0:
        update_raw_shots_with_names(goalie_lookup)
    
    # Step 3: Aggregate for GSAx
    aggregate_goalie_names_for_gsax()
    
    print("\n" + "=" * 80)
    print("COMPLETE")
    print("=" * 80)
    print("\nNext steps:")
    print("1. Re-run data acquisition to populate goalie_name going forward")
    print("2. Update calculate_goalie_gsax.py to include goalie names")
    print("3. Use goalie_names_lookup.csv for GSAx calculations")

if __name__ == "__main__":
    main()

