#!/usr/bin/env python3
"""
fetch_nhl_stats_from_landing.py

Fetch TOI and plus/minus season totals from NHL.com landing endpoint (api-web.nhle.com).
This endpoint works reliably and avoids DNS issues with statsapi.web.nhl.com.

Fetches both metrics in a single API call per player:
- TOI: from seasonTotals (last item = current season), avgToi * gamesPlayed
- Plus/minus: from seasonTotals (last item) or featuredStats.regularSeason.subSeason
"""

import os
import sys
import time
import requests
from typing import Optional, Dict, Tuple
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_API_BASE = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _safe_int(v, default=0) -> int:
    try:
        return int(v) if v is not None else default
    except Exception:
        return default


def parse_time_to_seconds(time_str: str) -> int:
    """
    Parse time string from NHL API (format: "MM:SS" or "HH:MM:SS").
    Returns total seconds.
    """
    if not time_str or not isinstance(time_str, str):
        return 0
    
    try:
        parts = time_str.split(":")
        if len(parts) == 3:  # HH:MM:SS
            hours = _safe_int(parts[0], 0)
            minutes = _safe_int(parts[1], 0)
            seconds = _safe_int(parts[2], 0)
            return hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:  # MM:SS
            minutes = _safe_int(parts[0], 0)
            seconds = _safe_int(parts[1], 0)
            return minutes * 60 + seconds
        else:
            return _safe_int(time_str, 0)
    except Exception:
        return 0


def fetch_player_landing_data(player_id: int) -> Optional[Dict]:
    """
    Fetch player landing page data from api-web.nhle.com.
    Returns dict with player data, or None if not found.
    """
    try:
        url = f"{NHL_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  Error fetching landing data for player {player_id}: {e}")
        return None


def extract_toi_and_plus_minus(landing_data: Dict, target_season: int) -> Tuple[int, int]:
    """
    Extract TOI (total seconds) and plus/minus from landing endpoint response.
    
    TOI: Get from seasonTotals (last item = current season), calculate total from avgToi * gamesPlayed
    Plus/minus: Get from seasonTotals (last item) or featuredStats.regularSeason.subSeason
    
    Returns: (toi_seconds, plus_minus)
    """
    toi_seconds = 0
    plus_minus = 0
    
    # Method 1: Get from seasonTotals (last item is current season)
    if "seasonTotals" in landing_data and isinstance(landing_data["seasonTotals"], list):
        season_totals = landing_data["seasonTotals"]
        if len(season_totals) > 0:
            # Last item should be current season
            current_season_data = season_totals[-1]
            
            # Check if this is the right season
            season_id = current_season_data.get("season", 0)
            # Season format: 20252026 (we want 2025)
            season_start = season_id // 10000 if season_id > 0 else 0
            
            if season_start == target_season or season_start == 0:  # 0 means we'll use it anyway
                # Extract TOI
                avg_toi_str = current_season_data.get("avgToi")
                games_played = _safe_int(current_season_data.get("gamesPlayed", 0), 0)
                
                if avg_toi_str and games_played > 0:
                    avg_toi_seconds = parse_time_to_seconds(avg_toi_str)
                    toi_seconds = avg_toi_seconds * games_played
                
                # Extract plus/minus
                plus_minus = _safe_int(current_season_data.get("plusMinus", 0), 0)
    
    # Method 2: Fallback to featuredStats if seasonTotals didn't work
    if toi_seconds == 0 or plus_minus == 0:
        if "featuredStats" in landing_data:
            featured = landing_data["featuredStats"]
            if "regularSeason" in featured:
                rs = featured["regularSeason"]
                if "subSeason" in rs:
                    sub = rs["subSeason"]
                    
                    # Get plus/minus from subSeason if we didn't get it from seasonTotals
                    if plus_minus == 0:
                        plus_minus = _safe_int(sub.get("plusMinus", 0), 0)
    
    return (toi_seconds, plus_minus)


def main() -> int:
    print("=" * 80)
    print("[fetch_nhl_stats_from_landing] STARTING")
    print("=" * 80)
    print(f"Season: {DEFAULT_SEASON}")
    print("Fetching TOI and plus/minus from NHL.com landing endpoint...")
    print(f"API: {NHL_API_BASE}/player/{{id}}/landing")
    print()
    
    try:
        db = supabase_client()
        print("[fetch_nhl_stats] Connected to Supabase")
    except Exception as e:
        print(f"[fetch_nhl_stats] ERROR: Failed to connect: {e}")
        return 1
    
    # Get all players from player_directory
    print("[fetch_nhl_stats] Fetching players from player_directory...")
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
    
    print(f"[fetch_nhl_stats] Found {len(players):,} players")
    print()
    
    # Fetch stats for each player
    updated_toi_count = 0
    updated_pm_count = 0
    not_found_count = 0
    error_count = 0
    last_progress_time = time.time()
    
    for idx, player in enumerate(players, 1):
        player_id = _safe_int(player.get("player_id"), 0)
        player_name = player.get("full_name", "Unknown")
        if not player_id:
            continue
        
        # Fetch from NHL API
        landing_data = fetch_player_landing_data(player_id)
        
        if landing_data:
            toi_seconds, plus_minus = extract_toi_and_plus_minus(landing_data, DEFAULT_SEASON)
            
            # Update database if we got valid data
            updates = {}
            if toi_seconds > 0:
                updates["nhl_toi_seconds"] = toi_seconds
            if plus_minus != 0 or toi_seconds > 0:  # Update even if 0 (might be accurate)
                updates["nhl_plus_minus"] = plus_minus
            
            if updates:
                try:
                    updates["season"] = DEFAULT_SEASON
                    updates["player_id"] = player_id
                    db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
                    
                    if toi_seconds > 0:
                        updated_toi_count += 1
                    if plus_minus != 0 or toi_seconds > 0:
                        updated_pm_count += 1
                except Exception as e:
                    print(f"  [ERROR] Failed to update player {player_id} ({player_name}): {e}")
                    error_count += 1
            else:
                not_found_count += 1
        else:
            not_found_count += 1
        
        # Progress every 15 seconds
        current_time = time.time()
        if current_time - last_progress_time >= 15:
            print(f"  [PROGRESS] Processed {idx}/{len(players)} players ({updated_toi_count} TOI updated, {updated_pm_count} +/- updated, {not_found_count} not found, {error_count} errors)...")
            last_progress_time = current_time
        
        # Rate limiting
        if idx < len(players):
            time.sleep(0.1)  # 100ms delay between requests
    
    print()
    print("=" * 80)
    print("[fetch_nhl_stats_from_landing] COMPLETE")
    print("=" * 80)
    print(f"Players processed: {len(players):,}")
    print(f"TOI updated: {updated_toi_count:,}")
    print(f"Plus/minus updated: {updated_pm_count:,}")
    print(f"Not found: {not_found_count:,}")
    print(f"Errors: {error_count:,}")
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
