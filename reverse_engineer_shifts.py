#!/usr/bin/env python3
"""
Reverse engineer shift tracking by analyzing a game with official shifts.
Compare official shifts vs our calculated shifts to identify gaps.
"""

import os
import json
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from collections import defaultdict

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
MCDAVID_ID = 8478402

# Find a game where McDavid has official shifts
print("Finding game with official shifts for McDavid...")
official_shifts = db.select(
    "player_shifts_official",
    select="game_id,shift_start_time_seconds,shift_end_time_seconds,period",
    filters=[("player_id", "eq", MCDAVID_ID)],
    limit=100
)

if not official_shifts:
    print("No official shifts found for McDavid")
    exit(1)

# Group by game
shifts_by_game = defaultdict(list)
for shift in official_shifts:
    game_id = shift.get("game_id")
    if game_id:
        shifts_by_game[game_id].append(shift)

# Pick a game with many shifts (more data to analyze)
best_game = max(shifts_by_game.items(), key=lambda x: len(x[1]))
game_id = best_game[0]
shifts = best_game[1]

print(f"\nAnalyzing game {game_id} with {len(shifts)} official shifts for McDavid")
print("=" * 80)

# Get play-by-play for this game
game_data = db.select("raw_nhl_data", select="raw_json", filters=[("game_id", "eq", game_id)], limit=1)
if not game_data:
    print(f"Game {game_id} not found in raw_nhl_data")
    exit(1)

pbp = game_data[0].get("raw_json", {})
plays = pbp.get("plays", [])

print(f"\nGame info:")
home_team = pbp.get("homeTeam", {})
away_team = pbp.get("awayTeam", {})
print(f"  Home: {home_team.get('abbrev')} (ID: {home_team.get('id')})")
print(f"  Away: {away_team.get('abbrev')} (ID: {away_team.get('id')})")

# Analyze official shifts
print(f"\nOfficial Shifts Analysis:")
print(f"  Total shifts: {len(shifts)}")
total_toi = sum(max(0, (s.get("shift_end_time_seconds") or 0) - (s.get("shift_start_time_seconds") or 0)) for s in shifts)
print(f"  Total TOI: {total_toi:.1f} seconds ({total_toi/60:.2f} minutes)")

# Group by period
shifts_by_period = defaultdict(list)
for shift in shifts:
    period = shift.get("period", 1)
    shifts_by_period[period].append(shift)

print(f"\nShifts by period:")
for period in sorted(shifts_by_period.keys()):
    period_shifts = shifts_by_period[period]
    period_toi = sum(max(0, (s.get("shift_end_time_seconds") or 0) - (s.get("shift_start_time_seconds") or 0)) for s in period_shifts)
    print(f"  Period {period}: {len(period_shifts)} shifts, {period_toi:.1f}s ({period_toi/60:.2f} min)")

# Show shift details
print(f"\nShift Details (first 10):")
for idx, shift in enumerate(sorted(shifts, key=lambda x: (x.get("period", 1), x.get("shift_start_time_seconds", 0)))[:10], 1):
    start = shift.get("shift_start_time_seconds", 0)
    end = shift.get("shift_end_time_seconds", 0)
    period = shift.get("period", 1)
    duration = max(0, end - start)
    start_min = int(start // 60)
    start_sec = int(start % 60)
    end_min = int(end // 60)
    end_sec = int(end % 60)
    print(f"  {idx}. Period {period}: {start_min:02d}:{start_sec:02d} - {end_min:02d}:{end_sec:02d} ({duration:.1f}s)")

# Now analyze play-by-play to see what events occur during these shifts
print(f"\n" + "=" * 80)
print("Play-by-Play Analysis During Shifts:")
print("=" * 80)

# For each shift, find plays that occurred during it
for idx, shift in enumerate(sorted(shifts, key=lambda x: (x.get("period", 1), x.get("shift_start_time_seconds", 0)))[:5], 1):
    start = shift.get("shift_start_time_seconds", 0)
    end = shift.get("shift_end_time_seconds", 0)
    period = shift.get("period", 1)
    
    print(f"\nShift {idx} (Period {period}, {start:.1f}s - {end:.1f}s):")
    
    # Find plays during this shift
    plays_during_shift = []
    for play in plays:
        play_period_desc = play.get("periodDescriptor", {})
        play_period = play_period_desc.get("number", 1)
        if play_period != period:
            continue
        
        time_str = play.get("timeInPeriod", "")
        if not time_str:
            continue
        
        # Parse time
        try:
            parts = time_str.split(":")
            if len(parts) == 2:
                play_time = int(parts[0]) * 60 + int(parts[1])
                if start <= play_time <= end:
                    plays_during_shift.append((play_time, play))
        except:
            pass
    
    print(f"  Plays during shift: {len(plays_during_shift)}")
    
    # Show event types
    event_types = defaultdict(int)
    for play_time, play in plays_during_shift[:10]:  # First 10
        event_type = play.get("typeDescKey") or play.get("typeCode") or "unknown"
        event_types[event_type] += 1
        details = play.get("details", {})
        
        # Check if McDavid is involved
        mcdavid_involved = False
        if details.get("scoringPlayerId") == MCDAVID_ID:
            mcdavid_involved = True
        if details.get("assist1PlayerId") == MCDAVID_ID or details.get("assist2PlayerId") == MCDAVID_ID:
            mcdavid_involved = True
        if details.get("shootingPlayerId") == MCDAVID_ID:
            mcdavid_involved = True
        
        marker = " [MCDAVID]" if mcdavid_involved else ""
        print(f"    {play_time//60:02d}:{play_time%60:02d} - {event_type}{marker}")
    
    if len(plays_during_shift) > 10:
        print(f"    ... and {len(plays_during_shift) - 10} more plays")

# Now check what our calculated shifts show
print(f"\n" + "=" * 80)
print("Our Calculated Shifts (from calculate_player_toi.py):")
print("=" * 80)

calculated_shifts = db.select(
    "player_shifts",
    select="shift_start_time_seconds,shift_end_time_seconds,period",
    filters=[("game_id", "eq", game_id), ("player_id", "eq", MCDAVID_ID)]
)

if calculated_shifts:
    calc_total_toi = sum(max(0, (s.get("shift_end_time_seconds") or 0) - (s.get("shift_start_time_seconds") or 0)) for s in calculated_shifts)
    print(f"  Total shifts: {len(calculated_shifts)}")
    print(f"  Total TOI: {calc_total_toi:.1f} seconds ({calc_total_toi/60:.2f} minutes)")
    print(f"  Official TOI: {total_toi:.1f} seconds ({total_toi/60:.2f} minutes)")
    print(f"  Difference: {total_toi - calc_total_toi:.1f} seconds ({(total_toi - calc_total_toi)/60:.2f} minutes)")
    
    # Compare shift counts
    print(f"\n  Shift count comparison:")
    print(f"    Official: {len(shifts)} shifts")
    print(f"    Calculated: {len(calculated_shifts)} shifts")
    print(f"    Difference: {len(shifts) - len(calculated_shifts)} shifts")
else:
    print("  No calculated shifts found for this game")

# Check player_toi_by_situation
print(f"\n" + "=" * 80)
print("Our TOI by Situation:")
print("=" * 80)

toi_by_situation = db.select(
    "player_toi_by_situation",
    select="situation,toi_seconds",
    filters=[("game_id", "eq", game_id), ("player_id", "eq", MCDAVID_ID)]
)

if toi_by_situation:
    total_situation_toi = sum(t.get("toi_seconds", 0) or 0 for t in toi_by_situation)
    print(f"  Total TOI from situations: {total_situation_toi:.1f} seconds ({total_situation_toi/60:.2f} minutes)")
    for t in toi_by_situation:
        situation = t.get("situation", "unknown")
        toi = t.get("toi_seconds", 0) or 0
        print(f"    {situation}: {toi:.1f}s ({toi/60:.2f} min)")
else:
    print("  No TOI by situation found")

print(f"\n" + "=" * 80)
print("KEY INSIGHTS:")
print("=" * 80)
print("1. Official shifts show the TRUE pattern we need to match")
print("2. Compare our calculated shifts to official to find gaps")
print("3. Analyze what events/patterns trigger shift starts/ends")
print("4. Build model that matches official shift patterns")
