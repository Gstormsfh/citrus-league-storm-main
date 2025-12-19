#!/usr/bin/env python3
"""Re-extract a specific game with the window-based PPP/SHP logic."""

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
DEFAULT_SEASON = 2025

print("=" * 80)
print(f"RE-EXTRACTING GAME {GAME_ID}")
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
from extractor_job import _aggregate_player_stats_from_pbp, _upsert_player_game_stats, _is_final_game_state, _mark_extracted_if_final

# Extract stats
print("Extracting player stats...")
rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
rows = list(rows_map.values())

if rows:
    print(f"Extracted stats for {len(rows)} players")
    
    # Find McDavid
    mcdavid_row = None
    for row in rows:
        if row.get("player_id") == 8478402:
            mcdavid_row = row
            break
    
    if mcdavid_row:
        print()
        print("McDavid's stats for this game:")
        print(f"  Goals: {mcdavid_row.get('goals', 0)}")
        print(f"  Assists: {mcdavid_row.get('primary_assists', 0) + mcdavid_row.get('secondary_assists', 0)}")
        print(f"  Points: {mcdavid_row.get('points', 0)}")
        print(f"  PPP: {mcdavid_row.get('ppp', 0)}")
        print(f"  SHP: {mcdavid_row.get('shp', 0)}")
    
    # Get existing rows to preserve fields like game_date
    existing_rows = db.select(
        "player_game_stats",
        select="*",
        filters=[("game_id", "eq", GAME_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1000
    )
    
    # Create lookup map
    existing_map = {}
    for er in existing_rows:
        pid = er.get("player_id")
        if pid:
            existing_map[pid] = er
    
    # Merge with existing data to preserve fields
    for row in rows:
        pid = row.get("player_id")
        if pid in existing_map:
            existing = existing_map[pid]
            # Preserve game_date and other fields
            row["game_date"] = existing.get("game_date") or row.get("game_date")
    
    # Upsert
    print()
    print("Upserting player_game_stats...")
    _upsert_player_game_stats(db, rows, GAME_ID, pbp)
    
    # Mark as extracted if final
    state = pbp.get("gameState")
    if _is_final_game_state(state):
        _mark_extracted_if_final(db, GAME_ID)
        print(f"Marked game as extracted (state={state})")
    
    print("[OK] Game re-extracted successfully!")
    
    # Verify immediately
    print()
    print("Verifying update...")
    verify = db.select(
        "player_game_stats",
        select="ppp,shp",
        filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", 8478402), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    if verify:
        print(f"  PPP: {verify[0].get('ppp', 0)}")
        print(f"  SHP: {verify[0].get('shp', 0)}")
else:
    print("[ERROR] No stats extracted")
