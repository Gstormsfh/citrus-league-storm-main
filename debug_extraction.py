#!/usr/bin/env python3
"""Debug why extraction shows PPP=1/SHP=1 but database has 0/0."""

import os
import sys
import json
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
print("DEBUGGING EXTRACTION")
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
    pbp = json.loads(pbp)

sys.path.insert(0, '.')
from extractor_job import _aggregate_player_stats_from_pbp

rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
mcdavid_row = rows_map.get(MCDAVID_ID)

if not mcdavid_row:
    print("[ERROR] McDavid not found")
    exit(1)

print("Extracted row (full):")
print(json.dumps(mcdavid_row, indent=2, default=str))
print()

print(f"PPP value: {mcdavid_row.get('ppp')} (type: {type(mcdavid_row.get('ppp'))})")
print(f"SHP value: {mcdavid_row.get('shp')} (type: {type(mcdavid_row.get('shp'))})")
print()

# Try direct insert (not upsert)
print("Attempting direct insert (will fail if row exists, that's OK)...")
try:
    # Remove updated_at to avoid issues
    insert_row = mcdavid_row.copy()
    if "updated_at" in insert_row:
        del insert_row["updated_at"]
    
    # Use POST directly (insert, not upsert)
    import requests
    url = f"{db.rest_base}/player_game_stats"
    headers = db._headers({"Prefer": "return=representation"})
    r = requests.post(url, headers=headers, data=json.dumps([insert_row]), timeout=60)
    
    if r.status_code >= 400:
        print(f"Insert failed (expected if row exists): {r.status_code} {r.text[:200]}")
        print()
        print("Trying UPDATE instead...")
        # Use PATCH to update
        url = f"{db.rest_base}/player_game_stats?game_id=eq.{GAME_ID}&player_id=eq.{MCDAVID_ID}&season=eq.{DEFAULT_SEASON}"
        r = requests.patch(url, headers=db._headers(), data=json.dumps({"ppp": 1, "shp": 1}), timeout=60)
        if r.status_code >= 400:
            print(f"Update failed: {r.status_code} {r.text[:200]}")
        else:
            print(f"Update succeeded: {r.status_code}")
    else:
        print(f"Insert succeeded: {r.status_code}")
        print(f"Response: {r.text[:200]}")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

print()
print("Final check...")
import time
time.sleep(1)
verify = db.select(
    "player_game_stats",
    select="ppp,shp",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if verify:
    print(f"  PPP: {verify[0].get('ppp', 0)}")
    print(f"  SHP: {verify[0].get('shp', 0)}")
