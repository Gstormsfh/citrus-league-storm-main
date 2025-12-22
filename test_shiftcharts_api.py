#!/usr/bin/env python3
"""Test if shiftcharts API is working for missing games."""

import requests
import time

# Test a few of the missing game IDs
test_games = [2025020057, 2025020058, 2025020059, 2025020060, 2025020061]

SHIFTCHARTS_URL = "https://api.nhle.com/stats/rest/en/shiftcharts"

print("Testing shiftcharts API for missing games...")
print("=" * 70)

for game_id in test_games:
  try:
    params = {"cayenneExp": f"gameId={game_id}"}
    r = requests.get(SHIFTCHARTS_URL, params=params, timeout=10)
    print(f"Game {game_id}: Status {r.status_code}", end="")
    if r.status_code == 200:
      data = r.json()
      shifts = [s for s in (data.get("data") or []) if int(s.get("typeCode") or 0) == 517]
      print(f" - {len(shifts)} shifts found")
    else:
      print(f" - ERROR: {r.text[:100]}")
    time.sleep(0.2)
  except Exception as e:
    print(f"Game {game_id}: EXCEPTION - {e}")

print("=" * 70)



