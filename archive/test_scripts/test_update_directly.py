#!/usr/bin/env python3
"""Test updating SOG directly"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Test updating a specific player's SOG
game_id = 2025020560
player_id = 8476458  # Player we know has SOG = 1

print(f"Testing update for player {player_id} in game {game_id}")

# Check current value
current = db.select("player_game_stats", select="nhl_shots_on_goal", filters=[("game_id", "eq", game_id), ("player_id", "eq", player_id)], limit=1)
print(f"Current SOG: {current[0].get('nhl_shots_on_goal') if current else 'NOT FOUND'}")

# Try to update
try:
    db.update(
        "player_game_stats",
        {"nhl_shots_on_goal": 1},
        filters=[
            ("season", "eq", 2025),
            ("game_id", "eq", game_id),
            ("player_id", "eq", player_id)
        ]
    )
    print("Update call completed")
    
    # Check if it worked
    updated = db.select("player_game_stats", select="nhl_shots_on_goal", filters=[("game_id", "eq", game_id), ("player_id", "eq", player_id)], limit=1)
    print(f"After update SOG: {updated[0].get('nhl_shots_on_goal') if updated else 'NOT FOUND'}")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

