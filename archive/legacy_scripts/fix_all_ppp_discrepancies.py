#!/usr/bin/env python3
"""
Fix all players where database PPP equals PPG instead of total PPP.
This ensures all players match NHL.com exactly.
"""

import os
import sys
import time
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
NHL_API_BASE = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def _safe_int(v, default=0) -> int:
    try:
        return int(v) if v is not None else default
    except Exception:
        return default

print("=" * 80)
print("Fixing All PPP Discrepancies")
print("=" * 80)
print()
print("Finding players where database PPP might equal PPG instead of total PPP...")
print()

# Get all players with PPP > 0
players = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp",
    filters=[
        ("season", "eq", DEFAULT_SEASON),
        ("nhl_ppp", "gt", 0)
    ],
    limit=1000
)

print(f"Checking {len(players)} players with PPP > 0...")
print()

discrepancies = []
checked = 0
updated = 0
errors = 0

for player_stat in players:
    player_id = player_stat.get("player_id")
    db_ppp = player_stat.get("nhl_ppp", 0)
    
    if not player_id:
        continue
    
    try:
        # Fetch from API
        url = f"{NHL_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        landing_data = response.json()
        
        if "featuredStats" in landing_data:
            featured = landing_data["featuredStats"]
            if "regularSeason" in featured:
                rs = featured["regularSeason"]
                if "subSeason" in rs:
                    sub = rs["subSeason"]
                    api_ppp = _safe_int(sub.get("powerPlayPoints", 0), 0)
                    api_ppg = _safe_int(sub.get("powerPlayGoals", 0), 0)
                    api_shp = _safe_int(sub.get("shorthandedPoints", 0), 0)
                    
                    # Check if database PPP equals PPG (suspicious) or doesn't match API
                    if db_ppp != api_ppp:
                        first_name = landing_data.get("firstName", {}).get("default", "Unknown")
                        last_name = landing_data.get("lastName", {}).get("default", "Unknown")
                        name = f"{first_name} {last_name}"
                        
                        # Update database
                        updates = {
                            "season": DEFAULT_SEASON,
                            "player_id": player_id,
                            "nhl_ppp": api_ppp,
                            "nhl_shp": api_shp,
                        }
                        
                        db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
                        updated += 1
                        
                        if updated <= 10:  # Show first 10 updates
                            print(f"  Updated {name} (ID: {player_id}): PPP {db_ppp} → {api_ppp}")
        
        checked += 1
        if checked % 50 == 0:
            print(f"  Progress: {checked}/{len(players)} checked, {updated} updated...")
        
        # Rate limiting
        time.sleep(0.1)
        
    except requests.exceptions.RequestException as e:
        if "429" in str(e):
            print(f"  Rate limited, waiting 5 seconds...")
            time.sleep(5)
        else:
            errors += 1
        continue
    except Exception as e:
        errors += 1
        continue

print()
print("=" * 80)
print("Summary")
print("=" * 80)
print(f"Players checked: {checked}")
print(f"Players updated: {updated}")
print(f"Errors: {errors}")
print()
if updated > 0:
    print(f"✓✓✓ Updated {updated} players with correct PPP values! ✓✓✓")
else:
    print("✓ No updates needed - all players have correct values")
print("=" * 80)

