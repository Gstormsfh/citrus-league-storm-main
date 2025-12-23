#!/usr/bin/env python3
"""Manually upsert game 2025020534 with all required fields."""

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
print(f"MANUAL UPSERT GAME {GAME_ID}")
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

sys.path.insert(0, '.')
from extractor_job import _aggregate_player_stats_from_pbp, _extract_game_date, _extract_team_abbrevs

# Extract all stats
rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
mcdavid_row = rows_map.get(MCDAVID_ID)

if not mcdavid_row:
    print("[ERROR] McDavid not found")
    exit(1)

# Get existing row to preserve all fields
existing = db.select(
    "player_game_stats",
    select="*",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if existing:
    # Merge: use extracted PPP/SHP, keep everything else from existing
    merged = existing[0].copy()
    merged["ppp"] = mcdavid_row.get("ppp", 0)
    merged["shp"] = mcdavid_row.get("shp", 0)
    # Also update other stats that might have changed
    merged["goals"] = mcdavid_row.get("goals", 0)
    merged["primary_assists"] = mcdavid_row.get("primary_assists", 0)
    merged["secondary_assists"] = mcdavid_row.get("secondary_assists", 0)
    merged["points"] = mcdavid_row.get("points", 0)
    
    print(f"Merged row - PPP: {merged['ppp']}, SHP: {merged['shp']}")
    print()
    
    # Upsert the merged row
    print("Upserting merged row...")
    db.upsert("player_game_stats", [merged], on_conflict="season,game_id,player_id")
    
    print("[OK] Upsert complete")
    print()
    
    # Verify
    import time
    time.sleep(1)
    verify = db.select(
        "player_game_stats",
        select="ppp,shp,goals,primary_assists,secondary_assists,points",
        filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if verify:
        v = verify[0]
        print("Verification:")
        print(f"  Goals: {v.get('goals', 0)}")
        print(f"  Assists: {v.get('primary_assists', 0) + v.get('secondary_assists', 0)}")
        print(f"  Points: {v.get('points', 0)}")
        print(f"  PPP: {v.get('ppp', 0)}")
        print(f"  SHP: {v.get('shp', 0)}")
        
        if v.get('ppp', 0) == 1 and v.get('shp', 0) == 1:
            print()
            print("[OK] Values are correct!")
        else:
            print()
            print("[WARNING] Values still incorrect")
else:
    print("[ERROR] Existing row not found")
