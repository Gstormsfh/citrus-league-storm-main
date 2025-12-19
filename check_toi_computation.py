#!/usr/bin/env python3
"""Check why TOI isn't being computed for games with shifts"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
MCDAVID_ID = 8478402

# Check a specific game that has shifts but TOI=0
game_id = 2025020274

print(f"Checking game {game_id} for McDavid (player_id={MCDAVID_ID})...\n")

# Check game stats
game_stats = db.select(
    "player_game_stats",
    select="icetime_seconds",
    filters=[("game_id", "eq", game_id), ("player_id", "eq", MCDAVID_ID)],
    limit=1
)
if game_stats:
    print(f"Current TOI in player_game_stats: {game_stats[0].get('icetime_seconds')} seconds\n")

# Check computed shifts
shifts = db.select(
    "player_shifts",
    select="player_id,shift_start_time_seconds,shift_end_time_seconds",
    filters=[("game_id", "eq", game_id), ("player_id", "eq", MCDAVID_ID)]
)
print(f"Computed shifts for McDavid: {len(shifts) if shifts else 0}")
if shifts:
    total_toi = 0
    for shift in shifts:
        start = shift.get("shift_start_time_seconds")
        end = shift.get("shift_end_time_seconds")
        if start is not None and end is not None:
            duration = max(0, float(end) - float(start))
            total_toi += int(duration)
            print(f"  Shift: {start}s to {end}s = {duration:.1f}s")
    print(f"  Total TOI from computed shifts: {total_toi} seconds ({total_toi/60:.2f} minutes)\n")

# Check official shifts
shifts_official = db.select(
    "player_shifts_official",
    select="player_id,shift_start_time_seconds,shift_end_time_seconds",
    filters=[("game_id", "eq", game_id), ("player_id", "eq", MCDAVID_ID)]
)
print(f"Official shifts for McDavid: {len(shifts_official) if shifts_official else 0}")
if shifts_official:
    total_toi = 0
    for shift in shifts_official:
        start = shift.get("shift_start_time_seconds")
        end = shift.get("shift_end_time_seconds")
        if start is not None and end is not None:
            duration = max(0, float(end) - float(start))
            total_toi += int(duration)
            print(f"  Shift: {start}s to {end}s = {duration:.1f}s")
    print(f"  Total TOI from official shifts: {total_toi} seconds ({total_toi/60:.2f} minutes)\n")

# Check player_toi_by_situation
toi_by_situation = db.select(
    "player_toi_by_situation",
    select="toi_seconds",
    filters=[("game_id", "eq", game_id), ("player_id", "eq", MCDAVID_ID)]
)
if toi_by_situation:
    total_toi = sum(t.get("toi_seconds", 0) or 0 for t in toi_by_situation)
    print(f"TOI from player_toi_by_situation: {total_toi} seconds ({total_toi/60:.2f} minutes)")
    for t in toi_by_situation:
        print(f"  Situation: {t.get('situation', 'unknown')} = {t.get('toi_seconds', 0)}s")
