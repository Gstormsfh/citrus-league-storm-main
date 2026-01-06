#!/usr/bin/env python3
"""
Check what's currently in the database for Crosby.
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
CROSBY_ID = 8471675

print("=" * 80)
print("Checking Crosby's Current Database Values")
print("=" * 80)
print()

result = db.select(
    "player_season_stats",
    select="nhl_ppp,nhl_shp,nhl_goals,nhl_assists",
    filters=[
        ("player_id", "eq", CROSBY_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=1
)

if result and len(result) > 0:
    r = result[0]
    print(f"Current database values:")
    print(f"  PPP: {r.get('nhl_ppp', 0)} (should be 16)")
    print(f"  SHP: {r.get('nhl_shp', 0)}")
    print(f"  Goals: {r.get('nhl_goals', 0)}")
    print(f"  Assists: {r.get('nhl_assists', 0)}")
    print()
    
    if r.get('nhl_ppp', 0) == 9:
        print("✗✗✗ DATABASE HAS OLD VALUE (9) - Need to re-run script ✗✗✗")
    elif r.get('nhl_ppp', 0) == 16:
        print("✓✓✓ DATABASE HAS CORRECT VALUE (16) ✓✓✓")
    else:
        print(f"⚠ Database has unexpected value: {r.get('nhl_ppp', 0)}")
else:
    print("No stats found for Crosby")

