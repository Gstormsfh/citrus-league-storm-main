#!/usr/bin/env python3
"""Backfill NHL stats for all games in the season"""
import os
import sys
from datetime import date, timedelta
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("BACKFILLING NHL STATS FOR ALL GAMES")
print("=" * 80)

# Get season start and end dates
season_start = date(2025, 10, 7)  # Approximate season start
season_end = date.today()

print(f"\nSeason range: {season_start} to {season_end}")
print("\nRunning scrape_per_game_nhl_stats.py for entire season...")
print("This will process all games and populate nhl_ppp, nhl_shp, etc.")
print("\n" + "=" * 80)

# Import and run the scraper
from scrape_per_game_nhl_stats import main as scrape_main

# Override sys.argv to pass date range
original_argv = sys.argv[:]
sys.argv = [sys.argv[0], season_start.isoformat(), season_end.isoformat()]

try:
    result = scrape_main()
    print("\n" + "=" * 80)
    if result == 0:
        print("✅ Backfill completed successfully!")
        print("\nNext step: Rebuild player_season_stats to aggregate the new data:")
        print("  python build_player_season_stats.py")
    else:
        print("⚠️  Backfill completed with errors. Check output above.")
    print("=" * 80)
finally:
    sys.argv = original_argv

