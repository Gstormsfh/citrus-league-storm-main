#!/usr/bin/env python3
"""
Find which game has missing stats for McDavid
Compare our per-game data to find the missing goal/shots
"""

import os
import sys
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from collections import defaultdict

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
PLAYER_ID = 8478402
SEASON = 2025  # 2025-2026 season

print("=" * 80)
print("FINDING MISSING GAME - MCDAVID 2025-2026")
print("=" * 80)
print()

# Get all our games
print("1. Getting all games from our database...")
our_games = db.select(
    "player_game_stats",
    select="game_id,game_date,nhl_goals,nhl_assists,nhl_shots_on_goal",
    filters=[
        ("player_id", "eq", PLAYER_ID),
        ("season", "eq", SEASON),
        ("is_goalie", "eq", False)
    ],
    limit=10000
)

our_games_by_id = {g.get("game_id"): g for g in our_games}
print(f"   Found {len(our_games)} games in our database")
print()

# Get all Oilers games from nhl_games
print("2. Getting all Oilers games from nhl_games...")
oilers_games = db.select(
    "nhl_games",
    select="game_id,game_date,home_team,away_team,status",
    filters=[
        ("season", "eq", SEASON),
        ("status", "eq", "final")
    ],
    limit=10000
)

# Filter to games where Oilers played
oilers_game_ids = set()
for game in oilers_games:
    if game.get("home_team") == "EDM" or game.get("away_team") == "EDM":
        oilers_game_ids.add(game.get("game_id"))

print(f"   Found {len(oilers_game_ids)} Oilers games")
print()

# Check which games we're missing
print("3. Checking for missing games...")
missing_game_ids = oilers_game_ids - set(our_games_by_id.keys())
if missing_game_ids:
    print(f"   Found {len(missing_game_ids)} games where McDavid should have stats but doesn't:")
    for gid in sorted(missing_game_ids):
        game_info = next((g for g in oilers_games if g.get("game_id") == gid), None)
        if game_info:
            print(f"     Game {gid} on {game_info.get('game_date')} ({game_info.get('away_team')} @ {game_info.get('home_team')})")
else:
    print("   No missing games found - all Oilers games have records")
print()

# Now check each game's stats from NHL API vs our database
print("4. Checking games where our stats might be wrong...")
print("   (This will take a while, checking first 10 games with goals)...")
print()

games_with_goals = [g for g in our_games if (g.get("nhl_goals", 0) or 0) > 0]
games_to_check = sorted(games_with_goals, key=lambda x: x.get("game_date", ""), reverse=True)[:10]

mismatches = []
for our_game in games_to_check:
    game_id = our_game.get("game_id")
    our_goals = our_game.get("nhl_goals", 0) or 0
    our_shots = our_game.get("nhl_shots_on_goal", 0) or 0
    
    # Fetch from NHL API
    try:
        url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            boxscore = response.json()
            player_stats = boxscore.get("playerByGameStats", {})
            
            api_goals = 0
            api_shots = 0
            
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
            
            if api_goals != our_goals or api_shots != our_shots:
                mismatches.append({
                    "game_id": game_id,
                    "date": our_game.get("game_date"),
                    "our_goals": our_goals,
                    "api_goals": api_goals,
                    "our_shots": our_shots,
                    "api_shots": api_shots
                })
    except Exception as e:
        print(f"   Error checking game {game_id}: {e}")

if mismatches:
    print(f"   Found {len(mismatches)} games with stat mismatches:")
    for m in mismatches:
        print(f"     Game {m['game_id']} ({m['date']}):")
        if m['our_goals'] != m['api_goals']:
            print(f"       Goals: We have {m['our_goals']}, API has {m['api_goals']} (MISSING {m['api_goals'] - m['our_goals']})")
        if m['our_shots'] != m['api_shots']:
            print(f"       Shots: We have {m['our_shots']}, API has {m['api_shots']} (MISSING {m['api_shots'] - m['our_shots']})")
else:
    print("   No mismatches found in checked games")
    print("   Need to check more games or check games without goals")

print()
print("=" * 80)
