#!/usr/bin/env python3
"""Diagnose shiftcharts ingestion issue."""

import os
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
SHIFTCHARTS_URL = "https://api.nhle.com/stats/rest/en/shiftcharts"

print("=" * 70)
print("SHIFTCHARTS DIAGNOSIS")
print("=" * 70)

# Get a game that already has shifts
print("\n1. Finding a game that already has shifts...")
existing = db.select("player_shifts_official", select="game_id", limit=1)
if existing:
  test_game_id = existing[0].get("game_id")
  print(f"   Using game_id: {test_game_id}")
  
  # Test API for this game
  print(f"\n2. Testing API for game {test_game_id}...")
  r = requests.get(SHIFTCHARTS_URL, params={"cayenneExp": f"gameId={test_game_id}"}, timeout=30)
  print(f"   Status: {r.status_code}")
  data = r.json()
  print(f"   Total records: {len(data.get('data', []))}")
  shifts = [s for s in (data.get('data', []) or []) if int(s.get('typeCode', 0) or 0) == 517]
  print(f"   Shifts (typeCode=517): {len(shifts)}")
  if shifts:
    print(f"   Sample shift keys: {list(shifts[0].keys())}")

# Test a missing game
print(f"\n3. Testing a missing game (2025020057)...")
r2 = requests.get(SHIFTCHARTS_URL, params={"cayenneExp": "gameId=2025020057"}, timeout=30)
print(f"   Status: {r2.status_code}")
data2 = r2.json()
print(f"   Total records: {len(data2.get('data', []))}")
shifts2 = [s for s in (data2.get('data', []) or []) if int(s.get('typeCode', 0) or 0) == 517]
print(f"   Shifts (typeCode=517): {len(shifts2)}")
if data2.get('data'):
  print(f"   Sample record typeCode: {data2.get('data', [])[0].get('typeCode') if data2.get('data') else None}")

# Check if maybe the issue is with how we're checking for existing shifts
print(f"\n4. Checking shift detection logic...")
all_shifts = []
offset = 0
while True:
  page = db.select("player_shifts_official", select="game_id", limit=1000, offset=offset)
  if not page:
    break
  all_shifts.extend(page)
  if len(page) < 1000:
    break
  offset += 1000
games_with_shifts = set(s.get("game_id") for s in all_shifts if s.get("game_id"))
print(f"   Games with shifts in DB: {len(games_with_shifts)}")

# Check if 2025020057 is in the missing list
all_games = []
offset = 0
while True:
  page = db.select("raw_nhl_data", select="game_id", limit=1000, offset=offset)
  if not page:
    break
  all_games.extend([g.get("game_id") for g in page if g.get("game_id")])
  if len(page) < 1000:
    break
  offset += 1000

missing = [gid for gid in all_games if gid not in games_with_shifts]
print(f"   Total games: {len(all_games)}")
print(f"   Missing shifts: {len(missing)}")
print(f"   Is 2025020057 in missing? {2025020057 in missing}")

print("=" * 70)

