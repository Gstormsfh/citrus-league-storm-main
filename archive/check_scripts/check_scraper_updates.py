#!/usr/bin/env python3
"""Check if scraper is actually updating defensemen records"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from datetime import date, timedelta

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("CHECKING SCRAPER UPDATE STATUS")
print("=" * 80)
print()

# Check a specific game that should have defensemen
test_game_id = 2025020515  # The game we tested earlier

print(f"1. Checking game {test_game_id}...")
game_stats = db.select("player_game_stats",
                       "player_id, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, is_goalie, updated_at",
                       filters=[("game_id", "eq", test_game_id)],
                       limit=50)

# Get positions for these players
print(f"   Found {len(game_stats)} player records in this game")
print()

# Check defensemen specifically
dmen_in_game = []
for stat in game_stats:
    if stat.get('is_goalie', False):
        continue
    player_dir = db.select("player_directory",
                          "position_code",
                          filters=[("player_id", "eq", stat['player_id']), ("season", "eq", 2025)],
                          limit=1)
    if player_dir and player_dir[0].get('position_code') == 'D':
        stat['position_code'] = 'D'
        dmen_in_game.append(stat)

print(f"   Defensemen in this game: {len(dmen_in_game)}")
if dmen_in_game:
    print("\n   Defensemen stats:")
    for dman in dmen_in_game[:5]:
        print(f"     Player {dman['player_id']}: G={dman.get('nhl_goals', 0)}, A={dman.get('nhl_assists', 0)}, SOG={dman.get('nhl_shots_on_goal', 0)}, Blk={dman.get('nhl_blocks', 0)}")
        print(f"       Updated: {dman.get('updated_at', 'N/A')}")

# Check forwards for comparison
fwd_in_game = []
for stat in game_stats:
    if stat.get('is_goalie', False):
        continue
    player_dir = db.select("player_directory",
                          "position_code",
                          filters=[("player_id", "eq", stat['player_id']), ("season", "eq", 2025)],
                          limit=1)
    if player_dir and player_dir[0].get('position_code') in ['C', 'LW', 'RW']:
        fwd_in_game.append(stat)

print(f"\n   Forwards in this game: {len(fwd_in_game)}")
if fwd_in_game:
    fwd_with_stats = [f for f in fwd_in_game if f.get('nhl_goals', 0) > 0 or f.get('nhl_shots_on_goal', 0) > 0]
    print(f"   Forwards with stats > 0: {len(fwd_with_stats)}")

print("\n" + "=" * 80)
print("DIAGNOSIS")
print("=" * 80)
if len(dmen_in_game) > 0:
    dmen_with_stats = [d for d in dmen_in_game if d.get('nhl_goals', 0) > 0 or d.get('nhl_shots_on_goal', 0) > 0]
    if len(dmen_with_stats) == 0:
        print("[ISSUE] Defensemen records exist but have no stats")
        print("        This means the scraper either:")
        print("        1. Didn't run for this game after the fix")
        print("        2. Ran but didn't find defensemen (API issue)")
        print("        3. Ran but failed to update these records")
        print()
        print("        SOLUTION: Re-run scraper for this specific game or date range")
    else:
        print(f"[OK] {len(dmen_with_stats)} defensemen have stats in this game")
else:
    print("[WARN] No defensemen found in this game (check if game has defensemen)")

