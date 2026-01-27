#!/usr/bin/env python3
"""
Check ALL McDavid games for stat mismatches
Find every game where our stats don't match NHL API
"""

import os
import sys
import requests
import time
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
PLAYER_ID = 8478402
SEASON = 2025  # 2025-2026 season

print("=" * 80)
print("CHECKING ALL MCDAVID GAMES FOR STAT MISMATCHES")
print("=" * 80)
print()

# Get all our games
print("Getting all games from database...")
our_games = db.select(
    "player_game_stats",
    select="game_id,game_date,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,nhl_ppg",
    filters=[
        ("player_id", "eq", PLAYER_ID),
        ("season", "eq", SEASON),
        ("is_goalie", "eq", False)
    ],
    limit=10000
)

print(f"Found {len(our_games)} games")
print(f"Checking each game against NHL API (this will take ~1 minute)...")
print()

mismatches = []
checked = 0
errors = 0

for our_game in sorted(our_games, key=lambda x: x.get("game_date", "")):
    game_id = our_game.get("game_id")
    game_date = our_game.get("game_date")
    our_goals = our_game.get("nhl_goals", 0) or 0
    our_assists = our_game.get("nhl_assists", 0) or 0
    our_points = our_game.get("nhl_points", 0) or 0
    our_shots = our_game.get("nhl_shots_on_goal", 0) or 0
    
    # Fetch from NHL API
    try:
        url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            boxscore = response.json()
            player_stats = boxscore.get("playerByGameStats", {})
            
            api_goals = None
            api_assists = None
            api_points = None
            api_shots = None
            
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
                            api_assists = player_stat.get("assists", 0) or 0
                            api_points = player_stat.get("points", 0) or 0
                            api_shots = player_stat.get("sog", 0) or 0
                            break
                    if api_goals is not None:
                        break
                if api_goals is not None:
                    break
            
            if api_goals is not None:
                if (api_goals != our_goals or 
                    api_assists != our_assists or 
                    api_points != our_points or 
                    api_shots != our_shots):
                    mismatches.append({
                        "game_id": game_id,
                        "date": game_date,
                        "our_goals": our_goals,
                        "api_goals": api_goals,
                        "our_assists": our_assists,
                        "api_assists": api_assists,
                        "our_points": our_points,
                        "api_points": api_points,
                        "our_shots": our_shots,
                        "api_shots": api_shots
                    })
            
            checked += 1
            if checked % 10 == 0:
                print(f"  Checked {checked}/{len(our_games)} games...")
            
            # Rate limiting
            time.sleep(0.3)
        else:
            errors += 1
    except Exception as e:
        print(f"  Error checking game {game_id}: {e}")
        errors += 1

print()
print("=" * 80)
print("RESULTS:")
print("=" * 80)
print(f"Games checked: {checked}")
print(f"Errors: {errors}")
print(f"Mismatches found: {len(mismatches)}")
print()

if mismatches:
    print("GAMES WITH STAT MISMATCHES:")
    print("-" * 80)
    
    total_goals_diff = 0
    total_assists_diff = 0
    total_points_diff = 0
    total_shots_diff = 0
    
    for m in mismatches:
        print(f"\nGame {m['game_id']} ({m['date']}):")
        
        if m['our_goals'] != m['api_goals']:
            diff = m['api_goals'] - m['our_goals']
            total_goals_diff += diff
            print(f"  Goals: We have {m['our_goals']}, API has {m['api_goals']} (DIFF: {diff:+d})")
        
        if m['our_assists'] != m['api_assists']:
            diff = m['api_assists'] - m['our_assists']
            total_assists_diff += diff
            print(f"  Assists: We have {m['our_assists']}, API has {m['api_assists']} (DIFF: {diff:+d})")
        
        if m['our_points'] != m['api_points']:
            diff = m['api_points'] - m['our_points']
            total_points_diff += diff
            print(f"  Points: We have {m['our_points']}, API has {m['api_points']} (DIFF: {diff:+d})")
        
        if m['our_shots'] != m['api_shots']:
            diff = m['api_shots'] - m['our_shots']
            total_shots_diff += diff
            print(f"  Shots: We have {m['our_shots']}, API has {m['api_shots']} (DIFF: {diff:+d})")
    
    print()
    print("=" * 80)
    print("TOTAL DIFFERENCES:")
    print("=" * 80)
    print(f"Goals: {total_goals_diff:+d}")
    print(f"Assists: {total_assists_diff:+d}")
    print(f"Points: {total_points_diff:+d}")
    print(f"Shots: {total_shots_diff:+d}")
    print()
    print(f"Expected from NHL.com: 1 goal, 0 assists, 1 point, 2 shots")
    print(f"Match: {total_goals_diff == 1 and total_assists_diff == 0 and total_points_diff == 1 and total_shots_diff == 2}")
else:
    print("No mismatches found!")

print()
print("=" * 80)
