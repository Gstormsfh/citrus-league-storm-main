#!/usr/bin/env python3
"""
Diagnose shiftcharts ingestion stall at 263 games.

Tests API and database operations for games around the stall point.
"""

import os
import requests
import time
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
SHIFTCHARTS_URL = "https://api.nhle.com/stats/rest/en/shiftcharts"

print("=" * 70)
print("SHIFTCHARTS STALL DIAGNOSIS")
print("=" * 70)

# Get games around the 263 mark
print("\n1. Finding games around the stall point...")
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
missing = sorted([gid for gid in all_games if gid not in games_with_shifts])

print(f"   Total games: {len(all_games)}")
print(f"   Games with shifts: {len(games_with_shifts)}")
print(f"   Games missing shifts: {len(missing)}")

# Test games around index 260-270 (around the 263 mark)
test_range = missing[255:275] if len(missing) > 275 else missing[255:]
print(f"\n2. Testing {len(test_range)} games around the stall point...")
print(f"   Game IDs: {test_range[:5]} ... {test_range[-5:]}")

api_results = {
  "success": [],
  "no_data": [],
  "errors": []
}

for game_id in test_range[:20]:  # Test first 20
  try:
    params = {"cayenneExp": f"gameId={game_id}"}
    r = requests.get(SHIFTCHARTS_URL, params=params, timeout=30)
    
    if r.status_code == 200:
      data = r.json()
      shifts = [s for s in (data.get("data", []) or []) if int(s.get("typeCode", 0) or 0) == 517]
      
      if shifts:
        api_results["success"].append((game_id, len(shifts)))
        print(f"   ✓ Game {game_id}: {len(shifts)} shifts")
      else:
        api_results["no_data"].append(game_id)
        print(f"   ⚠ Game {game_id}: No shifts in API (status 200, but 0 shifts)")
    else:
      api_results["errors"].append((game_id, r.status_code))
      print(f"   ✗ Game {game_id}: API error {r.status_code}")
    
    time.sleep(0.2)
  except Exception as e:
    api_results["errors"].append((game_id, str(e)))
    print(f"   ✗ Game {game_id}: Exception - {e}")

print(f"\n3. API Test Results:")
print(f"   Success: {len(api_results['success'])} games")
print(f"   No data: {len(api_results['no_data'])} games")
print(f"   Errors: {len(api_results['errors'])} games")

# Test upsert operation
print(f"\n4. Testing upsert operation...")
if api_results["success"]:
  test_game_id, test_shift_count = api_results["success"][0]
  print(f"   Testing with game_id={test_game_id} ({test_shift_count} shifts)")
  
  try:
    # Fetch the shifts
    params = {"cayenneExp": f"gameId={test_game_id}"}
    r = requests.get(SHIFTCHARTS_URL, params=params, timeout=30)
    data = r.json()
    shifts = [s for s in (data.get("data", []) or []) if int(s.get("typeCode", 0) or 0) == 517]
    
    # Try to upsert a small sample
    from ingest_shiftcharts import mmss_to_seconds, _now_iso
    shift_rows = []
    for r in shifts[:10]:  # Just test with 10 shifts
      try:
        shift_id = int(r["id"])
        start_s = mmss_to_seconds(r.get("startTime"))
        end_s = mmss_to_seconds(r.get("endTime"))
        dur_s = mmss_to_seconds(r.get("duration")) if r.get("duration") else None
        
        shift_rows.append({
          "shift_id": shift_id,
          "game_id": int(r.get("gameId")),
          "player_id": int(r.get("playerId")),
          "team_id": int(r.get("teamId")),
          "team_abbrev": r.get("teamAbbrev"),
          "period": int(r.get("period")),
          "shift_number": int(r.get("shiftNumber") or 0),
          "start_time": r.get("startTime"),
          "end_time": r.get("endTime"),
          "duration": r.get("duration"),
          "shift_start_time_seconds": int(start_s),
          "shift_end_time_seconds": int(end_s),
          "duration_seconds": int(dur_s) if dur_s is not None else None,
          "updated_at": _now_iso(),
        })
      except Exception as e:
        print(f"   WARN: Failed to parse shift: {e}")
        continue
    
    if shift_rows:
      try:
        db.upsert("player_shifts_official", shift_rows, on_conflict="shift_id")
        print(f"   ✓ Upsert test successful: {len(shift_rows)} shifts")
      except Exception as e:
        print(f"   ✗ Upsert test failed: {e}")
        import traceback
        traceback.print_exc()
    else:
      print(f"   ⚠ No valid shifts to test upsert")
      
  except Exception as e:
    print(f"   ✗ Failed to test upsert: {e}")
    import traceback
    traceback.print_exc()

# Check for pattern in game IDs
print(f"\n5. Checking for patterns in game IDs...")
if api_results["no_data"]:
  print(f"   Games with no data: {api_results['no_data'][:10]}")
  # Check if they're sequential or have a pattern
  if len(api_results["no_data"]) > 1:
    sorted_no_data = sorted(api_results["no_data"])
    gaps = [sorted_no_data[i+1] - sorted_no_data[i] for i in range(len(sorted_no_data)-1)]
    print(f"   ID gaps: {gaps[:10]}")

if api_results["errors"]:
  print(f"   Games with errors: {[g[0] for g in api_results['errors'][:10]]}")

print("\n" + "=" * 70)
print("DIAGNOSIS COMPLETE")
print("=" * 70)

