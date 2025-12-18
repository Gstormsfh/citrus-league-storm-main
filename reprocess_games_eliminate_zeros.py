#!/usr/bin/env python3
"""
reprocess_games_eliminate_zeros.py
Reprocess recent games with updated code to eliminate zeros.
"""

import sys
from datetime import datetime, timedelta
from data_acquisition import scrape_pbp_and_process

def reprocess_recent_games(days_back=7, max_games=20):
    """
    Reprocess recent games to get actual feature values (no zeros).
    
    Args:
        days_back: Number of days to look back
        max_games: Maximum number of games to process
    """
    print("=" * 80)
    print("REPROCESSING GAMES TO ELIMINATE ZEROS")
    print("=" * 80)
    print(f"\nWill process games from last {days_back} days")
    print(f"Maximum games: {max_games}")
    print("\nThis will:")
    print("  ✅ Calculate actual time_since_last_event (not zeros)")
    print("  ✅ Calculate actual distance_from_last_event (not zeros)")
    print("  ✅ Calculate actual speed_from_last_event (not zeros)")
    print("  ✅ Detect actual is_power_play (not all zeros)")
    print("  ✅ Detect actual is_empty_net (not all zeros)")
    print()
    
    # Get dates to process
    today = datetime.now()
    dates_to_process = []
    games_processed = 0
    
    for i in range(days_back):
        date = today - timedelta(days=i)
        date_str = date.strftime('%Y-%m-%d')
        dates_to_process.append(date_str)
    
    print(f"📅 Processing {len(dates_to_process)} dates...")
    print()
    
    for date_str in dates_to_process:
        if games_processed >= max_games:
            print(f"\n✅ Reached maximum games ({max_games})")
            break
        
        print(f"📅 Processing {date_str}...")
        try:
            result = scrape_pbp_and_process(date_str=date_str)
            if result is not None and not result.empty:
                games_processed += len(result)
                print(f"   ✅ Processed {len(result)} player/game records")
        except Exception as e:
            print(f"   ⚠️  Error: {e}")
            continue
    
    print("\n" + "=" * 80)
    print("REPROCESSING COMPLETE")
    print("=" * 80)
    print(f"✅ Processed {games_processed} player/game records")
    print("\n💡 Next steps:")
    print("   1. Pull fresh data: python pull_season_data.py")
    print("   2. Retrain model: python retrain_xg_with_moneypuck.py")
    print("   3. Test performance: python test_moneypuck_model.py")

if __name__ == "__main__":
    days_back = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    max_games = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    
    reprocess_recent_games(days_back=days_back, max_games=max_games)

