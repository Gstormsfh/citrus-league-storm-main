#!/usr/bin/env python3
"""
test_sample_reprocessing.py

Test re-processing on a small sample of dates to verify fixes work.
"""

import sys
from datetime import datetime, timedelta
from data_acquisition import scrape_pbp_and_process

def test_sample_dates():
    """Test processing on 2-3 recent dates."""
    print("=" * 80)
    print("PHASE 2: TEST SAMPLE RE-PROCESSING")
    print("=" * 80)
    
    # Get last 3 days with games
    test_dates = []
    for i in range(1, 8):  # Check last 7 days
        date = (datetime.today() - timedelta(days=i)).strftime('%Y-%m-%d')
        test_dates.append(date)
    
    print(f"\n📅 Testing on dates: {', '.join(test_dates[:3])}")
    print("\nProcessing sample dates to verify fixes work...")
    print("This will test:")
    print("  - speed_from_last_event calculation")
    print("  - time_since_powerplay_started tracking")
    print("  - is_power_play detection")
    print("  - is_empty_net detection")
    
    results = []
    for date in test_dates[:3]:  # Test first 3 dates
        print(f"\n{'='*80}")
        print(f"Processing date: {date}")
        print('='*80)
        try:
            result = scrape_pbp_and_process(date_str=date)
            if result is not None:
                results.append((date, True))
                print(f"✅ Successfully processed {date}")
            else:
                results.append((date, False))
                print(f"⚠️  No data for {date}")
        except Exception as e:
            results.append((date, False))
            print(f"❌ Error processing {date}: {e}")
    
    print("\n" + "=" * 80)
    print("SAMPLE TEST RESULTS")
    print("=" * 80)
    for date, success in results:
        status = "✅" if success else "❌"
        print(f"{status} {date}: {'Success' if success else 'Failed/No data'}")
    
    if any(success for _, success in results):
        print("\n✅ Sample processing complete!")
        print("Next: Verify the new data has proper feature values")
        print("Run: python verify_fixes.py")
    else:
        print("\n⚠️  No data processed. Try different dates or check API access.")

if __name__ == "__main__":
    test_sample_dates()

