#!/usr/bin/env python3
"""
Check NHL Landing Endpoint for McDavid's 2025-2026 season stats
"""

import requests
import json

PLAYER_ID = 8478402
SEASON = 2025  # 2025-2026 season

print("=" * 80)
print("NHL LANDING ENDPOINT - MCDAVID 2025-2026 SEASON")
print("=" * 80)
print()

url = f"https://api-web.nhle.com/v1/player/{PLAYER_ID}/landing"
print(f"Fetching: {url}")
print()

try:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    data = response.json()
    
    # Check featuredStats (current season)
    print("1. FEATURED STATS (Current Season):")
    print("-" * 80)
    if "featuredStats" in data:
        featured = data["featuredStats"]
        season_id = featured.get("season", 0)
        season_start = season_id // 10000 if season_id > 0 else 0
        print(f"   Season ID: {season_id} (start year: {season_start})")
        
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                print(f"   Games: {sub.get('gamesPlayed', 0)}")
                print(f"   Goals: {sub.get('goals', 0)}")
                print(f"   Assists: {sub.get('assists', 0)}")
                print(f"   Points: {sub.get('points', 0)}")
                print(f"   Shots: {sub.get('shots', 0)}")
                print(f"   PPP: {sub.get('powerPlayPoints', 0)}")
                print(f"   SHP: {sub.get('shorthandedPoints', 0)}")
    
    # Check seasonTotals array
    print()
    print("2. SEASON TOTALS ARRAY:")
    print("-" * 80)
    if "seasonTotals" in data and isinstance(data["seasonTotals"], list):
        for season_data in data["seasonTotals"]:
            season_id = season_data.get("season", 0)
            season_start = season_id // 10000 if season_id > 0 else 0
            print(f"   Season {season_id} (start: {season_start}):")
            print(f"     Games: {season_data.get('gamesPlayed', 0)}")
            print(f"     Goals: {season_data.get('goals', 0)}")
            print(f"     Assists: {season_data.get('assists', 0)}")
            print(f"     Points: {season_data.get('points', 0)}")
            print(f"     Shots: {season_data.get('shots', 0)}")
            print(f"     PPP: {season_data.get('powerPlayPoints', 0)}")
            print(f"     SHP: {season_data.get('shorthandedPoints', 0)}")
            if season_start == SEASON:
                print(f"     *** THIS IS THE 2025-2026 SEASON ***")
            print()
    
    # Find the 2025-2026 season specifically
    print()
    print("3. 2025-2026 SEASON (season = 2025):")
    print("-" * 80)
    target_season_data = None
    if "seasonTotals" in data and isinstance(data["seasonTotals"], list):
        for season_data in reversed(data["seasonTotals"]):  # Start from most recent
            season_id = season_data.get("season", 0)
            season_start = season_id // 10000 if season_id > 0 else 0
            if season_start == SEASON:
                target_season_data = season_data
                break
    
    if target_season_data:
        print(f"   Found 2025-2026 season:")
        print(f"   Games: {target_season_data.get('gamesPlayed', 0)}")
        print(f"   Goals: {target_season_data.get('goals', 0)}")
        print(f"   Assists: {target_season_data.get('assists', 0)}")
        print(f"   Points: {target_season_data.get('points', 0)}")
        print(f"   Shots: {target_season_data.get('shots', 0)}")
        print(f"   PPP: {target_season_data.get('powerPlayPoints', 0)}")
        print(f"   SHP: {target_season_data.get('shorthandedPoints', 0)}")
    else:
        print("   NOT FOUND in seasonTotals array!")
        print("   Checking featuredStats season...")
        if "featuredStats" in data:
            featured = data["featuredStats"]
            season_id = featured.get("season", 0)
            season_start = season_id // 10000 if season_id > 0 else 0
            if season_start == SEASON:
                print("   featuredStats IS the 2025-2026 season")
            else:
                print(f"   featuredStats is season {season_start}, not {SEASON}")
    
    print()
    print("=" * 80)
    print("COMPARISON:")
    print("=" * 80)
    if target_season_data:
        nhl_goals = target_season_data.get('goals', 0)
        nhl_assists = target_season_data.get('assists', 0)
        nhl_points = target_season_data.get('points', 0)
        nhl_shots = target_season_data.get('shots', 0)
        nhl_ppp = target_season_data.get('powerPlayPoints', 0)
        
        print(f"NHL.com says: {nhl_goals}G + {nhl_assists}A = {nhl_points}P, {nhl_shots} SOG, {nhl_ppp} PPP")
        print(f"Our database: 31G + 58A = 89P, 198 SOG, 37 PPP")
        print()
        print(f"Difference: {nhl_goals - 31} goals, {nhl_assists - 58} assists, {nhl_points - 89} points")
        print(f"            {nhl_shots - 198} shots, {nhl_ppp - 37} PPP")
    
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
