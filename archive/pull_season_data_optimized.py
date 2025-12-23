#!/usr/bin/env python3
"""
pull_season_data_optimized.py
Optimized parallel data acquisition pipeline using multiprocessing.
"""

import sys
import datetime
import pandas as pd
import os
import time
import multiprocessing
import argparse
import random
from functools import partial
import traceback

# --- Imports from existing code ---
from data_acquisition import process_single_game, supabase
from pull_season_data import get_all_finished_games_from_db, cleanup_raw_shots_table, pull_season_data

# -------------------------------------------------------

DEFAULT_MAX_PROCESSES = 6
COOLDOWN_PERIOD_SECONDS = 60  # Time to pause pool when 429 is hit

# Set UTF-8 encoding for stdout (original code)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


# --- Multiprocessing Worker ---

def process_game_id(game_id, rate_limit_flag=None):
    """
    Wrapper for multiprocessing pool. Calls process_single_game.
    The primary purpose is to capture results/errors and provide a simple worker API.
    """
    try:
        # process_single_game handles the anti-bot delay and 429 detection internally
        result_df = process_single_game(game_id, rate_limit_flag=rate_limit_flag)
        
        if result_df is not None:
            return {'success': True, 'game_id': game_id, 'shots': len(result_df)}
        else:
            # If process_single_game returns None after max retries
            return {'success': False, 'game_id': game_id, 'error': 'Failed after max retries.'}
    
    except Exception as e:
        # This catches all other exceptions (DB, JSON parsing, 404/500 errors)
        return {'success': False, 'game_id': game_id, 'error': str(e)}


# --- Main Orchestrator ---

def pull_season_data_optimized(start_date, end_date, cleanup_first, max_processes):
    """
    Pull all season data using parallel processing of individual games.
    """
    if end_date is None:
        end_date = datetime.date.today().strftime('%Y-%m-%d')
    
    print("=" * 80)
    print(f"OPTIMIZED PARALLEL DATA PULL: {start_date} to {end_date}")
    print("=" * 80)
    print(f"Max concurrent processes: {max_processes}")
    print()
    
    if cleanup_first:
        print("[CLEANUP] Cleaning up old data from raw_shots table...")
        cleanup_raw_shots_table(confirm=True)
        print()
    
    # 1. Get all game IDs to process
    # Try database first (fast), but if that fails, use sequential processing
    # (API fetching for all dates is too slow and gets rate-limited)
    print("Checking database for finished games...")
    game_ids = get_all_finished_games_from_db(start_date, end_date)
    
    if not game_ids:
        print("[INFO] No finished games found in database.")
        print("[INFO] Using sequential day-by-day processing (more reliable for API rate limits)...")
        # Fallback to the original slow logic (using imported original function)
        return pull_season_data_fallback(start_date, end_date)
    
    # Only use parallel processing if we have game IDs from database
    # (not from API, as that would have already been rate-limited)
    print(f"[INFO] Found {len(game_ids)} games in database. Using parallel processing.")
    
    total_games = len(game_ids)
    print(f"\nProcessing {total_games:,} games in parallel...")
    
    # 2. Setup Pool-Level Throttling Manager
    manager = multiprocessing.Manager()
    # 'b' for boolean, initialized to False (not throttled)
    rate_limit_flag = manager.Value('b', False)
    
    # Add cooldown time as an attribute to the flag for worker visibility
    rate_limit_flag.cooldown_time = COOLDOWN_PERIOD_SECONDS
    
    # 3. Process games in parallel
    start_time = time.time()
    results = []
    
    try:
        with multiprocessing.Pool(max_processes) as pool:
            # Use partial to fix the rate_limit_flag argument for the pool map
            worker = partial(process_game_id, rate_limit_flag=rate_limit_flag)
            
            # Map the worker function to the list of game IDs
            results = pool.map(worker, game_ids)
    
    except Exception as e:
        print(f"\n[FATAL ERROR] Parallel pool failed: {e}")
        traceback.print_exc()
        return None
    
    end_time = time.time()
    
    # 4. Summarize Results
    successes = [r for r in results if r and r['success']]
    failures = [r for r in results if r and not r['success']]
    
    print("\n" + "=" * 80)
    print("PARALLEL PROCESSING COMPLETE")
    print("=" * 80)
    print(f"Total time taken: {end_time - start_time:.2f} seconds")
    print(f"Games Processed: {total_games:,}")
    print(f"Successful Games: {len(successes):,}")
    print(f"Failed Games: {len(failures):,}")
    
    if failures:
        print("\n[FAILED GAME IDs]:")
        for fail in failures:
            print(f"  Game {fail['game_id']}: {fail['error']}")
    
    # 5. Final Data Fetch and CSV Save (Original Logic)
    # The final data fetch remains the same as it reads from the DB, not the API.
    return final_data_fetch_and_csv_save(start_date)


# --- Fallback and Final Fetch Functions ---

def pull_season_data_fallback(start_date, end_date):
    """Calls the original sequential script function."""
    print("--- Running original slow sequential pull_season_data.py ---")
    try:
        # Call the original pull_season_data function (no cleanup since we already did it)
        result = pull_season_data(start_date=start_date, end_date=end_date, cleanup_first=False)
        print("--- Fallback completed. ---")
        return result
    except Exception as e:
        print(f"[ERROR] Fallback failed: {e}")
        traceback.print_exc()
        return None


def final_data_fetch_and_csv_save(start_date):
    """Fetches all data from raw_shots table and saves to CSV."""
    try:
        print("\nFetching all shots from raw_shots table...")
        all_shots = []
        offset = 0
        batch_size = 1000
        
        while True:
            response = supabase.table('raw_shots').select('*').gte('created_at', f'{start_date}T00:00:00').range(offset, offset + batch_size - 1).execute()
            if not response.data or len(response.data) == 0:
                break
            all_shots.extend(response.data)
            if len(response.data) < batch_size:
                break
            offset += batch_size
        
        if all_shots:
            df_shots = pd.DataFrame(all_shots)
            output_file = 'data/our_shots_2025_optimized.csv'
            os.makedirs(os.path.dirname(output_file), exist_ok=True)
            df_shots.to_csv(output_file, index=False)
            print(f"[OK] Fetched and saved {len(df_shots):,} shots to {output_file}")
            return df_shots
        else:
            print("[WARNING] No shots found in raw_shots table.")
            return None
    except Exception as e:
        print(f"Error during final data fetch: {e}")
        return None


# --- Main Execution ---

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Optimized parallel NHL data scraper')
    parser.add_argument('start_date', nargs='?', default='2025-10-07',
                       help='Start date (YYYY-MM-DD)')
    parser.add_argument('end_date', nargs='?', default=None,
                       help='End date (YYYY-MM-DD), defaults to today')
    parser.add_argument('--max-processes', '-p', type=int, default=DEFAULT_MAX_PROCESSES,
                       help=f'Maximum number of parallel processes (default: {DEFAULT_MAX_PROCESSES}, lower to reduce rate limiting risk)')
    # Use store_false for --no-cleanup to override the default=True behavior
    parser.add_argument('--cleanup-first', action='store_true', default=True,
                       help='Clean up old data before processing (default: True)')
    parser.add_argument('--no-cleanup', dest='cleanup_first', action='store_false',
                       help='Skip cleanup before processing')
    
    args = parser.parse_args()
    
    pull_season_data_optimized(
        start_date=args.start_date,
        end_date=args.end_date,
        cleanup_first=args.cleanup_first,
        max_processes=args.max_processes
    )

