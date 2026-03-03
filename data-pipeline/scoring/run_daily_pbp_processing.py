#!/usr/bin/env python3
"""
run_daily_pbp_processing.py

Wrapper for processing unprocessed games from raw_nhl_data into raw_shots.
Designed to run daily (typically at 11:59 PM) to process all finished games.

This script:
1. Finds all games in raw_nhl_data where processed = false
2. Processes them in batches using process_xg_stats.py
3. Marks games as processed = true after successful completion
4. Provides progress logging and error handling
"""

import os
import signal
import sys
import time
import datetime as dt
from typing import Dict, List, Optional
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

signal.signal(signal.SIGINT, _handle_shutdown)
signal.signal(signal.SIGTERM, _handle_shutdown)

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

BATCH_SIZE = int(os.getenv("CITRUS_PBP_BATCH_SIZE", "10"))
MAX_RETRIES = 3


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_unprocessed_games(db: SupabaseRest, limit: Optional[int] = None) -> List[Dict]:
    """
    Get all unprocessed games from raw_nhl_data.
    
    Args:
        db: Supabase client
        limit: Optional limit on number of games to fetch
    
    Returns:
        List of game records with game_id and raw_json
    """
    try:
        filters = [("processed", "eq", False)]
        
        # Order by game_date descending to process most recent games first
        games = db.select(
            "raw_nhl_data",
            select="game_id,raw_json,game_date",
            filters=filters,
            limit=limit or 1000,  # Default to 1000 if no limit
            order="game_date.desc"
        )
        
        return games or []
    except Exception as e:
        logger.error(f"[run_daily_pbp_processing] Error fetching unprocessed games: {e}")
        return []


def count_unprocessed_games(db: SupabaseRest) -> int:
    """Count total number of unprocessed games."""
    try:
        games = get_unprocessed_games(db, limit=10000)  # Get a large sample to count
        return len(games)
    except Exception as e:
        logger.error(f"[run_daily_pbp_processing] Error counting unprocessed games: {e}")
        return 0


def process_single_game(game_id: int, raw_json: dict) -> bool:
    """
    Process a single game using process_xg_stats.py logic.
    
    Args:
        game_id: NHL game ID
        raw_json: Raw PBP JSON from raw_nhl_data
    
    Returns:
        True if successful, False otherwise
    """
    try:
        # Import the processing function from process_xg_stats
        # The file is in scripts/utilities/, so we need to add it to the path
        import sys
        import os
        scripts_path = os.path.join(os.path.dirname(__file__), 'scripts', 'utilities')
        if scripts_path not in sys.path:
            sys.path.insert(0, scripts_path)
        
        from process_xg_stats import process_single_game_json
        
        result = process_single_game_json(raw_json, game_id)
        
        if result is not None:
            return True
        else:
            logger.info(f"[run_daily_pbp_processing] Game {game_id}: Processing returned None (may have no shots)")
            return False
            
    except ImportError as e:
        logger.error(f"[run_daily_pbp_processing] Import error for process_xg_stats: {e}")
        logger.info("[run_daily_pbp_processing] Make sure scripts/utilities/process_xg_stats.py exists")
        return False
    except Exception as e:
        logger.error(f"[run_daily_pbp_processing] Error processing game {game_id}: {e}")
        import traceback
        traceback.print_exc()
        return False


def process_recently_finished_games(max_age_hours: int = 2) -> Dict[str, int]:
    """
    Process games that have recently finished (gameState = OFF, processed = false).
    Only processes games finished within the last max_age_hours to avoid processing old games.
    
    Args:
        max_age_hours: Maximum age in hours for a finished game to be processed
    
    Returns:
        Dictionary with processing statistics
    """
    logger.info("=" * 80)
    logger.info(f"[run_daily_pbp_processing] Processing recently finished games (max age: {max_age_hours} hours)")
    logger.info("=" * 80)
    
    db = supabase_client()
    now = dt.datetime.now(dt.timezone.utc)
    cutoff_time = now - dt.timedelta(hours=max_age_hours)
    
    # Get all unprocessed games
    unprocessed_games = get_unprocessed_games(db, limit=1000)
    
    if not unprocessed_games:
        logger.info("[run_daily_pbp_processing] No unprocessed games found")
        return {"processed": 0, "failed": 0, "skipped": 0, "game_ids": []}
    
    # Filter to only recently finished games
    # For today's games, we'll process any OFF games or check PBP API directly
    recently_finished = []
    today = dt.date.today()
    
    for game in unprocessed_games:
        raw_json = game.get("raw_json")
        game_id = game.get("game_id")
        game_date_str = game.get("game_date")
        
        if not raw_json:
            continue
        
        # Check if game is finished (gameState = "OFF")
        game_state = raw_json.get("gameState", "").upper()
        
        # If game is OFF in raw_json, add it
        if game_state == "OFF":
            # If it's from today, process it (regardless of timing)
            if game_date_str == today.isoformat():
                recently_finished.append(game)
                continue
        
        # If game state is not OFF in raw_json but it's from today,
        # check PBP API directly to see current state
        if game_date_str == today.isoformat() and game_id:
            try:
                pbp_response = citrus_request(
                    f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play",
                    timeout=5
                )
                if pbp_response.status_code == 200:
                    pbp_data = pbp_response.json()
                    pbp_state = pbp_data.get("gameState", "").upper()
                    if pbp_state == "OFF":
                        # Game is now OFF, process it
                        recently_finished.append(game)
                        logger.info(f"[run_daily_pbp_processing] Game {game_id} is now OFF (was {game_state}), will process")
            except Exception as e:
                # If PBP check fails, skip this game
                pass
    
    if not recently_finished:
        logger.info(f"[run_daily_pbp_processing] No recently finished games found (checked {len(unprocessed_games)} unprocessed games)")
        return {"processed": 0, "failed": 0, "skipped": 0, "game_ids": []}
    
    logger.info(f"[run_daily_pbp_processing] Found {len(recently_finished)} recently finished game(s) to process")
    logger.info("")
    
    # Process the games
    processed_count = 0
    failed_count = 0
    skipped_count = 0
    processed_game_ids = []  # Track successfully processed game IDs
    
    for idx, game in enumerate(recently_finished, 1):
        if _shutdown_requested:
            logger.info(f"\n[SHUTDOWN] Graceful shutdown complete. Processed {processed_count}/{len(recently_finished)} games.")
            sys.exit(0)

        game_id = game.get("game_id")
        raw_json = game.get("raw_json")
        game_date = game.get("game_date", "unknown")

        if not game_id or not raw_json:
            logger.warning(f"[run_daily_pbp_processing] Skipping invalid game record: {game_id}")
            skipped_count += 1
            continue
        
        logger.info(f"[{idx}/{len(recently_finished)}] Processing recently finished game {game_id} ({game_date})...")
        
        game_start_time = time.time()
        success = process_single_game(game_id, raw_json)
        game_time = time.time() - game_start_time
        
        if success:
            processed_count += 1
            processed_game_ids.append(game_id)
            logger.info(f"[run_daily_pbp_processing] ✓ Game {game_id} processed successfully ({game_time:.2f}s)")
            
            # Verify it was marked as processed
            try:
                check = db.select(
                    "raw_nhl_data",
                    select="processed",
                    filters=[("game_id", "eq", game_id)],
                    limit=1
                )
                if check and len(check) > 0:
                    if not check[0].get("processed", False):
                        logger.warning(f"[run_daily_pbp_processing] Warning: Game {game_id} not marked as processed, marking now...")
                        db.update(
                            "raw_nhl_data",
                            {"processed": True},
                            filters=[("game_id", "eq", game_id)]
                        )
            except Exception as e:
                logger.warning(f"[run_daily_pbp_processing] Warning: Could not verify processed flag for game {game_id}: {e}")
        else:
            failed_count += 1
            logger.error(f"[run_daily_pbp_processing] ✗ Game {game_id} failed to process")
        
        # Small delay between games
        time.sleep(0.5)
    
    logger.info("=" * 80)
    logger.info(f"[run_daily_pbp_processing] Recently finished games processing completed:")
    logger.info(f"  Processed: {processed_count}")
    logger.error(f"  Failed: {failed_count}")
    logger.info(f"  Skipped: {skipped_count}")
    logger.info("=" * 80)
    
    return {
        "processed": processed_count,
        "failed": failed_count,
        "skipped": skipped_count,
        "game_ids": processed_game_ids
    }


def process_all_unprocessed_games() -> Dict[str, int]:
    """
    Process all unprocessed games in batches.
    
    Returns:
        Dictionary with processing statistics
    """
    logger.info("=" * 80)
    logger.info("[run_daily_pbp_processing] Starting daily PBP processing")
    logger.info("=" * 80)
    logger.info(f"Batch size: {BATCH_SIZE}")
    logger.info(f"Max retries per game: {MAX_RETRIES}")
    logger.info("")
    
    db = supabase_client()
    
    # Count unprocessed games
    total_unprocessed = count_unprocessed_games(db)
    logger.info(f"[run_daily_pbp_processing] Found {total_unprocessed} unprocessed game(s)")
    
    if total_unprocessed == 0:
        logger.info("[run_daily_pbp_processing] No games to process. Exiting.")
        return {"processed": 0, "failed": 0, "skipped": 0}
    
    logger.info("")
    
    # Process games in batches
    processed_count = 0
    failed_count = 0
    skipped_count = 0
    retry_map = {}  # game_id -> retry_count
    permanently_failed_ids = set()  # Track games that exceeded retries - mark them as processed to stop infinite loop
    
    batch_num = 1
    start_time = time.time()
    max_batches = (total_unprocessed // BATCH_SIZE) + 10  # Safety limit to prevent infinite loops
    
    while batch_num <= max_batches:
        if _shutdown_requested:
            logger.error(f"\n[SHUTDOWN] Graceful shutdown complete. Processed: {processed_count}, Failed: {failed_count}")
            sys.exit(0)

        # Fetch batch
        games = get_unprocessed_games(db, limit=BATCH_SIZE)
        
        if not games:
            logger.info("[run_daily_pbp_processing] No more unprocessed games found.")
            break
        
        # Filter out games we've already permanently failed (they should be marked but just in case)
        games = [g for g in games if g.get("game_id") not in permanently_failed_ids]
        
        if not games:
            logger.error("[run_daily_pbp_processing] All remaining games have permanently failed. Exiting.")
            break
        
        logger.info(f"[run_daily_pbp_processing] Processing batch {batch_num} ({len(games)} games)...")
        
        batch_processed = 0
        batch_any_progress = False  # Track if we made any progress this batch
        
        for idx, game in enumerate(games, 1):
            game_id = game.get("game_id")
            raw_json = game.get("raw_json")
            game_date = game.get("game_date", "unknown")
            
            if not game_id or not raw_json:
                logger.warning(f"[run_daily_pbp_processing] Skipping invalid game record: {game_id}")
                skipped_count += 1
                batch_any_progress = True
                continue
            
            # Check retry count
            retry_count = retry_map.get(game_id, 0)
            if retry_count >= MAX_RETRIES:
                logger.info(f"[run_daily_pbp_processing] Game {game_id} exceeded max retries, marking as processed to prevent re-fetching")
                failed_count += 1
                permanently_failed_ids.add(game_id)
                batch_any_progress = True
                
                # CRITICAL FIX: Mark the game as processed so it doesn't get fetched again!
                try:
                    db.update(
                        "raw_nhl_data",
                        {"processed": True},  # Mark as processed even though it failed
                        filters=[("game_id", "eq", game_id)]
                    )
                    logger.error(f"[run_daily_pbp_processing] ✗ Game {game_id} marked as processed (failed permanently)")
                except Exception as e:
                    logger.error(f"[run_daily_pbp_processing] ERROR: Could not mark failed game {game_id} as processed: {e}")
                continue
            
            # Progress tracking
            total_processed_so_far = processed_count + batch_processed
            percent = (total_processed_so_far / total_unprocessed * 100) if total_unprocessed > 0 else 0
            elapsed = time.time() - start_time
            avg_time = elapsed / total_processed_so_far if total_processed_so_far > 0 else 0
            remaining = avg_time * (total_unprocessed - total_processed_so_far)
            
            logger.info(f"[{total_processed_so_far + 1}/{total_unprocessed}] ({percent:.1f}%) Processing game {game_id} ({game_date})...")
            if total_processed_so_far > 0:
                logger.info(f"  Elapsed: {elapsed:.1f}s | Est. remaining: {remaining:.1f}s | Batch: {idx}/{len(games)}")
            
            game_start_time = time.time()
            
            # Process game
            success = process_single_game(game_id, raw_json)
            
            game_time = time.time() - game_start_time
            
            if success:
                processed_count += 1
                batch_processed += 1
                batch_any_progress = True
                logger.info(f"[run_daily_pbp_processing] ✓ Game {game_id} processed successfully ({game_time:.2f}s)")
                
                # Verify it was marked as processed
                try:
                    check = db.select(
                        "raw_nhl_data",
                        select="processed",
                        filters=[("game_id", "eq", game_id)],
                        limit=1
                    )
                    if check and len(check) > 0:
                        if not check[0].get("processed", False):
                            logger.warning(f"[run_daily_pbp_processing] Warning: Game {game_id} not marked as processed, marking now...")
                            db.update(
                                "raw_nhl_data",
                                {"processed": True},
                                filters=[("game_id", "eq", game_id)]
                            )
                except Exception as e:
                    logger.warning(f"[run_daily_pbp_processing] Warning: Could not verify processed flag for game {game_id}: {e}")
            else:
                retry_map[game_id] = retry_count + 1
                if retry_map[game_id] < MAX_RETRIES:
                    logger.error(f"[run_daily_pbp_processing] Game {game_id} failed, will retry (attempt {retry_map[game_id]}/{MAX_RETRIES})")
                else:
                    logger.error(f"[run_daily_pbp_processing] ✗ Game {game_id} failed after {MAX_RETRIES} attempts, marking as processed")
                    failed_count += 1
                    permanently_failed_ids.add(game_id)
                    batch_any_progress = True
                    
                    # CRITICAL FIX: Mark the game as processed so it doesn't get fetched again!
                    try:
                        db.update(
                            "raw_nhl_data",
                            {"processed": True},
                            filters=[("game_id", "eq", game_id)]
                        )
                    except Exception as e:
                        logger.error(f"[run_daily_pbp_processing] ERROR: Could not mark failed game {game_id} as processed: {e}")
            
            # Small delay between games
            time.sleep(0.5)
        
        batch_num += 1
        
        # SAFETY: If we made no progress this batch (all games already failed), exit
        if not batch_any_progress:
            logger.error("[run_daily_pbp_processing] No progress made in this batch - all games may have failed. Exiting.")
            break
        
        # Check if we've processed all games (stop if batch was smaller than batch size)
        if len(games) < BATCH_SIZE:
            break
        
        # Progress update
        logger.error(f"[run_daily_pbp_processing] Progress: {processed_count} processed, {failed_count} failed, {skipped_count} skipped")
        logger.info("")
    
    # Safety check: if we hit max batches, log it
    if batch_num > max_batches:
        logger.warning(f"[run_daily_pbp_processing] WARNING: Hit max batch limit ({max_batches}). May indicate an issue.")
    
    logger.info("=" * 80)
    logger.info(f"[run_daily_pbp_processing] Processing completed:")
    logger.info(f"  Processed: {processed_count}")
    logger.error(f"  Failed: {failed_count}")
    logger.info(f"  Skipped: {skipped_count}")
    logger.info("=" * 80)
    
    return {
        "processed": processed_count,
        "failed": failed_count,
        "skipped": skipped_count
    }


def main() -> int:
    """Main entry point for manual execution."""
    try:
        result = process_all_unprocessed_games()
        logger.info(f"\nSummary: {result}")
        return 0
    except KeyboardInterrupt:
        logger.info("\n[run_daily_pbp_processing] Interrupted by user")
        return 0
    except Exception as e:
        logger.error(f"[run_daily_pbp_processing] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    raise SystemExit(main())

