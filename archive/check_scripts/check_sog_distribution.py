#!/usr/bin/env python3
"""Check SOG distribution for the game we just updated"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

game_id = 2025020560

# Get all skaters from this game
players = db.select("player_game_stats", select="player_id,nhl_shots_on_goal,is_goalie", filters=[("game_id", "eq", game_id), ("is_goalie", "eq", False)])

print(f"Game {game_id} - Skater SOG Distribution:")
print(f"Total skaters: {len(players)}")

sog_counts = {}
for p in players:
    sog = p.get('nhl_shots_on_goal', 0)
    sog_counts[sog] = sog_counts.get(sog, 0) + 1

print(f"\nSOG Distribution:")
for sog in sorted(sog_counts.keys()):
    count = sog_counts[sog]
    print(f"  {sog} shots: {count} players")

players_with_sog = sum(1 for p in players if p.get('nhl_shots_on_goal', 0) > 0)
print(f"\nPlayers with SOG > 0: {players_with_sog} out of {len(players)}")

# Show some examples
print(f"\nSample players with SOG:")
count = 0
for p in players:
    if p.get('nhl_shots_on_goal', 0) > 0:
        print(f"  Player {p['player_id']}: {p.get('nhl_shots_on_goal', 0)} SOG")
        count += 1
        if count >= 10:
            break

