#!/usr/bin/env python3
"""
populate_raw_shots.py
Convenience script to populate the raw_shots table with shot data.

Usage:
    python populate_raw_shots.py [date]
    
    date: Date to process (format: YYYY-MM-DD). Defaults to '2025-12-07' if not provided.
    
Examples:
    python populate_raw_shots.py                    # Process default date (2025-12-07)
    python populate_raw_shots.py 2025-12-07         # Process specific date
    python populate_raw_shots.py 2025-01-15         # Process different date
"""

import sys
import datetime
from data_acquisition import scrape_pbp_and_process

def main():
    """Main function to populate raw_shots table."""
    print("=" * 60)
    print("🏒 Raw Shots Table Population Script")
    print("=" * 60)
    print()
    
    # Get date from command line or use default
    if len(sys.argv) > 1:
        date_str = sys.argv[1]
        # Validate date format
        try:
            datetime.datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            print(f"❌ Error: Invalid date format '{date_str}'. Use YYYY-MM-DD format.")
            print("   Example: 2025-12-07")
            sys.exit(1)
    else:
        date_str = '2025-12-07'  # Default date
        print(f"ℹ️  No date specified. Using default: {date_str}")
        print("   (To specify a date, run: python populate_raw_shots.py YYYY-MM-DD)")
        print()
    
    print(f"📅 Processing games for date: {date_str}")
    print()
    
    # Process the games
    try:
        final_stats_df = scrape_pbp_and_process(date_str=date_str)
        
        if final_stats_df is not None and not final_stats_df.empty:
            print()
            print("=" * 60)
            print("✅ Population Complete!")
            print("=" * 60)
            print(f"📊 Summary:")
            print(f"   - Processed {len(final_stats_df)} player/game combinations")
            print(f"   - Date: {date_str}")
            print()
            print("💡 Next steps:")
            print("   - Run visualization scripts to see your shot data:")
            print("     * python shot_map_visualizer.py")
            print("     * python pass_shot_map.py")
            print("     * python zone_heatmap.py")
            print("     * python pass_impact_analyzer.py")
        else:
            print()
            print("=" * 60)
            print("⚠️  No data processed")
            print("=" * 60)
            print(f"   No finished games found for {date_str}")
            print("   Check that:")
            print("   1. The date has finished games")
            print("   2. The nhl_games table is populated (or API is accessible)")
            print("   3. The raw_shots table migration has been applied")
            
    except KeyboardInterrupt:
        print()
        print("⚠️  Process interrupted by user.")
        sys.exit(1)
    except Exception as e:
        print()
        print("=" * 60)
        print("❌ Error during processing")
        print("=" * 60)
        print(f"   {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

