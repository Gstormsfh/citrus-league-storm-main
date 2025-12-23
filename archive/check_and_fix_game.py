#!/usr/bin/env python3
"""Check game extraction status and ensure it's marked as extracted after fixing."""

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
print(f"CHECKING AND FIXING GAME {GAME_ID}")
print("=" * 80)
print()

# Check extraction status
raw_data = db.select(
    "raw_nhl_data",
    select="stats_extracted",
    filters=[("game_id", "eq", GAME_ID)],
    limit=1
)

if raw_data:
    print(f"Game extraction status:")
    print(f"  stats_extracted: {raw_data[0].get('stats_extracted', False)}")
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
from extractor_job import _aggregate_player_stats_from_pbp, _upsert_player_game_stats, _is_final_game_state, _mark_extracted_if_final

rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
mcdavid_row = rows_map.get(MCDAVID_ID)

if not mcdavid_row:
    print("[ERROR] McDavid not found")
    exit(1)

print(f"Extracted values: PPP={mcdavid_row.get('ppp', 0)}, SHP={mcdavid_row.get('shp', 0)}")
print()

# Get existing to preserve game_date
existing = db.select(
    "player_game_stats",
    select="game_date",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if existing:
    mcdavid_row["game_date"] = existing[0].get("game_date")

# Upsert with correct values
print("Upserting with correct PPP/SHP...")
_upsert_player_game_stats(db, [mcdavid_row], GAME_ID, pbp)

# Mark as extracted
state = pbp.get("gameState")
if _is_final_game_state(state):
    _mark_extracted_if_final(db, GAME_ID)
    print(f"Marked as extracted (state={state})")

print()
time.sleep(1)

# Verify
verify = db.select(
    "player_game_stats",
    select="ppp,shp",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if verify:
    print(f"Final verification: PPP={verify[0].get('ppp', 0)}, SHP={verify[0].get('shp', 0)}")
    if verify[0].get('ppp', 0) == 1 and verify[0].get('shp', 0) == 1:
        print("[OK] Values are correct and persisted!")
    else:
        print("[WARNING] Values still incorrect - may need to investigate database triggers")
