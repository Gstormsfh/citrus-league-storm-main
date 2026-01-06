#!/usr/bin/env python3
"""
Fast update: Only update PPP/SHP from landing endpoint (skip StatsAPI hits/blocks).
This is much faster since we don't wait for StatsAPI retries.
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
NHL_API_BASE = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def _safe_int(v, default=0) -> int:
    try:
        return int(v) if v is not None else default
    except Exception:
        return default

def fetch_player_landing_data(player_id: int):
    """Fetch player landing page data."""
    try:
        url = f"{NHL_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return None

def extract_ppp_shp(landing_data: dict, target_season: int) -> tuple:
    """Extract PPP and SHP from landing data."""
    ppp = 0
    shp = 0
    
    if "featuredStats" in landing_data:
        featured = landing_data["featuredStats"]
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                ppp = _safe_int(sub.get("powerPlayPoints", 0), 0)
                shp = _safe_int(sub.get("shorthandedPoints", 0), 0)
                return (ppp, shp)
    
    # Fallback to seasonTotals
    if "seasonTotals" in landing_data and isinstance(landing_data["seasonTotals"], list):
        for season_data in reversed(landing_data["seasonTotals"]):
            season_id = _safe_int(season_data.get("season", 0), 0)
            if season_id == target_season:
                ppp = _safe_int(season_data.get("powerPlayPoints", 0), 0)
                shp = _safe_int(season_data.get("shorthandedPoints", 0), 0)
                return (ppp, shp)
    
    return (ppp, shp)

print("=" * 80)
print("FAST PPP/SHP UPDATE (Landing Endpoint Only)")
print("=" * 80)
print("Skipping StatsAPI (hits/blocks) for speed")
print()

# Get all players
players = []
offset = 0
batch_size = 1000

while True:
    batch = db.select("player_directory", select="player_id,full_name", limit=batch_size, offset=offset)
    if not batch:
        break
    players.extend(batch)
    if len(batch) < batch_size:
        break
    offset += batch_size

print(f"Found {len(players):,} players")
print()

updated = 0
errors = 0
not_found = 0
last_progress = time.time()

for idx, player in enumerate(players, 1):
    player_id = _safe_int(player.get("player_id"), 0)
    player_name = player.get("full_name", "Unknown")
    
    if not player_id:
        continue
    
    try:
        landing_data = fetch_player_landing_data(player_id)
        if landing_data:
            ppp, shp = extract_ppp_shp(landing_data, DEFAULT_SEASON)
            
            updates = {
                "season": DEFAULT_SEASON,
                "player_id": player_id,
                "nhl_ppp": ppp,
                "nhl_shp": shp,
            }
            
            db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
            updated += 1
        else:
            not_found += 1
    except Exception as e:
        errors += 1
    
    # Progress every 50 players
    if idx % 50 == 0:
        elapsed = time.time() - last_progress
        rate = 50 / elapsed if elapsed > 0 else 0
        remaining = len(players) - idx
        eta_seconds = remaining / rate if rate > 0 else 0
        eta_minutes = eta_seconds / 60
        
        print(f"[{idx}/{len(players)}] Updated: {updated}, Errors: {errors}, Not Found: {not_found} | ETA: {eta_minutes:.1f} min")
        last_progress = time.time()
    
    # Rate limiting (much faster - 0.1s)
    time.sleep(0.1)

print()
print("=" * 80)
print("COMPLETE")
print("=" * 80)
print(f"Updated: {updated:,}")
print(f"Errors: {errors:,}")
print(f"Not Found: {not_found:,}")
print("=" * 80)

