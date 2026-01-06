#!/usr/bin/env python3
"""
Debug PPP extraction - check what we're actually getting vs what we should get.
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
    (8476453, "Mika Zibanejad"),
]

print("=" * 80)
print("DEBUGGING PPP EXTRACTION")
print("=" * 80)
print()

for player_id, name in test_players:
    print(f"{'='*80}")
    print(f"Player: {name} (ID: {player_id})")
    print(f"{'='*80}")
    print()
    
    # Check database
    db_result = db.select(
        "player_season_stats",
        select="nhl_ppp,nhl_shp",
        filters=[
            ("player_id", "eq", player_id),
            ("season", "eq", DEFAULT_SEASON)
        ],
        limit=1
    )
    
    if db_result and len(db_result) > 0:
        print(f"Database values:")
        print(f"  PPP: {db_result[0].get('nhl_ppp', 0)}")
        print(f"  SHP: {db_result[0].get('nhl_shp', 0)}")
        print()
    
    # Fetch from API
    url = f"{NHL_API_BASE}/player/{player_id}/landing"
    print(f"Fetching: {url}")
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    landing_data = response.json()
    print("✓ Fetched landing data")
    print()
    
    # Check featuredStats
    if "featuredStats" in landing_data:
        featured = landing_data["featuredStats"]
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                print("featuredStats.regularSeason.subSeason values:")
                print(f"  powerPlayGoals: {sub.get('powerPlayGoals', 0)}")
                print(f"  powerPlayAssists: {sub.get('powerPlayAssists', 0)}")
                print(f"  powerPlayPoints: {sub.get('powerPlayPoints', 0)}")
                print(f"  shorthandedGoals: {sub.get('shorthandedGoals', 0)}")
                print(f"  shorthandedAssists: {sub.get('shorthandedAssists', 0)}")
                print(f"  shorthandedPoints: {sub.get('shorthandedPoints', 0)}")
                print()
                
                ppg = _safe_int(sub.get("powerPlayGoals", 0), 0)
                ppa = _safe_int(sub.get("powerPlayAssists", 0), 0)
                ppp = _safe_int(sub.get("powerPlayPoints", 0), 0)
                
                print(f"Calculated:")
                print(f"  PPG: {ppg}")
                print(f"  PPA: {ppa}")
                print(f"  PPG + PPA: {ppg + ppa}")
                print(f"  PPP (from API): {ppp}")
                print()
                
                if ppp == ppg + ppa:
                    print("✓✓✓ PPP = PPG + PPA (CORRECT)")
                else:
                    print(f"✗✗✗ PPP ({ppp}) != PPG + PPA ({ppg + ppa}) - API ISSUE?")
                
                if db_result and len(db_result) > 0:
                    db_ppp = db_result[0].get('nhl_ppp', 0)
                    if db_ppp == ppp:
                        print(f"✓ Database matches API PPP ({ppp})")
                    elif db_ppp == ppg:
                        print(f"✗✗✗ DATABASE HAS PPG ({ppg}) INSTEAD OF PPP ({ppp})! ✗✗✗")
                        print(f"   We're storing powerPlayGoals instead of powerPlayPoints!")
                    else:
                        print(f"✗ Database ({db_ppp}) doesn't match API PPP ({ppp}) or PPG ({ppg})")
    
    print()

print("=" * 80)
print("Checking extraction code...")
print("=" * 80)

