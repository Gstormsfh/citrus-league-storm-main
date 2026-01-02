#!/usr/bin/env python3
"""Test what the scraper extracts for a recent game"""

import os
import requests
from dotenv import load_dotenv
from scrape_per_game_nhl_stats import fetch_game_boxscore, extract_player_stats_from_boxscore

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

# Test with a recent game
test_game_id = 2025020560
print(f"Testing extraction for game {test_game_id}...")

boxscore = fetch_game_boxscore(test_game_id)
if not boxscore:
    print("Failed to fetch boxscore")
    exit(1)

player_stats = extract_player_stats_from_boxscore(boxscore)
print(f"Extracted {len(player_stats)} players\n")

# Check SOG for first few skaters
print("First 5 skaters SOG values:")
count = 0
for pid, stats in player_stats.items():
    if not stats.get("_is_goalie"):
        sog = stats.get("nhl_shots_on_goal", "NOT FOUND")
        goals = stats.get("nhl_goals", 0)
        assists = stats.get("nhl_assists", 0)
        print(f"  Player {pid}: SOG={sog}, G={goals}, A={assists}")
        count += 1
        if count >= 5:
            break

# Also check the API directly
print("\nChecking API directly for first skater...")
if "playerByGameStats" in boxscore:
    for team_key in ["homeTeam", "awayTeam"]:
        if team_key in boxscore["playerByGameStats"]:
            team_data = boxscore["playerByGameStats"][team_key]
            for pos_group in ["forwards", "defensemen"]:
                if pos_group in team_data and team_data[pos_group]:
                    api_player = team_data[pos_group][0]
                    print(f"  API 'sog' field: {api_player.get('sog', 'NOT FOUND')}")
                    print(f"  API 'goals' field: {api_player.get('goals', 'NOT FOUND')}")
                    break
            break

