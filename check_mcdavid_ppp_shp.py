#!/usr/bin/env python3
"""Check McDavid's PPP and SHP to verify they match NHL.com."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025

print("=" * 80)
print("CHECKING MCDAVID PPP AND SHP")
print("=" * 80)
print()

# Get season stats
result = db.select(
    "player_season_stats",
    select="games_played, ppp, shp, goals, primary_assists, secondary_assists, points",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if result:
    row = result[0]
    print(f"Games played: {row.get('games_played', 0)}")
    print(f"Goals: {row.get('goals', 0)}")
    print(f"Assists: {row.get('primary_assists', 0) + row.get('secondary_assists', 0)}")
    print(f"Points: {row.get('points', 0)}")
    print()
    print(f"Power Play Points (PPP): {row.get('ppp', 0)}")
    print(f"Shorthanded Points (SHP): {row.get('shp', 0)}")
    print()
    print("Expected from NHL.com:")
    print("  PPP: 24 (as of recent update)")
    print("  SHP: 2 (as of recent update)")
    print()
    
    ppp = row.get('ppp', 0)
    shp = row.get('shp', 0)
    
    if ppp >= 24 and shp <= 2:
        print("[OK] PPP and SHP look correct!")
    else:
        print("[WARNING] PPP/SHP may not match NHL.com")
        print(f"  Our PPP: {ppp}, Expected: 24")
        print(f"  Our SHP: {shp}, Expected: 2")
else:
    print(f"[ERROR] No stats found for McDavid (player_id={MCDAVID_ID})")

print()
print("=" * 80)
print("RECENT GAMES WITH PPP/SHP")
print("=" * 80)
print()

# Get recent game stats
game_stats = db.select(
    "player_game_stats",
    select="game_id, game_date, ppp, shp, goals, primary_assists, secondary_assists",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    order="game_date.desc",
    limit=10
)

if game_stats:
    print("Last 10 games:")
    for game in game_stats:
        game_id = game.get('game_id')
        game_date = game.get('game_date', 'Unknown')
        ppp = game.get('ppp', 0)
        shp = game.get('shp', 0)
        goals = game.get('goals', 0)
        assists = game.get('primary_assists', 0) + game.get('secondary_assists', 0)
        points = goals + assists
        
        if ppp > 0 or shp > 0:
            print(f"  Game {game_id} ({game_date}): {goals}G {assists}A = {points}P | PPP: {ppp}, SHP: {shp}")
        else:
            print(f"  Game {game_id} ({game_date}): {goals}G {assists}A = {points}P | PPP: {ppp}, SHP: {shp}")
else:
    print("No game stats found")
