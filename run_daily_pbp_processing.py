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
import sys
import time
import datetime as dt
from typing import Dict, List, Optional
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from src.utils.citrus_request import citrus_request

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
        print(f"[run_daily_pbp_processing] Error fetching unprocessed games: {e}")
        return []


def count_unprocessed_games(db: SupabaseRest) -> int:
    """Count total number of unprocessed games."""
    try:
        games = get_unprocessed_games(db, limit=10000)  # Get a large sample to count
        return len(games)
    except Exception as e:
        print(f"[run_daily_pbp_processing] Error counting unprocessed games: {e}")
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
        from process_xg_stats import process_single_game_json
        
        result = process_single_game_json(raw_json, game_id)
        
        if result is not None:
            return True
        else:
            print(f"[run_daily_pbp_processing] Game {game_id}: Processing returned None (may have no shots)")
            return False
            
    except Exception as e:
        print(f"[run_daily_pbp_processing] Error processing game {game_id}: {e}")
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
    print("=" * 80)
    print(f"[run_daily_pbp_processing] Processing recently finished games (max age: {max_age_hours} hours)")
    print("=" * 80)
    
    db = supabase_client()
    now = dt.datetime.now(dt.timezone.utc)
    cutoff_time = now - dt.timedelta(hours=max_age_hours)
    
    # Get all unprocessed games
    unprocessed_games = get_unprocessed_games(db, limit=1000)
    
    if not unprocessed_games:
        print("[run_daily_pbp_processing] No unprocessed games found")
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
                        print(f"[run_daily_pbp_processing] Game {game_id} is now OFF (was {game_state}), will process")
            except Exception as e:
                # If PBP check fails, skip this game
                pass
    
    if not recently_finished:
        print(f"[run_daily_pbp_processing] No recently finished games found (checked {len(unprocessed_games)} unprocessed games)")
        return {"processed": 0, "failed": 0, "skipped": 0, "game_ids": []}
    
    print(f"[run_daily_pbp_processing] Found {len(recently_finished)} recently finished game(s) to process")
    print()
    
    # Process the games
    processed_count = 0
    failed_count = 0
    skipped_count = 0
    processed_game_ids = []  # Track successfully processed game IDs
    
    for idx, game in enumerate(recently_finished, 1):
        game_id = game.get("game_id")
        raw_json = game.get("raw_json")
        game_date = game.get("game_date", "unknown")
        
        if not game_id or not raw_json:
            print(f"[run_daily_pbp_processing] Skipping invalid game record: {game_id}")
            skipped_count += 1
            continue
        
        print(f"[{idx}/{len(recently_finished)}] Processing recently finished game {game_id} ({game_date})...")
        
        game_start_time = time.time()
        success = process_single_game(game_id, raw_json)
        game_time = time.time() - game_start_time
        
        if success:
            processed_count += 1
            processed_game_ids.append(game_id)
            print(f"[run_daily_pbp_processing] ✓ Game {game_id} processed successfully ({game_time:.2f}s)")
            
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
                        print(f"[run_daily_pbp_processing] Warning: Game {game_id} not marked as processed, marking now...")
                        db.update(
                            "raw_nhl_data",
                            {"processed": True},
                            filters=[("game_id", "eq", game_id)]
                        )
            except Exception as e:
                print(f"[run_daily_pbp_processing] Warning: Could not verify processed flag for game {game_id}: {e}")
        else:
            failed_count += 1
            print(f"[run_daily_pbp_processing] ✗ Game {game_id} failed to process")
        
        # Small delay between games
        time.sleep(0.5)
    
    print("=" * 80)
    print(f"[run_daily_pbp_processing] Recently finished games processing completed:")
    print(f"  Processed: {processed_count}")
    print(f"  Failed: {failed_count}")
    print(f"  Skipped: {skipped_count}")
    print("=" * 80)
    
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
    print("=" * 80)
    print("[run_daily_pbp_processing] Starting daily PBP processing")
    print("=" * 80)
    print(f"Batch size: {BATCH_SIZE}")
    print(f"Max retries per game: {MAX_RETRIES}")
    print()
    
    db = supabase_client()
    
    # Count unprocessed games
    total_unprocessed = count_unprocessed_games(db)
    print(f"[run_daily_pbp_processing] Found {total_unprocessed} unprocessed game(s)")
    
    if total_unprocessed == 0:
        print("[run_daily_pbp_processing] No games to process. Exiting.")
        return {"processed": 0, "failed": 0, "skipped": 0}
    
    print()
    
    # Process games in batches
    processed_count = 0
    failed_count = 0
    skipped_count = 0
    retry_map = {}  # game_id -> retry_count
    
    offset = 0
    batch_num = 1
    start_time = time.time()
    
    while True:
        # Fetch batch
        games = get_unprocessed_games(db, limit=BATCH_SIZE)
        
        if not games:
            break
        
        print(f"[run_daily_pbp_processing] Processing batch {batch_num} ({len(games)} games)...")
        
        batch_start_time = time.time()
        batch_processed = 0
        
        for idx, game in enumerate(games, 1):
            game_id = game.get("game_id")
            raw_json = game.get("raw_json")
            game_date = game.get("game_date", "unknown")
            
            if not game_id or not raw_json:
                print(f"[run_daily_pbp_processing] Skipping invalid game record: {game_id}")
                skipped_count += 1
                continue
            
            # Check retry count
            retry_count = retry_map.get(game_id, 0)
            if retry_count >= MAX_RETRIES:
                print(f"[run_daily_pbp_processing] Game {game_id} exceeded max retries, skipping")
                failed_count += 1
                continue
            
            # Progress tracking
            total_processed_so_far = processed_count + batch_processed
            percent = (total_processed_so_far / total_unprocessed * 100) if total_unprocessed > 0 else 0
            elapsed = time.time() - start_time if 'start_time' in locals() else 0
            avg_time = elapsed / total_processed_so_far if total_processed_so_far > 0 else 0
            remaining = avg_time * (total_unprocessed - total_processed_so_far)
            
            print(f"[{total_processed_so_far + 1}/{total_unprocessed}] ({percent:.1f}%) Processing game {game_id} ({game_date})...")
            if total_processed_so_far > 0:
                print(f"  Elapsed: {elapsed:.1f}s | Est. remaining: {remaining:.1f}s | Batch: {idx}/{len(games)}")
            
            game_start_time = time.time()
            
            # Process game
            success = process_single_game(game_id, raw_json)
            
            game_time = time.time() - game_start_time
            
            if success:
                processed_count += 1
                batch_processed += 1
                print(f"[run_daily_pbp_processing] ✓ Game {game_id} processed successfully ({game_time:.2f}s)")
                
                # Verify it was marked as processed
                try:
                    # Check if processed flag was set (process_xg_stats should do this)
                    check = db.select(
                        "raw_nhl_data",
                        select="processed",
                        filters=[("game_id", "eq", game_id)],
                        limit=1
                    )
                    if check and len(check) > 0:
                        if not check[0].get("processed", False):
                            print(f"[run_daily_pbp_processing] Warning: Game {game_id} not marked as processed, marking now...")
                            db.update(
                                "raw_nhl_data",
                                {"processed": True},
                                filters=[("game_id", "eq", game_id)]
                            )
                except Exception as e:
                    print(f"[run_daily_pbp_processing] Warning: Could not verify processed flag for game {game_id}: {e}")
            else:
                retry_map[game_id] = retry_count + 1
                if retry_map[game_id] < MAX_RETRIES:
                    print(f"[run_daily_pbp_processing] Game {game_id} failed, will retry (attempt {retry_map[game_id]}/{MAX_RETRIES})")
                else:
                    print(f"[run_daily_pbp_processing] ✗ Game {game_id} failed after {MAX_RETRIES} attempts")
                    failed_count += 1
            
            # Small delay between games
            time.sleep(0.5)
        
        batch_num += 1
        
        # Check if we've processed all games (stop if batch was smaller than batch size)
        if len(games) < BATCH_SIZE:
            break
        
        # Progress update
        print(f"[run_daily_pbp_processing] Progress: {processed_count} processed, {failed_count} failed, {skipped_count} skipped")
        print()
    
    print("=" * 80)
    print(f"[run_daily_pbp_processing] Processing completed:")
    print(f"  Processed: {processed_count}")
    print(f"  Failed: {failed_count}")
    print(f"  Skipped: {skipped_count}")
    print("=" * 80)
    
    return {
        "processed": processed_count,
        "failed": failed_count,
        "skipped": skipped_count
    }


def main() -> int:
    """Main entry point for manual execution."""
    try:
        result = process_all_unprocessed_games()
        print(f"\nSummary: {result}")
        return 0
    except KeyboardInterrupt:
        print("\n[run_daily_pbp_processing] Interrupted by user")
        return 0
    except Exception as e:
        print(f"[run_daily_pbp_processing] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

