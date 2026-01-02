#!/usr/bin/env python3
"""
POPULATE ALL PROJECTIONS - MASTER SCRIPT
=========================================
Ensures ALL fantasy weeks have projections populated.
Designed to be run daily to keep projections fresh and fluid.

This script:
1. Identifies all fantasy weeks from matchups table
2. Checks which dates are missing projections
3. Runs projections for ALL dates with games
4. Reports coverage status

Usage:
    python populate_all_projections.py [--force]

    --force: Recalculate ALL projections even if they exist (for updates)
"""
import subprocess
import sys
import os
from datetime import datetime, date, timedelta
from typing import Dict, List, Set, Tuple

# Set UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

SEASON = 2025
BATCH_SIZE = 1000


def get_db():
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def paginate_select(db, table, select, filters, max_records=50000):
    """Paginate through all records."""
    all_records = []
    offset = 0
    while len(all_records) < max_records:
        try:
            batch = db.select(table, select=select, filters=filters, limit=BATCH_SIZE, offset=offset)
            if not batch:
                break
            all_records.extend(batch)
            if len(batch) < BATCH_SIZE:
                break
            offset += BATCH_SIZE
        except Exception as e:
            print(f"  [WARN] Pagination error: {e}")
            break
    return all_records


def get_fantasy_weeks(db) -> List[Dict]:
    """Get all fantasy weeks from matchups table."""
    matchups = paginate_select(db, 'matchups', 
                               select='week_number,week_start_date,week_end_date',
                               filters=[])
    
    # Dedupe by week_number
    weeks = {}
    for m in matchups:
        wn = m.get('week_number')
        if wn and wn not in weeks:
            weeks[wn] = {
                'week_number': wn,
                'start_date': m.get('week_start_date'),
                'end_date': m.get('week_end_date')
            }
    
    return sorted(weeks.values(), key=lambda x: x['week_number'])


def get_dates_with_games(db, start_date: str, end_date: str) -> Set[str]:
    """Get all dates that have NHL games."""
    games = paginate_select(db, 'nhl_games',
                           select='game_date',
                           filters=[('season', 'eq', SEASON)])
    
    game_dates = set()
    for g in games:
        gd = g.get('game_date')
        if gd and start_date <= gd <= end_date:
            game_dates.add(gd)
    
    return game_dates


def get_dates_with_projections(db) -> Set[str]:
    """Get all dates that have projections."""
    projs = paginate_select(db, 'player_projected_stats',
                           select='projection_date',
                           filters=[])
    
    return set([p.get('projection_date') for p in projs if p.get('projection_date')])


def run_projection_for_date(date_str: str) -> bool:
    """Run projection for a single date."""
    try:
        result = subprocess.run(
            [sys.executable, "run_daily_projections.py", "--date", date_str, "--season", str(SEASON)],
            capture_output=True,
            text=True,
            timeout=180  # 3 minute timeout per day
        )
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"    [TIMEOUT] Projection for {date_str} timed out")
        return False
    except Exception as e:
        print(f"    [ERROR] {e}")
        return False


def main():
    force_update = "--force" in sys.argv
    
    print("=" * 70)
    print("POPULATE ALL PROJECTIONS - MASTER SCRIPT")
    print("=" * 70)
    print(f"Season: {SEASON}")
    print(f"Force Update: {force_update}")
    print(f"Started: {datetime.now().isoformat()}")
    print()
    
    db = get_db()
    
    # Step 1: Get all fantasy weeks
    print("[1/4] Fetching fantasy weeks...")
    weeks = get_fantasy_weeks(db)
    print(f"  Found {len(weeks)} fantasy weeks")
    
    if not weeks:
        print("  [ERROR] No fantasy weeks found!")
        return
    
    # Get date range
    all_start = min(w['start_date'] for w in weeks if w['start_date'])
    all_end = max(w['end_date'] for w in weeks if w['end_date'])
    print(f"  Date range: {all_start} to {all_end}")
    print()
    
    # Step 2: Get dates with games
    print("[2/4] Finding dates with games...")
    dates_with_games = get_dates_with_games(db, all_start, all_end)
    print(f"  Found {len(dates_with_games)} dates with games")
    print()
    
    # Step 3: Get dates with existing projections
    print("[3/4] Checking existing projections...")
    dates_with_projections = get_dates_with_projections(db)
    print(f"  Found {len(dates_with_projections)} dates with projections")
    print()
    
    # Step 4: Determine what needs to be run
    if force_update:
        # Run for ALL dates with games
        dates_to_process = sorted(dates_with_games)
        print(f"[4/4] FORCE MODE: Processing ALL {len(dates_to_process)} dates with games...")
    else:
        # Only run for dates missing projections
        dates_to_process = sorted(dates_with_games - dates_with_projections)
        print(f"[4/4] Processing {len(dates_to_process)} dates MISSING projections...")
    
    if not dates_to_process:
        print("  [OK] All dates already have projections!")
        print()
        print("=" * 70)
        print("ALL PROJECTIONS UP TO DATE")
        print("=" * 70)
        return
    
    print()
    print("-" * 70)
    
    # Process each date
    success_count = 0
    fail_count = 0
    
    for i, date_str in enumerate(dates_to_process):
        print(f"  [{i+1}/{len(dates_to_process)}] {date_str}...", end=" ", flush=True)
        
        if run_projection_for_date(date_str):
            print("[OK]")
            success_count += 1
        else:
            print("[FAILED]")
            fail_count += 1
    
    print("-" * 70)
    print()
    
    # Final verification
    print("FINAL VERIFICATION...")
    final_projections = get_dates_with_projections(db)
    final_missing = dates_with_games - final_projections
    
    # Filter to only dates up to today (future dates may not have games scheduled)
    today = date.today().isoformat()
    past_missing = [d for d in final_missing if d <= today]
    
    print(f"  Dates with games: {len(dates_with_games)}")
    print(f"  Dates with projections: {len(final_projections)}")
    print(f"  Past dates still missing: {len(past_missing)}")
    
    if past_missing:
        print(f"  [WARN] Missing dates: {sorted(past_missing)[:10]}...")
    
    print()
    print("=" * 70)
    print("PROJECTION POPULATION COMPLETE")
    print("=" * 70)
    print(f"Processed: {len(dates_to_process)}")
    print(f"Successful: {success_count}")
    print(f"Failed: {fail_count}")
    print(f"Coverage: {len(final_projections)}/{len(dates_with_games)} dates ({100*len(final_projections)/len(dates_with_games):.1f}%)")
    print(f"Finished: {datetime.now().isoformat()}")
    print("=" * 70)


if __name__ == "__main__":
    main()
