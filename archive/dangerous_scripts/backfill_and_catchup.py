#!/usr/bin/env python3
"""
Comprehensive backfill and catch-up script.
Processes all missing data to get fully up-to-speed before starting live service.

This script:
1. Checks for missing games in raw_nhl_data (needs scraping)
2. Processes unprocessed games from raw_nhl_data to raw_shots (PBP)
3. Updates live stats for recent games
4. Reports on what's missing
"""

import os
import sys
from datetime import datetime, date, timedelta
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = 2025

def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def check_missing_raw_nhl_data(db: SupabaseRest, start_date: date, end_date: date) -> dict:
    """Check which games need to be scraped into raw_nhl_data"""
    print("=" * 80)
    print("STEP 1: Checking for missing games in raw_nhl_data")
    print("=" * 80)
    
    try:
        # Get all games from nhl_games table in date range
        start_str = start_date.isoformat()
        end_str = end_date.isoformat()
        
        print(f"Checking date range: {start_str} to {end_str}")
        
        # Get all games from nhl_games
        all_games = db.select(
            "nhl_games",
            select="game_id",
            filters=[
                ("game_date", "gte", start_str),
                ("game_date", "lte", end_str)
            ],
            limit=10000
        )
        
        all_game_ids = set([g.get("game_id") for g in (all_games or []) if g.get("game_id")])
        print(f"Found {len(all_game_ids)} total games in nhl_games")
        
        # Get games already in raw_nhl_data
        existing_games = db.select(
            "raw_nhl_data",
            select="game_id",
            filters=[
                ("game_date", "gte", start_str),
                ("game_date", "lte", end_str)
            ],
            limit=10000
        )
        
        existing_game_ids = set([g.get("game_id") for g in (existing_games or []) if g.get("game_id")])
        print(f"Found {len(existing_game_ids)} games already in raw_nhl_data")
        
        missing_game_ids = list(all_game_ids - existing_game_ids)
        print(f"\nFound {len(missing_game_ids)} games that need to be scraped")
        
        if missing_game_ids:
            print(f"Sample game IDs: {missing_game_ids[:10]}")
            print(f"\nTo scrape these games, run:")
            print(f"  python ingest_raw_nhl.py {start_str} {end_str}")
        
        return {
            "missing_count": len(missing_game_ids),
            "game_ids": missing_game_ids
        }
    except Exception as e:
        print(f"Error checking missing games: {e}")
        import traceback
        traceback.print_exc()
        return {"missing_count": 0, "game_ids": []}


def check_unprocessed_pbp(db: SupabaseRest) -> dict:
    """Check which games need PBP processing (raw_nhl_data -> raw_shots)"""
    print("\n" + "=" * 80)
    print("STEP 2: Checking for unprocessed PBP games")
    print("=" * 80)
    
    try:
        # Count unprocessed games
        filters = [("processed", "eq", False)]
        unprocessed = db.select(
            "raw_nhl_data",
            select="game_id,game_date",
            filters=filters,
            limit=1000,
            order="game_date.desc"
        )
        
        count = len(unprocessed) if unprocessed else 0
        
        print(f"Found {count} unprocessed games in raw_nhl_data")
        
        if count > 0 and unprocessed:
            # Show date range
            dates = [g.get("game_date") for g in unprocessed if g.get("game_date")]
            if dates:
                print(f"Date range: {min(dates)} to {max(dates)}")
                print(f"Sample game IDs: {[g.get('game_id') for g in unprocessed[:10]]}")
            
            print(f"\nTo process these games, run:")
            print(f"  python run_daily_pbp_processing.py")
        
        return {
            "unprocessed_count": count,
            "games": unprocessed[:20] if unprocessed else []
        }
    except Exception as e:
        print(f"Error checking unprocessed PBP: {e}")
        import traceback
        traceback.print_exc()
        return {"unprocessed_count": 0, "games": []}


def check_recent_stats_updates(db: SupabaseRest, days_back: int = 7) -> dict:
    """Check recent games that might need stats updates"""
    print("\n" + "=" * 80)
    print("STEP 3: Checking recent stats updates")
    print("=" * 80)
    
    try:
        cutoff_date = (date.today() - timedelta(days=days_back)).isoformat()
        
        # Check recent games in raw_nhl_data
        recent_games = db.select(
            "raw_nhl_data",
            select="game_id,game_date",
            filters=[
                ("game_date", "gte", cutoff_date)
            ],
            limit=100,
            order="game_date.desc"
        )
        
        count = len(recent_games) if recent_games else 0
        print(f"Found {count} recent games (last {days_back} days)")
        
        if count > 0:
            print(f"\nTo update stats for recent games, run:")
            print(f"  python scrape_per_game_nhl_stats.py")
            print(f"  (or use --missing-goalies flag for goalie-only updates)")
        
        return {
            "recent_count": count,
            "games": recent_games[:10] if recent_games else []
        }
    except Exception as e:
        print(f"Error checking recent stats: {e}")
        import traceback
        traceback.print_exc()
        return {"recent_count": 0, "games": []}


def main():
    """Main backfill check"""
    print("=" * 80)
    print("BACKFILL & CATCH-UP DIAGNOSTIC")
    print("=" * 80)
    print(f"Date: {datetime.now()}")
    print()
    
    db = supabase_client()
    
    # Check season start (typically October)
    season_start = date(2025, 10, 7)  # Adjust if needed
    today = date.today()
    
    # Step 1: Check missing raw_nhl_data
    missing_raw = check_missing_raw_nhl_data(db, season_start, today)
    
    # Step 2: Check unprocessed PBP
    unprocessed_pbp = check_unprocessed_pbp(db)
    
    # Step 3: Check recent stats
    recent_stats = check_recent_stats_updates(db, days_back=7)
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY & RECOMMENDED ACTIONS")
    print("=" * 80)
    
    actions = []
    
    if missing_raw["missing_count"] > 0:
        actions.append(f"1. Scrape {missing_raw['missing_count']} missing games:")
        actions.append(f"   python ingest_raw_nhl.py {season_start.isoformat()} {today.isoformat()}")
    
    if unprocessed_pbp["unprocessed_count"] > 0:
        actions.append(f"2. Process {unprocessed_pbp['unprocessed_count']} unprocessed PBP games:")
        actions.append(f"   python run_daily_pbp_processing.py")
    
    if recent_stats["recent_count"] > 0:
        actions.append(f"3. Update stats for {recent_stats['recent_count']} recent games:")
        actions.append(f"   python scrape_per_game_nhl_stats.py")
    
    if not actions:
        print("OK All caught up! No missing data found.")
        print("\nYou can start the live service:")
        print("  python data_scraping_service.py")
    else:
        print("WARNING Found missing data. Run these commands in order:")
        for action in actions:
            print(f"   {action}")
        print("\nAfter completing these, start the live service:")
        print("  python data_scraping_service.py")
    
    print("=" * 80)


if __name__ == "__main__":
    main()

