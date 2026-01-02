#!/usr/bin/env python3
"""Test the full scrape flow for one game"""

import os
import sys
from datetime import date
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from scrape_per_game_nhl_stats import fetch_game_boxscore, extract_player_stats_from_boxscore, update_player_game_stats_nhl_columns

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Use the game we know works
game_id = 2025020560
print(f"Testing game {game_id}")

# Fetch boxscore
boxscore = fetch_game_boxscore(game_id)
if not boxscore:
    print("Failed to fetch boxscore")
    sys.exit(1)

# Extract stats
player_stats = extract_player_stats_from_boxscore(boxscore)
print(f"Extracted {len(player_stats)} players")

# Show what we extracted for first skater
for pid, stats in list(player_stats.items())[:3]:
    if not stats.get("_is_goalie"):
        print(f"  Player {pid}: SOG={stats.get('nhl_shots_on_goal')}, Goals={stats.get('nhl_goals')}")

# Update database
print("\nUpdating database...")
result = update_player_game_stats_nhl_columns(db, game_id, date(2024, 12, 10), player_stats, 2025)
print(f"Result: {result}")

# Verify
print("\nVerifying update...")
test_player = 8476458  # Player we know has SOG=1
updated = db.select("player_game_stats", select="nhl_shots_on_goal", filters=[("game_id", "eq", game_id), ("player_id", "eq", test_player)], limit=1)
print(f"Player {test_player} SOG after update: {updated[0].get('nhl_shots_on_goal') if updated else 'NOT FOUND'}")

