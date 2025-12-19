#!/usr/bin/env python3
"""Final fix: Use direct update and verify it persists."""

import os
import sys
import time
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
print(f"FINAL FIX FOR GAME {GAME_ID}")
print("=" * 80)
print()

# Get raw PBP and re-extract
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
from extractor_job import _aggregate_player_stats_from_pbp

rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
mcdavid_row = rows_map.get(MCDAVID_ID)

if not mcdavid_row:
    print("[ERROR] McDavid not found in extracted stats")
    exit(1)

print(f"Extracted PPP: {mcdavid_row.get('ppp', 0)}, SHP: {mcdavid_row.get('shp', 0)}")
print()

# Get existing row
existing = db.select(
    "player_game_stats",
    select="*",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if not existing:
    print("[ERROR] Existing row not found")
    exit(1)

print(f"Current database values: PPP={existing[0].get('ppp', 0)}, SHP={existing[0].get('shp', 0)}")
print()

# Update using UPDATE method (not upsert)
print("Updating using UPDATE method...")
db.update(
    "player_game_stats",
    {"ppp": mcdavid_row.get('ppp', 0), "shp": mcdavid_row.get('shp', 0)},
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)]
)

print("[OK] Update sent")
print()

# Wait a moment
time.sleep(1)

# Verify multiple times
for i in range(3):
    verify = db.select(
        "player_game_stats",
        select="ppp,shp,updated_at",
        filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    if verify:
        ppp = verify[0].get('ppp', 0)
        shp = verify[0].get('shp', 0)
        updated = verify[0].get('updated_at', 'N/A')
        print(f"Verification {i+1}: PPP={ppp}, SHP={shp}, updated_at={updated}")
        
        if ppp == 1 and shp == 1:
            print("[OK] Values are correct!")
            break
    time.sleep(0.5)

print()
print("If values are still 0, there may be a database trigger or constraint issue.")
