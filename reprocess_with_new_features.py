#!/usr/bin/env python3
"""
reprocess_with_new_features.py
Reprocess a sample of dates to populate new features (rebounds, shooting talent, created xG).
"""

import sys
from data_acquisition import scrape_pbp_and_process
from datetime import datetime, timedelta

def reprocess_date_range(start_date='2025-10-07', num_days=7):
    """
    Reprocess a date range to populate new features.
    
    Args:
        start_date: Starting date (YYYY-MM-DD)
        num_days: Number of days to process
    """
    print("=" * 80)
    print("REPROCESSING DATA WITH NEW FEATURES")
    print("=" * 80)
    print(f"Reprocessing {num_days} days starting from {start_date}")
    print("This will update existing records with new features:")
    print("  - Expected rebound probability")
    print("  - Expected goals of expected rebounds")
    print("  - Shooting talent adjusted xG")
    print("  - Created expected goals")
    print()
    
    start = datetime.strptime(start_date, '%Y-%m-%d')
    
    for i in range(num_days):
        current_date = start + timedelta(days=i)
        date_str = current_date.strftime('%Y-%m-%d')
        
        print(f"\n{'='*80}")
        print(f"Processing {date_str} ({i+1}/{num_days})")
        print(f"{'='*80}")
        
        try:
            result = scrape_pbp_and_process(date_str=date_str)
            if result is not None:
                print(f"✅ Successfully processed {date_str}")
            else:
                print(f"⚠️  No data for {date_str}")
        except Exception as e:
            print(f"❌ Error processing {date_str}: {e}")
            import traceback
            traceback.print_exc()
            continue
    
    print("\n" + "=" * 80)
    print("✅ REPROCESSING COMPLETE")
    print("=" * 80)
    print("\n💡 Run test_feature_impacts.py to see the impact of new features")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        start_date = sys.argv[1]
    else:
        start_date = '2025-10-07'
    
    if len(sys.argv) > 2:
        num_days = int(sys.argv[2])
    else:
        num_days = 7  # Process 1 week by default
    
    reprocess_date_range(start_date, num_days)

