#!/usr/bin/env python3
"""Check the actual dates of games with SOG"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Get games with SOG without date filter
print("Games with SOG > 0 (no date filter):")
games_with_sog = db.select("player_game_stats",
                          "game_id,game_date,nhl_shots_on_goal",
                          filters=[("is_goalie", "eq", False), ("nhl_shots_on_goal", "gt", 0)],
                          limit=20)

# Group by game
from collections import defaultdict
game_info = defaultdict(lambda: {"total": 0, "with_sog": 0, "date": None})
for r in games_with_sog:
    game_id = r.get('game_id')
    game_info[game_id]["total"] += 1
    if r.get('nhl_shots_on_goal', 0) > 0:
        game_info[game_id]["with_sog"] += 1
    if not game_info[game_id]["date"]:
        game_info[game_id]["date"] = r.get('game_date')

print(f"Found {len(game_info)} unique games with SOG:")
for game_id in sorted(list(game_info.keys()))[:10]:
    info = game_info[game_id]
    print(f"  Game {game_id}: Date={info['date']}, {info['with_sog']} players with SOG")

# Check total count without date filter
print("\nTotal records with SOG > 0 (no date filter):")
all_with_sog = db.select("player_game_stats",
                         "game_id",
                         filters=[("is_goalie", "eq", False), ("nhl_shots_on_goal", "gt", 0)],
                         limit=1)
# This will only tell us if any exist, not the count
# Let's count manually
count = 0
offset = 0
while True:
    batch = db.select("player_game_stats",
                     "game_id",
                     filters=[("is_goalie", "eq", False), ("nhl_shots_on_goal", "gt", 0)],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    count += len(batch)
    if len(batch) < 1000:
        break
    offset += 1000

print(f"  Total player records with SOG > 0: {count:,}")

