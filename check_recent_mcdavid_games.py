#!/usr/bin/env python3
"""Check McDavid's recent games to see which ones might have missing PPP/SHP."""

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
print("CHECKING MCDAVID'S RECENT GAMES FOR PPP/SHP")
print("=" * 80)
print()

# Get all game stats for McDavid
game_stats = db.select(
    "player_game_stats",
    select="game_id, game_date, goals, primary_assists, secondary_assists, ppp, shp, points",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    order="game_date.desc, game_id.desc"
)

if not game_stats:
    print("[ERROR] No game stats found")
    exit(1)

print(f"Total games: {len(game_stats)}")
print()

# Sum up totals
total_ppp = sum(g.get('ppp', 0) for g in game_stats)
total_shp = sum(g.get('shp', 0) for g in game_stats)
total_goals = sum(g.get('goals', 0) for g in game_stats)
total_assists = sum(g.get('primary_assists', 0) + g.get('secondary_assists', 0) for g in game_stats)
total_points = sum(g.get('points', 0) for g in game_stats)

print(f"Season totals from game stats:")
print(f"  Goals: {total_goals}")
print(f"  Assists: {total_assists}")
print(f"  Points: {total_points}")
print(f"  PPP: {total_ppp}")
print(f"  SHP: {total_shp}")
print()

# Get season stats
season_stats = db.select(
    "player_season_stats",
    select="ppp, shp, goals, points",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if season_stats:
    row = season_stats[0]
    print(f"Season stats table:")
    print(f"  Goals: {row.get('goals', 0)}")
    print(f"  Points: {row.get('points', 0)}")
    print(f"  PPP: {row.get('ppp', 0)}")
    print(f"  SHP: {row.get('shp', 0)}")
    print()
    
    if row.get('ppp', 0) != total_ppp:
        print(f"[WARNING] PPP mismatch: game stats sum = {total_ppp}, season stats = {row.get('ppp', 0)}")
    if row.get('shp', 0) != total_shp:
        print(f"[WARNING] SHP mismatch: game stats sum = {total_shp}, season stats = {row.get('shp', 0)}")

print()
print("Games with PPP or SHP:")
print()
for game in game_stats[:20]:  # Last 20 games
    ppp = game.get('ppp', 0)
    shp = game.get('shp', 0)
    goals = game.get('goals', 0)
    assists = game.get('primary_assists', 0) + game.get('secondary_assists', 0)
    points = game.get('points', 0)
    
    if ppp > 0 or shp > 0:
        print(f"  Game {game.get('game_id')} ({game.get('game_date')}): {goals}G {assists}A = {points}P | PPP: {ppp}, SHP: {shp}")

print()
print("=" * 80)
print("FETCHING NHL.COM DATA FOR COMPARISON")
print("=" * 80)
print()

# Fetch from NHL landing endpoint
try:
    url = f"https://api-web.nhle.com/v1/player/{MCDAVID_ID}/landing"
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    data = response.json()
    
    if "featuredStats" in data:
        featured = data["featuredStats"]
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                nhl_ppp = sub.get("powerPlayPoints", 0)
                nhl_shp = sub.get("shorthandedPoints", 0)
                
                print(f"NHL.com current season stats:")
                print(f"  Power Play Points: {nhl_ppp}")
                print(f"  Shorthanded Points: {nhl_shp}")
                print()
                
                if season_stats:
                    our_ppp = season_stats[0].get('ppp', 0)
                    our_shp = season_stats[0].get('shp', 0)
                    
                    print(f"Comparison:")
                    print(f"  PPP: Our={our_ppp}, NHL.com={nhl_ppp}, Diff={nhl_ppp - our_ppp}")
                    print(f"  SHP: Our={our_shp}, NHL.com={nhl_shp}, Diff={nhl_shp - our_shp}")
                    
                    if our_ppp != nhl_ppp or our_shp != nhl_shp:
                        print()
                        print("[INFO] There's a discrepancy. This could be due to:")
                        print("  1. A game that hasn't been processed yet")
                        print("  2. Power play window tracking edge case")
                        print("  3. Goal scored right at penalty expiration")
except Exception as e:
    print(f"[ERROR] Could not fetch NHL.com data: {e}")
