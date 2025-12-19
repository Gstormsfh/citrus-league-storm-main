#!/usr/bin/env python3
"""
Deep analysis of shift patterns to understand:
1. What triggers shift starts?
2. What triggers shift ends?
3. How do we track ALL players on ice, not just event participants?
"""

import os
import json
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from collections import defaultdict

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
MCDAVID_ID = 8478402
game_id = 2025020207  # Game we analyzed

# Get official shifts
official_shifts = db.select(
    "player_shifts_official",
    select="shift_start_time_seconds,shift_end_time_seconds,period",
    filters=[("game_id", "eq", game_id), ("player_id", "eq", MCDAVID_ID)]
)

# Get play-by-play
game_data = db.select("raw_nhl_data", select="raw_json", filters=[("game_id", "eq", game_id)], limit=1)
pbp = game_data[0].get("raw_json", {})
plays = pbp.get("plays", [])

home_team_id = pbp.get("homeTeam", {}).get("id")
away_team_id = pbp.get("awayTeam", {}).get("id")
mcdavid_team_id = 22  # EDM

def parse_time(time_str):
    try:
        parts = time_str.split(":")
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except:
        pass
    return 0

print("=" * 80)
print("SHIFT START/END PATTERN ANALYSIS")
print("=" * 80)

# For each shift, analyze what happens at start and end
for idx, shift in enumerate(sorted(official_shifts, key=lambda x: (x.get("period", 1), x.get("shift_start_time_seconds", 0)))[:10], 1):
    start = shift.get("shift_start_time_seconds", 0)
    end = shift.get("shift_end_time_seconds", 0)
    period = shift.get("period", 1)
    
    print(f"\nShift {idx} (Period {period}):")
    print(f"  Start: {start//60:02d}:{start%60:02d} ({start}s)")
    print(f"  End: {end//60:02d}:{end%60:02d} ({end}s)")
    print(f"  Duration: {end - start:.1f}s")
    
    # Find plays right before shift start (within 5 seconds)
    plays_before_start = []
    for play in plays:
        play_period = play.get("periodDescriptor", {}).get("number", 1)
        if play_period != period:
            continue
        play_time = parse_time(play.get("timeInPeriod", ""))
        if start - 5 <= play_time <= start + 2:
            plays_before_start.append((play_time, play))
    
    # Find plays right after shift end (within 5 seconds)
    plays_after_end = []
    for play in plays:
        play_period = play.get("periodDescriptor", {}).get("number", 1)
        if play_period != period:
            continue
        play_time = parse_time(play.get("timeInPeriod", ""))
        if end - 2 <= play_time <= end + 5:
            plays_after_end.append((play_time, play))
    
    print(f"  Events at START (within 5s):")
    if plays_before_start:
        for play_time, play in sorted(plays_before_start, key=lambda x: x[0]):
            event_type = play.get("typeDescKey") or play.get("typeCode") or "unknown"
            situation = play.get("situationCode", "")
            print(f"    {play_time//60:02d}:{play_time%60:02d} - {event_type} (situation: {situation})")
    else:
        print(f"    No events found (shift may start at period start or after stoppage)")
    
    print(f"  Events at END (within 5s):")
    if plays_after_end:
        for play_time, play in sorted(plays_after_end, key=lambda x: x[0]):
            event_type = play.get("typeDescKey") or play.get("typeCode") or "unknown"
            situation = play.get("situationCode", "")
            print(f"    {play_time//60:02d}:{play_time%60:02d} - {event_type} (situation: {situation})")
    else:
        print(f"    No events found (shift may end at period end or before stoppage)")

# Analyze all players' shifts to understand line patterns
print(f"\n" + "=" * 80)
print("LINE PATTERN ANALYSIS")
print("=" * 80)

# Get all official shifts for this game (all players)
all_shifts = db.select(
    "player_shifts_official",
    select="player_id,shift_start_time_seconds,shift_end_time_seconds,period",
    filters=[("game_id", "eq", game_id)],
    limit=1000
)

# Group shifts by time windows to see who's on ice together
print(f"\nAnalyzing who's on ice together (sample from Period 1, first 5 minutes):")
period_1_shifts = [s for s in all_shifts if s.get("period") == 1 and s.get("shift_start_time_seconds", 0) < 300]

# For each 10-second window, see who's on ice
for time_window in range(0, 300, 30):  # Every 30 seconds
    players_on_ice = []
    for shift in period_1_shifts:
        start = shift.get("shift_start_time_seconds", 0)
        end = shift.get("shift_end_time_seconds", 0)
        if start <= time_window <= end:
            players_on_ice.append(shift.get("player_id"))
    
    if players_on_ice:
        print(f"  {time_window//60:02d}:{time_window%60:02d} - {len(players_on_ice)} players on ice")

# Analyze situation codes during shifts
print(f"\n" + "=" * 80)
print("SITUATION CODE ANALYSIS")
print("=" * 80)

print(f"\nAnalyzing situation codes during McDavid's shifts:")
for idx, shift in enumerate(sorted(official_shifts, key=lambda x: (x.get("period", 1), x.get("shift_start_time_seconds", 0)))[:5], 1):
    start = shift.get("shift_start_time_seconds", 0)
    end = shift.get("shift_end_time_seconds", 0)
    period = shift.get("period", 1)
    
    situations = defaultdict(int)
    for play in plays:
        play_period = play.get("periodDescriptor", {}).get("number", 1)
        if play_period != period:
            continue
        play_time = parse_time(play.get("timeInPeriod", ""))
        if start <= play_time <= end:
            situation = play.get("situationCode", "")
            if situation:
                situations[situation] += 1
    
    print(f"\n  Shift {idx} ({start//60:02d}:{start%60:02d} - {end//60:02d}:{end%60:02d}):")
    for situation, count in sorted(situations.items(), key=lambda x: -x[1]):
        print(f"    {situation}: {count} events")

print(f"\n" + "=" * 80)
print("KEY FINDINGS:")
print("=" * 80)
print("1. Shifts can start/end without clear events (period starts, stoppages)")
print("2. Players are on ice even when not in play-by-play events")
print("3. Situation codes tell us skater counts but not WHO is on ice")
print("4. We need to track line changes and infer who's on ice from context")
print("5. Official shifts are more granular - we're missing many short shifts")
