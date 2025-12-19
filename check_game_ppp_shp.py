#!/usr/bin/env python3
"""Check a specific game's power play windows and goals to debug PPP/SHP."""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import json

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# Game to check
GAME_ID = 2025020534
MCDAVID_ID = 8478402

print("=" * 80)
print(f"CHECKING GAME {GAME_ID} FOR PPP/SHP")
print("=" * 80)
print()

# Get raw PBP
raw_data = db.select(
    "raw_nhl_data",
    select="raw_json",
    filters=[("game_id", "eq", GAME_ID)],
    limit=1
)

if not raw_data:
    print(f"[ERROR] Game {GAME_ID} not found in raw_nhl_data")
    exit(1)

pbp = raw_data[0].get("raw_json") or {}
if isinstance(pbp, str):
    import json
    pbp = json.loads(pbp)

# Import extractor functions
sys.path.insert(0, '.')
from extractor_job import _track_power_play_windows, _parse_time_to_seconds, _safe_int

# Build power play windows
pp_windows = _track_power_play_windows(pbp)

print(f"Power play windows found: {len(pp_windows)} seconds")
if len(pp_windows) > 0:
    print(f"  Sample: {list(pp_windows.items())[:5]}")
print()

# Find McDavid's goals and assists
plays = pbp.get("plays") or []
home_team_id = _safe_int((pbp.get("homeTeam") or {}).get("id"), 0)
away_team_id = _safe_int((pbp.get("awayTeam") or {}).get("id"), 0)

print("McDavid's goals and assists in this game:")
print()

for play in plays:
    details = play.get("details") or {}
    
    scoring_pid = _safe_int(details.get("scoringPlayerId"), 0)
    assist1_pid = _safe_int(details.get("assist1PlayerId"), 0)
    assist2_pid = _safe_int(details.get("assist2PlayerId"), 0)
    
    if scoring_pid == MCDAVID_ID or assist1_pid == MCDAVID_ID or assist2_pid == MCDAVID_ID:
        period_desc = play.get("periodDescriptor") or {}
        period = _safe_int(period_desc.get("number"), 1)
        time_str = play.get("timeInPeriod", "")
        time_seconds = _parse_time_to_seconds(time_str)
        game_time = int((period - 1) * 1200.0 + time_seconds)
        
        scoring_team_id = _safe_int(details.get("eventOwnerTeamId"), 0)
        is_home_scoring = (scoring_team_id == home_team_id) if scoring_team_id and home_team_id else None
        
        situation = pp_windows.get(game_time)
        
        role = []
        if scoring_pid == MCDAVID_ID:
            role.append("GOAL")
        if assist1_pid == MCDAVID_ID:
            role.append("ASSIST1")
        if assist2_pid == MCDAVID_ID:
            role.append("ASSIST2")
        
        print(f"  Period {period}, {time_str} (game_time={game_time}s)")
        print(f"    Role: {', '.join(role)}")
        print(f"    Situation at goal time: {situation or 'EVEN'}")
        print(f"    Scoring team: {'HOME' if is_home_scoring else 'AWAY' if is_home_scoring is False else 'UNKNOWN'}")
        
        # Determine if should be PP or SH
        is_pp = False
        is_sh = False
        
        if situation == "HOME_PP" and is_home_scoring is True:
            is_pp = True
        elif situation == "AWAY_PP" and is_home_scoring is False:
            is_pp = True
        elif situation == "HOME_PP" and is_home_scoring is False:
            is_sh = True
        elif situation == "AWAY_PP" and is_home_scoring is True:
            is_sh = True
        
        print(f"    Should be PP: {is_pp}, SH: {is_sh}")
        
        # Check nearby times
        print(f"    Nearby situations:")
        for offset in [-2, -1, 0, 1, 2]:
            nearby_time = game_time + offset
            nearby_situation = pp_windows.get(nearby_time)
            if nearby_situation:
                print(f"      {nearby_time}s ({offset:+d}): {nearby_situation}")
        print()
