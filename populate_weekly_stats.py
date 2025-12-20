#!/usr/bin/env python3
"""
Populate player_weekly_stats table from player_game_stats.

This script:
1. Calculates all weeks for the current season (Monday-Sunday)
2. For each week, aggregates player_game_stats into player_weekly_stats
3. Can be run periodically to keep weekly stats up to date
"""

import os
import sys
from datetime import datetime, timedelta
from typing import List, Tuple
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix Windows console encoding for emoji characters
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Load environment variables
load_dotenv()

# Supabase connection
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    sys.exit(1)

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_first_week_start(draft_completion_date: datetime) -> datetime:
    """Get the Monday of the first week after draft completion."""
    # Test date: December 8, 2025 (Monday)
    test_date = datetime(2025, 12, 8, 0, 0, 0)
    today = datetime.now()
    
    # Make both datetimes timezone-naive for comparison
    if draft_completion_date.tzinfo is not None:
        draft_completion_date = draft_completion_date.replace(tzinfo=None)
    
    if today >= test_date:
        draft_date = draft_completion_date.replace(hour=0, minute=0, second=0, microsecond=0)
        if draft_date <= test_date:
            return test_date
    
    # Normal logic: calculate Monday after draft completion
    date = draft_completion_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_of_week = date.weekday()  # 0 = Monday, 6 = Sunday
    
    if day_of_week == 0:  # Monday
        days_to_add = 0
    elif day_of_week == 6:  # Sunday
        days_to_add = 1
    else:
        days_to_add = 7 - day_of_week
    
    date += timedelta(days=days_to_add)
    return date


def get_week_start_date(week_number: int, first_week_start: datetime) -> datetime:
    """Get the Monday date for a given week number (1-based)."""
    weeks_to_add = (week_number - 1) * 7
    return first_week_start + timedelta(days=weeks_to_add)


def get_week_end_date(week_start: datetime) -> datetime:
    """Get the Sunday date for a week (6 days after Monday)."""
    return week_start + timedelta(days=6)


def get_available_weeks(first_week_start: datetime) -> List[int]:
    """Get all available weeks from first week until end of regular season."""
    weeks = []
    
    first_week_year = first_week_start.year
    first_week_month = first_week_start.month
    
    # Regular season ends around April 15
    if first_week_month >= 10:  # October-December
        regular_season_end_year = first_week_year + 1
    else:
        regular_season_end_year = first_week_year
    
    regular_season_end = datetime(regular_season_end_year, 4, 15, 23, 59, 59)
    
    diff_time = regular_season_end - first_week_start
    diff_days = diff_time.days
    total_weeks = (diff_days // 7) + 1
    
    for i in range(1, max(1, total_weeks) + 1):
        weeks.append(i)
    
    return weeks


def populate_week_stats(week_number: int, week_start: datetime, week_end: datetime) -> int:
    """Populate weekly stats for a specific week using the database function."""
    try:
        result = db.rpc(
            'populate_player_weekly_stats',
            {
                'p_week_number': week_number,
                'p_week_start_date': week_start.strftime('%Y-%m-%d'),
                'p_week_end_date': week_end.strftime('%Y-%m-%d')
            }
        )
        
        # The function returns the number of rows affected (as a list with one element)
        if isinstance(result, list) and len(result) > 0:
            rows_affected = result[0] if isinstance(result[0], int) else 0
        elif isinstance(result, int):
            rows_affected = result
        else:
            rows_affected = 0
        return rows_affected
    except Exception as e:
        print(f"❌ Error populating week {week_number}: {e}")
        import traceback
        traceback.print_exc()
        return 0


def main():
    """Main function to populate all weekly stats."""
    print("📊 Starting weekly stats population...")
    
    # Get all leagues to determine week ranges
    try:
        leagues = db.select('leagues', select='id, draft_status, updated_at') or []
        
        if not leagues:
            print("⚠️  No leagues found. Exiting.")
            return
        
        print(f"✅ Found {len(leagues)} league(s)")
        
        # Find a league with completed draft, or use the first league's updated_at
        # (In production, you might want to handle multiple leagues differently)
        completed_league = None
        for league in leagues:
            if league.get('draft_status') == 'completed':
                completed_league = league
                break
        
        if not completed_league:
            completed_league = leagues[0]
            print(f"⚠️  No completed draft found. Using league {completed_league.get('id')} updated_at")
        
        updated_at = completed_league.get('updated_at')
        
        if not updated_at:
            print("⚠️  No updated_at found. Using default date: 2025-12-08")
            draft_date = datetime(2025, 12, 8)
        else:
            # Parse the timestamp (could be ISO format with or without timezone)
            if 'T' in updated_at:
                draft_date = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
            else:
                draft_date = datetime.fromisoformat(updated_at)
        
        first_week_start = get_first_week_start(draft_date)
        weeks = get_available_weeks(first_week_start)
        
        print(f"📅 First week starts: {first_week_start.strftime('%Y-%m-%d')}")
        print(f"📅 Total weeks to process: {len(weeks)}")
        
        total_rows = 0
        for week_num in weeks:
            week_start = get_week_start_date(week_num, first_week_start)
            week_end = get_week_end_date(week_start)
            
            print(f"  Processing week {week_num} ({week_start.strftime('%Y-%m-%d')} to {week_end.strftime('%Y-%m-%d')})...")
            rows = populate_week_stats(week_num, week_start, week_end)
            total_rows += rows
            print(f"    ✅ Populated {rows} player records")
        
        print(f"\n✅ Complete! Total records: {total_rows}")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
