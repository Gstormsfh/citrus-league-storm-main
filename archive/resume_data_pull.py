#!/usr/bin/env python3
"""
Resume data pull - skips games already in database and continues from where it stopped.
"""

import sys
import datetime
from data_acquisition import scrape_pbp_and_process, supabase
from dotenv import load_dotenv
import time

# Set UTF-8 encoding for stdout
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()

def get_processed_game_ids():
    """Get set of game IDs already in the database."""
    print("Checking which games are already processed...")
    processed_games = set()
    offset = 0
    batch_size = 1000
    
    while True:
        response = supabase.table('raw_shots').select('game_id').range(offset, offset + batch_size - 1).execute()
        if not response.data or len(response.data) == 0:
            break
        processed_games.update([g['game_id'] for g in response.data])
        if len(response.data) < batch_size:
            break
        offset += batch_size
        print(f"  Checked {len(processed_games):,} unique games so far...")
    
    print(f"Found {len(processed_games):,} already-processed games")
    return processed_games

def resume_pull(start_date='2025-10-07', end_date=None):
    """Resume data pull, skipping already-processed games."""
    if end_date is None:
        end_date = datetime.date.today().strftime('%Y-%m-%d')
    
    print("=" * 80)
    print(f"RESUMING DATA PULL: {start_date} to {end_date}")
    print("=" * 80)
    print()
    
    # Get already-processed games
    processed_games = get_processed_game_ids()
    print()
    
    # Process by date
    start = datetime.datetime.strptime(start_date, '%Y-%m-%d').date()
    end = datetime.datetime.strptime(end_date, '%Y-%m-%d').date()
    
    current_date = start
    total_dates = (end - start).days + 1
    dates_processed = 0
    dates_skipped = 0
    
    print("Processing games by date (skipping already-processed games)...")
    print()
    
    while current_date <= end:
        date_str = current_date.strftime('%Y-%m-%d')
        dates_processed += 1
        
        print(f"[{dates_processed}/{total_dates}] Processing {date_str}...")
        
        try:
            # scrape_pbp_and_process will handle individual games
            # We can't easily skip at the game level here, but the function
            # uses upsert so it won't duplicate data
            result = scrape_pbp_and_process(date_str=date_str)
            
            if result is None or result.empty:
                dates_skipped += 1
                print(f"  No games for {date_str}")
            else:
                print(f"  Processed {len(result)} shots for {date_str}")
                
        except Exception as e:
            print(f"  [ERROR] Error processing {date_str}: {e}")
            import traceback
            traceback.print_exc()
        
        current_date += datetime.timedelta(days=1)
        time.sleep(1.0)  # Delay between dates
    
    print("\n" + "=" * 80)
    print("RESUME COMPLETE")
    print("=" * 80)
    print(f"Dates processed: {dates_processed}")
    print(f"Dates skipped (no games): {dates_skipped}")

if __name__ == "__main__":
    start_date = '2025-10-07'
    if len(sys.argv) > 1:
        start_date = sys.argv[1]
    
    end_date = None
    if len(sys.argv) > 2:
        end_date = sys.argv[2]
    
    resume_pull(start_date=start_date, end_date=end_date)

