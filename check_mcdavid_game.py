#!/usr/bin/env python3
"""
Check specific McDavid game that has zero stats
Game ID: 2025020139
Date: 2025-10-25
"""

import os
import sys
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
PLAYER_ID = 8478402
GAME_ID = 2025020139
SEASON = 2025  # 2025-2026 season

print("=" * 80)
print(f"CHECKING GAME {GAME_ID} - 2025-10-25")
print("=" * 80)
print()

# Check our database
print("1. OUR DATABASE RECORD:")
print("-" * 80)
game_stats = db.select(
    "player_game_stats",
    select="*",
    filters=[
        ("player_id", "eq", PLAYER_ID),
        ("game_id", "eq", GAME_ID),
        ("season", "eq", SEASON)
    ],
    limit=1
)

if game_stats and len(game_stats) > 0:
    g = game_stats[0]
    print(f"   Game ID: {g.get('game_id')}")
    print(f"   Date: {g.get('game_date')}")
    print(f"   Goals: {g.get('nhl_goals', 0)}")
    print(f"   Assists: {g.get('nhl_assists', 0)}")
    print(f"   Points: {g.get('nhl_points', 0)}")
    print(f"   Shots: {g.get('nhl_shots_on_goal', 0)}")
    print(f"   Updated: {g.get('updated_at', 'N/A')}")
else:
    print("   NO RECORD FOUND in player_game_stats!")

# Check if game exists in nhl_games
print()
print("2. GAME INFO (nhl_games table):")
print("-" * 80)
game_info = db.select(
    "nhl_games",
    select="*",
    filters=[("game_id", "eq", GAME_ID)],
    limit=1
)

if game_info and len(game_info) > 0:
    gi = game_info[0]
    print(f"   Game ID: {gi.get('game_id')}")
    print(f"   Date: {gi.get('game_date')}")
    print(f"   Home: {gi.get('home_team')}")
    print(f"   Away: {gi.get('away_team')}")
    print(f"   Status: {gi.get('status')}")
else:
    print("   Game not found in nhl_games table")

# Try to fetch from NHL API
print()
print("3. NHL API BOXSCORE:")
print("-" * 80)
try:
    url = f"https://api-web.nhle.com/v1/gamecenter/{GAME_ID}/boxscore"
    response = requests.get(url, timeout=10)
    if response.status_code == 200:
        boxscore = response.json()
        
        # Find McDavid in the boxscore
        player_stats = boxscore.get("playerByGameStats", {})
        found = False
        
        for team_key in ["homeTeam", "awayTeam"]:
            if team_key not in player_stats:
                continue
            team_data = player_stats[team_key]
            for position_group in ["forwards", "defense", "goalies"]:
                if position_group not in team_data:
                    continue
                players = team_data[position_group]
                for player_stat in players:
                    if player_stat.get("playerId") == PLAYER_ID:
                        found = True
                        print(f"   Found McDavid in {team_key} {position_group}:")
                        print(f"   Goals: {player_stat.get('goals', 0)}")
                        print(f"   Assists: {player_stat.get('assists', 0)}")
                        print(f"   Points: {player_stat.get('points', 0)}")
                        print(f"   Shots (sog): {player_stat.get('sog', 0)}")
                        print(f"   Power Play Goals: {player_stat.get('powerPlayGoals', 0)}")
                        break
                if found:
                    break
            if found:
                break
        
        if not found:
            print("   McDavid not found in boxscore (might not have played?)")
    else:
        print(f"   API returned status {response.status_code}")
except Exception as e:
    print(f"   Error fetching from API: {e}")

print()
print("=" * 80)
