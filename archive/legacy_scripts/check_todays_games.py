#!/usr/bin/env python3
"""Check for games today in both database and API"""

import os
import sys
import datetime as dt
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

print("=" * 80)
print("CHECKING TODAY'S GAMES")
print("=" * 80)
print()

today = dt.date.today()
print(f"Today's date: {today}")
print(f"Current time: {dt.datetime.now()}")
print()

# Check 1: Database (nhl_games table)
print("1. Checking database (nhl_games table)...")
try:
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    games = db.select(
        "nhl_games",
        select="game_id,game_date,home_team,away_team,status",
        filters=[("game_date", "eq", today.isoformat())],
        limit=100
    )
    
    if games:
        print(f"   Found {len(games)} games in database for today:")
        for g in games:
            status = g.get("status", "unknown")
            game_id = g.get("game_id")
            home = g.get("home_team", "?")
            away = g.get("away_team", "?")
            print(f"     Game {game_id}: {away} @ {home} - Status: {status}")
        
        # Check which ones are in raw_nhl_data
        print()
        print("   Checking which are in raw_nhl_data...")
        game_ids = [g.get("game_id") for g in games if g.get("game_id")]
        if game_ids:
            raw_games = db.select(
                "raw_nhl_data",
                select="game_id,processed",
                filters=[("game_id", "in", game_ids)],
                limit=100
            )
            raw_game_ids = set([g.get("game_id") for g in (raw_games or []) if g.get("game_id")])
            processed = [g.get("game_id") for g in (raw_games or []) if g.get("processed", False)]
            
            print(f"     In raw_nhl_data: {len(raw_game_ids)}/{len(game_ids)}")
            print(f"     Processed: {len(processed)}/{len(game_ids)}")
            
            missing = set(game_ids) - raw_game_ids
            if missing:
                print(f"     Missing from raw_nhl_data: {len(missing)} games")
                for gid in list(missing)[:5]:
                    print(f"       - Game {gid}")
    else:
        print("   No games found in database for today")
except Exception as e:
    print(f"   Error: {e}")
print()

# Check 2: NHL API schedule/now
print("2. Checking NHL API (schedule/now)...")
try:
    response = requests.get("https://api-web.nhle.com/v1/schedule/now", timeout=10)
    response.raise_for_status()
    data = response.json()
    api_games = data.get("games", [])
    
    print(f"   API returned {len(api_games)} games")
    
    if api_games:
        for g in api_games[:10]:
            game_id = g.get("id")
            state = g.get("gameState", "unknown")
            away = g.get("awayTeam", {}).get("abbrev", "?")
            home = g.get("homeTeam", {}).get("abbrev", "?")
            start = g.get("startTimeUTC", "?")
            print(f"     Game {game_id}: {away} @ {home} - State: {state} - Start: {start}")
        
        # Check for active states
        active = [g for g in api_games if g.get("gameState", "").upper() in ("LIVE", "CRIT", "INTERMISSION")]
        if active:
            print(f"\n   ACTIVE GAMES FOUND: {len(active)}")
            for g in active:
                game_id = g.get("id")
                state = g.get("gameState")
                away = g.get("awayTeam", {}).get("abbrev", "?")
                home = g.get("homeTeam", {}).get("abbrev", "?")
                print(f"     🟢 Game {game_id}: {away} @ {home} ({state})")
        else:
            print("   No active games in API response")
    else:
        print("   API returned no games")
except Exception as e:
    print(f"   Error: {e}")
print()

# Check 3: Try checking specific game IDs from database
print("3. Checking game states directly from gamecenter API...")
try:
    if games and len(games) > 0:
        # Check first few games
        for game in games[:5]:
            game_id = game.get("game_id")
            if game_id:
                try:
                    pbp_url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
                    pbp_response = requests.get(pbp_url, timeout=10)
                    if pbp_response.status_code == 200:
                        pbp_data = pbp_response.json()
                        pbp_state = pbp_data.get("gameState", "unknown")
                        print(f"     Game {game_id}: PBP state = {pbp_state}")
                        
                        if pbp_state.upper() in ("LIVE", "CRIT", "INTERMISSION"):
                            print(f"       ✅ THIS GAME IS ACTIVE!")
                    else:
                        print(f"     Game {game_id}: HTTP {pbp_response.status_code}")
                except Exception as e:
                    print(f"     Game {game_id}: Error - {e}")
except Exception as e:
    print(f"   Error: {e}")

print()
print("=" * 80)

