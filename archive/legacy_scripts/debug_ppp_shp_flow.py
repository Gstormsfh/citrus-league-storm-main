#!/usr/bin/env python3
"""
Debug the PPP/SHP flow from database to frontend.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# Test with McDavid
MCDAVID_ID = 8478402

print("=" * 80)
print("PPP/SHP FLOW DEBUG")
print("=" * 80)
print()

# Step 1: Check database
print("Step 1: Database (player_season_stats)")
print("-" * 80)
db_result = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp",
    filters=[
        ("player_id", "eq", MCDAVID_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=1
)

if db_result and len(db_result) > 0:
    r = db_result[0]
    print(f"✓ Found in database:")
    print(f"  nhl_ppp: {r.get('nhl_ppp', 0)}")
    print(f"  nhl_shp: {r.get('nhl_shp', 0)}")
else:
    print("✗ Not found in database")
    sys.exit(1)

print()
print("Step 2: What PlayerService.getPlayersByIds() would return")
print("-" * 80)
print("PlayerService queries player_season_stats and maps:")
print("  ppp: Number(s?.nhl_ppp ?? 0)")
print("  shp: Number(s?.nhl_shp ?? 0)")
print()
print(f"Expected PlayerService output:")
print(f"  ppp: {r.get('nhl_ppp', 0)}")
print(f"  shp: {r.get('nhl_shp', 0)}")

print()
print("=" * 80)
print("Now checking frontend code flow...")
print("=" * 80)

