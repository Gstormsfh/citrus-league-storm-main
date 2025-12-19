#!/usr/bin/env python3
"""Directly update PPP/SHP for game 2025020534 using UPDATE instead of UPSERT."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

GAME_ID = 2025020534
MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025

print("=" * 80)
print(f"DIRECT UPDATE GAME {GAME_ID} PPP/SHP")
print("=" * 80)
print()

# Use UPDATE instead of UPSERT
print("Updating PPP=1, SHP=1 for McDavid in this game...")
db.update(
    "player_game_stats",
    {"ppp": 1, "shp": 1},
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)]
)

print("[OK] Update sent")
print()

# Verify
verify = db.select(
    "player_game_stats",
    select="ppp,shp,goals,primary_assists,secondary_assists",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if verify:
    row = verify[0]
    print("Verification:")
    print(f"  Goals: {row.get('goals', 0)}")
    print(f"  Assists: {row.get('primary_assists', 0) + row.get('secondary_assists', 0)}")
    print(f"  PPP: {row.get('ppp', 0)}")
    print(f"  SHP: {row.get('shp', 0)}")
    
    if row.get('ppp', 0) == 1 and row.get('shp', 0) == 1:
        print()
        print("[OK] Update successful! Now rebuild season stats.")
    else:
        print()
        print("[WARNING] Update may not have worked - values still incorrect")
else:
    print("[ERROR] Row not found after update")
