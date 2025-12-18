#!/usr/bin/env python3
"""
test_with_fresh_data.py
Process a sample of recent games with the new code, then retrain and test.
"""

import pandas as pd
import sys
from datetime import datetime, timedelta

def find_recent_games():
    """Find recent games to process."""
    print("=" * 80)
    print("FINDING RECENT GAMES TO PROCESS")
    print("=" * 80)
    
    try:
        df = pd.read_csv('data/nhl-schedule-2025.csv')
        df['date'] = pd.to_datetime(df['date'])
        
        # Find games from last 14 days
        cutoff = datetime.now() - timedelta(days=14)
        recent = df[df['date'] >= cutoff].copy()
        
        if len(recent) == 0:
            print("⚠️  No recent games found. Checking all games...")
            recent = df.copy()
        
        # Group by date
        dates = recent.groupby('date')['gameId'].count().sort_index(ascending=False)
        
        print(f"\n📅 Found {len(recent)} games in last 14 days")
        print(f"📅 Available dates (most recent first):")
        for date, count in dates.head(10).items():
            print(f"   {date.strftime('%Y-%m-%d')}: {count} games")
        
        # Get most recent date with games
        if len(dates) > 0:
            most_recent_date = dates.index[0]
            games_on_date = recent[recent['date'] == most_recent_date]
            print(f"\n✅ Recommended: Process {most_recent_date.strftime('%Y-%m-%d')} ({len(games_on_date)} games)")
            return most_recent_date.strftime('%Y-%m-%d'), len(games_on_date)
        else:
            print("\n⚠️  No games found")
            return None, 0
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return None, 0

def main():
    """Main function."""
    print("=" * 80)
    print("TESTING WITH FRESH DATA")
    print("=" * 80)
    print("\nThis script will:")
    print("  1. Find recent games to process")
    print("  2. Process them with the new MoneyPuck-aligned code")
    print("  3. Extract the fresh data")
    print("  4. Retrain the model")
    print("  5. Test and compare results")
    print()
    
    # Find recent games
    date_str, game_count = find_recent_games()
    
    if date_str is None:
        print("\n❌ No games found to process")
        return
    
    print("\n" + "=" * 80)
    print("PROCESSING GAMES")
    print("=" * 80)
    print(f"\n📅 Processing date: {date_str}")
    print(f"🎮 Games to process: {game_count}")
    print("\n💡 Run this command to process:")
    print(f"   python data_acquisition.py {date_str}")
    print("\n💡 Then run this to retrain:")
    print("   python retrain_xg_with_moneypuck.py")
    print("\n💡 Then run this to test:")
    print("   python test_moneypuck_model.py")
    
    # Ask if user wants to proceed
    print("\n" + "=" * 80)
    response = input("Would you like to process games now? (y/n): ").strip().lower()
    
    if response == 'y':
        print(f"\n🚀 Processing games for {date_str}...")
        import subprocess
        result = subprocess.run([sys.executable, 'data_acquisition.py', date_str], 
                              capture_output=True, text=True)
        print(result.stdout)
        if result.stderr:
            print("Errors:", result.stderr)
        
        if result.returncode == 0:
            print("\n✅ Processing complete!")
            print("\n📊 Next steps:")
            print("   1. Run: python retrain_xg_with_moneypuck.py")
            print("   2. Run: python test_moneypuck_model.py")
        else:
            print("\n⚠️  Processing had errors. Check output above.")
    else:
        print("\n⏭️  Skipping processing. Run the commands manually when ready.")

if __name__ == "__main__":
    main()

