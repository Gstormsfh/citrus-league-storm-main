#!/usr/bin/env python3
"""Check which games don't have shift data available from API."""

import os
import requests
import time
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
SHIFTCHARTS_URL = "https://api.nhle.com/stats/rest/en/shiftcharts"

print("=" * 70)
print("CHECKING GAMES WITHOUT SHIFT DATA")
print("=" * 70)

# Get missing games
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
missing = [gid for gid in all_games if gid not in games_with_shifts]

print(f"\nTesting {min(20, len(missing))} missing games from API...")
print()

no_shifts = []
has_shifts = []
errors = []

for i, game_id in enumerate(missing[:20], 1):
  try:
    params = {"cayenneExp": f"gameId={game_id}"}
    r = requests.get(SHIFTCHARTS_URL, params=params, timeout=10)
    if r.status_code == 200:
      data = r.json()
      shifts = [s for s in (data.get("data") or []) if int(s.get("typeCode") or 0) == 517]
      if shifts:
        has_shifts.append(game_id)
        print(f"{i}. Game {game_id}: {len(shifts)} shifts available")
      else:
        no_shifts.append(game_id)
        print(f"{i}. Game {game_id}: NO shifts in API")
    else:
      errors.append(game_id)
      print(f"{i}. Game {game_id}: API ERROR {r.status_code}")
    time.sleep(0.2)
  except Exception as e:
    errors.append(game_id)
    print(f"{i}. Game {game_id}: EXCEPTION - {e}")

print()
print("=" * 70)
print(f"Summary:")
print(f"  Games with shifts available: {len(has_shifts)}")
print(f"  Games with NO shifts in API: {len(no_shifts)}")
print(f"  Games with API errors: {len(errors)}")
print(f"  Total missing: {len(missing)}")
print("=" * 70)

if no_shifts:
  print(f"\nNote: {len(no_shifts)} games don't have shift data in the NHL API.")
  print("This is normal - some games (preseason, cancelled, etc.) may not have shifts.")
  print("The script should continue processing games that DO have shifts.")

