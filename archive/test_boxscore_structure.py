#!/usr/bin/env python3
"""
Quick test to see the structure of NHL gamecenter boxscore
"""

import requests
import json
from datetime import date, timedelta

# Get a recent game ID (today or yesterday)
today = date.today()
yesterday = today - timedelta(days=1)

# Test with a known game ID (you can replace this with an actual game ID from your database)
# For now, let's try to fetch a recent game
test_game_id = 2025020123  # Example - replace with actual game ID

url = f"https://api-web.nhle.com/v1/gamecenter/{test_game_id}/boxscore"

print(f"Testing boxscore endpoint: {url}")
print()

try:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    boxscore = response.json()
    
    print("✅ Successfully fetched boxscore")
    print(f"Top-level keys: {list(boxscore.keys())}")
    print()
    
    if "playerByGameStats" in boxscore:
        print("Found playerByGameStats")
        player_stats = boxscore["playerByGameStats"]
        print(f"  Keys: {list(player_stats.keys())}")
        print()
        
        # Check home team
        if "homeTeam" in player_stats:
            home_team = player_stats["homeTeam"]
            print("Home Team structure:")
            print(f"  Keys: {list(home_team.keys())}")
            
            # Check forwards
            if "forwards" in home_team and isinstance(home_team["forwards"], list) and len(home_team["forwards"]) > 0:
                sample_forward = home_team["forwards"][0]
                print(f"\n  Sample Forward Player Keys: {list(sample_forward.keys())}")
                print(f"  Sample Forward Data: {json.dumps(sample_forward, indent=2)[:500]}")
            
            # Check defensemen
            if "defensemen" in home_team and isinstance(home_team["defensemen"], list) and len(home_team["defensemen"]) > 0:
                sample_dman = home_team["defensemen"][0]
                print(f"\n  Sample Defenseman Player Keys: {list(sample_dman.keys())}")
            
            # Check goalies
            if "goalies" in home_team and isinstance(home_team["goalies"], list) and len(home_team["goalies"]) > 0:
                sample_goalie = home_team["goalies"][0]
                print(f"\n  Sample Goalie Player Keys: {list(sample_goalie.keys())}")
                print(f"  Sample Goalie Data: {json.dumps(sample_goalie, indent=2)[:500]}")
    else:
        print("❌ No playerByGameStats found")
        print(f"Available keys: {list(boxscore.keys())}")
        
except Exception as e:
    print(f"❌ Error: {e}")
    print("\nNote: You may need to replace test_game_id with an actual game ID from your database")
