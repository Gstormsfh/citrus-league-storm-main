#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose: Fetch per-game player stats from NHL landing endpoint (canonical NHL stats)
# Invoked: imported by data_scraping_service.py + scrape_per_game_nhl_stats.py
# Reads:   NHL public API (game landing endpoint)
# Writes:  player_game_stats (nhl_* columns), goalie_gsax inputs
# ────────────────────────────────────────────────────────────
"""
fetch_nhl_stats_from_landing.py

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  ⭐ PPP/SHP SOURCE OF TRUTH (Season Totals)                               ║
# ╠═══════════════════════════════════════════════════════════════════════════╣
# ║  This script fetches SEASON TOTALS from NHL Landing Endpoint.             ║
# ║  It's the ONLY source for accurate PPP (Power Play Points) and            ║
# ║  SHP (Shorthanded Points) because the boxscore API lacks PP/SH assists.   ║
# ║                                                                           ║
# ║  Runs nightly automatically at midnight MT via data_scraping_service.py. ║
# ║  For per-game PPP/SHP, see: sync_ppp_from_gamelog.py                      ║
# ║                                                                           ║
# ║  ⚡ Optimized for 100-IP proxy rotation - minimal delays for speed!        ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

Fetch all official NHL.com statistics from landing endpoint (api-web.nhle.com).
This endpoint works reliably and avoids DNS issues with statsapi.web.nhl.com.

Fetches comprehensive stats in a single API call per player:
- Skaters: Goals, Assists, Points, SOG, PIM, PPP, SHP, TOI, +/-
- Goalies: Wins, Losses, OTL, Saves, Shots Faced, GA, GAA, SV%, Shutouts, TOI
- Note: Hits and blocks are NOT available from landing endpoint (need StatsAPI fallback)
"""

import os
import signal
import sys
import time
import requests
from typing import Optional, Dict, Tuple, Any
from dotenv import load_dotenv
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.utils.citrus_request import citrus_request
import logging

logger = logging.getLogger(__name__)

_shutdown_requested = False

def _handle_shutdown(signum, frame):
    global _shutdown_requested
    _shutdown_requested = True
    logger.info(f"\n[SHUTDOWN] Signal {signum} received, finishing current operation...")

import threading
if threading.current_thread() is threading.main_thread():
    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

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


def fetch_player_landing_data(player_id: int, retries: int = 5) -> Tuple[Optional[Dict], Optional[str]]:
    """
    Fetch player landing page data from api-web.nhle.com.
    Returns tuple: (data, error_type) where:
    - (data, None) - success
    - (None, "429") - rate limited after all retries
    - (None, "not_found") - 404 or other error (not 429)

    Delegates retry logic and proxy rotation to citrus_request (100-IP rotation,
    exponential backoff, circuit breaker). No redundant retry loops needed here.
    """
    url = f"{NHL_API_BASE}/player/{player_id}/landing"

    try:
        response = citrus_request(url, timeout=10, max_retries=retries)

        if response.status_code == 200:
            return (response.json(), None)

        # citrus_request already retried 429s with proxy rotation — if we still get one, it's truly exhausted
        if response.status_code == 429:
            return (None, "429")

        if response.status_code == 404:
            return (None, "not_found")

        # Other unexpected status codes
        return (None, "not_found")

    except requests.exceptions.HTTPError as e:
        if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
            if e.response.status_code == 404:
                return (None, "not_found")
            if e.response.status_code == 429:
                return (None, "429")
        logger.error(f"  Error fetching landing data for player {player_id}: {e}")
        return (None, "not_found")
    except Exception as e:
        logger.error(f"  Error fetching landing data for player {player_id}: {e}")
        return (None, "not_found")


def fetch_player_statsapi_data(player_id: int, season: str, retries: int = 5) -> Optional[Dict[str, Any]]:
    """
    Fetch player stats from StatsAPI endpoint (official NHL.com API for hits/blocks).
    Returns dict with stats or None if failed.

    Uses citrus_request for 100-IP proxy rotation. StatsAPI often has DNS issues —
    citrus_request handles this with proxy failover.
    """
    url = f"{STATS_API_BASE}/people/{player_id}/stats"
    params = {
        "stats": "statsSingleSeason",
        "season": season
    }

    try:
        response = citrus_request(url, params=params, timeout=15, max_retries=retries)
        response.raise_for_status()
        data = response.json()

        # Extract stats from response
        stats_list = data.get("stats", [])
        if stats_list:
            splits = stats_list[0].get("splits", [])
            if splits:
                return splits[0].get("stat", {})

        return None

    except Exception:
        # StatsAPI often has DNS issues - this is expected, don't log as error
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
    
    # Method 1: PRIMARY - Use featuredStats (this is the current season's data, most reliable)
    if "featuredStats" in landing_data:
        featured = landing_data["featuredStats"]
        # Check if the featured season matches our target
        featured_season = featured.get("season", 0)
        featured_season_start = featured_season // 10000 if featured_season > 0 else 0
        
        if featured_season_start == target_season or featured_season_start == 0:  # 0 means use it anyway
            if "regularSeason" in featured:
                rs = featured["regularSeason"]
                if "subSeason" in rs:
                    sub = rs["subSeason"]
                    
                    games_played = _safe_int(sub.get("gamesPlayed", 0), 0)
                    stats["games_played"] = games_played
                    
                    if not is_goalie:
                        # Skater stats from featuredStats
                        stats["nhl_goals"] = _safe_int(sub.get("goals", 0), 0)
                        stats["nhl_assists"] = _safe_int(sub.get("assists", 0), 0)
                        stats["nhl_points"] = _safe_int(sub.get("points", 0), 0)
                        stats["nhl_plus_minus"] = _safe_int(sub.get("plusMinus", 0), 0)
                        stats["nhl_shots_on_goal"] = _safe_int(sub.get("shots", 0), 0)
                        stats["nhl_pim"] = _safe_int(sub.get("pim", 0), 0)
                        # CRITICAL: Landing endpoint provides powerPlayPoints and shorthandedPoints directly!
                        stats["nhl_ppp"] = _safe_int(sub.get("powerPlayPoints", 0), 0)
                        stats["nhl_shp"] = _safe_int(sub.get("shorthandedPoints", 0), 0)
                        # Hits and blocks are NOT in landing endpoint - will need StatsAPI fallback
                        stats["nhl_hits"] = 0
                        stats["nhl_blocks"] = 0
                        # TOI not directly in featuredStats, will get from seasonTotals
                    else:
                        # Goalie stats from featuredStats (if available)
                        stats["nhl_wins"] = _safe_int(sub.get("wins", 0), 0)
                        stats["nhl_losses"] = _safe_int(sub.get("losses", 0), 0)
                        stats["nhl_ot_losses"] = _safe_int(sub.get("otLosses", 0), 0)
                        stats["nhl_save_pct"] = float(sub.get("savePctg", 0) or 0)
                        stats["nhl_gaa"] = float(sub.get("goalsAgainstAvg", 0) or 0)
                        stats["nhl_shutouts"] = _safe_int(sub.get("shutouts", 0), 0)
                        stats["goalie_gp"] = games_played
    
    # Method 2: Fallback to seasonTotals if featuredStats didn't work or for TOI
    if not stats or stats.get("games_played", 0) == 0:
        if "seasonTotals" in landing_data and isinstance(landing_data["seasonTotals"], list):
            season_totals = landing_data["seasonTotals"]
            if len(season_totals) > 0:
                # Find the season that matches target_season
                current_season_data = None
                for season_data in reversed(season_totals):  # Start from most recent
                    season_id = season_data.get("season", 0)
                    # Season format: 20252026 (we want 2025)
                    season_start = season_id // 10000 if season_id > 0 else 0
                    if season_start == target_season:
                        current_season_data = season_data
                        break
                
                # Fallback to last item if no match found (shouldn't happen, but safety)
                if current_season_data is None:
                    current_season_data = season_totals[-1]
                
                # Extract stats from the found season
                if current_season_data:
                    games_played = _safe_int(current_season_data.get("gamesPlayed", 0), 0)
                    if "games_played" not in stats:
                        stats["games_played"] = games_played
                    
                    if is_goalie:
                        # Goalie stats
                        if "nhl_wins" not in stats:
                            stats["nhl_wins"] = _safe_int(current_season_data.get("wins", 0), 0)
                        if "nhl_losses" not in stats:
                            stats["nhl_losses"] = _safe_int(current_season_data.get("losses", 0), 0)
                        if "nhl_ot_losses" not in stats:
                            stats["nhl_ot_losses"] = _safe_int(current_season_data.get("otLosses", 0), 0)
                        if "nhl_goals_against" not in stats:
                            stats["nhl_goals_against"] = _safe_int(current_season_data.get("goalsAgainst", 0), 0)
                        if "nhl_gaa" not in stats:
                            stats["nhl_gaa"] = float(current_season_data.get("goalsAgainstAvg", 0) or 0)
                        if "nhl_save_pct" not in stats:
                            stats["nhl_save_pct"] = float(current_season_data.get("savePctg", 0) or 0)
                        if "nhl_shutouts" not in stats:
                            stats["nhl_shutouts"] = _safe_int(current_season_data.get("shutouts", 0), 0)
                        if "nhl_shots_faced" not in stats:
                            stats["nhl_shots_faced"] = _safe_int(current_season_data.get("shotsAgainst", 0), 0)
                        
                        # Calculate saves
                        if "nhl_saves" not in stats:
                            if stats.get("nhl_shots_faced", 0) > 0 and stats.get("nhl_goals_against", 0) >= 0:
                                stats["nhl_saves"] = stats["nhl_shots_faced"] - stats["nhl_goals_against"]
                            else:
                                stats["nhl_saves"] = 0
                        
                        # Extract TOI (goalies use timeOnIce, format: "HH:MM:SS")
                        if "nhl_toi_seconds" not in stats:
                            time_on_ice_str = current_season_data.get("timeOnIce")
                            if time_on_ice_str:
                                stats["nhl_toi_seconds"] = parse_time_to_seconds(time_on_ice_str)
                            else:
                                stats["nhl_toi_seconds"] = 0
                        
                        if "goalie_gp" not in stats:
                            stats["goalie_gp"] = games_played
                    else:
                        # Skater stats - only fill in missing values
                        if "nhl_goals" not in stats:
                            stats["nhl_goals"] = _safe_int(current_season_data.get("goals", 0), 0)
                        if "nhl_assists" not in stats:
                            stats["nhl_assists"] = _safe_int(current_season_data.get("assists", 0), 0)
                        if "nhl_points" not in stats:
                            stats["nhl_points"] = _safe_int(current_season_data.get("points", 0), 0)
                        if "nhl_plus_minus" not in stats:
                            stats["nhl_plus_minus"] = _safe_int(current_season_data.get("plusMinus", 0), 0)
                        if "nhl_shots_on_goal" not in stats:
                            stats["nhl_shots_on_goal"] = _safe_int(current_season_data.get("shots", 0), 0)
                        if "nhl_pim" not in stats:
                            stats["nhl_pim"] = _safe_int(current_season_data.get("pim", 0), 0)
                        # CRITICAL: Only use seasonTotals for PPP/SHP if not already set from featuredStats
                        if "nhl_ppp" not in stats:
                            stats["nhl_ppp"] = _safe_int(current_season_data.get("powerPlayPoints", 0), 0)
                        if "nhl_shp" not in stats:
                            stats["nhl_shp"] = _safe_int(current_season_data.get("shorthandedPoints", 0), 0)
                        
                        # Extract TOI (skaters use avgToi, format: "MM:SS")
                        if "nhl_toi_seconds" not in stats:
                            avg_toi_str = current_season_data.get("avgToi")
                            if avg_toi_str and games_played > 0:
                                avg_toi_seconds = parse_time_to_seconds(avg_toi_str)
                                stats["nhl_toi_seconds"] = avg_toi_seconds * games_played
                            else:
                                stats["nhl_toi_seconds"] = 0
    
    # Final fallback - should not be needed
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
    logger.info("=" * 80)
    logger.info("[fetch_nhl_stats_from_landing] STARTING")
    logger.info("=" * 80)
    logger.info(f"Season: {DEFAULT_SEASON}")
    logger.info("Fetching ALL official NHL.com statistics from landing endpoint...")
    logger.info(f"API: {NHL_API_BASE}/player/{{id}}/landing")
    logger.info("")
    logger.info("Stats being fetched:")
    logger.info("  Skaters: Goals, Assists, Points, SOG, PIM, PPP, SHP, TOI, +/-")
    logger.info("  Goalies: Wins, Losses, OTL, Saves, Shots Faced, GA, GAA, SV%, Shutouts, TOI")
    logger.info("  Note: Hits and blocks require StatsAPI fallback (not in landing endpoint)")
    logger.info("")
    
    try:
        db = supabase_client()
        logger.info("[fetch_nhl_stats] Connected to Supabase")
    except Exception as e:
        logger.error(f"[fetch_nhl_stats] ERROR: Failed to connect: {e}")
        return 1
    
    # Get all players from player_directory for current season only
    # CRITICAL: Must filter by season to avoid fetching players from all seasons,
    # which causes excessive API calls and 429 rate limiting that leaves players without stats rows
    logger.info(f"[fetch_nhl_stats] Fetching players from player_directory (season={DEFAULT_SEASON})...")
    players = []
    offset = 0
    batch_size = 1000

    while True:
        batch = db.select("player_directory", select="player_id,full_name", filters=[("season", "eq", DEFAULT_SEASON)], limit=batch_size, offset=offset)
        if not batch:
            break
        players.extend(batch)
        if len(batch) < batch_size:
            break
        offset += batch_size
    
    logger.info(f"[fetch_nhl_stats] Found {len(players):,} players")
    logger.info("")
    
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
    rate_limited_429_count = 0
    error_count = 0
    last_progress_time = time.time()
    
    # Track failed players for retry phase
    failed_429_players = []  # List of (player_id, player_name, is_goalie) tuples
    failed_not_found_players = []  # List of (player_id, player_name, is_goalie) tuples
    
    # Minimal courtesy delay between requests — citrus_request handles rate limiting
    # internally via 100-IP proxy rotation, exponential backoff, and circuit breaker
    base_delay = 0.15  # 150ms courtesy delay between players
    consecutive_errors = 0  # Track consecutive errors for logging
    
    for idx, player in enumerate(players, 1):
        if _shutdown_requested:
            logger.info(f"\n[SHUTDOWN] Graceful shutdown complete. Processed {idx - 1}/{len(players)} players.")
            logger.info(f"  Skaters updated: {updated_count['skaters']} | Goalies updated: {updated_count['goalies']}")
            sys.exit(0)

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
        landing_data, error_type = fetch_player_landing_data(player_id)
        
        # Track failed players for retry phase
        # Note: citrus_request handles 429s internally via 100-IP rotation + exponential backoff.
        # If we still get a 429 error_type here, all retries across all proxies were exhausted.
        if error_type == "429":
            failed_429_players.append((player_id, player_name, is_goalie))
            rate_limited_429_count += 1
            consecutive_errors += 1
        elif error_type == "not_found":
            failed_not_found_players.append((player_id, player_name, is_goalie))
            not_found_count += 1
            consecutive_errors = 0
        else:
            consecutive_errors = 0
        
        if landing_data:
            stats = extract_all_official_stats(landing_data, DEFAULT_SEASON, is_goalie=is_goalie)
            
            # StatsAPI (statsapi.web.nhl.com) is DEPRECATED and offline.
            # Hits/blocks come from PBP-calculated values in player_season_stats.
            # DO NOT call StatsAPI — it triggers circuit breaker pauses (60s each)
            # that make this script take hours instead of minutes.
            
            # Update database if we got valid data
            # Ensure all required keys exist in stats dict
            if not stats:
                # No stats extracted - treat as not found
                if (player_id, player_name, is_goalie) not in failed_not_found_players:
                    failed_not_found_players.append((player_id, player_name, is_goalie))
                    not_found_count += 1
                continue
            
            updates = {}

            # CRITICAL: Include games_played for both skaters and goalies
            # Without this, players created solely by this script (no prior row from
            # build_player_season_stats) get games_played=0 and display with blank stats
            if "games_played" in stats and stats.get("games_played", 0) > 0:
                updates["games_played"] = stats.get("games_played", 0)

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
                # CRITICAL: Update nhl_ppp and nhl_shp from landing endpoint
                if "nhl_ppp" in stats:
                    updates["nhl_ppp"] = stats.get("nhl_ppp", 0)
                if "nhl_shp" in stats:
                    updates["nhl_shp"] = stats.get("nhl_shp", 0)
                # NEVER write hits/blocks from landing — they're always 0 here.
                # Correct values come from boxscore aggregation in build_player_season_stats.
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
                    logger.error(f"  [ERROR] Failed to update player {player_id} ({player_name}): {e}")
                    error_count += 1
        
        # Progress every 15 seconds
        current_time = time.time()
        if current_time - last_progress_time >= 15:
            logger.error(f"  [PROGRESS] Processed {idx}/{len(players)} players ({updated_count['skaters']} skaters, {updated_count['goalies']} goalies updated, {not_found_count} not found, {error_count} errors)...")
            last_progress_time = current_time
        
        # Minimal courtesy delay — citrus_request handles rate limiting via 100-IP rotation
        if idx < len(players):
            time.sleep(base_delay)
    
    logger.info("")
    logger.info("=" * 80)
    logger.info("[fetch_nhl_stats_from_landing] COMPLETE")
    logger.info("=" * 80)
    logger.info(f"Players processed: {len(players):,}")
    logger.info(f"Skaters updated: {updated_count['skaters']:,}")
    logger.info(f"Goalies updated: {updated_count['goalies']:,}")
    logger.info("")
    logger.info("Stats updated:")
    logger.info(f"  TOI: {updated_count['toi']:,}")
    logger.info(f"  Goals: {updated_count['goals']:,}")
    logger.info(f"  Assists: {updated_count['assists']:,}")
    logger.info(f"  Points: {updated_count['points']:,}")
    logger.info(f"  Plus/Minus: {updated_count['plus_minus']:,}")
    logger.info(f"  Shots on Goal: {updated_count['sog']:,}")
    logger.info(f"  PIM: {updated_count['pim']:,}")
    logger.info(f"  PPP: {updated_count['ppp']:,}")
    logger.info(f"  SHP: {updated_count['shp']:,}")
    logger.info(f"  Wins: {updated_count['wins']:,}")
    logger.info(f"  Saves: {updated_count['saves']:,}")
    logger.info(f"  Shutouts: {updated_count['shutouts']:,}")
    logger.info("")
    logger.info(f"Not found: {not_found_count:,}")
    logger.error(f"Errors: {error_count:,}")
    logger.info("")
    if updated_count.get("statsapi_hits_blocks", 0) > 0:
        logger.info(f"[OK] StatsAPI fallback: Successfully fetched hits/blocks for {updated_count['statsapi_hits_blocks']:,} players")
    else:
        logger.warning("[WARNING] StatsAPI fallback: Hits/blocks not available (StatsAPI may have DNS issues)")
        logger.info("      Players will have hits/blocks = 0 (can use PBP-calculated as fallback)")
    logger.info("")
    
    # RETRY PHASE: Retry all failed players
    players_to_retry = failed_429_players + failed_not_found_players
    retry_updated_count = {
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
        "statsapi_hits_blocks": 0
    }
    retry_not_found_count = 0
    retry_rate_limited_count = 0
    retry_error_count = 0
    
    if players_to_retry:
        logger.info("=" * 80)
        logger.error(f"[RETRY PHASE] Retrying {len(players_to_retry)} players that failed...")
        logger.info("=" * 80)
        logger.info("")
        
        for idx, (player_id, player_name, is_goalie) in enumerate(players_to_retry, 1):
            if _shutdown_requested:
                logger.info(f"\n[SHUTDOWN] Graceful shutdown complete during retry phase.")
                sys.exit(0)

            # Fetch from NHL API (landing endpoint - primary)
            landing_data, error_type = fetch_player_landing_data(player_id)
            
            if error_type == "429":
                retry_rate_limited_count += 1
            elif error_type == "not_found":
                retry_not_found_count += 1
            
            if landing_data:
                stats = extract_all_official_stats(landing_data, DEFAULT_SEASON, is_goalie=is_goalie)
                
                # StatsAPI is DEPRECATED and offline — skip hits/blocks fallback
                
                # Update database if we got valid data
                if not stats:
                    continue

                updates = {}

                # Include games_played for both skaters and goalies (same as main phase)
                if "games_played" in stats and stats.get("games_played", 0) > 0:
                    updates["games_played"] = stats.get("games_played", 0)

                if is_goalie:
                    # Goalie stats
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
                    # Skater stats
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
                    # NEVER write hits/blocks from landing — correct values from boxscore aggregation
                    if "nhl_toi_seconds" in stats and stats.get("nhl_toi_seconds", 0) > 0:
                        updates["nhl_toi_seconds"] = stats.get("nhl_toi_seconds", 0)
                
                if updates:
                    try:
                        updates["season"] = DEFAULT_SEASON
                        updates["player_id"] = player_id
                        db.upsert("player_season_stats", [updates], on_conflict="season,player_id")
                        
                        # Track what was updated
                        if is_goalie:
                            retry_updated_count["goalies"] += 1
                            if updates.get("nhl_wins", 0) > 0:
                                retry_updated_count["wins"] += 1
                            if updates.get("nhl_saves", 0) > 0:
                                retry_updated_count["saves"] += 1
                            if updates.get("nhl_shutouts", 0) > 0:
                                retry_updated_count["shutouts"] += 1
                        else:
                            retry_updated_count["skaters"] += 1
                            if updates.get("nhl_goals", 0) > 0:
                                retry_updated_count["goals"] += 1
                            if updates.get("nhl_assists", 0) > 0:
                                retry_updated_count["assists"] += 1
                            if updates.get("nhl_points", 0) > 0:
                                retry_updated_count["points"] += 1
                            if updates.get("nhl_shots_on_goal", 0) > 0:
                                retry_updated_count["sog"] += 1
                            if updates.get("nhl_ppp", 0) > 0:
                                retry_updated_count["ppp"] += 1
                            if updates.get("nhl_shp", 0) > 0:
                                retry_updated_count["shp"] += 1
                            if updates.get("nhl_plus_minus", 0) != 0:
                                retry_updated_count["plus_minus"] += 1
                        
                        if updates.get("nhl_toi_seconds", 0) > 0:
                            retry_updated_count["toi"] += 1
                        if updates.get("nhl_pim", 0) > 0:
                            retry_updated_count["pim"] += 1
                    except Exception as e:
                        logger.error(f"  [ERROR] Failed to update player {player_id} ({player_name}) in retry: {e}")
                        retry_error_count += 1
            
            # Minimal courtesy delay — citrus_request handles rate limiting via 100-IP rotation
            if idx < len(players_to_retry):
                time.sleep(0.5)  # Slightly higher delay for retry phase
        
        # Print retry phase summary
        logger.info("")
        logger.info("=" * 80)
        logger.info("[RETRY PHASE] COMPLETE")
        logger.info("=" * 80)
        logger.info(f"Players retried: {len(players_to_retry):,}")
        logger.info(f"Skaters updated: {retry_updated_count['skaters']:,}")
        logger.info(f"Goalies updated: {retry_updated_count['goalies']:,}")
        logger.info("")
        logger.info("Stats updated in retry:")
        logger.info(f"  TOI: {retry_updated_count['toi']:,}")
        logger.info(f"  Goals: {retry_updated_count['goals']:,}")
        logger.info(f"  Assists: {retry_updated_count['assists']:,}")
        logger.info(f"  Points: {retry_updated_count['points']:,}")
        logger.info(f"  Plus/Minus: {retry_updated_count['plus_minus']:,}")
        logger.info(f"  Shots on Goal: {retry_updated_count['sog']:,}")
        logger.info(f"  PIM: {retry_updated_count['pim']:,}")
        logger.info(f"  PPP: {retry_updated_count['ppp']:,}")
        logger.info(f"  SHP: {retry_updated_count['shp']:,}")
        logger.info(f"  Wins: {retry_updated_count['wins']:,}")
        logger.info(f"  Saves: {retry_updated_count['saves']:,}")
        logger.info(f"  Shutouts: {retry_updated_count['shutouts']:,}")
        logger.info("")
        logger.info(f"Rate limited (429): {retry_rate_limited_count:,}")
        logger.info(f"Not found: {retry_not_found_count:,}")
        logger.error(f"Errors: {retry_error_count:,}")
        logger.info("")
    
    # Final summary
    logger.info("=" * 80)
    logger.info("[fetch_nhl_stats_from_landing] COMPLETE")
    logger.info("=" * 80)
    total_skaters = updated_count['skaters'] + retry_updated_count['skaters']
    total_goalies = updated_count['goalies'] + retry_updated_count['goalies']
    logger.info(f"Total players processed: {len(players):,}")
    logger.info(f"Total skaters updated: {total_skaters:,}")
    logger.info(f"Total goalies updated: {total_goalies:,}")
    logger.info("")
    logger.info("Total stats updated:")
    logger.info(f"  TOI: {updated_count['toi'] + retry_updated_count['toi']:,}")
    logger.info(f"  Goals: {updated_count['goals'] + retry_updated_count['goals']:,}")
    logger.info(f"  Assists: {updated_count['assists'] + retry_updated_count['assists']:,}")
    logger.info(f"  Points: {updated_count['points'] + retry_updated_count['points']:,}")
    logger.info(f"  Plus/Minus: {updated_count['plus_minus'] + retry_updated_count['plus_minus']:,}")
    logger.info(f"  Shots on Goal: {updated_count['sog'] + retry_updated_count['sog']:,}")
    logger.info(f"  PIM: {updated_count['pim'] + retry_updated_count['pim']:,}")
    logger.info(f"  PPP: {updated_count['ppp'] + retry_updated_count['ppp']:,}")
    logger.info(f"  SHP: {updated_count['shp'] + retry_updated_count['shp']:,}")
    logger.info(f"  Wins: {updated_count['wins'] + retry_updated_count['wins']:,}")
    logger.info(f"  Saves: {updated_count['saves'] + retry_updated_count['saves']:,}")
    logger.info(f"  Shutouts: {updated_count['shutouts'] + retry_updated_count['shutouts']:,}")
    logger.info("")
    total_rate_limited = rate_limited_429_count + retry_rate_limited_count
    total_not_found = not_found_count + retry_not_found_count
    total_errors = error_count + retry_error_count
    logger.info(f"Total rate limited (429): {total_rate_limited:,}")
    logger.info(f"Total not found: {total_not_found:,}")
    logger.error(f"Total errors: {total_errors:,}")
    logger.info("")
    total_statsapi = updated_count.get("statsapi_hits_blocks", 0) + retry_updated_count.get("statsapi_hits_blocks", 0)
    if total_statsapi > 0:
        logger.info(f"[OK] StatsAPI fallback: Successfully fetched hits/blocks for {total_statsapi:,} players")
    else:
        logger.warning("[WARNING] StatsAPI fallback: Hits/blocks not available (StatsAPI may have DNS issues)")
        logger.info("      Players will have hits/blocks = 0 (can use PBP-calculated as fallback)")
    
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    raise SystemExit(main())

