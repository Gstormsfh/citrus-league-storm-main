#!/usr/bin/env python3
"""Force update game 2025020534 with correct PPP/SHP values."""

import os
import sys
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
print(f"FORCE UPDATING GAME {GAME_ID} PPP/SHP")
print("=" * 80)
print()

# Get raw PBP
raw_data = db.select(
    "raw_nhl_data",
    select="raw_json",
    filters=[("game_id", "eq", GAME_ID)],
    limit=1
)

if not raw_data:
    print(f"[ERROR] Game {GAME_ID} not found")
    exit(1)

pbp = raw_data[0].get("raw_json") or {}
if isinstance(pbp, str):
    import json
    pbp = json.loads(pbp)

# Import extractor functions
sys.path.insert(0, '.')
from extractor_job import _aggregate_player_stats_from_pbp

# Extract stats
print("Extracting player stats...")
rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)

# Find McDavid's row
mcdavid_row = rows_map.get(MCDAVID_ID)
if not mcdavid_row:
    print(f"[ERROR] McDavid not found in extracted stats")
    exit(1)

print(f"Extracted stats for McDavid:")
print(f"  Goals: {mcdavid_row.get('goals', 0)}")
print(f"  Assists: {mcdavid_row.get('primary_assists', 0) + mcdavid_row.get('secondary_assists', 0)}")
print(f"  Points: {mcdavid_row.get('points', 0)}")
print(f"  PPP: {mcdavid_row.get('ppp', 0)}")
print(f"  SHP: {mcdavid_row.get('shp', 0)}")
print()

# Get existing row to preserve other fields
existing = db.select(
    "player_game_stats",
    select="*",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if existing:
    # Update existing row with new PPP/SHP
    update_data = {
        "season": DEFAULT_SEASON,
        "game_id": GAME_ID,
        "player_id": MCDAVID_ID,
        "ppp": mcdavid_row.get('ppp', 0),
        "shp": mcdavid_row.get('shp', 0),
        # Preserve other fields
        "goals": existing[0].get('goals', 0),
        "primary_assists": existing[0].get('primary_assists', 0),
        "secondary_assists": existing[0].get('secondary_assists', 0),
        "points": existing[0].get('points', 0),
        "game_date": existing[0].get('game_date'),
        "team_abbrev": existing[0].get('team_abbrev'),
        "position_code": existing[0].get('position_code'),
        "is_goalie": existing[0].get('is_goalie', False),
    }
    
    print("Updating with data:")
    print(f"  PPP: {update_data['ppp']}")
    print(f"  SHP: {update_data['shp']}")
    print()
    
    # Use upsert with conflict resolution
    db.upsert("player_game_stats", [update_data], on_conflict="season,game_id,player_id")
    
    print("[OK] Updated successfully!")
    
    # Verify
    verify = db.select(
        "player_game_stats",
        select="ppp,shp",
        filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if verify:
        print()
        print("Verification:")
        print(f"  PPP: {verify[0].get('ppp', 0)}")
        print(f"  SHP: {verify[0].get('shp', 0)}")
else:
    print("[ERROR] Existing row not found - cannot update")
