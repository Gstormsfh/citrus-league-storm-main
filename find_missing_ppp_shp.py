#!/usr/bin/env python3
"""Find which game is missing PPP/SHP for McDavid."""

import os
import requests
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
print("FINDING MISSING PPP/SHP FOR MCDAVID")
print("=" * 80)
print()

# Get NHL.com data
url = f"https://api-web.nhle.com/v1/player/{MCDAVID_ID}/landing"
response = requests.get(url, timeout=10)
response.raise_for_status()
nhl_data = response.json()

nhl_ppp = 0
nhl_shp = 0

if "featuredStats" in nhl_data:
    featured = nhl_data["featuredStats"]
    if "regularSeason" in featured:
        rs = featured["regularSeason"]
        if "subSeason" in rs:
            sub = rs["subSeason"]
            nhl_ppp = sub.get("powerPlayPoints", 0)
            nhl_shp = sub.get("shorthandedPoints", 0)

print(f"NHL.com totals: PPP={nhl_ppp}, SHP={nhl_shp}")
print()

# Get our game stats
game_stats = db.select(
    "player_game_stats",
    select="game_id, game_date, goals, primary_assists, secondary_assists, ppp, shp, points",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    order="game_id.asc"
)

our_ppp = sum(g.get('ppp', 0) or 0 for g in game_stats)
our_shp = sum(g.get('shp', 0) or 0 for g in game_stats)

print(f"Our totals: PPP={our_ppp}, SHP={our_shp}")
print(f"Missing: PPP={nhl_ppp - our_ppp}, SHP={nhl_shp - our_shp}")
print()

# Check each game that has points but might be missing PPP/SHP
print("Games with points but potentially missing PPP/SHP:")
print()
for game in game_stats:
    goals = game.get('goals', 0) or 0
    assists = (game.get('primary_assists', 0) or 0) + (game.get('secondary_assists', 0) or 0)
    points = game.get('points', 0) or 0
    ppp = game.get('ppp', 0) or 0
    shp = game.get('shp', 0) or 0
    
    # If player has points but no PPP/SHP, it might be a power play point we're missing
    if points > 0 and ppp == 0 and shp == 0:
        print(f"  Game {game.get('game_id')} ({game.get('game_date')}): {goals}G {assists}A = {points}P | PPP: {ppp}, SHP: {shp}")

print()
print("All games with PPP or SHP:")
for game in game_stats:
    ppp = game.get('ppp', 0) or 0
    shp = game.get('shp', 0) or 0
    if ppp > 0 or shp > 0:
        goals = game.get('goals', 0) or 0
        assists = (game.get('primary_assists', 0) or 0) + (game.get('secondary_assists', 0) or 0)
        points = game.get('points', 0) or 0
        print(f"  Game {game.get('game_id')} ({game.get('game_date')}): {goals}G {assists}A = {points}P | PPP: {ppp}, SHP: {shp}")
