#!/usr/bin/env python3
"""Check if SOG was extracted for a specific game"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Check the games we just scraped
game_id = 2025020001
players = db.select("player_game_stats", select="player_id,nhl_shots_on_goal,is_goalie", filters=[("game_id", "eq", game_id), ("is_goalie", "eq", False)], limit=10)

print(f"Players from game {game_id}:")
for p in players:
    print(f"  Player {p['player_id']}: SOG = {p.get('nhl_shots_on_goal', 0)}")

# Also check a game we know has data (the one we tested earlier)
test_game_id = 2025020560
test_players = db.select("player_game_stats", select="player_id,nhl_shots_on_goal,is_goalie", filters=[("game_id", "eq", test_game_id), ("is_goalie", "eq", False)], limit=5)

print(f"\nPlayers from test game {test_game_id} (should have SOG):")
for p in test_players:
    print(f"  Player {p['player_id']}: SOG = {p.get('nhl_shots_on_goal', 0)}")

