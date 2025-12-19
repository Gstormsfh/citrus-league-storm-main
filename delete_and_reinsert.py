#!/usr/bin/env python3
"""Delete and re-insert game 2025020534 row to force update."""

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
print(f"DELETE AND RE-INSERT GAME {GAME_ID}")
print("=" * 80)
print()

# Get existing row
existing = db.select(
    "player_game_stats",
    select="*",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if not existing:
    print("[ERROR] Row not found")
    exit(1)

print(f"Current values: PPP={existing[0].get('ppp', 0)}, SHP={existing[0].get('shp', 0)}")
print()

# Get raw PBP and extract
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
from extractor_job import _aggregate_player_stats_from_pbp, _compute_toi_from_shifts

rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
mcdavid_row = rows_map.get(MCDAVID_ID)

if not mcdavid_row:
    print("[ERROR] McDavid not found")
    exit(1)

print(f"Extracted values: PPP={mcdavid_row.get('ppp', 0)}, SHP={mcdavid_row.get('shp', 0)}")
print()

# Get TOI
toi_by_player = _compute_toi_from_shifts(db, GAME_ID, pbp)
if MCDAVID_ID in toi_by_player:
    mcdavid_row["icetime_seconds"] = toi_by_player[MCDAVID_ID]

# Preserve existing fields
mcdavid_row["game_date"] = existing[0].get("game_date")
mcdavid_row["team_abbrev"] = existing[0].get("team_abbrev")
mcdavid_row["position_code"] = existing[0].get("position_code")
mcdavid_row["is_goalie"] = existing[0].get("is_goalie", False)

print("Deleting existing row...")
db.delete(
    "player_game_stats",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)]
)

print("Inserting new row...")
db.upsert("player_game_stats", [mcdavid_row], on_conflict="season,game_id,player_id")

print()
print("Verifying...")
import time
time.sleep(1)

verify = db.select(
    "player_game_stats",
    select="ppp,shp,goals,primary_assists,secondary_assists",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if verify:
    v = verify[0]
    print(f"  Goals: {v.get('goals', 0)}")
    print(f"  Assists: {v.get('primary_assists', 0) + v.get('secondary_assists', 0)}")
    print(f"  PPP: {v.get('ppp', 0)}")
    print(f"  SHP: {v.get('shp', 0)}")
    
    if v.get('ppp', 0) == 1 and v.get('shp', 0) == 1:
        print()
        print("[OK] Success! Now rebuild season stats.")
    else:
        print()
        print("[WARNING] Values still incorrect")
