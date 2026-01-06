#!/usr/bin/env python3
"""
Verify McDavid's PPP and SHP stats from player_season_stats after running landing script.
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

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# McDavid's player_id
MCDAVID_ID = 8478402

print("=" * 80)
print("Verifying Connor McDavid's Stats from Landing Endpoint")
print("=" * 80)
print()

# Get McDavid's season stats
stats = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp,nhl_goals,nhl_assists,nhl_points",
    filters=[
        ("player_id", "eq", MCDAVID_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=1
)

if not stats or len(stats) == 0:
    print(f"ERROR: No season stats found for McDavid (player_id: {MCDAVID_ID})")
    sys.exit(1)

mcdavid = stats[0]
print(f"Player ID: {mcdavid.get('player_id')}")
print(f"Season: {DEFAULT_SEASON}")
print()
print("Stats from player_season_stats (NHL Landing Endpoint):")
print(f"  Goals: {mcdavid.get('nhl_goals', 0)}")
print(f"  Assists: {mcdavid.get('nhl_assists', 0)}")
print(f"  Points: {mcdavid.get('nhl_points', 0)}")
print(f"  Powerplay Points (nhl_ppp): {mcdavid.get('nhl_ppp', 0)}")
print(f"  Shorthanded Points (nhl_shp): {mcdavid.get('nhl_shp', 0)}")
print()

# Expected values
expected_ppp = 30
expected_shp = 2

actual_ppp = mcdavid.get('nhl_ppp', 0)
actual_shp = mcdavid.get('nhl_shp', 0)

print("=" * 80)
print("Verification:")
print("=" * 80)
print(f"Expected PPP: {expected_ppp}")
print(f"Actual PPP:   {actual_ppp}")
if actual_ppp == expected_ppp:
    print("[OK] PPP matches expected value!")
else:
    print(f"[WARNING] PPP mismatch! Expected {expected_ppp}, got {actual_ppp}")
print()
print(f"Expected SHP: {expected_shp}")
print(f"Actual SHP:   {actual_shp}")
if actual_shp == expected_shp:
    print("[OK] SHP matches expected value!")
else:
    print(f"[WARNING] SHP mismatch! Expected {expected_shp}, got {actual_shp}")
print()

# Also check a few other high-profile players
print("=" * 80)
print("Spot Checking Other Players:")
print("=" * 80)
print()

# Get a few other top players
other_players = [
    (8471214, "Nathan MacKinnon"),
    (8477956, "Auston Matthews"),
    (8471675, "Sidney Crosby"),
    (8473419, "Brad Marchand"),
]

for player_id, name in other_players:
    stats = db.select(
        "player_season_stats",
        select="player_id,nhl_ppp,nhl_shp,nhl_goals,nhl_assists,nhl_points",
        filters=[
            ("player_id", "eq", player_id),
            ("season", "eq", DEFAULT_SEASON)
        ],
        limit=1
    )
    
    if stats and len(stats) > 0:
        p = stats[0]
        print(f"{name} (ID: {player_id}):")
        print(f"  Goals: {p.get('nhl_goals', 0)}, Assists: {p.get('nhl_assists', 0)}, Points: {p.get('nhl_points', 0)}")
        print(f"  PPP: {p.get('nhl_ppp', 0)}, SHP: {p.get('nhl_shp', 0)}")
        print()
    else:
        print(f"{name} (ID: {player_id}): No stats found")
        print()

print("=" * 80)
print("Verification Complete")
print("=" * 80)

