#!/usr/bin/env python3
"""Check which of McDavid's games have TOI data"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
MCDAVID_ID = 8478402

# Get all of McDavid's games
games = db.select(
    "player_game_stats",
    select="game_id,icetime_seconds",
    filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", 2025)]
)

print(f"McDavid's games: {len(games) if games else 0}")
print()

# Check which have TOI > 0
games_with_toi = [g for g in games if (g.get("icetime_seconds") or 0) > 0]
games_without_toi = [g for g in games if (g.get("icetime_seconds") or 0) == 0]

print(f"Games with TOI > 0: {len(games_with_toi)}")
print(f"Games with TOI = 0: {len(games_without_toi)}")
print()

# Check which have player_toi_by_situation
if games:
    game_ids = [g.get("game_id") for g in games if g.get("game_id")]
    toi_records = db.select(
        "player_toi_by_situation",
        select="game_id",
        filters=[("player_id", "eq", MCDAVID_ID)]
    )
    
    games_with_toi_table = set()
    if toi_records:
        games_with_toi_table = set([t.get("game_id") for t in toi_records if t.get("game_id")])
    
    games_missing_toi_table = [gid for gid in game_ids if gid not in games_with_toi_table]
    
    print(f"Games with player_toi_by_situation: {len(games_with_toi_table)}")
    print(f"Games missing player_toi_by_situation: {len(games_missing_toi_table)}")
    if games_missing_toi_table:
        print(f"  Missing: {games_missing_toi_table[:10]}")
