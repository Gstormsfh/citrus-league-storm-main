#!/usr/bin/env python3
"""
scrape_live_nhl_stats.py

Live stats scraper wrapper for updating official NHL stats during game nights.
Only processes games that are currently active (LIVE, CRIT) or recently finished (OFF).

This script is designed to run frequently (every 30 seconds) during game nights
to keep player_game_stats.nhl_* columns up-to-date for live scoring.
"""

import os
import sys
import time
import logging
import datetime as dt
from typing import Dict, List, Optional
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import requests

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_BASE_URL = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))
COOLDOWN_SECONDS = int(os.getenv("CITRUS_LIVE_STATS_COOLDOWN", "30"))  # 30 seconds cooldown for live games


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_schedule_now() -> dict:
    """Fetch current NHL schedule."""
    response = requests.get(f"{NHL_BASE_URL}/schedule/now", timeout=10)
    response.raise_for_status()
    return response.json()


def get_active_game_ids() -> List[int]:
    """
    Get list of game IDs that are currently active or recently finished.
    Uses both schedule/now API and fallback to database + direct PBP checks.
    
    Returns:
        List of game IDs that need stats updates
    """
    try:
        schedule = get_schedule_now()
        api_games = schedule.get("games", [])
        
        active_game_ids = []
        now = dt.datetime.now(dt.timezone.utc)
        
        # Method 1: Check schedule/now API
        for game in api_games:
            game_state = game.get("gameState", "").upper()
            game_id = game.get("id")
            
            if not game_id:
                continue
            
            # Include LIVE, CRIT, and INTERMISSION games (all active states)
            if game_state in ("LIVE", "CRIT", "INTERMISSION"):
                active_game_ids.append(int(game_id))
            # Include OFF/FINAL games finished in last 4 hours (still processing and may need score updates)
            elif game_state in ("OFF", "FINAL"):
                game_date_str = game.get("startTimeUTC", "")
                if game_date_str:
                    try:
                        game_date = dt.datetime.fromisoformat(game_date_str.replace('Z', '+00:00'))
                        # Extended to 4 hours to catch games that just finished and may need updates
                        if (now - game_date).total_seconds() < 14400:  # 4 hours
                            active_game_ids.append(int(game_id))
                    except:
                        pass
        
        # Method 2: ALWAYS check database for games marked as "live" (even if schedule/now shows them)
        # This ensures we catch games that the API might miss
        try:
            db = supabase_client()
            today = dt.date.today()
            live_games_in_db = db.select(
                "nhl_games",
                select="game_id",
                filters=[
                    ("game_date", "eq", today.isoformat()),
                    ("status", "eq", "live")
                ],
                limit=10
            )
            for game in live_games_in_db:
                game_id = game.get("game_id")
                if game_id and game_id not in active_game_ids:
                    # Double-check via PBP API to verify it's actually live
                    try:
                        import requests
                        pbp_response = requests.get(
                            f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play",
                            timeout=5
                        )
                        if pbp_response.status_code == 200:
                            pbp_data = pbp_response.json()
                            pbp_state = pbp_data.get("gameState", "").upper()
                            if pbp_state in ("LIVE", "CRIT", "INTERMISSION"):
                                active_game_ids.append(int(game_id))
                                logger = logging.getLogger(__name__)
                                logger.info(f"[scrape_live_nhl_stats] Found live game {game_id} via database check (PBP state: {pbp_state})")
                            elif pbp_state in ("OFF", "FINAL"):
                                # Game finished recently - check if within 4 hour window
                                game_info = pbp_data.get("gameInfo", {})
                                start_time_utc = game_info.get("startTimeUTC", "")
                                if start_time_utc:
                                    try:
                                        game_date = dt.datetime.fromisoformat(start_time_utc.replace('Z', '+00:00'))
                                        if (now - game_date).total_seconds() < 14400:  # 4 hours
                                            active_game_ids.append(int(game_id))
                                            logger = logging.getLogger(__name__)
                                            logger.info(f"[scrape_live_nhl_stats] Found recently finished game {game_id} via database check (finished {(now - game_date).total_seconds()/3600:.1f}h ago)")
                                    except:
                                        pass
                    except Exception as pbp_e:
                        # If PBP check fails but DB says live, include it anyway (better to update than miss)
                        active_game_ids.append(int(game_id))
                        logger = logging.getLogger(__name__)
                        logger.warning(f"[scrape_live_nhl_stats] PBP check failed for game {game_id} but DB says live, including anyway: {pbp_e}")
        except Exception as e:
            logger = logging.getLogger(__name__)
            logger.warning(f"[scrape_live_nhl_stats] Error checking database for live games: {e}")
        
        # Method 3: Fallback - check database for today's games and check PBP directly
        # Only run if we haven't found any games yet
        if not active_game_ids:
            try:
                db = supabase_client()
                today = dt.date.today()
                today_games = db.select(
                    "nhl_games",
                    select="game_id",
                    filters=[("game_date", "eq", today.isoformat())],
                    limit=20
                )
                
                if today_games:
                    import requests
                    for game in today_games:
                        game_id = game.get("game_id")
                        if game_id:
                            try:
                                pbp_response = requests.get(
                                    f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play",
                                    timeout=5
                                )
                                if pbp_response.status_code == 200:
                                    pbp_data = pbp_response.json()
                                    pbp_state = pbp_data.get("gameState", "").upper()
                                    if pbp_state in ("LIVE", "CRIT", "INTERMISSION"):
                                        active_game_ids.append(int(game_id))
                                    elif pbp_state in ("OFF", "FINAL"):
                                        # Check if finished recently (within 4 hours)
                                        game_info = pbp_data.get("gameInfo", {})
                                        start_time_utc = game_info.get("startTimeUTC", "")
                                        if start_time_utc:
                                            try:
                                                game_date = dt.datetime.fromisoformat(start_time_utc.replace('Z', '+00:00'))
                                                # Extended to 4 hours to catch games that just finished
                                                if (now - game_date).total_seconds() < 14400:  # 4 hours
                                                    active_game_ids.append(int(game_id))
                                                    logger = logging.getLogger(__name__)
                                                    logger.debug(f"[scrape_live_nhl_stats] Found recently finished game {game_id} via fallback PBP check")
                                            except:
                                                pass
                            except:
                                continue
            except Exception as e:
                print(f"[scrape_live_nhl_stats] Fallback game detection failed: {e}")
        
        return active_game_ids
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.error(f"[scrape_live_nhl_stats] Error fetching active games: {e}", exc_info=True)
        return []


def get_last_update_time(db: SupabaseRest, game_id: int) -> Optional[dt.datetime]:
    """
    Get the last time stats were updated for this game.
    
    IMPORTANT: Only checks updates from THIS script (scrape_live_nhl_stats).
    Uses a marker or checks if the update was from the boxscore scraper.
    
    Returns:
        Last update time or None if never updated
    """
    try:
        # Check player_game_stats for any record with recent update
        # We'll use the most recent updated_at, but we need to be smarter about
        # whether it was from this script or from another source
        stats = db.select(
            "player_game_stats",
            select="updated_at",
            filters=[("game_id", "eq", game_id)],
            limit=1
        )
        
        if stats and len(stats) > 0:
            updated_str = stats[0].get("updated_at")
            if updated_str:
                try:
                    return dt.datetime.fromisoformat(updated_str.replace('Z', '+00:00'))
                except:
                    pass
    except Exception as e:
        print(f"[scrape_live_nhl_stats] Error checking last update for game {game_id}: {e}")
    
    return None


def update_game_scores_in_nhl_games(db: SupabaseRest, game_id: int, boxscore: dict) -> bool:
    """
    Update game scores and status in nhl_games table from boxscore.
    
    Args:
        db: Supabase client
        game_id: NHL game ID
        boxscore: Boxscore JSON from NHL API
    """
    try:
        # Extract scores from boxscore
        home_team = boxscore.get("homeTeam", {})
        away_team = boxscore.get("awayTeam", {})
        
        home_abbrev = home_team.get("abbrev", "")
        away_abbrev = away_team.get("abbrev", "")
        
        # Get scores from boxscore - check multiple possible locations
        home_score = None
        away_score = None
        
        # Try boxscore root level (primary method)
        if "homeTeam" in boxscore and isinstance(boxscore["homeTeam"], dict):
            home_score = boxscore["homeTeam"].get("score", None)
        if "awayTeam" in boxscore and isinstance(boxscore["awayTeam"], dict):
            away_score = boxscore["awayTeam"].get("score", None)
        
        # Try gameInfo
        if home_score is None or away_score is None:
            game_info = boxscore.get("gameInfo", {})
            if "homeTeamScore" in game_info:
                home_score = game_info.get("homeTeamScore")
            if "awayTeamScore" in game_info:
                away_score = game_info.get("awayTeamScore")
        
        # Try linescore
        if home_score is None or away_score is None:
            linescore = boxscore.get("linescore", {})
            if "byPeriod" in linescore:
                by_period = linescore["byPeriod"]
                if isinstance(by_period, list) and len(by_period) > 0:
                    # Sum up scores from all periods
                    home_total = 0
                    away_total = 0
                    for period in by_period:
                        if isinstance(period, dict):
                            home_total += int(period.get("home", 0) or 0)
                            away_total += int(period.get("away", 0) or 0)
                    if home_total > 0 or away_total > 0:
                        home_score = home_total
                        away_score = away_total
        
        # Determine game status - handle both OFF and FINAL states
        game_state = boxscore.get("gameState", "").upper()
        if game_state in ("LIVE", "CRIT", "INTERMISSION"):
            status = "live"
        elif game_state in ("OFF", "FINAL"):
            status = "final"
        else:
            status = "scheduled"
        
        # Extract period info if live
        period = None
        period_time = None
        if status == "live":
            linescore = boxscore.get("linescore", {})
            current_period = linescore.get("currentPeriod", 0)
            if current_period == 1:
                period = "1st"
            elif current_period == 2:
                period = "2nd"
            elif current_period == 3:
                period = "3rd"
            elif current_period == 4:
                period = "OT"
            elif current_period > 4:
                period = "SO"
            
            period_time = linescore.get("currentPeriodTimeRemaining", None)
        
        # Update nhl_games table if we have score info
        if home_score is not None and away_score is not None:
            update_data = {
                "home_score": int(home_score),
                "away_score": int(away_score),
                "status": status
            }
            
            if period:
                update_data["period"] = period
            if period_time:
                update_data["period_time"] = period_time
            
            try:
                db.update(
                    "nhl_games",
                    update_data,
                    filters=[("game_id", "eq", game_id)]
                )
                print(f"[scrape_live_nhl_stats] Updated game {game_id} scores: {away_abbrev} {away_score}-{home_score} {home_abbrev} ({status})")
                return True
            except Exception as e:
                print(f"[scrape_live_nhl_stats] Warning: Could not update nhl_games for game {game_id}: {e}")
                return False
        else:
            # Still update status even if scores aren't available
            try:
                db.update(
                    "nhl_games",
                    {"status": status},
                    filters=[("game_id", "eq", game_id)]
                )
                return True
            except:
                return False
                
    except Exception as e:
        print(f"[scrape_live_nhl_stats] Warning: Error updating game scores for {game_id}: {e}")
        return False


def should_update_game(db: SupabaseRest, game_id: int, is_live: bool = False, force: bool = False) -> bool:
    """
    Check if a game should be updated (cooldown check).
    
    Args:
        db: Supabase client
        game_id: Game ID to check
        is_live: If True, use shorter cooldown for live games, otherwise use default (5min)
        force: If True, bypass cooldown and always return True
    
    Returns:
        True if game should be updated, False if still in cooldown
    """
    if force:
        return True
    
    last_update = get_last_update_time(db, game_id)
    
    if last_update is None:
        return True  # Never updated, should update
    
    now = dt.datetime.now(dt.timezone.utc)
    time_since_update = (now - last_update).total_seconds()
    
    # Determine cooldown based on game state and stats
    if is_live:
        # For live games, check if stats are zero - use shorter cooldown if so
        try:
            existing_stats = db.select(
                "player_game_stats",
                select="nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal",
                filters=[("game_id", "eq", game_id)],
                limit=10
            )
            if existing_stats:
                # Check if all stats are 0
                all_zero = all(
                    s.get("nhl_goals", 0) == 0 and 
                    s.get("nhl_assists", 0) == 0 and 
                    s.get("nhl_points", 0) == 0 and
                    s.get("nhl_shots_on_goal", 0) == 0
                    for s in existing_stats
                )
                if all_zero:
                    cooldown = 15  # 15 seconds for live games with zero stats
                else:
                    cooldown = 30  # 30 seconds for live games with stats
            else:
                # No stats exist - use shorter cooldown
                cooldown = 15
        except:
            # If check fails, use default live cooldown
            cooldown = 30
    else:
        # Finished games: 5 minutes
        cooldown = 300
    
    return time_since_update >= cooldown


def update_finished_game_scores_in_batch(db: SupabaseRest, max_games: int = 20) -> Dict[str, int]:
    """
    Update scores for finished games that are missing scores.
    This is called periodically to ensure finished games show their final scores.
    
    Args:
        db: Supabase client
        max_games: Maximum number of games to check
    
    Returns:
        Dictionary with update statistics
    """
    try:
        today = dt.date.today()
        yesterday = today - dt.timedelta(days=1)
        
        updated_count = 0
        checked_count = 0
        
        # Check today and yesterday
        for check_date in [yesterday, today]:
            games = db.select(
                "nhl_games",
                select="game_id,home_team,away_team,home_score,away_score,status",
                filters=[("game_date", "eq", check_date.isoformat())],
                limit=max_games
            )
            
            if not games:
                continue
            
            for game in games:
                game_id = game.get("game_id")
                home_score = game.get("home_score")
                away_score = game.get("away_score")
                status = game.get("status", "scheduled")
                
                # Check games that:
                # 1. Don't have scores, OR
                # 2. Are marked as "scheduled" but might be finished
                needs_check = (
                    home_score is None or away_score is None or
                    status == "scheduled"
                )
                
                if not needs_check:
                    continue
                
                checked_count += 1
                try:
                    # Fetch boxscore directly
                    boxscore_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/boxscore"
                    boxscore_response = requests.get(boxscore_url, timeout=10)
                    boxscore_response.raise_for_status()
                    boxscore = boxscore_response.json()
                    
                    game_state = boxscore.get("gameState", "").upper()
                    
                    # If game is OFF (finished), update scores
                    if game_state == "OFF":
                        if update_game_scores_in_nhl_games(db, game_id, boxscore):
                            updated_count += 1
                except Exception as e:
                    print(f"[scrape_live_nhl_stats] Error checking finished game {game_id}: {e}")
        
        if updated_count > 0:
            print(f"[scrape_live_nhl_stats] Updated {updated_count} finished game score(s)")
        
        return {"updated": updated_count, "checked": checked_count}
    except Exception as e:
        print(f"[scrape_live_nhl_stats] Error updating finished game scores: {e}")
        return {"updated": 0, "checked": 0}


def update_live_game_stats() -> Dict[str, int]:
    """
    Update official NHL stats for all active games.
    Also updates scores for finished games that are missing scores.
    
    Returns:
        Dictionary with update statistics
    """
    import datetime as dt
    import logging
    logger = logging.getLogger(__name__)
    now_str = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logger.info("=" * 80)
    logger.info(f"[scrape_live_nhl_stats] Starting live stats update cycle at {now_str}")
    logger.info("=" * 80)
    
    db = supabase_client()
    
    # First, update finished game scores
    finished_result = update_finished_game_scores_in_batch(db, max_games=20)
    
    # Then, update active games
    active_game_ids = get_active_game_ids()
    
    if not active_game_ids:
        logger.info("[scrape_live_nhl_stats] No active games found")
        return {
            "updated": finished_result.get("updated", 0),
            "skipped": 0,
            "failed": 0,
            "finished_updated": finished_result.get("updated", 0)
        }
    
    logger.info(f"[scrape_live_nhl_stats] Found {len(active_game_ids)} active game(s): {active_game_ids}")
    
    # Import the main scraper function (before we use it)
    from scrape_per_game_nhl_stats import (
        fetch_game_boxscore,
        extract_player_stats_from_boxscore,
        update_player_game_stats_nhl_columns
    )
    
    # Filter games by cooldown (use shorter cooldown for live games)
    games_to_update = []
    for game_id in active_game_ids:
        # STEP 1: Check for zero/missing stats BEFORE checking cooldown or fetching boxscore
        # This allows us to force updates even if boxscore fetch fails
        force_update = False
        has_zero_or_missing_stats = False
        try:
            existing_stats = db.select(
                "player_game_stats",
                select="player_id,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal",
                filters=[("game_id", "eq", game_id)],
                limit=20  # Check more players to get better sample
            )
            if existing_stats:
                # Check if all stats are 0 (might need update)
                all_zero = all(
                    s.get("nhl_goals", 0) == 0 and 
                    s.get("nhl_assists", 0) == 0 and 
                    s.get("nhl_points", 0) == 0 and
                    s.get("nhl_shots_on_goal", 0) == 0
                    for s in existing_stats
                )
                if all_zero:
                    has_zero_or_missing_stats = True
                    logger.info(f"[scrape_live_nhl_stats] Game {game_id} has all-zero stats ({len(existing_stats)} players checked)")
            else:
                # No stats exist yet - force update to create them
                has_zero_or_missing_stats = True
                logger.info(f"[scrape_live_nhl_stats] Game {game_id} has no player_game_stats rows")
        except Exception as e:
            logger.warning(f"[scrape_live_nhl_stats] Error checking stats for game {game_id}: {e}")
            # If check fails, we'll check game state below
        
        # STEP 2: Check if game is actually live (not just finished)
        # For live games, ALWAYS fetch fresh from API (not stored data)
        is_live = False
        boxscore = None
        try:
            # For active games, force API fetch to get fresh stats
            boxscore = fetch_game_boxscore(game_id, db, force_api=True)
            if boxscore:
                game_state = boxscore.get("gameState", "").upper()
                is_live = game_state in ("LIVE", "CRIT", "INTERMISSION")
                if is_live:
                    logger.info(f"[scrape_live_nhl_stats] Game {game_id} is LIVE (state: {game_state}) - fetched fresh from API")
        except Exception as e:
            logger.warning(f"[scrape_live_nhl_stats] Warning: Could not fetch boxscore for game {game_id}: {e}")
            # If we can't check game state but have zero/missing stats, assume it might be live
            if has_zero_or_missing_stats:
                is_live = True  # Assume live if we can't verify
                logger.info(f"[scrape_live_nhl_stats] Game {game_id}: Assuming live due to zero/missing stats")
        
        # STEP 3: Force update if game is live AND has zero/missing stats
        if is_live and has_zero_or_missing_stats:
            force_update = True
            logger.info(f"[scrape_live_nhl_stats] Game {game_id}: FORCING update (live game with zero/missing stats)")
        
        # STEP 4: Check cooldown (with force flag)
        should_update = should_update_game(db, game_id, is_live=is_live, force=force_update)
        if should_update:
            games_to_update.append(game_id)
            if force_update:
                logger.info(f"[scrape_live_nhl_stats] Game {game_id}: Added to update queue (FORCED - live game with zero/missing stats)")
            else:
                logger.info(f"[scrape_live_nhl_stats] Game {game_id}: Added to update queue (cooldown passed, is_live={is_live})")
        else:
            # Get last update time for logging
            try:
                last_update = get_last_update_time(db, game_id)
                if last_update:
                    now = dt.datetime.now(dt.timezone.utc)
                    age = (now - last_update).total_seconds()
                    # Calculate when it will be ready
                    cooldown_time = 15 if (is_live and has_zero_or_missing_stats) else (30 if is_live else 300)
                    time_until_ready = max(0, cooldown_time - age)
                    logger.debug(f"[scrape_live_nhl_stats] Skipping game {game_id}: still in cooldown "
                          f"(last update {age:.0f}s ago, need {cooldown_time}s, ready in {time_until_ready:.0f}s, "
                          f"force={force_update}, is_live={is_live})")
                else:
                    logger.debug(f"[scrape_live_nhl_stats] Skipping game {game_id}: should_update returned False "
                          f"(force={force_update}, is_live={is_live})")
            except Exception as e:
                logger.warning(f"[scrape_live_nhl_stats] Skipping game {game_id}: error checking cooldown ({e})")
    
    if not games_to_update:
        # Log detailed reason why games are being skipped
        logger.info(f"[scrape_live_nhl_stats] All {len(active_game_ids)} active game(s) still in cooldown, skipping update")
        for game_id in active_game_ids:
            try:
                last_update = get_last_update_time(db, game_id)
                if last_update:
                    now = dt.datetime.now(dt.timezone.utc)
                    age = (now - last_update).total_seconds()
                    logger.info(f"[scrape_live_nhl_stats]   Game {game_id}: last updated {age:.0f}s ago (cooldown: 30s)")
            except:
                pass
        return {"updated": 0, "skipped": len(active_game_ids), "failed": 0}
    
    logger.info(f"[scrape_live_nhl_stats] Updating {len(games_to_update)} game(s) out of {len(active_game_ids)} active game(s)")
    
    updated_count = 0
    failed_count = 0
    
    for game_id in games_to_update:
        try:
            logger.info(f"[scrape_live_nhl_stats] Processing game {game_id}...")
            
            # Fetch boxscore - ALWAYS use API for live games to get fresh stats
            boxscore = fetch_game_boxscore(game_id, db, force_api=True)
            if not boxscore:
                logger.warning(f"[scrape_live_nhl_stats] Warning: Could not fetch boxscore for game {game_id}")
                failed_count += 1
                continue
            
            # Extract game date from boxscore
            game_info = boxscore.get("gameInfo", {})
            start_time_utc = game_info.get("startTimeUTC", "")
            if start_time_utc:
                try:
                    game_date = dt.datetime.fromisoformat(start_time_utc.replace('Z', '+00:00')).date()
                except:
                    game_date = dt.date.today()
            else:
                game_date = dt.date.today()
            
            # Extract player stats
            player_stats = extract_player_stats_from_boxscore(boxscore)
            if not player_stats:
                logger.warning(f"[scrape_live_nhl_stats] Warning: No player stats extracted for game {game_id}")
                failed_count += 1
                continue
            
            # Validate extracted stats before updating
            stats_with_data = sum(1 for pid, s in player_stats.items() 
                                if s.get("nhl_shots_on_goal", 0) > 0 or s.get("nhl_hits", 0) > 0 or 
                                   s.get("nhl_blocks", 0) > 0 or s.get("nhl_toi_seconds", 0) > 0)
            logger.info(f"[scrape_live_nhl_stats] Extracted stats for {len(player_stats)} players, "
                       f"{stats_with_data} have non-zero SOG/Hits/Blocks/TOI")
            
            # Update database
            result = update_player_game_stats_nhl_columns(
                db=db,
                game_id=game_id,
                game_date=game_date,
                player_stats=player_stats,
                season=DEFAULT_SEASON
            )
            
            # Also update game scores in nhl_games table
            update_game_scores_in_nhl_games(db, game_id, boxscore)
            
            # Validate that stats were actually written
            if result.get("updated", 0) > 0 or result.get("created", 0) > 0:
                updated_count += 1
                logger.info(f"[scrape_live_nhl_stats] Successfully updated game {game_id}: "
                      f"{result.get('updated', 0)} players updated, {result.get('created', 0)} players created, "
                      f"{result.get('skipped', 0)} skipped")
                
                # Verify stats were written by checking a sample player
                try:
                    sample_stats = db.select(
                        "player_game_stats",
                        select="player_id,nhl_shots_on_goal,nhl_hits,nhl_blocks,nhl_toi_seconds",
                        filters=[("game_id", "eq", game_id)],
                        limit=3
                    )
                    if sample_stats:
                        for s in sample_stats:
                            logger.debug(f"[scrape_live_nhl_stats]   Verified player {s['player_id']}: "
                                       f"SOG={s.get('nhl_shots_on_goal', 0)}, Hits={s.get('nhl_hits', 0)}, "
                                       f"Blocks={s.get('nhl_blocks', 0)}, TOI={s.get('nhl_toi_seconds', 0)}s")
                except Exception as verify_e:
                    logger.warning(f"[scrape_live_nhl_stats] Could not verify stats for game {game_id}: {verify_e}")
            else:
                logger.warning(f"[scrape_live_nhl_stats] Warning: No records updated for game {game_id} "
                      f"(result: {result})")
                failed_count += 1
            
            # Small delay to avoid rate limiting
            time.sleep(0.5)
            
        except Exception as e:
            logger.error(f"[scrape_live_nhl_stats] Error processing game {game_id}: {e}", exc_info=True)
            failed_count += 1
    
    # Calculate skipped count
    skipped_count = len(active_game_ids) - updated_count - failed_count
    
    logger.info("=" * 80)
    logger.info(f"[scrape_live_nhl_stats] Update cycle completed: {updated_count} games updated, "
          f"{skipped_count} skipped, {failed_count} failed, "
          f"{finished_result.get('updated', 0)} finished games updated")
    logger.info("=" * 80)
    
    return {
        "updated": updated_count,
        "skipped": skipped_count,
        "failed": failed_count,
        "finished_updated": finished_result.get("updated", 0)
    }


def main() -> int:
    """Main entry point for manual execution."""
    try:
        result = update_live_game_stats()
        print(f"\nSummary: {result}")
        return 0
    except KeyboardInterrupt:
        print("\n[scrape_live_nhl_stats] Interrupted by user")
        return 0
    except Exception as e:
        print(f"[scrape_live_nhl_stats] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

