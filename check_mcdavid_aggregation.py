#!/usr/bin/env python3
"""Check if there are duplicate game stats or aggregation issues for McDavid."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from collections import Counter

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025

print("=" * 80)
print("CHECKING MCDAVID AGGREGATION")
print("=" * 80)
print()

# Get all game stats
game_stats = db.select(
    "player_game_stats",
    select="game_id, game_date, ppp, shp, goals, primary_assists, secondary_assists",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    order="game_id.asc"
)

print(f"Total game stats rows: {len(game_stats)}")
print()

# Check for duplicates
game_ids = [g.get('game_id') for g in game_stats]
duplicates = [gid for gid, count in Counter(game_ids).items() if count > 1]

if duplicates:
    print(f"[WARNING] Found duplicate game_ids: {duplicates}")
    for dup_id in duplicates:
        dup_rows = [g for g in game_stats if g.get('game_id') == dup_id]
        print(f"  Game {dup_id}: {len(dup_rows)} rows")
        for row in dup_rows:
            print(f"    PPP: {row.get('ppp', 0)}, SHP: {row.get('shp', 0)}")
else:
    print("[OK] No duplicate game_ids found")
print()

# Sum manually
total_ppp = 0
total_shp = 0
null_ppp = 0
null_shp = 0

for game in game_stats:
    ppp = game.get('ppp')
    shp = game.get('shp')
    
    if ppp is None:
        null_ppp += 1
        ppp = 0
    if shp is None:
        null_shp += 1
        shp = 0
    
    total_ppp += int(ppp)
    total_shp += int(shp)

print(f"Manual sum:")
print(f"  PPP: {total_ppp} (NULL values: {null_ppp})")
print(f"  SHP: {total_shp} (NULL values: {null_shp})")
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
        print(f"[ISSUE] PPP mismatch: game stats sum = {total_ppp}, season stats = {row.get('ppp', 0)}")
        print(f"  Missing: {total_ppp - row.get('ppp', 0)} PPP")
    if row.get('shp', 0) != total_shp:
        print(f"[ISSUE] SHP mismatch: game stats sum = {total_shp}, season stats = {row.get('shp', 0)}")
        print(f"  Missing: {total_shp - row.get('shp', 0)} SHP")

print()
print("Games with highest PPP/SHP:")
print()
sorted_games = sorted(game_stats, key=lambda g: (g.get('ppp', 0) + g.get('shp', 0)), reverse=True)
for game in sorted_games[:10]:
    ppp = game.get('ppp', 0) or 0
    shp = game.get('shp', 0) or 0
    if ppp > 0 or shp > 0:
        print(f"  Game {game.get('game_id')}: PPP={ppp}, SHP={shp}")
