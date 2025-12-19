#!/usr/bin/env python3
"""Check McDavid's TOI issue - should be ~20 min/game, not 7:46"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
MCDAVID_ID = 8478402

# Get all game stats
all_games = []
offset = 0
batch_size = 1000

while True:
    games = db.select(
        "player_game_stats",
        select="game_id,game_date,icetime_seconds,goals,primary_assists,secondary_assists,ppp,shp",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", 2025)],
        limit=batch_size,
        offset=offset
    )
    if not games:
        break
    all_games.extend(games)
    if len(games) < batch_size:
        break
    offset += batch_size

print(f"Total games: {len(all_games)}\n")

# Analyze TOI
games_with_toi = [g for g in all_games if (g.get("icetime_seconds") or 0) > 0]
games_without_toi = [g for g in all_games if (g.get("icetime_seconds") or 0) == 0]

print(f"Games WITH TOI: {len(games_with_toi)}")
print(f"Games WITHOUT TOI: {len(games_without_toi)}\n")

if games_with_toi:
    total_toi = sum(g.get("icetime_seconds", 0) for g in games_with_toi)
    avg_toi_per_game_with_data = total_toi / len(games_with_toi)
    print(f"Average TOI per game (games with data): {avg_toi_per_game_with_data:.1f} seconds ({avg_toi_per_game_with_data/60:.2f} minutes)")
    print(f"Total TOI from games with data: {total_toi} seconds ({total_toi/60:.1f} minutes)\n")

total_toi_all = sum(g.get("icetime_seconds", 0) or 0 for g in all_games)
avg_toi_per_game_all = total_toi_all / len(all_games) if all_games else 0
print(f"Average TOI per game (all games, including 0s): {avg_toi_per_game_all:.1f} seconds ({avg_toi_per_game_all/60:.2f} minutes)")
print(f"Total TOI (all games): {total_toi_all} seconds ({total_toi_all/60:.1f} minutes)\n")

# Show games without TOI
if games_without_toi:
    print(f"Games WITHOUT TOI (first 10):")
    for g in sorted(games_without_toi, key=lambda x: x.get("game_date") or "")[:10]:
        print(f"  Game {g.get('game_id')} ({g.get('game_date')}): TOI=0")

# Check if shifts exist for games without TOI
print("\nChecking if shifts exist for games without TOI...")
for g in games_without_toi[:5]:
    game_id = g.get("game_id")
    shifts = db.select("player_shifts", select="id", filters=[("game_id", "eq", game_id)], limit=1)
    shifts_official = db.select("player_shifts_official", select="shift_id", filters=[("game_id", "eq", game_id)], limit=1)
    print(f"  Game {game_id}: computed_shifts={len(shifts) if shifts else 0}, official_shifts={len(shifts_official) if shifts_official else 0}")

# PPP/SHP breakdown
print("\nPPP/SHP breakdown:")
total_ppp = sum(g.get("ppp", 0) or 0 for g in all_games)
total_shp = sum(g.get("shp", 0) or 0 for g in all_games)
print(f"Total PPP: {total_ppp}")
print(f"Total SHP: {total_shp}")

ppp_games = [g for g in all_games if (g.get("ppp") or 0) > 0]
shp_games = [g for g in all_games if (g.get("shp") or 0) > 0]
print(f"Games with PPP: {len(ppp_games)}")
print(f"Games with SHP: {len(shp_games)}")
