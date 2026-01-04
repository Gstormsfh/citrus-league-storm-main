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
COOLDOWN_SECONDS = int(os.getenv("CITRUS_LIVE_STATS_COOLDOWN", "300"))  # 5 minutes cooldown per game


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
    
    Returns:
        List of game IDs that need stats updates
    """
    try:
        schedule = get_schedule_now()
        games = schedule.get("games", [])
        
        active_game_ids = []
        now = dt.datetime.now(dt.timezone.utc)
        
        for game in games:
            game_state = game.get("gameState", "").upper()
            game_id = game.get("id")
            
            if not game_id:
                continue
            
            # Include LIVE, CRIT, and INTERMISSION games (all active states)
            if game_state in ("LIVE", "CRIT", "INTERMISSION"):
                active_game_ids.append(int(game_id))
            # Include OFF games finished in last 2 hours (still processing)
            elif game_state == "OFF":
                game_date_str = game.get("startTimeUTC", "")
                if game_date_str:
                    try:
                        game_date = dt.datetime.fromisoformat(game_date_str.replace('Z', '+00:00'))
                        if (now - game_date).total_seconds() < 7200:  # 2 hours
                            active_game_ids.append(int(game_id))
                    except:
                        pass
        
        return active_game_ids
    except Exception as e:
        print(f"[scrape_live_nhl_stats] Error fetching active games: {e}")
        return []


def get_last_update_time(db: SupabaseRest, game_id: int) -> Optional[dt.datetime]:
    """
    Get the last time stats were updated for this game.
    
    Returns:
        Last update time or None if never updated
    """
    try:
        # Check player_game_stats for any record with recent update
        stats = db.select(
            "player_game_stats",
            select="updated_at",
            filters=[("game_id", "eq", game_id)],
            limit=1,
            order_by="updated_at",
            order_direction="desc"
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


def should_update_game(db: SupabaseRest, game_id: int) -> bool:
    """
    Check if a game should be updated (cooldown check).
    
    Returns:
        True if game should be updated, False if still in cooldown
    """
    last_update = get_last_update_time(db, game_id)
    
    if last_update is None:
        return True  # Never updated, should update
    
    now = dt.datetime.now(dt.timezone.utc)
    time_since_update = (now - last_update).total_seconds()
    
    return time_since_update >= COOLDOWN_SECONDS


def update_live_game_stats() -> Dict[str, int]:
    """
    Update official NHL stats for all active games.
    
    Returns:
        Dictionary with update statistics
    """
    print("=" * 80)
    print("[scrape_live_nhl_stats] Starting live stats update cycle")
    print("=" * 80)
    
    db = supabase_client()
    active_game_ids = get_active_game_ids()
    
    if not active_game_ids:
        print("[scrape_live_nhl_stats] No active games found")
        return {"updated": 0, "skipped": 0, "failed": 0}
    
    print(f"[scrape_live_nhl_stats] Found {len(active_game_ids)} active game(s)")
    
    # Filter games by cooldown
    games_to_update = []
    for game_id in active_game_ids:
        if should_update_game(db, game_id):
            games_to_update.append(game_id)
        else:
            print(f"[scrape_live_nhl_stats] Skipping game {game_id} (still in cooldown)")
    
    if not games_to_update:
        print("[scrape_live_nhl_stats] All games still in cooldown, skipping update")
        return {"updated": 0, "skipped": len(active_game_ids), "failed": 0}
    
    print(f"[scrape_live_nhl_stats] Updating {len(games_to_update)} game(s)")
    
    # Import the main scraper function
    from scrape_per_game_nhl_stats import (
        fetch_game_boxscore,
        extract_player_stats_from_boxscore,
        update_player_game_stats_nhl_columns
    )
    
    updated_count = 0
    failed_count = 0
    
    for game_id in games_to_update:
        try:
            print(f"[scrape_live_nhl_stats] Processing game {game_id}...")
            
            # Fetch boxscore
            boxscore = fetch_game_boxscore(game_id, db)
            if not boxscore:
                print(f"[scrape_live_nhl_stats] Warning: Could not fetch boxscore for game {game_id}")
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
                print(f"[scrape_live_nhl_stats] Warning: No player stats extracted for game {game_id}")
                failed_count += 1
                continue
            
            # Update database
            result = update_player_game_stats_nhl_columns(
                db=db,
                game_id=game_id,
                game_date=game_date,
                player_stats=player_stats,
                season=DEFAULT_SEASON
            )
            
            if result.get("updated", 0) > 0 or result.get("created", 0) > 0:
                updated_count += 1
                print(f"[scrape_live_nhl_stats] Successfully updated game {game_id}: "
                      f"{result.get('updated', 0)} updated, {result.get('created', 0)} created")
            else:
                print(f"[scrape_live_nhl_stats] Warning: No records updated for game {game_id}")
                failed_count += 1
            
            # Small delay to avoid rate limiting
            time.sleep(0.5)
            
        except Exception as e:
            print(f"[scrape_live_nhl_stats] Error processing game {game_id}: {e}")
            import traceback
            traceback.print_exc()
            failed_count += 1
    
    print("=" * 80)
    print(f"[scrape_live_nhl_stats] Update cycle completed: {updated_count} updated, {failed_count} failed")
    print("=" * 80)
    
    return {
        "updated": updated_count,
        "skipped": len(active_game_ids) - len(games_to_update),
        "failed": failed_count
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

