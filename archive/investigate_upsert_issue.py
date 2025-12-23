#!/usr/bin/env python3
"""Investigate why upsert isn't preserving PPP/SHP values."""

import os
import sys
import json
import requests
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
print("INVESTIGATING UPSERT ISSUE")
print("=" * 80)
print()

# Step 1: Get current database state
print("Step 1: Current database state")
current = db.select(
    "player_game_stats",
    select="*",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if current:
    print(f"  PPP: {current[0].get('ppp', 0)}")
    print(f"  SHP: {current[0].get('shp', 0)}")
    print(f"  Goals: {current[0].get('goals', 0)}")
    print(f"  Assists: {current[0].get('primary_assists', 0) + current[0].get('secondary_assists', 0)}")
    print()
else:
    print("  [ERROR] Row not found")
    exit(1)

# Step 2: Extract fresh stats
print("Step 2: Extracting fresh stats from PBP...")
raw_data = db.select(
    "raw_nhl_data",
    select="raw_json",
    filters=[("game_id", "eq", GAME_ID)],
    limit=1
)

if not raw_data:
    print("  [ERROR] Game not found")
    exit(1)

pbp = raw_data[0].get("raw_json") or {}
if isinstance(pbp, str):
    pbp = json.loads(pbp)

sys.path.insert(0, '.')
from extractor_job import _aggregate_player_stats_from_pbp

rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
mcdavid_extracted = rows_map.get(MCDAVID_ID)

if mcdavid_extracted:
    print(f"  Extracted PPP: {mcdavid_extracted.get('ppp', 0)}")
    print(f"  Extracted SHP: {mcdavid_extracted.get('shp', 0)}")
    print(f"  Extracted Goals: {mcdavid_extracted.get('goals', 0)}")
    print()
else:
    print("  [ERROR] McDavid not found in extraction")
    exit(1)

# Step 3: Test upsert with merge-duplicates
print("Step 3: Testing upsert with merge-duplicates...")
print("  Creating row with PPP=1, SHP=1...")

# Use the extracted row but ensure all fields are present
test_row = mcdavid_extracted.copy()
# Preserve existing fields that might be important
test_row["game_date"] = current[0].get("game_date")
test_row["team_abbrev"] = current[0].get("team_abbrev")
test_row["position_code"] = current[0].get("position_code")
test_row["is_goalie"] = current[0].get("is_goalie", False)

print(f"  Row to upsert: PPP={test_row.get('ppp')}, SHP={test_row.get('shp')}")
print()

# Try upsert with explicit merge-duplicates
url = f"{db.rest_base}/player_game_stats?on_conflict=season,game_id,player_id"
headers = db._headers({
    "Prefer": "resolution=merge-duplicates,return=representation"
})
body = [test_row]

print("  Sending POST request with merge-duplicates...")
r = requests.post(url, headers=headers, data=json.dumps(body), timeout=60)
print(f"  Status: {r.status_code}")

if r.status_code >= 400:
    print(f"  Error: {r.text[:500]}")
else:
    if r.text:
        result = r.json()
        if isinstance(result, list) and len(result) > 0:
            print(f"  Returned row: PPP={result[0].get('ppp', 0)}, SHP={result[0].get('shp', 0)}")
        else:
            print(f"  Response: {r.text[:200]}")

print()

# Step 4: Verify after upsert
import time
time.sleep(1)
print("Step 4: Verifying after upsert...")
verify = db.select(
    "player_game_stats",
    select="ppp,shp,goals,primary_assists,secondary_assists",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if verify:
    v = verify[0]
    print(f"  PPP: {v.get('ppp', 0)}")
    print(f"  SHP: {v.get('shp', 0)}")
    print(f"  Goals: {v.get('goals', 0)}")
    print(f"  Assists: {v.get('primary_assists', 0) + v.get('secondary_assists', 0)}")
    
    if v.get('ppp', 0) == 1 and v.get('shp', 0) == 1:
        print()
        print("[OK] Upsert worked! Values are correct.")
    else:
        print()
        print("[ISSUE] Upsert did not preserve values.")
        print("  This suggests the merge-duplicates resolution isn't working as expected.")
        print("  Possible causes:")
        print("  1. PostgREST merge-duplicates only merges NULL values, not 0 values")
        print("  2. There's a default constraint overriding the values")
        print("  3. The conflict resolution is using the wrong strategy")
