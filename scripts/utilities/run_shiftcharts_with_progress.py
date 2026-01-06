#!/usr/bin/env python3
"""
Run shiftcharts ingestion with progress tracking and better error handling.
This version will continue even if individual games fail.
"""

import os
import sys
import time
from dotenv import load_dotenv
from ingest_shiftcharts import *

load_dotenv()
db = supabase_client()

# Get games that need shifts
print("=" * 70)
print("SHIFTCHARTS INGESTION WITH PROGRESS TRACKING")
print("=" * 70)

game_ids = iter_game_ids_from_raw_nhl_data(db, 2025, 0, skip_existing=True)
print(f"\nFound {len(game_ids)} games that need shifts")
print("Starting ingestion...\n")

success_count = 0
error_count = 0
no_shifts_count = 0

for idx, gid in enumerate(game_ids, start=1):
  try:
    rows = fetch_shiftcharts(gid)
    shift_rows = []
    for r in rows:
      if int(r.get("typeCode") or 0) != 517:
        continue
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
      except Exception as shift_err:
        print(f"  WARN: Skipping invalid shift: {shift_err}")
        continue

    if shift_rows:
      upsert_shifts(db, shift_rows)
      success_count += 1
      print(f"[{idx}/{len(game_ids)}] Game {gid}: {len(shift_rows)} shifts - OK")
    else:
      no_shifts_count += 1
      print(f"[{idx}/{len(game_ids)}] Game {gid}: 0 shifts (no data in API)")
    
    time.sleep(0.2)
    
    # Progress update every 10 games
    if idx % 10 == 0:
      print(f"  Progress: {idx}/{len(game_ids)} | Success: {success_count} | Errors: {error_count} | No shifts: {no_shifts_count}")
      
  except KeyboardInterrupt:
    print(f"\n\nInterrupted at game {gid} ({idx}/{len(game_ids)})")
    break
  except Exception as e:
    error_count += 1
    print(f"[{idx}/{len(game_ids)}] Game {gid}: ERROR - {e}")
    import traceback
    traceback.print_exc()
    time.sleep(0.2)
    # Continue to next game

print("\n" + "=" * 70)
print("FINAL SUMMARY:")
print(f"  Total games: {len(game_ids)}")
print(f"  Success: {success_count}")
print(f"  Errors: {error_count}")
print(f"  No shifts in API: {no_shifts_count}")
print("=" * 70)








