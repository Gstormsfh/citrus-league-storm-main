#!/usr/bin/env python3
"""Check how position codes are extracted for defensemen"""

import requests
import json

test_game_id = 2025020515
url = f"https://api-web.nhle.com/v1/gamecenter/{test_game_id}/boxscore"

print("=" * 80)
print("CHECKING POSITION CODE EXTRACTION")
print("=" * 80)
print()

response = requests.get(url, timeout=10)
boxscore = response.json()

player_stats = boxscore.get("playerByGameStats", {})
for team_key in ["homeTeam", "awayTeam"]:
    if team_key not in player_stats:
        continue
    
    team_data = player_stats[team_key]
    if "defense" in team_data:
        defense_players = team_data["defense"]
        print(f"{team_key} defensemen:")
        for i, player in enumerate(defense_players[:3]):
            print(f"  Player {i+1}:")
            print(f"    playerId: {player.get('playerId')}")
            print(f"    position: {player.get('position')}")
            print(f"    name: {player.get('name', {}).get('default', 'N/A')}")
            print(f"    goals: {player.get('goals', 0)}")
            print(f"    assists: {player.get('assists', 0)}")
            print(f"    sog: {player.get('sog', 0)}")
            print(f"    All keys: {list(player.keys())[:10]}")
            print()

