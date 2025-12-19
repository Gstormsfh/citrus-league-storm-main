#!/usr/bin/env python3
"""Check sum of all games including game 2025020534."""

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
print("CHECKING ALL GAMES SUM")
print("=" * 80)
print()

# Get all game stats
game_stats = db.select(
    "player_game_stats",
    select="game_id, game_date, ppp, shp, goals, primary_assists, secondary_assists, points",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    order="game_id.asc"
)

print(f"Total games: {len(game_stats)}")
print()

# Find game 2025020534
target_game = None
for game in game_stats:
    if game.get('game_id') == 2025020534:
        target_game = game
        break

if target_game:
    print(f"Game 2025020534:")
    print(f"  PPP: {target_game.get('ppp', 0)}")
    print(f"  SHP: {target_game.get('shp', 0)}")
    print(f"  Goals: {target_game.get('goals', 0)}")
    print(f"  Assists: {target_game.get('primary_assists', 0) + target_game.get('secondary_assists', 0)}")
    print()
else:
    print("[ERROR] Game 2025020534 not found")
    exit(1)

# Sum all
total_ppp = sum(g.get('ppp', 0) or 0 for g in game_stats)
total_shp = sum(g.get('shp', 0) or 0 for g in game_stats)

print(f"Manual sum of all games:")
print(f"  PPP: {total_ppp}")
print(f"  SHP: {total_shp}")
print()

# Get season stats
season_stats = db.select(
    "player_season_stats",
    select="ppp, shp",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if season_stats:
    row = season_stats[0]
    print(f"Season stats table:")
    print(f"  PPP: {row.get('ppp', 0)}")
    print(f"  SHP: {row.get('shp', 0)}")
    print()
    
    if row.get('ppp', 0) != total_ppp:
        print(f"[ISSUE] PPP mismatch: sum={total_ppp}, season={row.get('ppp', 0)}")
    if row.get('shp', 0) != total_shp:
        print(f"[ISSUE] SHP mismatch: sum={total_shp}, season={row.get('shp', 0)}")
    
    if row.get('ppp', 0) == total_ppp and row.get('shp', 0) == total_shp:
        print("[OK] Season stats match game stats sum!")
