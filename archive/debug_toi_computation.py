#!/usr/bin/env python3
"""Debug why TOI computation is failing even when shifts exist"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
MCDAVID_ID = 8478402

# Test game that has shifts but 0 TOI
test_game_id = 2025020274

print(f"Checking game {test_game_id} for McDavid (player_id {MCDAVID_ID})...\n")

# Check computed shifts
computed_shifts = db.select(
    "player_shifts",
    select="player_id,shift_start_time_seconds,shift_end_time_seconds",
    filters=[("game_id", "eq", test_game_id), ("player_id", "eq", MCDAVID_ID)],
    limit=100
)

print(f"Computed shifts: {len(computed_shifts) if computed_shifts else 0}")
if computed_shifts:
    total_toi = 0
    for shift in computed_shifts[:5]:
        start = shift.get("shift_start_time_seconds")
        end = shift.get("shift_end_time_seconds")
        duration = (float(end) - float(start)) if start is not None and end is not None else 0
        total_toi += duration
        print(f"  Shift: {start} to {end} = {duration:.0f} seconds")
    print(f"  Total TOI from first 5 shifts: {total_toi:.0f} seconds")

# Check official shifts
official_shifts = db.select(
    "player_shifts_official",
    select="player_id,shift_start_time_seconds,shift_end_time_seconds",
    filters=[("game_id", "eq", test_game_id), ("player_id", "eq", MCDAVID_ID)],
    limit=100
)

print(f"\nOfficial shifts: {len(official_shifts) if official_shifts else 0}")
if official_shifts:
    total_toi = 0
    for shift in official_shifts[:5]:
        start = shift.get("shift_start_time_seconds")
        end = shift.get("shift_end_time_seconds")
        duration = (float(end) - float(start)) if start is not None and end is not None else 0
        total_toi += duration
        print(f"  Shift: {start} to {end} = {duration:.0f} seconds")
    print(f"  Total TOI from first 5 shifts: {total_toi:.0f} seconds")

# Check what TOI is stored in player_game_stats
game_stats = db.select(
    "player_game_stats",
    select="icetime_seconds",
    filters=[("game_id", "eq", test_game_id), ("player_id", "eq", MCDAVID_ID), ("season", "eq", 2025)],
    limit=1
)

if game_stats:
    print(f"\nStored TOI in player_game_stats: {game_stats[0].get('icetime_seconds')}")
