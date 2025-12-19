#!/usr/bin/env python3
"""Test script to fetch just McDavid's TOI from NHL.com API."""

import os
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025

def parse_time_string(time_str: str) -> int:
    """Parse time string from NHL API (format: "HH:MM:SS" or "MM:SS"). Returns total seconds."""
    if not time_str or not isinstance(time_str, str):
        return 0
    try:
        parts = time_str.split(":")
        if len(parts) == 3:  # HH:MM:SS
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = int(parts[2])
            return hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:  # MM:SS
            minutes = int(parts[0])
            seconds = int(parts[1])
            return minutes * 60 + seconds
        else:
            return int(time_str) if time_str.isdigit() else 0
    except Exception:
        return 0

print("=" * 80)
print("FETCHING MCDAVID TOI FROM NHL.COM")
print("=" * 80)
print()

# Fetch from NHL Stats API
season_str = f"{DEFAULT_SEASON}{DEFAULT_SEASON+1}"
url = f"https://statsapi.web.nhl.com/api/v1/people/{MCDAVID_ID}/stats?stats=statsSingleSeason&season={season_str}"

print(f"Fetching from: {url}")
try:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    data = response.json()
    
    stats_list = data.get("stats", [])
    if not stats_list:
        print("[ERROR] No stats found in response")
        exit(1)
    
    splits = stats_list[0].get("splits", [])
    if not splits:
        print("[ERROR] No splits found in response")
        exit(1)
    
    stat_data = splits[0].get("stat", {})
    toi_str = stat_data.get("timeOnIce") or stat_data.get("evenTimeOnIce")
    
    if toi_str:
        toi_seconds = parse_time_string(toi_str)
        print(f"[OK] Found TOI: {toi_str} = {toi_seconds} seconds ({toi_seconds / 60:.1f} minutes)")
        
        # Update database
        db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
        games_played = stat_data.get("games", 0)
        toi_per_game = toi_seconds / games_played if games_played > 0 else 0
        
        print(f"Games played: {games_played}")
        print(f"TOI per game: {toi_per_game / 60:.2f} minutes ({toi_per_game / 60:.2f} min/game)")
        
        # Update in database
        db.upsert(
            "player_season_stats",
            {
                "season": DEFAULT_SEASON,
                "player_id": MCDAVID_ID,
                "nhl_toi_seconds": toi_seconds
            },
            on_conflict="season,player_id"
        )
        
        print(f"[OK] Updated McDavid's nhl_toi_seconds to {toi_seconds} seconds")
        print(f"[OK] This should show as {toi_per_game / 60:.2f} min/game in the frontend")
    else:
        print("[ERROR] No TOI found in stat data")
        print(f"Available fields: {list(stat_data.keys())}")
        
except requests.exceptions.RequestException as e:
    print(f"[ERROR] Network error: {e}")
    print("[INFO] This is likely a DNS/network connectivity issue")
    print("[INFO] Try again when network is stable")
except Exception as e:
    print(f"[ERROR] Unexpected error: {e}")
    import traceback
    traceback.print_exc()
