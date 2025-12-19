#!/usr/bin/env python3
"""
Fetch TOI from api-web.nhle.com gamecenter boxscore endpoint.
This endpoint works (no DNS issues) and might have TOI data per game.
We can sum it up to get season totals.
"""

import os
import time
import requests
from typing import Dict, Optional
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

DEFAULT_SEASON = 2025
MCDAVID_ID = 8478402

def parse_time_string(time_str: str) -> int:
    """Parse time string (HH:MM:SS or MM:SS) to seconds."""
    if not time_str or not isinstance(time_str, str):
        return 0
    try:
        parts = time_str.split(":")
        if len(parts) == 3:  # HH:MM:SS
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:  # MM:SS
            return int(parts[0]) * 60 + int(parts[1])
        else:
            return int(time_str) if time_str.isdigit() else 0
    except Exception:
        return 0

def fetch_game_boxscore(game_id: int) -> Optional[Dict]:
    """Fetch boxscore from gamecenter endpoint."""
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  Error fetching game {game_id}: {e}")
        return None

def extract_toi_from_boxscore(boxscore: Dict, player_id: int) -> Optional[int]:
    """Extract TOI for a specific player from boxscore."""
    if "playerByGameStats" not in boxscore:
        return None
    
    player_stats = boxscore["playerByGameStats"]
    
    # Check both teams
    for team_key in ["homeTeam", "awayTeam"]:
        if team_key not in player_stats:
            continue
        
        team_data = player_stats[team_key]
        if not isinstance(team_data, dict):
            continue
        
        # Check forwards, defensemen, goalies
        for position_group in ["forwards", "defensemen", "goalies"]:
            if position_group not in team_data:
                continue
            
            players = team_data[position_group]
            if not isinstance(players, list):
                continue
            
            for player_stat in players:
                if not isinstance(player_stat, dict):
                    continue
                
                pid = player_stat.get("playerId")
                if pid == player_id:
                    # Look for TOI field
                    toi_str = player_stat.get("timeOnIce") or player_stat.get("toi") or player_stat.get("toiSeconds")
                    if toi_str:
                        return parse_time_string(str(toi_str))
    
    return None

print("=" * 80)
print("FETCHING TOI FROM GAMECENTER BOXSCORE")
print("=" * 80)
print()

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# Get all games for the season
print("Fetching games from database...")
games = db.select(
    "raw_nhl_data",
    select="game_id,game_date",
    order="game_id.asc"
)

print(f"Found {len(games)} games")
print()

# Test with a few games first to see the structure
print("Testing boxscore structure with first 3 games...")
test_games = games[:3] if len(games) >= 3 else games

for game in test_games:
    game_id = game.get("game_id")
    print(f"  Testing game {game_id}...")
    boxscore = fetch_game_boxscore(game_id)
    
    if boxscore:
        print(f"    [OK] Fetched boxscore")
        
        # Check structure
        if "playerByGameStats" in boxscore:
            print(f"    Found playerByGameStats")
            print(f"    Keys: {list(boxscore['playerByGameStats'].keys())}")
            
            # Try to find McDavid
            toi = extract_toi_from_boxscore(boxscore, MCDAVID_ID)
            if toi:
                print(f"    [SUCCESS] Found McDavid TOI: {toi} seconds ({toi/60:.1f} minutes)")
            else:
                print(f"    [INFO] McDavid not in this game or TOI not found")
                # Print structure for debugging
                if "playerByGameStats" in boxscore:
                    for team_key in ["homeTeam", "awayTeam"]:
                        if team_key in boxscore["playerByGameStats"]:
                            team_data = boxscore["playerByGameStats"][team_key]
                            if isinstance(team_data, dict):
                                for pos_group in ["forwards", "defensemen", "goalies"]:
                                    if pos_group in team_data and isinstance(team_data[pos_group], list):
                                        players = team_data[pos_group]
                                        if len(players) > 0:
                                            print(f"    Sample {pos_group} player keys: {list(players[0].keys())}")
                                            # Print a sample player to see all fields
                                            import json
                                            print(f"    Sample player data: {json.dumps(players[0], indent=6)[:500]}")
                                            break
                                break
        else:
            print(f"    [WARNING] No playerByGameStats found")
            print(f"    Available keys: {list(boxscore.keys())}")
    
    time.sleep(0.5)  # Rate limiting

print()
print("=" * 80)
print("NEXT STEPS")
print("=" * 80)
print("If TOI is found in boxscore, we can:")
print("1. Fetch all games for the season")
print("2. Sum up TOI for each player")
print("3. Store in nhl_toi_seconds column")
print()
