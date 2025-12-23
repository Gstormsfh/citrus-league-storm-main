#!/usr/bin/env python3
"""
reprocess_full_season.py
Reprocess the ENTIRE season to populate all new features (rebounds, shooting talent, created xG).
This will update existing records in the database with all new feature values.
"""

import sys
from datetime import datetime, timedelta
from data_acquisition import scrape_pbp_and_process
import time

def reprocess_full_season(start_date='2025-10-07', end_date=None, show_progress=True):
    """
    Reprocess entire season to populate all new features.
    
    Args:
        start_date: Season start date (YYYY-MM-DD)
        end_date: End date (default: today)
        show_progress: Show progress updates
    """
    if end_date is None:
        end_date = datetime.now().strftime('%Y-%m-%d')
    
    print("=" * 80)
    print("FULL SEASON REPROCESSING WITH ALL NEW FEATURES")
    print("=" * 80)
    print(f"Reprocessing from {start_date} to {end_date}")
    print("\nThis will update ALL shots with:")
    print("  ✅ Expected rebound probability")
    print("  ✅ Expected goals of expected rebounds")
    print("  ✅ Shooting talent adjusted xG")
    print("  ✅ Created expected goals")
    print("\nNote: Uses upsert, so existing records will be updated (not duplicated)")
    print()
    
    start = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')
    
    total_days = (end - start).days + 1
    current_date = start
    dates_processed = 0
    dates_with_games = 0
    dates_with_errors = 0
    
    print(f"Processing {total_days} days...")
    print("=" * 80)
    
    while current_date <= end:
        date_str = current_date.strftime('%Y-%m-%d')
        dates_processed += 1
        
        if show_progress and dates_processed % 10 == 0:
            progress = (dates_processed / total_days) * 100
            print(f"\n📊 Progress: {dates_processed}/{total_days} days ({progress:.1f}%)")
            print(f"   Dates with games: {dates_with_games}")
            print(f"   Dates with errors: {dates_with_errors}")
            print()
        
        try:
            result = scrape_pbp_and_process(date_str=date_str)
            if result is not None and not result.empty:
                dates_with_games += 1
                if show_progress:
                    print(f"✅ {date_str} - Processed successfully")
            else:
                if show_progress:
                    print(f"⚪ {date_str} - No games")
        except Exception as e:
            dates_with_errors += 1
            if show_progress:
                print(f"❌ {date_str} - Error: {str(e)[:50]}")
            # Continue processing other dates
            pass
        
        current_date += timedelta(days=1)
        
        # Small delay to avoid overwhelming API/database
        time.sleep(0.1)
    
    print("\n" + "=" * 80)
    print("✅ FULL SEASON REPROCESSING COMPLETE")
    print("=" * 80)
    print(f"\n📊 Summary:")
    print(f"   Total dates processed: {dates_processed}")
    print(f"   Dates with games: {dates_with_games}")
    print(f"   Dates with errors: {dates_with_errors}")
    print(f"\n💡 Next steps:")
    print(f"   1. Run: python test_full_season_with_all_features.py")
    print(f"   2. Run: python test_feature_impacts.py")
    print(f"   3. Compare results to see full impact of all features")

if __name__ == "__main__":
    start_date = '2025-10-07'  # Season start
    end_date = None  # Today
    
    if len(sys.argv) > 1:
        start_date = sys.argv[1]
    if len(sys.argv) > 2:
        end_date = sys.argv[2]
    
    print("🚀 Starting full season reprocessing...")
    print("   This may take a while - processing all dates from season start to today")
    print("   Press Ctrl+C to cancel if needed\n")
    
    try:
        reprocess_full_season(start_date=start_date, end_date=end_date)
    except KeyboardInterrupt:
        print("\n\n⚠️  Reprocessing interrupted by user")
        print("   Partial progress has been saved to database")
        print("   You can resume by running this script again")

