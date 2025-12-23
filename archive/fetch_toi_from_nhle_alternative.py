#!/usr/bin/env python3
"""
Alternative approach: Try to fetch TOI from api-web.nhle.com gamecenter endpoint
or check if we can calculate it from our existing shift data.
"""

import os
import requests
import json
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025

print("=" * 80)
print("ATTEMPTING ALTERNATIVE TOI FETCH METHODS")
print("=" * 80)
print()

# Method 1: Try gamecenter endpoint for a recent game
print("Method 1: Testing gamecenter endpoint...")
print("  (This endpoint is used successfully in the codebase)")

# Get a recent game for McDavid's team (Edmonton)
# Let's try to get a game from our database first
db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# Get a recent game
recent_games = db.select(
    "raw_nhl_data",
    select="game_id,game_date",
    order="game_date.desc",
    limit=5
)

if recent_games:
    test_game_id = recent_games[0].get("game_id")
    print(f"  Testing with game_id: {test_game_id}")
    
    url = f"https://api-web.nhle.com/v1/gamecenter/{test_game_id}/play-by-play"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        print(f"  [OK] Successfully fetched gamecenter data")
        
        # Check for TOI or shift data
        if "rosterSpots" in data:
            print(f"  Found rosterSpots section")
            # This might have player info but probably not TOI
        
        if "plays" in data:
            print(f"  Found {len(data['plays'])} plays")
        
        # Check for boxscore which might have TOI
        if "boxscore" in data:
            boxscore = data["boxscore"]
            print(f"  Found boxscore section")
            print(f"  Boxscore keys: {list(boxscore.keys())}")
            
            # Check player stats in boxscore
            if "playerByGameStats" in boxscore:
                print(f"  Found playerByGameStats")
                # This might have TOI per game
        
    except Exception as e:
        print(f"  [ERROR] {e}")

print()
print("Method 2: Check if we can use our existing player_toi_by_situation table...")
print("  (This is our calculated TOI from shifts)")

# Check if we have TOI data in player_toi_by_situation
toi_data = db.select(
    "player_toi_by_situation",
    select="player_id,game_id,toi_all",
    filters=[("player_id", "eq", MCDAVID_ID)],
    limit=10
)

if toi_data:
    print(f"  [OK] Found {len(toi_data)} games with TOI data for McDavid")
    total_toi = sum(row.get("toi_all", 0) for row in toi_data)
    print(f"  Total TOI from our data: {total_toi} seconds ({total_toi/60:.1f} minutes)")
    print(f"  Average per game: {total_toi/len(toi_data)/60:.2f} minutes")
    
    # Check season total
    season_toi_rows = db.select(
        "player_toi_by_situation",
        select="toi_all",
        filters=[("player_id", "eq", MCDAVID_ID)]
    )
    if season_toi_rows:
        season_total = sum(row.get("toi_all", 0) for row in season_toi_rows)
        games = len(season_toi_rows)
        print(f"  Season total from our data: {season_total} seconds ({season_total/60:.1f} minutes)")
        print(f"  Games with TOI data: {games}")
        if games > 0:
            print(f"  Average per game: {season_total/games/60:.2f} minutes")
            print()
            print(f"  [INFO] We could use this as a fallback, but it's our calculated TOI")
            print(f"  [INFO] The issue is it's showing ~20 min/game, not 22:41 from NHL.com")
else:
    print(f"  [WARNING] No TOI data found in player_toi_by_situation for McDavid")

print()
print("Method 3: Try using a proxy or different DNS resolution...")
print("  [INFO] The statsapi.web.nhl.com endpoint has the TOI data we need")
print("  [INFO] But DNS resolution is failing. This might be:")
print("    - Temporary network issue")
print("    - Firewall/proxy blocking")
print("    - DNS server issue")
print()
print("  [SUGGESTION] Try:")
print("    1. Check internet connectivity")
print("    2. Try from a different network")
print("    3. Use a VPN if available")
print("    4. Check if statsapi.web.nhl.com is accessible in browser")
