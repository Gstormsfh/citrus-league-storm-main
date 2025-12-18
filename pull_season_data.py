#!/usr/bin/env python3
"""
pull_season_data.py
Pull all 2025 season shot data using our data acquisition pipeline.
Saves to CSV for comparison with MoneyPuck data.
"""

import sys
import datetime
import pandas as pd
from data_acquisition import scrape_pbp_and_process, supabase
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

def pull_season_data(start_date='2025-10-07', end_date=None, days_per_batch=7, cleanup_first=False):
    """
    Pull all season data by processing games in date batches.
    
    Args:
        start_date: Season start date
        end_date: Season end date (default: today)
        days_per_batch: Number of days to process per batch (to show progress)
    """
    if end_date is None:
        end_date = datetime.date.today().strftime('%Y-%m-%d')
    
    print("=" * 80)
    print("PULLING 2025 SEASON DATA")
    print("=" * 80)
    print(f"Date range: {start_date} to {end_date}")
    print(f"Processing in batches of {days_per_batch} days")
    print()
    
    # Cleanup old data if requested
    if cleanup_first:
        print("[CLEANUP] Cleaning up old data from raw_shots table...")
        cleanup_raw_shots_table(confirm=True)
        print()
    
    # Process by date (scrape_pbp_and_process handles individual dates)
    start = datetime.datetime.strptime(start_date, '%Y-%m-%d').date()
    end = datetime.datetime.strptime(end_date, '%Y-%m-%d').date()
    
    current_date = start
    total_dates = (end - start).days + 1
    dates_processed = 0
    
    print("Processing games by date...")
    print("(This will save all shots to raw_shots table)")
    print()
    
    while current_date <= end:
        date_str = current_date.strftime('%Y-%m-%d')
        dates_processed += 1
        
        print(f"[{dates_processed}/{total_dates}] Processing {date_str}...")
        
        try:
            final_stats_df = scrape_pbp_and_process(date_str=date_str)
            # Note: scrape_pbp_and_process saves to raw_shots table automatically
        except Exception as e:
            print(f"  [WARNING]  Error processing {date_str}: {e}")
            import traceback
            traceback.print_exc()
        
        current_date += datetime.timedelta(days=1)
        
        # Delay between dates to avoid overwhelming API
        import time
        time.sleep(1.0)  # Increased to 1 second to reduce rate limiting
    
    print("\n" + "=" * 80)
    print("All dates processed. Fetching from raw_shots table...")
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
            
            # Save to CSV
            output_file = 'data/our_shots_2025.csv'
            df_shots.to_csv(output_file, index=False)
            print(f"\n[OK] Saved {len(df_shots)} shots to {output_file}")
            
            # Print summary
            print("\n" + "=" * 80)
            print("SUMMARY")
            print("=" * 80)
            print(f"Total shots: {len(df_shots):,}")
            print(f"Unique games: {df_shots['game_id'].nunique()}")
            print(f"Unique players: {df_shots['player_id'].nunique()}")
            print(f"xG statistics:")
            print(f"  Mean: {df_shots['xg_value'].mean():.4f}")
            print(f"  Median: {df_shots['xg_value'].median():.4f}")
            print(f"  Max: {df_shots['xg_value'].max():.4f}")
            print(f"  Min: {df_shots['xg_value'].min():.4f}")
            print(f"\nShots with xG > 0.3: {(df_shots['xg_value'] > 0.3).sum():,}")
            print(f"Shots with xG > 0.2: {(df_shots['xg_value'] > 0.2).sum():,}")
            
            return df_shots
        else:
            print("[WARNING]  No shots found in raw_shots table")
            return None
            
    except Exception as e:
        print(f"Error fetching shots: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    # 2025-26 season started October 7, 2025
    start_date = '2025-10-07'
    end_date = datetime.date.today().strftime('%Y-%m-%d')
    cleanup_first = True  # Clean up old data before processing
    
    if len(sys.argv) > 1:
        start_date = sys.argv[1]
    if len(sys.argv) > 2:
        end_date = sys.argv[2]
    if len(sys.argv) > 3:
        cleanup_first = sys.argv[3].lower() in ('true', '1', 'yes', 'y')
    
    pull_season_data(start_date=start_date, end_date=end_date, cleanup_first=cleanup_first)

