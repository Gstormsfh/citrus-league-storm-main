#!/usr/bin/env python3
"""
Inspect the actual landing endpoint response for McDavid to verify data extraction.
"""

import os
import sys
import json
import requests
from dotenv import load_dotenv

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
NHL_API_BASE = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

MCDAVID_ID = 8478402

print("=" * 80)
print("Inspecting NHL Landing Endpoint for Connor McDavid")
print("=" * 80)
print()

url = f"{NHL_API_BASE}/player/{MCDAVID_ID}/landing"
print(f"Fetching: {url}")
print()

try:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    data = response.json()
    
    print("Response structure:")
    print(f"  Keys: {list(data.keys())}")
    print()
    
    # Check seasonTotals
    if "seasonTotals" in data:
        season_totals = data["seasonTotals"]
        print(f"seasonTotals array length: {len(season_totals)}")
        print()
        
        # Show all seasons
        print("All seasons in seasonTotals:")
        for idx, season in enumerate(season_totals):
            season_id = season.get("season", 0)
            season_start = season_id // 10000 if season_id > 0 else 0
            games = season.get("gamesPlayed", 0)
            goals = season.get("goals", 0)
            assists = season.get("assists", 0)
            points = season.get("points", 0)
            ppp = season.get("powerPlayPoints", 0)
            shp = season.get("shorthandedPoints", 0)
            
            print(f"  [{idx}] Season {season_id} (start: {season_start}): GP={games}, G={goals}, A={assists}, P={points}, PPP={ppp}, SHP={shp}")
        
        print()
        
        # Last item (should be current season)
        if len(season_totals) > 0:
            last_season = season_totals[-1]
            print("Last season in array (what we're using):")
            print(f"  Season ID: {last_season.get('season', 0)}")
            print(f"  Games Played: {last_season.get('gamesPlayed', 0)}")
            print(f"  Goals: {last_season.get('goals', 0)}")
            print(f"  Assists: {last_season.get('assists', 0)}")
            print(f"  Points: {last_season.get('points', 0)}")
            print(f"  Powerplay Points: {last_season.get('powerPlayPoints', 0)}")
            print(f"  Shorthanded Points: {last_season.get('shorthandedPoints', 0)}")
            print()
            
            # Find the season that matches DEFAULT_SEASON
            target_season = None
            for season in season_totals:
                season_id = season.get("season", 0)
                season_start = season_id // 10000 if season_id > 0 else 0
                if season_start == DEFAULT_SEASON:
                    target_season = season
                    break
            
            if target_season:
                print(f"Season matching {DEFAULT_SEASON}:")
                print(f"  Season ID: {target_season.get('season', 0)}")
                print(f"  Games Played: {target_season.get('gamesPlayed', 0)}")
                print(f"  Goals: {target_season.get('goals', 0)}")
                print(f"  Assists: {target_season.get('assists', 0)}")
                print(f"  Points: {target_season.get('points', 0)}")
                print(f"  Powerplay Points: {target_season.get('powerPlayPoints', 0)}")
                print(f"  Shorthanded Points: {target_season.get('shorthandedPoints', 0)}")
            else:
                print(f"WARNING: No season found matching {DEFAULT_SEASON}")
    
    # Check featuredStats
    if "featuredStats" in data:
        print()
        print("featuredStats structure:")
        featured = data["featuredStats"]
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            print(f"  regularSeason keys: {list(rs.keys())}")
            if "subSeason" in rs:
                sub = rs["subSeason"]
                print(f"  subSeason keys: {list(sub.keys())}")
                print(f"  subSeason powerPlayPoints: {sub.get('powerPlayPoints', 0)}")
                print(f"  subSeason shorthandedPoints: {sub.get('shorthandedPoints', 0)}")
    
    print()
    print("=" * 80)
    print("Full JSON (first 2000 chars):")
    print("=" * 80)
    print(json.dumps(data, indent=2)[:2000])
    print("...")
    
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()

