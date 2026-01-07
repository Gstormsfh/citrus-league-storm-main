#!/usr/bin/env python3
"""
fetch_nhl_stats_from_landing_fast.py

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  ⭐ PPP/SHP SOURCE OF TRUTH (Season Totals) - CONCURRENT VERSION          ║
# ╠═══════════════════════════════════════════════════════════════════════════╣
# ║  This script fetches SEASON TOTALS from NHL Landing Endpoint.             ║
# ║  It's the ONLY source for accurate PPP (Power Play Points) and            ║
# ║  SHP (Shorthanded Points) because the boxscore API lacks PP/SH assists.   ║
# ║                                                                           ║
# ║  OPTIMIZED VERSION: Uses concurrent requests (3-5 workers) with          ║
# ║  shared rate limiting to speed up processing while maintaining safety.    ║
# ║                                                                           ║
# ║  ⚠️  Uses 1.5-3 second delays per worker to avoid rate limiting.         ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

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
import threading
import requests
from typing import Optional, Dict, Tuple, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
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


class SharedRateLimiter:
    """
    Thread-safe rate limiter that ensures minimum delay between requests across all workers.
    """
    def __init__(self, base_delay: float = 1.5):
        self.base_delay = base_delay
        self.lock = threading.Lock()
        self.last_request_time = 0.0
        self.request_count = 0
        self.adaptive_delay = base_delay
    
    def wait_if_needed(self):
        """Wait if needed to maintain rate limit. Thread-safe."""
        with self.lock:
            current_time = time.time()
            elapsed = current_time - self.last_request_time
            
            if elapsed < self.adaptive_delay:
                sleep_time = self.adaptive_delay - elapsed
                time.sleep(sleep_time)
            
            self.last_request_time = time.time()
            self.request_count += 1
    
    def increase_delay(self, new_delay: float):
        """Increase the delay (e.g., after 429 error). Thread-safe."""
        with self.lock:
            if new_delay > self.adaptive_delay:
                self.adaptive_delay = new_delay
                print(f"  [RATE LIMIT] Increasing delay to {new_delay}s between requests")


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
    
    Implements exponential backoff retry for 429 errors: 5s, 10s, 20s, 40s, 80s
    """
    url = f"{NHL_API_BASE}/player/{player_id}/landing"
    
    for attempt in range(retries):
        try:
            response = requests.get(url, timeout=10)
            
            # Success case
            if response.status_code == 200:
                return (response.json(), None)
            
            # 429 Rate Limit - retry with exponential backoff
            if response.status_code == 429:
                if attempt < retries - 1:
                    delay = 5 * (2 ** attempt)  # 5s, 10s, 20s, 40s, 80s
                    print(f"  [RETRY] Player {player_id}, attempt {attempt + 1}/{retries} after 429 error, waiting {delay}s...")
                    time.sleep(delay)
                    continue
                else:
                    # All retries exhausted
                    print(f"  Error fetching landing data for player {player_id}: 429 Client Error: Too Many Requests (after {retries} attempts)")
                    return (None, "429")
            
            # Other HTTP errors (404, 500, etc.)
            response.raise_for_status()
            
        except requests.exceptions.HTTPError as e:
            # 404 or other HTTP error (not 429)
            if hasattr(e.response, 'status_code') and e.response.status_code == 404:
                return (None, "not_found")
            else:
                # Other HTTP errors
                if attempt < retries - 1:
                    delay = 5 * (2 ** attempt)
                    time.sleep(delay)
                    continue
                else:
                    print(f"  Error fetching landing data for player {player_id}: {e}")
                    return (None, "not_found")
        except Exception as e:
            # Network errors, timeouts, etc.
            if attempt < retries - 1:
                delay = 5 * (2 ** attempt)
                time.sleep(delay)
                continue
            else:
                print(f"  Error fetching landing data for player {player_id}: {e}")
                return (None, "not_found")
    
    # Should never reach here, but safety fallback
    return (None, "not_found")


def fetch_player_statsapi_data(player_id: int, season: str, retries: int = 5) -> Optional[Dict[str, Any]]:
    """
    Fetch player stats from StatsAPI endpoint (official NHL.com API for hits/blocks).
    Returns dict with stats or None if failed.
    
    Uses aggressive retries with exponential backoff to handle DNS issues.
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
                # Exponential backoff: 2s, 4s, 8s, 16s, 32s
                delay = 2 ** (attempt + 1)
                time.sleep(delay)
            else:
                # StatsAPI often has DNS issues - this is expected, don't log as error
                return None
        except Exception as e:
            if attempt < retries - 1:
                delay = 2 ** (attempt + 1)
                time.sleep(delay)
            else:
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


def process_single_player(
    player: Dict,
    player_idx: int,
    total_players: int,
    db: SupabaseRest,
    updated_count: Dict,
    failed_429_players: list,
    failed_not_found_players: list,
    failed_error_players: list,
    rate_limiter: SharedRateLimiter,
    progress_lock: threading.Lock,
    last_progress_time: list  # List with single float for mutable reference
) -> None:
    """
    Process a single player. Thread-safe version of the main loop logic.
    """
    player_id = _safe_int(player.get("player_id"), 0)
    player_name = player.get("full_name", "Unknown")
    if not player_id:
        return
    
    # Determine if player is a goalie (check player_directory)
    is_goalie = False
    try:
        player_dir = db.select("player_directory", select="is_goalie", filters=[("player_id", "eq", player_id), ("season", "eq", DEFAULT_SEASON)], limit=1)
        if player_dir and len(player_dir) > 0:
            is_goalie = bool(player_dir[0].get("is_goalie", False))
    except Exception:
        pass  # Default to skater if we can't determine
    
    # Rate limit before making request
    rate_limiter.wait_if_needed()
    
    # Fetch from NHL API (landing endpoint - primary)
    landing_data, error_type = fetch_player_landing_data(player_id)
    
    # Track failed players for retry phase (thread-safe)
    if error_type == "429":
        with progress_lock:
            failed_429_players.append((player_id, player_name, is_goalie))
            # Increase delay after first 429
            if rate_limiter.adaptive_delay < 5.0:
                rate_limiter.increase_delay(5.0)
    elif error_type == "not_found":
        with progress_lock:
            failed_not_found_players.append((player_id, player_name, is_goalie))
    
    if landing_data:
        stats = extract_all_official_stats(landing_data, DEFAULT_SEASON, is_goalie=is_goalie)
        
        # For skaters: Always attempt StatsAPI for hits/blocks (official NHL.com API)
        # Landing endpoint doesn't provide hits/blocks, so StatsAPI is the source of truth
        if not is_goalie:
            season_string = f"{DEFAULT_SEASON}{DEFAULT_SEASON + 1}"  # "20252026"
            statsapi_data = fetch_player_statsapi_data(player_id, season_string)
            
            if statsapi_data:
                hits, blocks = extract_hits_blocks_from_statsapi(statsapi_data)
                # Always update with StatsAPI values (even if 0) - this is the official source
                stats["nhl_hits"] = hits
                stats["nhl_blocks"] = blocks
                # Track StatsAPI success (for reporting)
                if hits > 0 or blocks > 0:
                    with progress_lock:
                        updated_count["statsapi_hits_blocks"] = updated_count.get("statsapi_hits_blocks", 0) + 1
            # If StatsAPI fails, leave as 0 (will be logged in summary)
        
        # Update database if we got valid data
        # Ensure all required keys exist in stats dict
        if not stats:
            # No stats extracted - treat as not found
            with progress_lock:
                if (player_id, player_name, is_goalie) not in failed_not_found_players:
                    failed_not_found_players.append((player_id, player_name, is_goalie))
            return
        
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
            # CRITICAL: Update nhl_ppp and nhl_shp from landing endpoint
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
                
                # Track what was updated (thread-safe)
                with progress_lock:
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
                    
                    # Progress tracking (every 15 seconds)
                    current_time = time.time()
                    if current_time - last_progress_time[0] >= 15:
                        not_found_count = len(failed_not_found_players)
                        error_count = 0  # We don't track errors separately in concurrent version
                        print(f"  [PROGRESS] Processed {player_idx}/{total_players} players ({updated_count['skaters']} skaters, {updated_count['goalies']} goalies updated, {not_found_count} not found, {error_count} errors)...")
                        last_progress_time[0] = current_time
            except Exception as e:
                print(f"  [ERROR] Failed to update player {player_id} ({player_name}): {e}")
                # Track player for retry
                with progress_lock:
                    if (player_id, player_name, is_goalie) not in failed_error_players:
                        failed_error_players.append((player_id, player_name, is_goalie))


def main() -> int:
    print("=" * 80)
    print("[fetch_nhl_stats_from_landing] STARTING (CONCURRENT VERSION)")
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
    print("OPTIMIZATION: Using 3 concurrent workers with shared rate limiting")
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
    rate_limited_429_count = 0
    error_count = 0
    
    # Track failed players for retry phase
    failed_429_players = []  # List of (player_id, player_name, is_goalie) tuples
    failed_not_found_players = []  # List of (player_id, player_name, is_goalie) tuples
    failed_error_players = []  # List of (player_id, player_name, is_goalie) tuples for processing errors
    
    # Thread-safe rate limiter and progress tracking
    rate_limiter = SharedRateLimiter(base_delay=1.5)  # Start with 1.5s, will increase if 429s occur
    progress_lock = threading.Lock()
    last_progress_time = [time.time()]  # List for mutable reference
    
    # Process players concurrently
    max_workers = 3  # Start conservative, can increase if stable
    processed_count = [0]  # Thread-safe counter
    
    print(f"[fetch_nhl_stats] Processing {len(players):,} players with {max_workers} concurrent workers...")
    print()
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all players
        futures = {}
        for idx, player in enumerate(players, 1):
            future = executor.submit(
                process_single_player,
                player,
                idx,
                len(players),
                db,
                updated_count,
                failed_429_players,
                failed_not_found_players,
                failed_error_players,
                rate_limiter,
                progress_lock,
                last_progress_time
            )
            futures[future] = idx
        
        # Wait for completion and track progress
        for future in as_completed(futures):
            try:
                future.result()  # This will raise if there was an exception
                processed_count[0] += 1
            except Exception as e:
                with progress_lock:
                    error_count += 1
                print(f"  [ERROR] Exception processing player: {e}")
                # Note: Individual player errors are tracked in process_single_player
    
    # Count rate limited players
    rate_limited_429_count = len(failed_429_players)
    not_found_count = len(failed_not_found_players)
    
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
        print(f"[OK] StatsAPI fallback: Successfully fetched hits/blocks for {updated_count['statsapi_hits_blocks']:,} players")
    else:
        print("[WARNING] StatsAPI fallback: Hits/blocks not available (StatsAPI may have DNS issues)")
        print("      Players will have hits/blocks = 0 (can use PBP-calculated as fallback)")
    print()
    
    # RETRY PHASE: Retry all failed players (sequential for safety)
    players_to_retry = failed_429_players + failed_not_found_players + failed_error_players
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
        print("=" * 80)
        print(f"[RETRY PHASE] Retrying {len(players_to_retry)} players that failed...")
        print(f"  - Rate limited (429): {len(failed_429_players)}")
        print(f"  - Not found: {len(failed_not_found_players)}")
        print(f"  - Processing errors: {len(failed_error_players)}")
        print("=" * 80)
        print()
        
        # Use higher delay for retry phase (sequential)
        base_delay = 5.0  # Conservative for retries
        
        for idx, (player_id, player_name, is_goalie) in enumerate(players_to_retry, 1):
            # Fetch from NHL API (landing endpoint - primary)
            landing_data, error_type = fetch_player_landing_data(player_id)
            
            if error_type == "429":
                retry_rate_limited_count += 1
            elif error_type == "not_found":
                retry_not_found_count += 1
            
            if landing_data:
                stats = extract_all_official_stats(landing_data, DEFAULT_SEASON, is_goalie=is_goalie)
                
                # For skaters: Always attempt StatsAPI for hits/blocks (official NHL.com API)
                if not is_goalie:
                    season_string = f"{DEFAULT_SEASON}{DEFAULT_SEASON + 1}"  # "20252026"
                    statsapi_data = fetch_player_statsapi_data(player_id, season_string)
                    
                    if statsapi_data:
                        hits, blocks = extract_hits_blocks_from_statsapi(statsapi_data)
                        stats["nhl_hits"] = hits
                        stats["nhl_blocks"] = blocks
                        if hits > 0 or blocks > 0:
                            retry_updated_count["statsapi_hits_blocks"] = retry_updated_count.get("statsapi_hits_blocks", 0) + 1
                
                # Update database if we got valid data
                if not stats:
                    continue
                
                updates = {}
                
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
                        print(f"  [ERROR] Failed to update player {player_id} ({player_name}) in retry: {e}")
                        retry_error_count += 1
            
            # Rate limiting delay
            if idx < len(players_to_retry):
                time.sleep(base_delay)
        
        # Print retry phase summary
        print()
        print("=" * 80)
        print("[RETRY PHASE] COMPLETE")
        print("=" * 80)
        print(f"Players retried: {len(players_to_retry):,}")
        print(f"Skaters updated: {retry_updated_count['skaters']:,}")
        print(f"Goalies updated: {retry_updated_count['goalies']:,}")
        print()
        print("Stats updated in retry:")
        print(f"  TOI: {retry_updated_count['toi']:,}")
        print(f"  Goals: {retry_updated_count['goals']:,}")
        print(f"  Assists: {retry_updated_count['assists']:,}")
        print(f"  Points: {retry_updated_count['points']:,}")
        print(f"  Plus/Minus: {retry_updated_count['plus_minus']:,}")
        print(f"  Shots on Goal: {retry_updated_count['sog']:,}")
        print(f"  PIM: {retry_updated_count['pim']:,}")
        print(f"  PPP: {retry_updated_count['ppp']:,}")
        print(f"  SHP: {retry_updated_count['shp']:,}")
        print(f"  Wins: {retry_updated_count['wins']:,}")
        print(f"  Saves: {retry_updated_count['saves']:,}")
        print(f"  Shutouts: {retry_updated_count['shutouts']:,}")
        print()
        print(f"Rate limited (429): {retry_rate_limited_count:,}")
        print(f"Not found: {retry_not_found_count:,}")
        print(f"Errors: {retry_error_count:,}")
        print()
    
    # Final summary
    print("=" * 80)
    print("[fetch_nhl_stats_from_landing] COMPLETE")
    print("=" * 80)
    total_skaters = updated_count['skaters'] + retry_updated_count['skaters']
    total_goalies = updated_count['goalies'] + retry_updated_count['goalies']
    print(f"Total players processed: {len(players):,}")
    print(f"Total skaters updated: {total_skaters:,}")
    print(f"Total goalies updated: {total_goalies:,}")
    print()
    print("Total stats updated:")
    print(f"  TOI: {updated_count['toi'] + retry_updated_count['toi']:,}")
    print(f"  Goals: {updated_count['goals'] + retry_updated_count['goals']:,}")
    print(f"  Assists: {updated_count['assists'] + retry_updated_count['assists']:,}")
    print(f"  Points: {updated_count['points'] + retry_updated_count['points']:,}")
    print(f"  Plus/Minus: {updated_count['plus_minus'] + retry_updated_count['plus_minus']:,}")
    print(f"  Shots on Goal: {updated_count['sog'] + retry_updated_count['sog']:,}")
    print(f"  PIM: {updated_count['pim'] + retry_updated_count['pim']:,}")
    print(f"  PPP: {updated_count['ppp'] + retry_updated_count['ppp']:,}")
    print(f"  SHP: {updated_count['shp'] + retry_updated_count['shp']:,}")
    print(f"  Wins: {updated_count['wins'] + retry_updated_count['wins']:,}")
    print(f"  Saves: {updated_count['saves'] + retry_updated_count['saves']:,}")
    print(f"  Shutouts: {updated_count['shutouts'] + retry_updated_count['shutouts']:,}")
    print()
    total_rate_limited = rate_limited_429_count + retry_rate_limited_count
    total_not_found = not_found_count + retry_not_found_count
    total_errors = error_count + retry_error_count
    print(f"Total rate limited (429): {total_rate_limited:,}")
    print(f"Total not found: {total_not_found:,}")
    print(f"Total errors: {total_errors:,}")
    print()
    total_statsapi = updated_count.get("statsapi_hits_blocks", 0) + retry_updated_count.get("statsapi_hits_blocks", 0)
    if total_statsapi > 0:
        print(f"[OK] StatsAPI fallback: Successfully fetched hits/blocks for {total_statsapi:,} players")
    else:
        print("[WARNING] StatsAPI fallback: Hits/blocks not available (StatsAPI may have DNS issues)")
        print("      Players will have hits/blocks = 0 (can use PBP-calculated as fallback)")
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

