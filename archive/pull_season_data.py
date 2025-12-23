#!/usr/bin/env python3
"""
pull_season_data.py
Pull all 2025 season shot data using the optimized two-phase data pipeline.

Phase 1: Fast parallel scraping of raw JSON from NHL API (ingest_raw_nhl.py)
Phase 2: Process raw JSON and calculate xG/xA stats (process_xg_stats.py)

Saves to CSV for comparison with MoneyPuck data.
"""

import sys
import datetime
import pandas as pd
import argparse
from data_acquisition import supabase
from dotenv import load_dotenv
import os

# Set UTF-8 encoding for stdout to handle Unicode characters on Windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        # Python < 3.7 doesn't have reconfigure, try setting environment variable
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()

def get_all_finished_games_from_db(start_date='2025-10-07', end_date=None):
    """
    Get all finished games from nhl_games table for date range.
    Falls back to API if database doesn't have finished games.
    
    Args:
        start_date: Season start date (default: Oct 7, 2025 for 2025-26 season)
        end_date: Season end date (default: today)
    
    Returns:
        List of game IDs
    """
    if end_date is None:
        end_date = datetime.date.today().strftime('%Y-%m-%d')
    
    # Try database first
    try:
        response = supabase.table('nhl_games').select('game_id').gte('game_date', start_date).lte('game_date', end_date).in_('status', ['final', 'FINAL', 'OFF', 'F']).execute()
        
        if response.data and len(response.data) > 0:
            game_ids = [game['game_id'] for game in response.data]
            print(f"Found {len(game_ids)} finished games in database from {start_date} to {end_date}")
            return game_ids
    except Exception as e:
        print(f"Could not query nhl_games table: {e}")
    
    # Fallback: Fetch from API for each date in range
    print(f"No finished games found in database. Fetching from NHL API for date range {start_date} to {end_date}...")
    from data_acquisition import get_finished_game_ids
    import time
    
    start = datetime.datetime.strptime(start_date, '%Y-%m-%d').date()
    end = datetime.datetime.strptime(end_date, '%Y-%m-%d').date()
    
    all_game_ids = []
    current_date = start
    
    while current_date <= end:
        date_str = current_date.strftime('%Y-%m-%d')
        game_ids = get_finished_game_ids(date_str)
        all_game_ids.extend(game_ids)
        current_date += datetime.timedelta(days=1)
        time.sleep(0.5)  # Small delay to avoid rate limiting
    
    if all_game_ids:
        print(f"Found {len(all_game_ids)} finished games from API")
        return all_game_ids
    
    return []

def cleanup_raw_shots_table(confirm=True):
    """
    Delete all records from raw_shots table.
    
    Args:
        confirm: If True, will check count before deleting and show confirmation
    
    Returns:
        Number of records deleted
    """
    try:
        # Check if table exists and get count
        if confirm:
            try:
                response = supabase.table('raw_shots').select('id', count='exact').execute()
                count = response.count if hasattr(response, 'count') else len(response.data) if response.data else 0
                print(f"  Found {count:,} existing records in raw_shots table")
            except Exception as e:
                print(f"  [WARNING]  Could not check table count: {e}")
                count = 0
        
        # Delete all records
        print("  [DELETE] Deleting all records from raw_shots table...")
        # Supabase doesn't have a direct delete all, so we need to delete in batches
        # First, get all IDs using pagination
        try:
            all_ids = []
            offset = 0
            batch_size = 1000
            
            # Fetch all IDs with pagination
            while True:
                response = supabase.table('raw_shots').select('id').range(offset, offset + batch_size - 1).execute()
                if not response.data or len(response.data) == 0:
                    break
                all_ids.extend([record['id'] for record in response.data])
                if len(response.data) < batch_size:
                    break  # Last batch
                offset += batch_size
                print(f"    Fetched {len(all_ids):,} IDs so far...")
            
            if len(all_ids) > 0:
                # Delete in batches of 1000
                deleted = 0
                delete_batch_size = 1000
                for i in range(0, len(all_ids), delete_batch_size):
                    batch_ids = all_ids[i:i + delete_batch_size]
                    supabase.table('raw_shots').delete().in_('id', batch_ids).execute()
                    deleted += len(batch_ids)
                    print(f"    Deleted {deleted:,}/{len(all_ids):,} records...")
                print(f"  [OK] Deleted {deleted:,} records from raw_shots table")
                return deleted
            else:
                print("  [OK] No records to delete")
                return 0
        except Exception as e:
            # If batch delete fails, try truncate via SQL (if we have access)
            print(f"  [WARNING]  Batch delete failed: {e}")
            print("  Attempting alternative cleanup method...")
            # For now, just return 0 - user can manually clean if needed
            return 0
            
    except Exception as e:
        print(f"  [ERROR] Error cleaning up raw_shots table: {e}")
        import traceback
        traceback.print_exc()
        return 0

def pull_season_data(start_date='2025-10-07', end_date=None, cleanup_first=False, 
                     max_processes=10, batch_size=10, skip_ingestion=False, skip_processing=False):
    """
    Pull all season data using the optimized two-phase pipeline.
    
    Phase 1: Fast parallel scraping of raw JSON from NHL API
    Phase 2: Process raw JSON and calculate xG/xA stats
    
    Args:
        start_date: Season start date
        end_date: Season end date (default: today)
        cleanup_first: If True, clean up old data from raw_shots table
        max_processes: Number of parallel processes for Phase 1 (default: 10)
        batch_size: Number of games to process per batch in Phase 2 (default: 10)
        skip_ingestion: If True, skip Phase 1 (assume raw data already exists)
        skip_processing: If True, skip Phase 2 (only scrape, don't process)
    """
    if end_date is None:
        end_date = datetime.date.today().strftime('%Y-%m-%d')
    
    print("=" * 80)
    print("🚀 OPTIMIZED TWO-PHASE SEASON DATA PULL")
    print("=" * 80)
    print(f"Date range: {start_date} to {end_date}")
    print(f"Phase 1 (Ingestion): {max_processes} parallel processes")
    print(f"Phase 2 (Processing): {batch_size} games per batch")
    print()
    
    # Cleanup old data if requested
    if cleanup_first:
        print("[CLEANUP] Cleaning up old data from raw_shots table...")
        cleanup_raw_shots_table(confirm=True)
        print()
    
    # ===== PHASE 1: RAW DATA INGESTION =====
    if not skip_ingestion:
        print("=" * 80)
        print("PHASE 1: RAW DATA INGESTION")
        print("=" * 80)
        print("Scraping raw JSON from NHL API and saving to raw_nhl_data table...")
        print()
        
        try:
            # Import Phase 1 functions
            from ingest_raw_nhl import get_unprocessed_games, ingest_games_parallel
            
            # Get games to scrape
            game_ids = get_unprocessed_games(start_date, end_date)
            
            if not game_ids:
                print("No new games to scrape (all games already in raw_nhl_data table)")
            else:
                # Ingest in parallel
                ingest_summary = ingest_games_parallel(game_ids, max_processes=max_processes)
                print(f"\n[OK] Phase 1 complete: {ingest_summary['successes']:,} games saved to raw_nhl_data")
                
                if ingest_summary['failures'] > 0:
                    print(f"[WARNING] {ingest_summary['failures']:,} games failed to scrape")
        except ImportError as e:
            print(f"[ERROR] Could not import Phase 1 functions: {e}")
            print("Make sure ingest_raw_nhl.py is available")
            return None
        except Exception as e:
            print(f"[ERROR] Phase 1 failed: {e}")
            import traceback
            traceback.print_exc()
            return None
    else:
        print("[SKIP] Phase 1 skipped (assuming raw data already exists)")
    
    print()
    
    # ===== PHASE 2: DATA PROCESSING =====
    if not skip_processing:
        print("=" * 80)
        print("PHASE 2: DATA PROCESSING")
        print("=" * 80)
        print("Processing raw JSON, calculating xG/xA, and saving to raw_shots table...")
        print()
        
        try:
            # Import Phase 2 functions
            from process_xg_stats import process_games_batch
            
            # Process all unprocessed games
            process_summary = process_games_batch(batch_size=batch_size)
            print(f"\n[OK] Phase 2 complete: {process_summary['processed']:,} games processed")
            
            if process_summary['failed'] > 0:
                print(f"[WARNING] {process_summary['failed']:,} games failed to process")
        except ImportError as e:
            print(f"[ERROR] Could not import Phase 2 functions: {e}")
            print("Make sure process_xg_stats.py is available")
            return None
        except Exception as e:
            print(f"[ERROR] Phase 2 failed: {e}")
            import traceback
            traceback.print_exc()
            return None
    else:
        print("[SKIP] Phase 2 skipped (only scraping, not processing)")
    
    print()
    print("=" * 80)
    print("Fetching processed shots from raw_shots table...")
    print("=" * 80)
    
    # Fetch all shots from raw_shots table with pagination
    try:
        print("\nFetching all shots from raw_shots table...")
        print("(Using pagination to fetch all records, not just the first 1000)")
        
        all_shots = []
        offset = 0
        batch_size = 1000
        
        while True:
            response = supabase.table('raw_shots').select('*').gte('created_at', f'{start_date}T00:00:00').range(offset, offset + batch_size - 1).execute()
            
            if not response.data or len(response.data) == 0:
                break
            
            all_shots.extend(response.data)
            
            if len(response.data) < batch_size:
                break  # Last batch - we've fetched all records
            
            offset += batch_size
            print(f"  Fetched {len(all_shots):,} records so far...")
        
        if all_shots:
            df_shots = pd.DataFrame(all_shots)
            print(f"[OK] Fetched {len(df_shots):,} shot records (all records)")
            
            # Ensure data directory exists
            os.makedirs('data', exist_ok=True)
            
            # Save to CSV
            output_file = 'data/our_shots_2025.csv'
            df_shots.to_csv(output_file, index=False)
            print(f"\n[OK] Saved {len(df_shots):,} shots to {output_file}")
            
            # Print summary
            print("\n" + "=" * 80)
            print("SUMMARY")
            print("=" * 80)
            print(f"Total shots: {len(df_shots):,}")
            print(f"Unique games: {df_shots['game_id'].nunique()}")
            
            # Handle player_id column (might be missing or named differently)
            if 'player_id' in df_shots.columns:
                print(f"Unique players: {df_shots['player_id'].nunique()}")
            
            # Handle xG column name variations (xg_value, xG_Value, etc.)
            xg_column = None
            for col in ['xG_Value', 'xg_value', 'xG_value', 'xg_Value']:
                if col in df_shots.columns:
                    xg_column = col
                    break
            
            if xg_column:
                xg_data = pd.to_numeric(df_shots[xg_column], errors='coerce')
                print(f"xG statistics (column: {xg_column}):")
                print(f"  Mean: {xg_data.mean():.4f}")
                print(f"  Median: {xg_data.median():.4f}")
                print(f"  Max: {xg_data.max():.4f}")
                print(f"  Min: {xg_data.min():.4f}")
                print(f"\nShots with xG > 0.3: {(xg_data > 0.3).sum():,}")
                print(f"Shots with xG > 0.2: {(xg_data > 0.2).sum():,}")
            else:
                print("[WARNING] No xG column found in data")
            
            return df_shots
        else:
            if skip_processing:
                print("[INFO] No shots found in raw_shots table (Phase 2 was skipped)")
                print("[INFO] Run Phase 2 processing to generate shots: python process_xg_stats.py")
            else:
                print("[WARNING] No shots found in raw_shots table")
            return None
            
    except Exception as e:
        print(f"Error fetching shots: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Pull season data using optimized two-phase pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full pipeline (default: scrape + process)
  python pull_season_data.py
  
  # Specific date range
  python pull_season_data.py 2025-10-07 2025-12-16
  
  # Only scrape, don't process
  python pull_season_data.py --skip-processing
  
  # Only process existing scraped data
  python pull_season_data.py --skip-ingestion
  
  # Custom parallelism
  python pull_season_data.py --max-processes 12 --batch-size 20
        """
    )
    
    parser.add_argument('start_date', nargs='?', default='2025-10-07',
                       help='Start date (YYYY-MM-DD), default: 2025-10-07')
    parser.add_argument('end_date', nargs='?', default=None,
                       help='End date (YYYY-MM-DD), default: today')
    parser.add_argument('--cleanup-first', action='store_true', default=False,
                       help='Clean up old data from raw_shots table before processing')
    parser.add_argument('--max-processes', '-p', type=int, default=10,
                       help='Number of parallel processes for Phase 1 (default: 10)')
    parser.add_argument('--batch-size', '-b', type=int, default=10,
                       help='Number of games per batch for Phase 2 (default: 10)')
    parser.add_argument('--skip-ingestion', action='store_true',
                       help='Skip Phase 1 (assume raw data already exists)')
    parser.add_argument('--skip-processing', action='store_true',
                       help='Skip Phase 2 (only scrape, don\'t process)')
    
    args = parser.parse_args()
    
    if args.end_date is None:
        args.end_date = datetime.date.today().strftime('%Y-%m-%d')
    
    pull_season_data(
        start_date=args.start_date,
        end_date=args.end_date,
        cleanup_first=args.cleanup_first,
        max_processes=args.max_processes,
        batch_size=args.batch_size,
        skip_ingestion=args.skip_ingestion,
        skip_processing=args.skip_processing
    )

