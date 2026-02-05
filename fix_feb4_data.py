"""
Fix script to repopulate February 4th, 2026 data
Runs the data pipeline for a specific date
"""
import os
import sys
from datetime import datetime, date

print("=" * 80)
print("FIX: Re-scraping and processing data for February 4th, 2026")
print("=" * 80)
print()

# Step 1: Scrape player game stats for Feb 4th
print("STEP 1: Scraping player game stats from NHL API...")
print("Command: python fetch_nhl_stats_from_landing_fast.py --date 2026-02-04")
print()

# Step 2: Populate fantasy daily rosters
print("STEP 2: Populating fantasy daily rosters...")
print("SQL: Call RPC to populate daily rosters for 2026-02-04")
print()

# Step 3: Recalculate matchup scores
print("STEP 3: Recalculating matchup scores...")
print("SQL: Call update_all_matchup_scores()")
print()

print("=" * 80)
print("MANUAL STEPS REQUIRED:")
print("=" * 80)
print()
print("1. Run the scraper for Feb 4th:")
print("   python fetch_nhl_stats_from_landing_fast.py --date 2026-02-04")
print()
print("2. In Supabase SQL Editor, run:")
print("""
   -- Populate daily rosters for Feb 4th
   SELECT populate_fantasy_daily_rosters('2026-02-04'::date);
   
   -- Recalculate all matchup scores
   SELECT update_all_matchup_scores();
   
   -- Verify the fix
   SELECT COUNT(*) as player_stats FROM player_game_stats WHERE game_date = '2026-02-04';
   SELECT COUNT(*) as daily_rosters FROM fantasy_daily_rosters WHERE game_date = '2026-02-04';
""")
print()
print("3. Check the Matchup tab - Feb 4th should now show points")
print()
