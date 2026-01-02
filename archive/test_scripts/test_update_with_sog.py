#!/usr/bin/env python3
"""Test if update actually includes SOG in the update_data"""

import os
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

# Test with the game we know works
test_game_id = 2025020560
print(f"Testing update for game {test_game_id}...")

boxscore = fetch_game_boxscore(test_game_id)
player_stats = extract_player_stats_from_boxscore(boxscore)

# Check what's in the stats dict before update
print("\nStats dict contents for first skater:")
for pid, stats in list(player_stats.items())[:1]:
    if not stats.get("_is_goalie"):
        print(f"  Player {pid}:")
        print(f"    nhl_shots_on_goal: {stats.get('nhl_shots_on_goal', 'NOT FOUND')}")
        print(f"    nhl_goals: {stats.get('nhl_goals', 'NOT FOUND')}")
        print(f"    All keys: {sorted([k for k in stats.keys() if k.startswith('nhl_')])}")
        
        # Simulate what update_player_game_stats_nhl_columns does
        is_goalie = stats.pop("_is_goalie", False)
        team_abbrev = stats.pop("_team_abbrev", "")
        position_code = stats.pop("_position_code", "F")
        
        print(f"\n  After popping metadata:")
        print(f"    nhl_shots_on_goal: {stats.get('nhl_shots_on_goal', 'NOT FOUND')}")
        print(f"    All keys: {sorted([k for k in stats.keys() if k.startswith('nhl_')])}")
        
        # Check what update_data would contain
        update_data = {**stats}
        print(f"\n  Update data would contain:")
        print(f"    nhl_shots_on_goal: {update_data.get('nhl_shots_on_goal', 'NOT FOUND')}")
        break

# Now actually try the update
print("\nAttempting actual update...")
result = update_player_game_stats_nhl_columns(db, test_game_id, date(2024, 12, 10), player_stats, 2025)
print(f"Update result: {result}")

# Check if it worked
print("\nChecking database after update...")
updated = db.select("player_game_stats",
                   "player_id,nhl_shots_on_goal",
                   filters=[("game_id", "eq", test_game_id), ("is_goalie", "eq", False)],
                   limit=5)

for p in updated:
    print(f"  Player {p['player_id']}: SOG={p.get('nhl_shots_on_goal', 0)}")

