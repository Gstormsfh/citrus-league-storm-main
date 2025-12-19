#!/usr/bin/env python3
"""Fix game 2025020534 and mark as extracted to prevent overwrites."""

import os
import sys
import time
import requests
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
print(f"FIXING GAME {GAME_ID} AND MARKING AS EXTRACTED")
print("=" * 80)
print()

# Update using PATCH (we know this works)
print("Updating PPP=1, SHP=1 using PATCH...")
url = f"{db.rest_base}/player_game_stats?game_id=eq.{GAME_ID}&player_id=eq.{MCDAVID_ID}&season=eq.{DEFAULT_SEASON}"
r = requests.patch(url, headers=db._headers(), data=json.dumps({"ppp": 1, "shp": 1}), timeout=60)
print(f"PATCH status: {r.status_code}")
if r.status_code >= 400:
    print(f"Error: {r.text[:200]}")
    exit(1)

# Mark game as extracted
print()
print("Marking game as extracted...")
from extractor_job import _mark_extracted_if_final
_mark_extracted_if_final(db, GAME_ID)

print()
time.sleep(2)

# Verify
print("Verifying update...")
verify = db.select(
    "player_game_stats",
    select="ppp,shp",
    filters=[("game_id", "eq", GAME_ID), ("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if verify:
    ppp = verify[0].get('ppp', 0)
    shp = verify[0].get('shp', 0)
    print(f"  PPP: {ppp}")
    print(f"  SHP: {shp}")
    
    if ppp == 1 and shp == 1:
        print()
        print("[OK] Values are correct! Game is marked as extracted.")
        print("Now rebuild season stats.")
    else:
        print()
        print("[WARNING] Values still incorrect")
