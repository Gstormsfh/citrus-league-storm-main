#!/usr/bin/env python3
"""
Super fast update: Only update players missing hits/blocks data.
Skips players who already have data, uses minimal retries.
"""

import os
import sys
import requests
import time
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def _safe_int(v, default=0) -> int:
    try:
        return int(v) if v is not None else default
    except Exception:
        return default

def fetch_player_statsapi_data(player_id: int, season_string: str, max_retries: int = 1):
    """Fetch with only 1 retry for speed."""
    base_url = "https://statsapi.web.nhl.com/api/v1/people"
    
    for attempt in range(max_retries + 1):
        try:
            url = f"{base_url}/{player_id}/stats"
            params = {"stats": "statsSingleSeason", "season": season_string}
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            
            if "stats" in data and len(data["stats"]) > 0:
                stats = data["stats"][0]
                if "splits" in stats and len(stats["splits"]) > 0:
                    split = stats["splits"][0]
                    if "stat" in split:
                        return split["stat"]
            return None
        except Exception:
            if attempt < max_retries:
                time.sleep(1)  # Only 1 second delay
            return None
    
    return None

def extract_hits_blocks(statsapi_data: dict) -> tuple:
    if not statsapi_data:
        return (0, 0)
    hits = _safe_int(statsapi_data.get("hits", 0), 0)
    blocks = _safe_int(statsapi_data.get("blockedShots", 0), 0)
    return (hits, blocks)

print("=" * 80)
print("SUPER FAST HITS/BLOCKS UPDATE")
print("=" * 80)
print("Only updating players missing hits/blocks data")
print()

# Get all skaters
all_skaters = db.select(
    "player_directory",
    select="player_id,full_name",
    filters=[
        ("season", "eq", DEFAULT_SEASON),
        ("is_goalie", "eq", False)
    ],
    limit=10000
)

# Get players who already have hits/blocks > 0
existing = db.select(
    "player_season_stats",
    select="player_id",
    filters=[
        ("season", "eq", DEFAULT_SEASON),
        ("nhl_hits", "gt", 0)
    ],
    limit=10000
)
existing_ids = {p["player_id"] for p in existing} if existing else set()

# Filter to only players missing data
players_to_update = [p for p in all_skaters if p.get("player_id") not in existing_ids]

print(f"Total skaters: {len(all_skaters) if all_skaters else 0:,}")
print(f"Already have hits data: {len(existing_ids):,}")
print(f"Need to update: {len(players_to_update):,}")
print()

updated = 0
errors = 0
not_found = 0
last_progress = time.time()
season_string = f"{DEFAULT_SEASON}{DEFAULT_SEASON + 1}"

for idx, player in enumerate(players_to_update, 1):
    player_id = _safe_int(player.get("player_id"), 0)
    if not player_id:
        continue
    
    try:
        statsapi_data = fetch_player_statsapi_data(player_id, season_string, max_retries=1)
        
        if statsapi_data:
            hits, blocks = extract_hits_blocks(statsapi_data)
            
            if hits > 0 or blocks > 0:  # Only update if we got data
                updates = {
                    "season": DEFAULT_SEASON,
                    "player_id": player_id,
                    "nhl_hits": hits,
                    "nhl_blocks": blocks,
                }
                db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
                updated += 1
        else:
            not_found += 1
    except Exception:
        errors += 1
    
    # Progress every 5 players OR every 3 seconds (more frequent)
    current_time = time.time()
    if idx % 5 == 0 or (current_time - last_progress >= 3.0):
        elapsed = current_time - (last_progress if idx > 5 else time.time() - (idx * 0.1))
        if idx > 0:
            rate = idx / elapsed if elapsed > 0 else 0
            remaining = len(players_to_update) - idx
            eta_seconds = remaining / rate if rate > 0 else 0
            eta_minutes = eta_seconds / 60
            pct = (idx / len(players_to_update)) * 100
            print(f"[{idx:4d}/{len(players_to_update)}] {pct:5.1f}% | Updated: {updated:3d} | Errors: {errors:2d} | Not Found: {not_found:3d} | Rate: {rate:.1f}/s | ETA: {eta_minutes:.1f}m", flush=True)
        last_progress = current_time
    
    # Minimal delay
    time.sleep(0.1)

print()
print("=" * 80)
print("COMPLETE")
print("=" * 80)
print(f"Updated: {updated:,}")
print(f"Errors: {errors:,}")
print(f"Not Found: {not_found:,}")
print("=" * 80)

