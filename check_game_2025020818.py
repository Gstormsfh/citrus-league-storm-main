#!/usr/bin/env python3
"""
Check Game 2025020818 in detail - this is the game with missing stats
"""

import os
import sys
import requests
import json
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
PLAYER_ID = 8478402
GAME_ID = 2025020818
SEASON = 2025  # 2025-2026 season

print("=" * 80)
print(f"DETAILED CHECK: GAME {GAME_ID} - 2026-01-24")
print("=" * 80)
print()

# Get our database record
print("1. OUR DATABASE RECORD:")
print("-" * 80)
our_record = db.select(
    "player_game_stats",
    select="*",
    filters=[
        ("player_id", "eq", PLAYER_ID),
        ("game_id", "eq", GAME_ID),
        ("season", "eq", SEASON)
    ],
    limit=1
)

if our_record and len(our_record) > 0:
    r = our_record[0]
    print(f"   Goals: {r.get('nhl_goals', 0)}")
    print(f"   Assists: {r.get('nhl_assists', 0)}")
    print(f"   Points: {r.get('nhl_points', 0)}")
    print(f"   Shots: {r.get('nhl_shots_on_goal', 0)}")
    print(f"   PPP: {r.get('nhl_ppp', 0)}")
    print(f"   PPG: {r.get('nhl_ppg', 0)}")
    print(f"   Updated: {r.get('updated_at', 'N/A')}")
else:
    print("   NO RECORD FOUND!")

# Get NHL API boxscore
print()
print("2. NHL API BOXSCORE:")
print("-" * 80)
url = f"https://api-web.nhle.com/v1/gamecenter/{GAME_ID}/boxscore"
response = requests.get(url, timeout=10)
if response.status_code == 200:
    boxscore = response.json()
    
    # Find McDavid
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
                    print(f"   Team: {team_key}, Position: {position_group}")
                    print(f"   Goals: {player_stat.get('goals', 0)}")
                    print(f"   Assists: {player_stat.get('assists', 0)}")
                    print(f"   Points: {player_stat.get('points', 0)}")
                    print(f"   Shots (sog): {player_stat.get('sog', 0)}")
                    print(f"   Power Play Goals: {player_stat.get('powerPlayGoals', 0)}")
                    print(f"   Shorthanded Goals: {player_stat.get('shorthandedGoals', 0)}")
                    print()
                    print("   Full player stat object:")
                    print(json.dumps(player_stat, indent=2))
                    break
            if found:
                break
        if found:
            break
    
    if not found:
        print("   McDavid not found in boxscore")

print()
print("=" * 80)
print("SUMMARY:")
print("=" * 80)
if our_record and len(our_record) > 0 and response.status_code == 200:
    r = our_record[0]
    our_goals = r.get('nhl_goals', 0) or 0
    our_shots = r.get('nhl_shots_on_goal', 0) or 0
    
    # Extract from boxscore
    api_goals = 0
    api_shots = 0
    player_stats = boxscore.get("playerByGameStats", {})
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
                    api_goals = player_stat.get("goals", 0) or 0
                    api_shots = player_stat.get("sog", 0) or 0
                    break
            if api_goals > 0 or api_shots > 0:
                break
        if api_goals > 0 or api_shots > 0:
            break
    
    print(f"   Our DB:  {our_goals} goals, {our_shots} shots")
    print(f"   NHL API: {api_goals} goals, {api_shots} shots")
    print(f"   Missing: {api_goals - our_goals} goals, {api_shots - our_shots} shots")
    print()
    print("   THIS IS THE BUG - Our database has wrong stats for this game!")
