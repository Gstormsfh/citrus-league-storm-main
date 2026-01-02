#!/usr/bin/env python3
"""Test what the extraction function actually returns"""

import requests
from scrape_per_game_nhl_stats import extract_player_stats_from_boxscore

# Use the game we know works
game_id = 2025020560
url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
response = requests.get(url, timeout=10)
boxscore = response.json()

player_stats = extract_player_stats_from_boxscore(boxscore)

print(f"Extracted stats for {len(player_stats)} players")
print("\nFirst 3 skaters:")
count = 0
for player_id, stats in player_stats.items():
    if not stats.get("_is_goalie", False):
        print(f"\nPlayer {player_id}:")
        print(f"  nhl_shots_on_goal: {stats.get('nhl_shots_on_goal', 'NOT FOUND')}")
        print(f"  nhl_goals: {stats.get('nhl_goals', 'NOT FOUND')}")
        print(f"  nhl_assists: {stats.get('nhl_assists', 'NOT FOUND')}")
        count += 1
        if count >= 3:
            break

