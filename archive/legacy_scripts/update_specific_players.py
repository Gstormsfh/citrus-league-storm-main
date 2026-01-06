#!/usr/bin/env python3
"""
Manually update specific players to verify the fix works.
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

test_players = [
    (8481524, "Lucas Raymond"),
    (8471675, "Sidney Crosby"),
]

print("=" * 80)
print("Manually Updating Specific Players")
print("=" * 80)
print()

for player_id, name in test_players:
    print(f"Updating {name} (ID: {player_id})...")
    
    # Fetch landing data
    url = f"{NHL_API_BASE}/player/{player_id}/landing"
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    landing_data = response.json()
    
    # Extract stats
    stats = {}
    if "featuredStats" in landing_data:
        featured = landing_data["featuredStats"]
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                stats["nhl_ppp"] = _safe_int(sub.get("powerPlayPoints", 0), 0)
                stats["nhl_shp"] = _safe_int(sub.get("shorthandedPoints", 0), 0)
    
    print(f"  Extracted: PPP={stats.get('nhl_ppp', 0)}, SHP={stats.get('nhl_shp', 0)}")
    
    # Update database
    updates = {
        "season": DEFAULT_SEASON,
        "player_id": player_id,
        "nhl_ppp": stats.get("nhl_ppp", 0),
        "nhl_shp": stats.get("nhl_shp", 0),
    }
    
    db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
    print(f"  ✓ Updated database")
    print()

print("=" * 80)
print("Update Complete")
print("=" * 80)

