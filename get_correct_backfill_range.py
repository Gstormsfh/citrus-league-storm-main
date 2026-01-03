#!/usr/bin/env python3
"""
Get the correct date range for backfilling projections.
Uses ALL games with stats, not a limited sample.
"""

from dotenv import load_dotenv
import os
import sys
from datetime import date

from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def get_backfill_range(db: SupabaseRest, season: int):
    """
    Get the actual date range for games with stats.
    """
    print("\n" + "="*80)
    print("CORRECT BACKFILL RANGE")
    print("="*80 + "\n")
    
    # Get ALL games with stats (no limit)
    all_stats = []
    offset = 0
    limit = 1000
    while True:
        stats = db.select(
            "player_game_stats",
            select="game_id,game_date,season",
            filters=[("season", "eq", season)],
            limit=limit,
            offset=offset
        )
        if not stats or len(stats) == 0:
            break
        all_stats.extend(stats)
        if len(stats) < limit:
            break
        offset += limit
    
    if not all_stats:
        print("No games with stats found!")
        return
    
    # Get unique dates
    dates = sorted(set(s.get("game_date") for s in all_stats if s.get("game_date")))
    unique_game_ids = set(int(s.get("game_id", 0)) for s in all_stats if s.get("game_id"))
    
    print(f"Total games with stats: {len(unique_game_ids)}")
    print(f"Date range: {dates[0]} to {dates[-1]}")
    print(f"Unique dates: {len(dates)}")
    print()
    
    # Check which games already have projections
    all_projections = []
    offset = 0
    while True:
        projs = db.select(
            "player_projected_stats",
            select="game_id,projection_date",
            filters=[("season", "eq", season)],
            limit=limit,
            offset=offset
        )
        if not projs or len(projs) == 0:
            break
        all_projections.extend(projs)
        if len(projs) < limit:
            break
        offset += limit
    
    proj_game_ids = set(int(p.get("game_id", 0)) for p in all_projections if p.get("game_id"))
    missing = unique_game_ids - proj_game_ids
    
    print(f"Games with projections: {len(proj_game_ids)}")
    print(f"Games with stats but missing projections: {len(missing)}")
    print()
    
    if len(missing) == 0:
        print("[OK] All games with stats already have projections!")
        print(f"  You can run the audit on all {len(unique_game_ids)} games.")
    else:
        print(f"⚠️  Need to backfill {len(missing)} games")
        print(f"\nBackfill command:")
        print(f"  python backtest_vopa_model_fast.py {dates[0]} {dates[-1]} {season}")
    
    print("\n" + "="*80 + "\n")

if __name__ == "__main__":
    season = 2025
    if len(sys.argv) > 1:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    get_backfill_range(db, season)

