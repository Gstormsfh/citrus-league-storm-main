#!/usr/bin/env python3
"""Check why SOG updates aren't persisting"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Check the specific player we know should have SOG=1
test_game_id = 2025020560
test_player_id = 8476458

print(f"Checking player {test_player_id} in game {test_game_id}...")

player = db.select("player_game_stats",
                  "player_id,nhl_shots_on_goal,nhl_goals,nhl_assists,updated_at",
                  filters=[("game_id", "eq", test_game_id), ("player_id", "eq", test_player_id)],
                  limit=1)

if player:
    p = player[0]
    print(f"  SOG: {p.get('nhl_shots_on_goal', 0)}")
    print(f"  Goals: {p.get('nhl_goals', 0)}")
    print(f"  Assists: {p.get('nhl_assists', 0)}")
    print(f"  Updated: {p.get('updated_at', 'N/A')}")
else:
    print("  Player not found")

# Check if maybe there's a data type issue or the update is being filtered
print("\nChecking if update method works with explicit SOG value...")
try:
    # Try a direct update
    db.update("player_game_stats",
             {"nhl_shots_on_goal": 1},
             filters=[("season", "eq", 2025), ("game_id", "eq", test_game_id), ("player_id", "eq", test_player_id)])
    print("  Direct update call completed")
    
    # Check if it worked
    updated = db.select("player_game_stats",
                       "nhl_shots_on_goal",
                       filters=[("game_id", "eq", test_game_id), ("player_id", "eq", test_player_id)],
                       limit=1)
    if updated:
        print(f"  After direct update, SOG: {updated[0].get('nhl_shots_on_goal', 0)}")
except Exception as e:
    print(f"  Error: {e}")
    import traceback
    traceback.print_exc()

# Check how many total records have SOG > 0 now
print("\nChecking total records with SOG > 0...")
all_with_sog = db.select("player_game_stats",
                         "game_id,player_id,nhl_shots_on_goal",
                         filters=[("is_goalie", "eq", False), ("nhl_shots_on_goal", "gt", 0)],
                         limit=10)

print(f"  Found {len(all_with_sog)} records with SOG > 0:")
for r in all_with_sog[:5]:
    print(f"    Game {r['game_id']}, Player {r['player_id']}: SOG={r.get('nhl_shots_on_goal', 0)}")

