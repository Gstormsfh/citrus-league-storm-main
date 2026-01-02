#!/usr/bin/env python3
"""
Diagnostic script to check what position group names the NHL boxscore API actually uses
"""

import requests
import json

# Use the game ID you provided
test_game_id = 2025020515

url = f"https://api-web.nhle.com/v1/gamecenter/{test_game_id}/boxscore"

print("=" * 80)
print("NHL BOXSCORE API STRUCTURE INSPECTION")
print("=" * 80)
print(f"Game ID: {test_game_id}")
print(f"URL: {url}")
print()

try:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    boxscore = response.json()
    
    print("[OK] Successfully fetched boxscore")
    print()
    
    if "playerByGameStats" not in boxscore:
        print("[ERROR] No playerByGameStats found")
        print(f"Available top-level keys: {list(boxscore.keys())}")
        exit(1)
    
    player_stats = boxscore["playerByGameStats"]
    print("playerByGameStats keys:", list(player_stats.keys()))
    print()
    
    # Check both home and away teams
    for team_key in ["homeTeam", "awayTeam"]:
        if team_key not in player_stats:
            continue
        
        team_data = player_stats[team_key]
        print(f"\n{team_key.upper()} structure:")
        print(f"  All keys: {list(team_data.keys())}")
        print()
        
        # Check for various possible defensemen field names
        possible_defense_keys = ["defensemen", "defense", "defencemen", "defence", "dmen", "defenders"]
        
        found_defense_key = None
        for key in possible_defense_keys:
            if key in team_data:
                found_defense_key = key
                print(f"  [FOUND] '{key}' exists!")
                players = team_data[key]
                if isinstance(players, list):
                    print(f"     Type: list with {len(players)} players")
                    if len(players) > 0:
                        sample = players[0]
                        print(f"     Sample player keys: {list(sample.keys())[:15]}")
                        print(f"     Sample playerId: {sample.get('playerId')}")
                        print(f"     Sample position: {sample.get('position')}")
                        print(f"     Sample goals: {sample.get('goals', 0)}")
                        print(f"     Sample assists: {sample.get('assists', 0)}")
                        print(f"     Sample sog: {sample.get('sog', 0)}")
                        print(f"     Sample hits: {sample.get('hits', 0)}")
                        print(f"     Sample blocks: {sample.get('blocks', 0)}")
                else:
                    print(f"     Type: {type(players)}")
                print()
        
        if not found_defense_key:
            print(f"  [ERROR] NONE of these keys found: {possible_defense_keys}")
            print(f"  Available keys are: {list(team_data.keys())}")
            print()
        
        # Also check forwards for comparison
        if "forwards" in team_data:
            forwards = team_data["forwards"]
            print(f"  Forwards: {len(forwards) if isinstance(forwards, list) else 'N/A'} players")
            if isinstance(forwards, list) and len(forwards) > 0:
                fwd_sample = forwards[0]
                print(f"     Sample forward playerId: {fwd_sample.get('playerId')}")
                print(f"     Sample forward goals: {fwd_sample.get('goals', 0)}")
                print(f"     Sample forward sog: {fwd_sample.get('sog', 0)}")
        
        # Check goalies for comparison
        if "goalies" in team_data:
            goalies = team_data["goalies"]
            print(f"  Goalies: {len(goalies) if isinstance(goalies, list) else 'N/A'} players")
    
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print("Look for the key that contains defensemen players above.")
    print("The scraper currently looks for: 'defensemen'")
    print("If a different key is found, update the scraper accordingly.")
    
except Exception as e:
    print(f"[ERROR] Error: {e}")
    import traceback
    traceback.print_exc()

