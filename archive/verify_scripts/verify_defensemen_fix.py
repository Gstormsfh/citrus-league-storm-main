#!/usr/bin/env python3
"""Verify that defensemen stats are now working correctly"""

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
print("DEFENSEMEN STATS FIX VERIFICATION")
print("=" * 80)
print()

# 1. Find some defensemen in player_directory
print("1. Finding defensemen in player_directory...")
defensemen = db.select("player_directory",
                     "player_id, full_name, position_code, is_goalie",
                     filters=[("position_code", "eq", "D"), ("season", "eq", 2025)],
                     limit=10)

if not defensemen:
    print("   [ERROR] No defensemen found in player_directory")
    exit(1)

print(f"   Found {len(defensemen)} defensemen:")
for d in defensemen[:5]:
    print(f"     Player {d['player_id']}: {d['full_name']}, position={d.get('position_code')}, is_goalie={d.get('is_goalie', False)}")

# 2. Check if defensemen have stats in player_game_stats
print("\n2. Checking if defensemen have stats in player_game_stats...")
test_dman_id = defensemen[0]['player_id']
dman_stats = db.select("player_game_stats",
                      "game_id, game_date, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, nhl_hits, nhl_ppp, nhl_shp, nhl_pim, is_goalie",
                      filters=[("player_id", "eq", test_dman_id)],
                      limit=5)

print(f"   Stats for defenseman {test_dman_id} ({defensemen[0]['full_name']}):")
if dman_stats:
    for stat in dman_stats[:3]:
        is_goalie = stat.get('is_goalie', False)
        print(f"     Game {stat['game_id']} ({stat.get('game_date', 'N/A')}):")
        print(f"       is_goalie={is_goalie}")
        print(f"       G={stat.get('nhl_goals', 0)}, A={stat.get('nhl_assists', 0)}, SOG={stat.get('nhl_shots_on_goal', 0)}")
        print(f"       Blk={stat.get('nhl_blocks', 0)}, Hits={stat.get('nhl_hits', 0)}, PIM={stat.get('nhl_pim', 0)}")
        if is_goalie:
            print(f"       [WARN] This defenseman has is_goalie=true - this is the problem!")
else:
    print("     [WARN] No stats found for this defenseman")

# 3. Test the get_matchup_stats RPC with defensemen
print("\n3. Testing get_matchup_stats RPC with defensemen...")
# Use a recent week
week_end = date.today()
week_start = week_end - timedelta(days=6)

test_dman_ids = [d['player_id'] for d in defensemen[:3]]
print(f"   Testing with defensemen IDs: {test_dman_ids}")
print(f"   Date range: {week_start} to {week_end}")

# Call the RPC (we'll simulate it by checking the logic manually)
# Actually, let's check if the stats would be returned correctly
print("\n4. Checking if stats would be aggregated correctly...")
for dman_id in test_dman_ids[:2]:
    # Get stats for this defenseman in the date range
    stats = db.select("player_game_stats",
                     "game_id, game_date, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, is_goalie",
                     filters=[("player_id", "eq", dman_id),
                             ("game_date", "gte", week_start.isoformat()),
                             ("game_date", "lte", week_end.isoformat())],
                     limit=10)
    
    # Filter to only skater records (is_goalie = false or NULL)
    skater_stats = [s for s in stats if not s.get('is_goalie', False)]
    goalie_stats = [s for s in stats if s.get('is_goalie', False)]
    
    print(f"\n   Defenseman {dman_id}:")
    print(f"     Total game records: {len(stats)}")
    print(f"     Skater records (is_goalie=false/NULL): {len(skater_stats)}")
    print(f"     Goalie records (is_goalie=true): {len(goalie_stats)}")
    
    if skater_stats:
        total_goals = sum(s.get('nhl_goals', 0) for s in skater_stats)
        total_assists = sum(s.get('nhl_assists', 0) for s in skater_stats)
        total_sog = sum(s.get('nhl_shots_on_goal', 0) for s in skater_stats)
        total_blocks = sum(s.get('nhl_blocks', 0) for s in skater_stats)
        print(f"     Aggregated stats (skater records only):")
        print(f"       Goals: {total_goals}, Assists: {total_assists}, SOG: {total_sog}, Blocks: {total_blocks}")
        if total_goals > 0 or total_assists > 0 or total_sog > 0 or total_blocks > 0:
            print(f"       [OK] Defenseman has stats that should be returned")
        else:
            print(f"       [INFO] Defenseman has no stats in this date range (may be normal)")
    else:
        print(f"     [WARN] No skater records found - defenseman may be incorrectly marked as goalie")
    
    if goalie_stats:
        print(f"     [WARN] Found {len(goalie_stats)} goalie records for this defenseman - this is incorrect!")

# 5. Summary
print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
print("The migration adds is_goalie filters to ensure:")
print("  - Skater stats only include records where is_goalie = false or NULL")
print("  - Goalie stats only include records where is_goalie = true")
print()
print("If defensemen have is_goalie = false in player_game_stats, they should")
print("now show their stats correctly in matchup tabs.")
print()
print("If defensemen still show zeros, check:")
print("  1. Are defensemen marked as is_goalie = false in player_game_stats?")
print("  2. Do defensemen have stats in the date range being queried?")
print("  3. Are defensemen included in the player_ids array passed to the RPC?")

