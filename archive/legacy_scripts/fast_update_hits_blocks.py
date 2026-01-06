#!/usr/bin/env python3
"""
Fast update: Update hits and blocks from StatsAPI.
Optimized with better error handling and progress tracking.
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

def fetch_player_statsapi_data(player_id: int, season_string: str, max_retries: int = 3):
    """
    Fetch player stats from StatsAPI with retries.
    Returns dict with hits and blocks, or None if failed.
    """
    base_url = "https://statsapi.web.nhl.com/api/v1/people"
    
    for attempt in range(max_retries):
        try:
            url = f"{base_url}/{player_id}/stats"
            params = {
                "stats": "statsSingleSeason",
                "season": season_string
            }
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if "stats" in data and len(data["stats"]) > 0:
                stats = data["stats"][0]
                if "splits" in stats and len(stats["splits"]) > 0:
                    split = stats["splits"][0]
                    if "stat" in split:
                        return split["stat"]
            
            return None
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                delay = 2 ** (attempt + 1)  # 2s, 4s, 8s
                time.sleep(delay)
            else:
                return None
        except Exception:
            return None
    
    return None

def extract_hits_blocks(statsapi_data: dict) -> tuple:
    """Extract hits and blocks from StatsAPI data."""
    if not statsapi_data:
        return (0, 0)
    
    hits = _safe_int(statsapi_data.get("hits", 0), 0)
    blocks = _safe_int(statsapi_data.get("blockedShots", 0), 0)
    
    return (hits, blocks)

print("=" * 80)
print("FAST HITS/BLOCKS UPDATE (StatsAPI)")
print("=" * 80)
print("Updating hits and blocks for all skaters")
print()

# Get all skaters (not goalies)
players = []
offset = 0
batch_size = 1000

while True:
    batch = db.select(
        "player_directory",
        select="player_id,full_name",
        filters=[
            ("season", "eq", DEFAULT_SEASON),
            ("is_goalie", "eq", False)
        ],
        limit=batch_size,
        offset=offset
    )
    if not batch:
        break
    players.extend(batch)
    if len(batch) < batch_size:
        break
    offset += batch_size

print(f"Found {len(players):,} skaters")
print()

updated = 0
errors = 0
not_found = 0
skipped = 0
last_progress = time.time()
season_string = f"{DEFAULT_SEASON}{DEFAULT_SEASON + 1}"  # "20252026"

for idx, player in enumerate(players, 1):
    player_id = _safe_int(player.get("player_id"), 0)
    player_name = player.get("full_name", "Unknown")
    
    if not player_id:
        skipped += 1
        continue
    
    try:
        statsapi_data = fetch_player_statsapi_data(player_id, season_string, max_retries=2)  # Only 2 retries for speed
        
        if statsapi_data:
            hits, blocks = extract_hits_blocks(statsapi_data)
            
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
    except Exception as e:
        errors += 1
    
    # Progress every 25 players (more frequent since StatsAPI is slower)
    if idx % 25 == 0:
        elapsed = time.time() - last_progress
        rate = 25 / elapsed if elapsed > 0 else 0
        remaining = len(players) - idx
        eta_seconds = remaining / rate if rate > 0 else 0
        eta_minutes = eta_seconds / 60
        
        print(f"[{idx}/{len(players)}] Updated: {updated}, Errors: {errors}, Not Found: {not_found} | ETA: {eta_minutes:.1f} min")
        last_progress = time.time()
    
    # Rate limiting (slightly longer for StatsAPI)
    time.sleep(0.2)

print()
print("=" * 80)
print("COMPLETE")
print("=" * 80)
print(f"Updated: {updated:,}")
print(f"Errors: {errors:,}")
print(f"Not Found: {not_found:,}")
print(f"Skipped: {skipped:,}")
print()
print("Note: Some players may show 0 hits/blocks if StatsAPI doesn't have data")
print("      or if the API is unavailable. This is expected for some players.")
print("=" * 80)

