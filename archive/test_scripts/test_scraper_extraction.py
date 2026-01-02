#!/usr/bin/env python3
"""Test what the scraper actually extracts for defensemen"""

import sys
import os
sys.path.insert(0, r"C:\Users\garre\Documents\citrus-league-storm-main")

from dotenv import load_dotenv
from scrape_per_game_nhl_stats import fetch_game_boxscore, extract_player_stats_from_boxscore

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

# Test with the game we know has defensemen
test_game_id = 2025020515

print("=" * 80)
print("TESTING SCRAPER EXTRACTION FOR DEFENSEMEN")
print("=" * 80)
print(f"Game ID: {test_game_id}")
print()

# Fetch boxscore
print("1. Fetching boxscore...")
boxscore = fetch_game_boxscore(test_game_id)
if not boxscore:
    print("   [ERROR] Failed to fetch boxscore")
    exit(1)
print("   [OK] Boxscore fetched")
print()

# Extract player stats
print("2. Extracting player stats...")
player_stats = extract_player_stats_from_boxscore(boxscore)
if not player_stats:
    print("   [ERROR] No player stats extracted")
    exit(1)

print(f"   [OK] Extracted {len(player_stats)} players")
print()

# Count by position
print("3. Analyzing extracted players...")
goalies = []
defensemen = []
forwards = []
unknown = []

for player_id, stats in player_stats.items():
    is_goalie = stats.get("_is_goalie", False)
    position_code = stats.get("_position_code", "?")
    
    if is_goalie:
        goalies.append((player_id, stats))
    elif position_code == "D":
        defensemen.append((player_id, stats))
    elif position_code in ["C", "LW", "RW", "L", "R"]:
        forwards.append((player_id, stats))
    else:
        unknown.append((player_id, stats, position_code))

print(f"   Goalies: {len(goalies)}")
print(f"   Defensemen: {len(defensemen)}")
print(f"   Forwards: {len(forwards)}")
print(f"   Unknown: {len(unknown)}")
print()

# Show defensemen stats
if defensemen:
    print("4. Defensemen extracted:")
    for player_id, stats in defensemen[:5]:
        print(f"   Player {player_id}:")
        print(f"     Goals: {stats.get('nhl_goals', 0)}")
        print(f"     Assists: {stats.get('nhl_assists', 0)}")
        print(f"     SOG: {stats.get('nhl_shots_on_goal', 0)}")
        print(f"     Blocks: {stats.get('nhl_blocks', 0)}")
        print(f"     Hits: {stats.get('nhl_hits', 0)}")
        print(f"     Position code: {stats.get('_position_code', '?')}")
        print()
else:
    print("4. [WARN] No defensemen found in extracted stats!")
    print("   This means the scraper is NOT finding defensemen in the API")
    print()

# Show forwards for comparison
if forwards:
    fwd_with_stats = [f for f in forwards if f[1].get('nhl_goals', 0) > 0 or f[1].get('nhl_shots_on_goal', 0) > 0]
    print(f"5. Forwards: {len(forwards)} total, {len(fwd_with_stats)} with stats > 0")
    if fwd_with_stats:
        print("   Sample forward with stats:")
        player_id, stats = fwd_with_stats[0]
        print(f"     Player {player_id}: G={stats.get('nhl_goals', 0)}, SOG={stats.get('nhl_shots_on_goal', 0)}")
    print()

print("=" * 80)
print("DIAGNOSIS")
print("=" * 80)
if len(defensemen) == 0:
    print("[CRITICAL] Scraper is NOT extracting defensemen from API")
    print("           This means the fix didn't work or there's another issue")
elif len(defensemen) > 0:
    dmen_with_stats = [d for d in defensemen if d[1].get('nhl_goals', 0) > 0 or d[1].get('nhl_shots_on_goal', 0) > 0]
    if len(dmen_with_stats) == 0:
        print("[WARN] Scraper IS extracting defensemen, but they have zero stats")
        print("       This could mean:")
        print("       1. Game hasn't been played yet (API returns empty stats)")
        print("       2. Defensemen actually had zero stats in this game")
    else:
        print(f"[OK] Scraper IS extracting defensemen with stats: {len(dmen_with_stats)}/{len(defensemen)}")

