#!/usr/bin/env python3
"""
Check Lucas Raymond's correct player ID and verify PPP values.
"""

import os
import sys
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
print("Checking Lucas Raymond Player IDs")
print("=" * 80)
print()

# Check both player IDs
player_ids = [
    (8481524, "ID from our previous checks"),
    (8482078, "ID from NHL.com URL"),
]

for player_id, description in player_ids:
    print(f"{'='*80}")
    print(f"Player ID: {player_id} ({description})")
    print(f"{'='*80}")
    print()
    
    # Check database
    db_result = db.select(
        "player_directory",
        select="player_id,full_name,team_abbrev",
        filters=[
            ("player_id", "eq", player_id),
            ("season", "eq", DEFAULT_SEASON)
        ],
        limit=1
    )
    
    if db_result and len(db_result) > 0:
        p = db_result[0]
        print(f"Database: {p.get('full_name')} ({p.get('team_abbrev')})")
    else:
        print("Database: Not found")
    
    # Check season stats
    stats_result = db.select(
        "player_season_stats",
        select="nhl_ppp,nhl_shp",
        filters=[
            ("player_id", "eq", player_id),
            ("season", "eq", DEFAULT_SEASON)
        ],
        limit=1
    )
    
    if stats_result and len(stats_result) > 0:
        s = stats_result[0]
        print(f"Season Stats: PPP={s.get('nhl_ppp', 0)}, SHP={s.get('nhl_shp', 0)}")
    else:
        print("Season Stats: Not found")
    
    # Fetch from API
    try:
        url = f"{NHL_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        landing_data = response.json()
        
        first_name = landing_data.get("firstName", {}).get("default", "Unknown")
        last_name = landing_data.get("lastName", {}).get("default", "Unknown")
        full_name = f"{first_name} {last_name}"
        team = landing_data.get("currentTeamAbbrev", "Unknown")
        
        print(f"API: {full_name} ({team})")
        
        if "featuredStats" in landing_data:
            featured = landing_data["featuredStats"]
            if "regularSeason" in featured:
                rs = featured["regularSeason"]
                if "subSeason" in rs:
                    sub = rs["subSeason"]
                    ppp = _safe_int(sub.get("powerPlayPoints", 0), 0)
                    shp = _safe_int(sub.get("shorthandedPoints", 0), 0)
                    ppg = _safe_int(sub.get("powerPlayGoals", 0), 0)
                    ppa = _safe_int(sub.get("powerPlayAssists", 0), 0)
                    
                    print(f"API Stats:")
                    print(f"  PPG: {ppg}")
                    print(f"  PPA: {ppa}")
                    print(f"  PPG + PPA: {ppg + ppa}")
                    print(f"  PPP (powerPlayPoints): {ppp}")
                    print(f"  SHP: {shp}")
    except Exception as e:
        print(f"API Error: {e}")
    
    print()

print("=" * 80)
print("Conclusion")
print("=" * 80)
print("We need to identify which player ID is the correct Lucas Raymond")
print("and ensure we're using the right one in our database.")

