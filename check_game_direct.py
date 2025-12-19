#!/usr/bin/env python3
"""Check game 2025020534 directly from database."""

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

print("=" * 80)
print(f"CHECKING GAME {GAME_ID} IN DATABASE")
print("=" * 80)
print()

# Get game stats
game_stats = db.select(
    "player_game_stats",
    select="*",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID)],
    limit=1
)

if game_stats:
    row = game_stats[0]
    print("McDavid's stats for this game:")
    print(f"  Goals: {row.get('goals', 0)}")
    print(f"  Primary assists: {row.get('primary_assists', 0)}")
    print(f"  Secondary assists: {row.get('secondary_assists', 0)}")
    print(f"  Points: {row.get('points', 0)}")
    print(f"  PPP: {row.get('ppp', 0)}")
    print(f"  SHP: {row.get('shp', 0)}")
    print(f"  Updated at: {row.get('updated_at', 'N/A')}")
else:
    print("[ERROR] Game stats not found")
