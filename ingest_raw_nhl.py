#!/usr/bin/env python3
"""
ingest_raw_nhl.py
Phase 1: Fast, parallel raw data ingestion from NHL API.

This script scrapes play-by-play JSON AND boxscore JSON from the NHL API and stores both
in raw_nhl_data table. The boxscore data properly structures players in ["forwards", "defense", 
"goalies"] groups, ensuring defencemen stats are captured correctly.

It focuses on speed and reliability - no processing, just fetch and save.
Boxscore data is used by scrape_per_game_nhl_stats.py for official NHL stat extraction.
"""

import sys
import datetime
import requests
import time
import multiprocessing
import argparse
import random
from functools import partial
import traceback
from dotenv import load_dotenv
import os
from src.utils.citrus_request import citrus_request

# Set UTF-8 encoding for stdout
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Import Supabase client setup
from supabase_rest import SupabaseRest

# Load environment variables
load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

# NHL API base URL
NHL_BASE_URL = "https://api-web.nhle.com/v1"

# Constants
DEFAULT_MAX_PROCESSES = 10
MAX_429_RETRIES = 5
BASE_429_DELAY = 2
COOLDOWN_PERIOD_SECONDS = 60


def get_fresh_supabase_client():
    """Create a fresh Supabase client for process safety."""
    load_dotenv()
    SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def scrape_single_game_json(game_id):
    """
    Fetch raw JSON for a single game from NHL API.
    
    Args:
        game_id: NHL game ID (e.g., 2025020001)
    
    Returns:
        dict: Raw JSON data or None if failed
    """
    pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"
    
    # Randomized delay to avoid bot-like patterns
    time.sleep(random.uniform(0.1, 0.3))
    
    for attempt in range(MAX_429_RETRIES):
        try:
            response = citrus_request(pbp_url, timeout=15)
            
            if response.status_code == 429:
                if attempt < MAX_429_RETRIES - 1:
                    delay = min(BASE_429_DELAY ** (attempt + 1), 60)
                    print(f"  Game {game_id}: 429 rate limit. Waiting {delay}s...")
                    time.sleep(delay)
                    continue
                else:
                    print(f"  Game {game_id}: 429 after {MAX_429_RETRIES} attempts. Skipping.")
                    return None
            
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.Timeout:
            if attempt < MAX_429_RETRIES - 1:
                delay = min(BASE_429_DELAY ** attempt, 30)
                print(f"  Game {game_id}: Timeout (attempt {attempt + 1}/{MAX_429_RETRIES}). Retrying in {delay}s...")
                time.sleep(delay)
            else:
                print(f"  Game {game_id}: Timeout after {MAX_429_RETRIES} attempts. Skipping.")
                return None
                
        except requests.exceptions.RequestException as e:
            if attempt < MAX_429_RETRIES - 1:
                delay = min(BASE_429_DELAY ** attempt, 30)
                print(f"  Game {game_id}: Error (attempt {attempt + 1}/{MAX_429_RETRIES}): {e}")
                time.sleep(delay)
            else:
                print(f"  Game {game_id}: Failed after {MAX_429_RETRIES} attempts: {e}")
                return None
    
    return None


def scrape_single_game_boxscore(game_id):
    """
    Fetch boxscore JSON for a single game from NHL API.
    Boxscore properly structures players in ["forwards", "defense", "goalies"] groups,
    ensuring defencemen stats are captured correctly.
    
    Args:
        game_id: NHL game ID (e.g., 2025020001)
    
    Returns:
        dict: Boxscore JSON data or None if failed
    """
    boxscore_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/boxscore"
    
    # Small delay between PBP and boxscore fetch (within same worker)
    time.sleep(random.uniform(0.1, 0.2))
    
    for attempt in range(MAX_429_RETRIES):
        try:
            response = citrus_request(boxscore_url, timeout=15)
            
            if response.status_code == 429:
                if attempt < MAX_429_RETRIES - 1:
                    delay = min(BASE_429_DELAY ** (attempt + 1), 60)
                    print(f"  Game {game_id} boxscore: 429 rate limit. Waiting {delay}s...")
                    time.sleep(delay)
                    continue
                else:
                    print(f"  Game {game_id} boxscore: 429 after {MAX_429_RETRIES} attempts. Skipping.")
                    return None
            
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.Timeout:
            if attempt < MAX_429_RETRIES - 1:
                delay = min(BASE_429_DELAY ** attempt, 30)
                print(f"  Game {game_id} boxscore: Timeout (attempt {attempt + 1}/{MAX_429_RETRIES}). Retrying in {delay}s...")
                time.sleep(delay)
            else:
                print(f"  Game {game_id} boxscore: Timeout after {MAX_429_RETRIES} attempts. Skipping.")
                return None
                
        except requests.exceptions.RequestException as e:
            if attempt < MAX_429_RETRIES - 1:
                delay = min(BASE_429_DELAY ** attempt, 30)
                print(f"  Game {game_id} boxscore: Error (attempt {attempt + 1}/{MAX_429_RETRIES}): {e}")
                time.sleep(delay)
            else:
                print(f"  Game {game_id} boxscore: Failed after {MAX_429_RETRIES} attempts: {e}")
                return None
    
    return None


def save_raw_json_to_db(game_id, json_data, game_date, db_client, boxscore_json=None):
    """
    Save raw JSON and boxscore JSON to raw_nhl_data table using UPSERT for idempotency.
    
    Args:
        game_id: NHL game ID
        json_data: Raw PBP JSON from API
        game_date: Date of the game (YYYY-MM-DD)
        db_client: Supabase client
        boxscore_json: Optional boxscore JSON from API
    """
    try:
        # Extract game date from JSON if not provided
        if not game_date and json_data:
            # Try to extract date from JSON structure
            game_date = datetime.date.today().strftime('%Y-%m-%d')
        
        # Build upsert data
        upsert_data = {
            'game_id': game_id,
            'game_date': game_date,
            'raw_json': json_data,
            'scraped_at': datetime.datetime.now().isoformat()
        }
        
        # Add boxscore if provided
        if boxscore_json is not None:
            upsert_data['boxscore_json'] = boxscore_json
        
        # UPSERT: Insert or update if game_id already exists
        db_client.upsert('raw_nhl_data', upsert_data, on_conflict='game_id')
        
        return True
    except Exception as e:
        print(f"  Game {game_id}: Error saving to database: {e}")
        return False


def extract_game_date_from_json(json_data, game_id):
    """Extract game date from JSON structure."""
    try:
        # Try to get date from game info
        if 'gameInfo' in json_data:
            game_info = json_data['gameInfo']
            if 'startTimeUTC' in game_info:
                start_time = game_info['startTimeUTC']
                # Parse ISO format date
                date_part = start_time.split('T')[0]
                return date_part
    except:
        pass
    
    # Fallback: try to infer from game_id
    # Game IDs are like 2025020001 where 2025 is year, 02 is month, etc.
    try:
        game_id_str = str(game_id)
        if len(game_id_str) >= 8:
            year = game_id_str[:4]
            # Game ID format varies, try to extract date
            # For now, return None and let caller use today's date
            pass
    except:
        pass
    
    return None


def ingest_single_game(game_id, rate_limit_flag=None):
    """
    Worker function: Scrape and save a single game.
    Designed for multiprocessing.
    
    Args:
        game_id: NHL game ID
        rate_limit_flag: Shared flag for pool-level throttling
    
    Returns:
        dict: Result with success status
    """
    db_client = get_fresh_supabase_client()
    
    # Check if pool is throttled
    if rate_limit_flag and rate_limit_flag.value:
        cooldown_time = getattr(rate_limit_flag, 'cooldown_time', COOLDOWN_PERIOD_SECONDS)
        print(f"Game {game_id}: Pool throttled. Waiting {cooldown_time}s...")
        time.sleep(cooldown_time)
    
    try:
        # Scrape PBP JSON
        json_data = scrape_single_game_json(game_id)
        
        if json_data is None:
            return {'success': False, 'game_id': game_id, 'error': 'Failed to fetch PBP JSON'}
        
        # Scrape boxscore JSON (for proper defencemen handling)
        boxscore_json = scrape_single_game_boxscore(game_id)
        
        # Extract game date
        game_date = extract_game_date_from_json(json_data, game_id)
        if not game_date:
            # Fallback to today if we can't extract date
            game_date = datetime.date.today().strftime('%Y-%m-%d')
        
        # Save to database (UPSERT) - boxscore is optional, PBP is required
        saved = save_raw_json_to_db(game_id, json_data, game_date, db_client, boxscore_json=boxscore_json)
        
        if saved:
            boxscore_status = "with boxscore" if boxscore_json else "without boxscore"
            return {'success': True, 'game_id': game_id, 'boxscore': boxscore_json is not None}
        else:
            return {'success': False, 'game_id': game_id, 'error': 'Failed to save to database'}
            
    except Exception as e:
        return {'success': False, 'game_id': game_id, 'error': str(e)}


def get_finished_game_ids_from_api(start_date, end_date):
    """
    Get all finished game IDs from NHL API for date range.
    
    Args:
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
    
    Returns:
        list: List of game IDs
    """
    start = datetime.datetime.strptime(start_date, '%Y-%m-%d').date()
    end = datetime.datetime.strptime(end_date, '%Y-%m-%d').date()
    
    all_game_ids = []
    current_date = start
    
    print(f"Fetching game IDs from API for {start_date} to {end_date}...")
    
    while current_date <= end:
        date_str = current_date.strftime('%Y-%m-%d')
        
        # Fetch schedule for this date from NHL API
        try:
            schedule_url = f"{NHL_BASE_URL}/schedule/{date_str.replace('-', '')}"
            response = citrus_request(schedule_url, timeout=15)
            response.raise_for_status()
            schedule_data = response.json()
            
            # Extract finished game IDs
            finished_game_ids = []
            for date_entry in schedule_data.get('gameWeek', []):
                if date_entry.get('date') == date_str:
                    for game in date_entry.get('games', []):
                        game_state = game.get('gameState', '')
                        if game_state in ['FINAL', 'OFF', 'F']:
                            game_id = game.get('id')
                            if game_id:
                                finished_game_ids.append(game_id)
            
            all_game_ids.extend(finished_game_ids)
            if finished_game_ids:
                print(f"  {date_str}: Found {len(finished_game_ids)} finished games")
            
        except Exception as e:
            print(f"  {date_str}: Error fetching schedule: {e}")
        
        current_date += datetime.timedelta(days=1)
        time.sleep(0.5)  # Small delay to avoid rate limiting
    
    print(f"Total finished games from API: {len(all_game_ids)}")
    return all_game_ids


def get_unprocessed_games(start_date, end_date):
    """
    Get games that haven't been scraped yet (not in raw_nhl_data table).
    
    Args:
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
    
    Returns:
        list: List of game IDs that need to be scraped
    """
    # Get all finished games - try database first, then API
    all_game_ids = []
    
    # Try to get from nhl_games table first
    try:
        db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
        games = db.select(
            'nhl_games',
            select='game_id',
            filters=[
                ('game_date', 'gte', start_date),
                ('game_date', 'lte', end_date),
                ('status', 'in', ['final', 'FINAL', 'OFF', 'F'])
            ],
            limit=10000
        )
        if games:
            all_game_ids = [g['game_id'] for g in games if g.get('game_id')]
            print(f"Found {len(all_game_ids)} finished games in database from {start_date} to {end_date}")
    except Exception as e:
        print(f"Could not query nhl_games table: {e}")
        print("Falling back to API...")
    
    # Fallback to API if database query failed or returned no results
    if not all_game_ids:
        all_game_ids = get_finished_game_ids_from_api(start_date, end_date)
    
    if not all_game_ids:
        return []
    
    # Check which ones are already in raw_nhl_data
    print(f"Checking which of {len(all_game_ids)} games are already scraped...")
    
    # Fetch in batches to avoid memory issues
    already_scraped = set()
    offset = 0
    batch_size = 1000
    
    try:
        db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
        while True:
            games = db.select(
                'raw_nhl_data',
                select='game_id',
                limit=batch_size,
                offset=offset
            )
            if not games:
                break
            already_scraped.update([g['game_id'] for g in games if g.get('game_id')])
            if len(games) < batch_size:
                break
            offset += batch_size
    except Exception as e:
        if 'raw_nhl_data' in str(e) or 'PGRST205' in str(e):
            print(f"[ERROR] raw_nhl_data table does not exist. Please run migration:")
            print(f"  supabase/migrations/20251217000000_create_raw_nhl_data_table.sql")
            print(f"  Or apply it via Supabase dashboard.")
            raise
        raise
    
    # Return games that haven't been scraped
    unprocessed = [gid for gid in all_game_ids if gid not in already_scraped]
    print(f"Found {len(unprocessed)} games to scrape ({len(already_scraped)} already in database)")
    
    return unprocessed


def ingest_games_parallel(game_ids, max_processes=10):
    """
    Ingest games in parallel using multiprocessing.
    
    Args:
        game_ids: List of game IDs to scrape
        max_processes: Number of parallel processes
    
    Returns:
        dict: Summary with successes and failures
    """
    if not game_ids:
        print("No games to process.")
        return {'successes': 0, 'failures': 0, 'results': []}
    
    print(f"\nIngesting {len(game_ids):,} games with {max_processes} parallel processes...")
    
    # Setup pool-level throttling
    manager = multiprocessing.Manager()
    rate_limit_flag = manager.Value('b', False)
    rate_limit_flag.cooldown_time = COOLDOWN_PERIOD_SECONDS
    
    start_time = time.time()
    results = []
    
    try:
        with multiprocessing.Pool(max_processes) as pool:
            worker = partial(ingest_single_game, rate_limit_flag=rate_limit_flag)
            results = pool.map(worker, game_ids)
    except Exception as e:
        print(f"\n[FATAL ERROR] Parallel pool failed: {e}")
        traceback.print_exc()
        return {'successes': 0, 'failures': len(game_ids), 'results': results}
    
    end_time = time.time()
    
    successes = [r for r in results if r and r.get('success')]
    failures = [r for r in results if r and not r.get('success')]
    
    print("\n" + "=" * 80)
    print("INGESTION COMPLETE")
    print("=" * 80)
    print(f"Total time: {end_time - start_time:.2f} seconds")
    print(f"Games processed: {len(game_ids):,}")
    print(f"Successful: {len(successes):,}")
    print(f"Failed: {len(failures):,}")
    
    if failures:
        print(f"\n[FAILED GAMES] (showing first 10):")
        for fail in failures[:10]:
            print(f"  Game {fail['game_id']}: {fail.get('error', 'Unknown error')}")
        if len(failures) > 10:
            print(f"  ... and {len(failures) - 10} more")
    
    return {'successes': len(successes), 'failures': len(failures), 'results': results}


def main():
    """Main entry point with CLI arguments."""
    parser = argparse.ArgumentParser(description='Phase 1: Fast raw NHL data ingestion')
    parser.add_argument('start_date', nargs='?', default='2025-10-07',
                       help='Start date (YYYY-MM-DD)')
    parser.add_argument('end_date', nargs='?', default=None,
                       help='End date (YYYY-MM-DD), defaults to today')
    parser.add_argument('--max-processes', '-p', type=int, default=DEFAULT_MAX_PROCESSES,
                       help=f'Maximum parallel processes (default: {DEFAULT_MAX_PROCESSES})')
    parser.add_argument('--skip-check', action='store_true',
                       help='Skip checking for already-scraped games (scrape all)')
    
    args = parser.parse_args()
    
    if args.end_date is None:
        args.end_date = datetime.date.today().strftime('%Y-%m-%d')
    
    print("=" * 80)
    print(f"PHASE 1: RAW NHL DATA INGESTION")
    print("=" * 80)
    print(f"Date range: {args.start_date} to {args.end_date}")
    print(f"Max processes: {args.max_processes}")
    print()
    
    # Get games to scrape
    if args.skip_check:
        from pull_season_data import get_all_finished_games_from_db
        game_ids = get_all_finished_games_from_db(args.start_date, args.end_date)
        if not game_ids:
            game_ids = get_finished_game_ids_from_api(args.start_date, args.end_date)
    else:
        game_ids = get_unprocessed_games(args.start_date, args.end_date)
    
    if not game_ids:
        print("No games to scrape.")
        return
    
    # Ingest in parallel
    summary = ingest_games_parallel(game_ids, max_processes=args.max_processes)
    
    print(f"\n[OK] Ingestion complete. {summary['successes']:,} games saved to raw_nhl_data table.")


if __name__ == "__main__":
    main()

