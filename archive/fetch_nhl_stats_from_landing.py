#!/usr/bin/env python3
"""
fetch_nhl_stats_from_landing.py

Fetch all official NHL.com statistics from landing endpoint (api-web.nhle.com).
This endpoint works reliably and avoids DNS issues with statsapi.web.nhl.com.

Fetches comprehensive stats in a single API call per player:
- Skaters: Goals, Assists, Points, SOG, PIM, PPP, SHP, TOI, +/-
- Goalies: Wins, Losses, OTL, Saves, Shots Faced, GA, GAA, SV%, Shutouts, TOI
- Note: Hits and blocks are NOT available from landing endpoint (need StatsAPI fallback)
"""

import os
import sys
import time
import requests
from typing import Optional, Dict, Tuple, Any
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_API_BASE = "https://api-web.nhle.com/v1"
STATS_API_BASE = "https://statsapi.web.nhl.com/api/v1"
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
    
    Examples:
    - "22:41" -> 1361 seconds (22 minutes, 41 seconds)
    - "1750:03" -> 630003 seconds (1750 hours, 3 seconds - goalie TOI)
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
        elif len(parts) == 2:  # MM:SS or HH:MM (for goalie TOI like "1750:03")
            # Check if first part is > 60 (likely hours:minutes format)
            first_part = _safe_int(parts[0], 0)
            if first_part > 60:
                # Likely HH:MM format (e.g., "1750:03" = 1750 hours, 3 minutes)
                hours = first_part
                minutes = _safe_int(parts[1], 0)
                return hours * 3600 + minutes * 60
            else:
                # MM:SS format
                minutes = first_part
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


def fetch_player_statsapi_data(player_id: int, season: str, retries: int = 3) -> Optional[Dict[str, Any]]:
    """
    Fetch player stats from StatsAPI endpoint (fallback for hits/blocks).
    Returns dict with stats or None if failed.
    """
    for attempt in range(retries):
        try:
            url = f"{STATS_API_BASE}/people/{player_id}/stats"
            params = {
                "stats": "statsSingleSeason",
                "season": season
            }
            response = requests.get(url, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            # Extract stats from response
            stats_list = data.get("stats", [])
            if stats_list:
                splits = stats_list[0].get("splits", [])
                if splits:
                    return splits[0].get("stat", {})
            
            return None
            
        except requests.exceptions.RequestException as e:
            if attempt < retries - 1:
                time.sleep(2)  # Wait before retry
            else:
                # StatsAPI often has DNS issues - this is expected, don't log as error
                return None
        except Exception as e:
            return None
    
    return None


def extract_hits_blocks_from_statsapi(statsapi_data: Dict[str, Any]) -> Tuple[int, int]:
    """
    Extract hits and blocks from StatsAPI response.
    Returns: (hits, blocks)
    """
    if not statsapi_data:
        return (0, 0)
    
    hits = _safe_int(statsapi_data.get("hits", 0), 0)
    blocks = _safe_int(statsapi_data.get("blocked", 0), 0)  # StatsAPI uses "blocked" not "blocks"
    
    return (hits, blocks)


def extract_all_official_stats(landing_data: Dict, target_season: int, is_goalie: bool = False) -> Dict[str, Any]:
    """
    Extract all official NHL.com stats from landing endpoint response.
    
    Returns dict with all available NHL official stats for the target season.
    Handles both skaters and goalies.
    """
    stats = {}
    
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
                games_played = _safe_int(current_season_data.get("gamesPlayed", 0), 0)
                stats["games_played"] = games_played
                
                if is_goalie:
                    # Goalie stats
                    stats["nhl_wins"] = _safe_int(current_season_data.get("wins", 0), 0)
                    stats["nhl_losses"] = _safe_int(current_season_data.get("losses", 0), 0)
                    stats["nhl_ot_losses"] = _safe_int(current_season_data.get("otLosses", 0), 0)
                    stats["nhl_goals_against"] = _safe_int(current_season_data.get("goalsAgainst", 0), 0)
                    stats["nhl_gaa"] = float(current_season_data.get("goalsAgainstAvg", 0) or 0)
                    stats["nhl_save_pct"] = float(current_season_data.get("savePctg", 0) or 0)
                    stats["nhl_shutouts"] = _safe_int(current_season_data.get("shutouts", 0), 0)
                    stats["nhl_shots_faced"] = _safe_int(current_season_data.get("shotsAgainst", 0), 0)
                    
                    # Calculate saves
                    if stats["nhl_shots_faced"] > 0 and stats["nhl_goals_against"] >= 0:
                        stats["nhl_saves"] = stats["nhl_shots_faced"] - stats["nhl_goals_against"]
                    else:
                        stats["nhl_saves"] = 0
                    
                    # Extract TOI (goalies use timeOnIce, format: "HH:MM:SS")
                    time_on_ice_str = current_season_data.get("timeOnIce")
                    if time_on_ice_str:
                        stats["nhl_toi_seconds"] = parse_time_to_seconds(time_on_ice_str)
                    else:
                        stats["nhl_toi_seconds"] = 0
                    
                    # Goalie GP
                    stats["goalie_gp"] = games_played
                else:
                    # Skater stats
                    stats["nhl_goals"] = _safe_int(current_season_data.get("goals", 0), 0)
                    stats["nhl_assists"] = _safe_int(current_season_data.get("assists", 0), 0)
                    stats["nhl_points"] = _safe_int(current_season_data.get("points", 0), 0)
                    stats["nhl_plus_minus"] = _safe_int(current_season_data.get("plusMinus", 0), 0)
                    stats["nhl_shots_on_goal"] = _safe_int(current_season_data.get("shots", 0), 0)
                    stats["nhl_pim"] = _safe_int(current_season_data.get("pim", 0), 0)
                    stats["nhl_ppp"] = _safe_int(current_season_data.get("powerPlayPoints", 0), 0)
                    stats["nhl_shp"] = _safe_int(current_season_data.get("shorthandedPoints", 0), 0)
                    
                    # Hits and blocks are NOT in landing endpoint - will need StatsAPI fallback
                    stats["nhl_hits"] = 0  # Placeholder - need StatsAPI
                    stats["nhl_blocks"] = 0  # Placeholder - need StatsAPI
                    
                    # Extract TOI (skaters use avgToi, format: "MM:SS")
                    avg_toi_str = current_season_data.get("avgToi")
                    if avg_toi_str and games_played > 0:
                        avg_toi_seconds = parse_time_to_seconds(avg_toi_str)
                        stats["nhl_toi_seconds"] = avg_toi_seconds * games_played
                    else:
                        stats["nhl_toi_seconds"] = 0
                    
                    # Extract TOI (skaters use avgToi, format: "MM:SS")
                    avg_toi_str = current_season_data.get("avgToi")
                    if avg_toi_str and games_played > 0:
                        avg_toi_seconds = parse_time_to_seconds(avg_toi_str)
                        stats["nhl_toi_seconds"] = avg_toi_seconds * games_played
                    else:
                        stats["nhl_toi_seconds"] = 0
    
    # Method 2: Fallback to featuredStats if seasonTotals didn't work
    if not stats or stats.get("games_played", 0) == 0:
        if "featuredStats" in landing_data:
            featured = landing_data["featuredStats"]
            if "regularSeason" in featured:
                rs = featured["regularSeason"]
                if "subSeason" in rs:
                    sub = rs["subSeason"]
                    
                    if not is_goalie:
                        # Fill in any missing skater stats
                        if "nhl_goals" not in stats:
                            stats["nhl_goals"] = _safe_int(sub.get("goals", 0), 0)
                        if "nhl_assists" not in stats:
                            stats["nhl_assists"] = _safe_int(sub.get("assists", 0), 0)
                        if "nhl_points" not in stats:
                            stats["nhl_points"] = _safe_int(sub.get("points", 0), 0)
                        if "nhl_plus_minus" not in stats:
                            stats["nhl_plus_minus"] = _safe_int(sub.get("plusMinus", 0), 0)
                        if "nhl_shots_on_goal" not in stats:
                            stats["nhl_shots_on_goal"] = _safe_int(sub.get("shots", 0), 0)
                        if "nhl_ppp" not in stats:
                            stats["nhl_ppp"] = _safe_int(sub.get("powerPlayPoints", 0), 0)
                        if "nhl_shp" not in stats:
                            stats["nhl_shp"] = _safe_int(sub.get("shorthandedPoints", 0), 0)
                    else:
                        # Fill in any missing goalie stats
                        if "nhl_wins" not in stats:
                            stats["nhl_wins"] = _safe_int(sub.get("wins", 0), 0)
                        if "nhl_losses" not in stats:
                            stats["nhl_losses"] = _safe_int(sub.get("losses", 0), 0)
                        if "nhl_ot_losses" not in stats:
                            stats["nhl_ot_losses"] = _safe_int(sub.get("otLosses", 0), 0)
                        if "nhl_save_pct" not in stats:
                            stats["nhl_save_pct"] = float(sub.get("savePctg", 0) or 0)
                        if "nhl_gaa" not in stats:
                            stats["nhl_gaa"] = float(sub.get("goalsAgainstAvg", 0) or 0)
                        if "nhl_shutouts" not in stats:
                            stats["nhl_shutouts"] = _safe_int(sub.get("shutouts", 0), 0)
    
    return stats


def main() -> int:
    print("=" * 80)
    print("[fetch_nhl_stats_from_landing] STARTING")
    print("=" * 80)
    print(f"Season: {DEFAULT_SEASON}")
    print("Fetching ALL official NHL.com statistics from landing endpoint...")
    print(f"API: {NHL_API_BASE}/player/{{id}}/landing")
    print()
    print("Stats being fetched:")
    print("  Skaters: Goals, Assists, Points, SOG, PIM, PPP, SHP, TOI, +/-")
    print("  Goalies: Wins, Losses, OTL, Saves, Shots Faced, GA, GAA, SV%, Shutouts, TOI")
    print("  Note: Hits and blocks require StatsAPI fallback (not in landing endpoint)")
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
    updated_count = {
        "skaters": 0,
        "goalies": 0,
        "toi": 0,
        "plus_minus": 0,
        "goals": 0,
        "assists": 0,
        "points": 0,
        "sog": 0,
        "pim": 0,
        "ppp": 0,
        "shp": 0,
        "wins": 0,
        "saves": 0,
        "shutouts": 0,
        "statsapi_hits_blocks": 0  # Track StatsAPI fallback usage
    }
    not_found_count = 0
    error_count = 0
    last_progress_time = time.time()
    
    for idx, player in enumerate(players, 1):
        player_id = _safe_int(player.get("player_id"), 0)
        player_name = player.get("full_name", "Unknown")
        if not player_id:
            continue
        
        # Determine if player is a goalie (check player_directory)
        is_goalie = False
        try:
            player_dir = db.select("player_directory", select="is_goalie", filters=[("player_id", "eq", player_id), ("season", "eq", DEFAULT_SEASON)], limit=1)
            if player_dir and len(player_dir) > 0:
                is_goalie = bool(player_dir[0].get("is_goalie", False))
        except Exception:
            pass  # Default to skater if we can't determine
        
        # Fetch from NHL API (landing endpoint - primary)
        landing_data = fetch_player_landing_data(player_id)
        
        if landing_data:
            stats = extract_all_official_stats(landing_data, DEFAULT_SEASON, is_goalie=is_goalie)
            
            # For skaters: Try StatsAPI fallback for hits/blocks if not available from landing
            if not is_goalie and (stats.get("nhl_hits", 0) == 0 or stats.get("nhl_blocks", 0) == 0):
                season_string = f"{DEFAULT_SEASON}{DEFAULT_SEASON + 1}"  # "20252026"
                statsapi_data = fetch_player_statsapi_data(player_id, season_string)
                
                if statsapi_data:
                    hits, blocks = extract_hits_blocks_from_statsapi(statsapi_data)
                    if hits > 0:
                        stats["nhl_hits"] = hits
                    if blocks > 0:
                        stats["nhl_blocks"] = blocks
                    # Track StatsAPI success (for reporting)
                    if hits > 0 or blocks > 0:
                        updated_count["statsapi_hits_blocks"] = updated_count.get("statsapi_hits_blocks", 0) + 1
            
            # Update database if we got valid data
            # Ensure all required keys exist in stats dict
            if not stats:
                not_found_count += 1
                continue
            
            updates = {}
            
            if is_goalie:
                # Goalie stats - use .get() with defaults to avoid KeyError
                if "goalie_gp" in stats:
                    updates["goalie_gp"] = stats.get("goalie_gp", 0)
                if "nhl_wins" in stats:
                    updates["nhl_wins"] = stats.get("nhl_wins", 0)
                if "nhl_losses" in stats:
                    updates["nhl_losses"] = stats.get("nhl_losses", 0)
                if "nhl_ot_losses" in stats:
                    updates["nhl_ot_losses"] = stats.get("nhl_ot_losses", 0)
                if "nhl_saves" in stats:
                    updates["nhl_saves"] = stats.get("nhl_saves", 0)
                if "nhl_shots_faced" in stats:
                    updates["nhl_shots_faced"] = stats.get("nhl_shots_faced", 0)
                if "nhl_goals_against" in stats:
                    updates["nhl_goals_against"] = stats.get("nhl_goals_against", 0)
                if "nhl_shutouts" in stats:
                    updates["nhl_shutouts"] = stats.get("nhl_shutouts", 0)
                if "nhl_save_pct" in stats:
                    updates["nhl_save_pct"] = stats.get("nhl_save_pct")
                if "nhl_gaa" in stats:
                    updates["nhl_gaa"] = stats.get("nhl_gaa")
                if "nhl_toi_seconds" in stats and stats.get("nhl_toi_seconds", 0) > 0:
                    updates["nhl_toi_seconds"] = stats.get("nhl_toi_seconds", 0)
            else:
                # Skater stats - use .get() with defaults to avoid KeyError
                if "nhl_goals" in stats:
                    updates["nhl_goals"] = stats.get("nhl_goals", 0)
                if "nhl_assists" in stats:
                    updates["nhl_assists"] = stats.get("nhl_assists", 0)
                if "nhl_points" in stats:
                    updates["nhl_points"] = stats.get("nhl_points", 0)
                if "nhl_plus_minus" in stats:
                    updates["nhl_plus_minus"] = stats.get("nhl_plus_minus", 0)
                if "nhl_shots_on_goal" in stats:
                    updates["nhl_shots_on_goal"] = stats.get("nhl_shots_on_goal", 0)
                if "nhl_pim" in stats:
                    updates["nhl_pim"] = stats.get("nhl_pim", 0)
                if "nhl_ppp" in stats:
                    updates["nhl_ppp"] = stats.get("nhl_ppp", 0)
                if "nhl_shp" in stats:
                    updates["nhl_shp"] = stats.get("nhl_shp", 0)
                # Note: hits and blocks are 0 (not in landing endpoint - need StatsAPI)
                if "nhl_hits" in stats:
                    updates["nhl_hits"] = stats.get("nhl_hits", 0)
                if "nhl_blocks" in stats:
                    updates["nhl_blocks"] = stats.get("nhl_blocks", 0)
                if "nhl_toi_seconds" in stats and stats.get("nhl_toi_seconds", 0) > 0:
                    updates["nhl_toi_seconds"] = stats.get("nhl_toi_seconds", 0)
            
            if updates:
                try:
                    updates["season"] = DEFAULT_SEASON
                    updates["player_id"] = player_id
                    db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
                    
                    # Track what was updated
                    if is_goalie:
                        updated_count["goalies"] += 1
                        if updates.get("nhl_wins", 0) > 0:
                            updated_count["wins"] += 1
                        if updates.get("nhl_saves", 0) > 0:
                            updated_count["saves"] += 1
                        if updates.get("nhl_shutouts", 0) > 0:
                            updated_count["shutouts"] += 1
                    else:
                        updated_count["skaters"] += 1
                        if updates.get("nhl_goals", 0) > 0:
                            updated_count["goals"] += 1
                        if updates.get("nhl_assists", 0) > 0:
                            updated_count["assists"] += 1
                        if updates.get("nhl_points", 0) > 0:
                            updated_count["points"] += 1
                        if updates.get("nhl_shots_on_goal", 0) > 0:
                            updated_count["sog"] += 1
                        if updates.get("nhl_ppp", 0) > 0:
                            updated_count["ppp"] += 1
                        if updates.get("nhl_shp", 0) > 0:
                            updated_count["shp"] += 1
                        if updates.get("nhl_plus_minus", 0) != 0:
                            updated_count["plus_minus"] += 1
                    
                    if updates.get("nhl_toi_seconds", 0) > 0:
                        updated_count["toi"] += 1
                    if updates.get("nhl_pim", 0) > 0:
                        updated_count["pim"] += 1
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
            print(f"  [PROGRESS] Processed {idx}/{len(players)} players ({updated_count['skaters']} skaters, {updated_count['goalies']} goalies updated, {not_found_count} not found, {error_count} errors)...")
            last_progress_time = current_time
        
        # Rate limiting
        if idx < len(players):
            time.sleep(0.1)  # 100ms delay between requests
    
    print()
    print("=" * 80)
    print("[fetch_nhl_stats_from_landing] COMPLETE")
    print("=" * 80)
    print(f"Players processed: {len(players):,}")
    print(f"Skaters updated: {updated_count['skaters']:,}")
    print(f"Goalies updated: {updated_count['goalies']:,}")
    print()
    print("Stats updated:")
    print(f"  TOI: {updated_count['toi']:,}")
    print(f"  Goals: {updated_count['goals']:,}")
    print(f"  Assists: {updated_count['assists']:,}")
    print(f"  Points: {updated_count['points']:,}")
    print(f"  Plus/Minus: {updated_count['plus_minus']:,}")
    print(f"  Shots on Goal: {updated_count['sog']:,}")
    print(f"  PIM: {updated_count['pim']:,}")
    print(f"  PPP: {updated_count['ppp']:,}")
    print(f"  SHP: {updated_count['shp']:,}")
    print(f"  Wins: {updated_count['wins']:,}")
    print(f"  Saves: {updated_count['saves']:,}")
    print(f"  Shutouts: {updated_count['shutouts']:,}")
    print()
    print(f"Not found: {not_found_count:,}")
    print(f"Errors: {error_count:,}")
    print()
    if updated_count.get("statsapi_hits_blocks", 0) > 0:
        print(f"✅ StatsAPI fallback: Successfully fetched hits/blocks for {updated_count['statsapi_hits_blocks']:,} players")
    else:
        print("⚠️  StatsAPI fallback: Hits/blocks not available (StatsAPI may have DNS issues)")
        print("      Players will have hits/blocks = 0 (can use PBP-calculated as fallback)")
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
