#!/usr/bin/env python3
"""
Check the ACTUAL number of games in the database.
No limits, no filters - just the raw count.
"""

from dotenv import load_dotenv
import os
import sys
from collections import defaultdict

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def check_actual_counts(db: SupabaseRest, season: int):
    """
    Get the ACTUAL counts from the database without limits.
    """
    print("\n" + "="*80)
    print("ACTUAL DATABASE COUNTS CHECK")
    print("="*80 + "\n")
    
    # 1. Check nhl_games table (the source of truth)
    print("1. Checking nhl_games table (source of truth)...")
    try:
        # Get all games for the season
        all_games = []
        offset = 0
        limit = 1000
        while True:
            games = db.select(
                "nhl_games",
                select="game_id,game_date,season",
                filters=[("season", "eq", season)],
                limit=limit,
                offset=offset
            )
            if not games or len(games) == 0:
                break
            all_games.extend(games)
            if len(games) < limit:
                break
            offset += limit
        
        print(f"   Total games in nhl_games: {len(all_games)}")
        if all_games:
            dates = sorted(set(g.get("game_date") for g in all_games if g.get("game_date")))
            print(f"   Date range: {dates[0]} to {dates[-1]}")
            print(f"   Unique dates: {len(dates)}")
    except Exception as e:
        print(f"   Error: {e}")
        all_games = []
    
    # 2. Check player_game_stats (what we're matching against)
    print("\n2. Checking player_game_stats table...")
    try:
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
        
        unique_game_ids = set(int(s.get("game_id", 0)) for s in all_stats if s.get("game_id"))
        print(f"   Total stat records: {len(all_stats)}")
        print(f"   Unique game IDs: {len(unique_game_ids)}")
        if all_stats:
            dates = sorted(set(s.get("game_date") for s in all_stats if s.get("game_date")))
            print(f"   Date range: {dates[0]} to {dates[-1]}")
            print(f"   Unique dates: {len(dates)}")
    except Exception as e:
        print(f"   Error: {e}")
        all_stats = []
        unique_game_ids = set()
    
    # 3. Check player_projected_stats (what we're projecting)
    print("\n3. Checking player_projected_stats table...")
    try:
        all_projections = []
        offset = 0
        limit = 1000
        while True:
            projs = db.select(
                "player_projected_stats",
                select="game_id,projection_date,season",
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
        
        unique_proj_game_ids = set(int(p.get("game_id", 0)) for p in all_projections if p.get("game_id"))
        print(f"   Total projections: {len(all_projections)}")
        print(f"   Unique game IDs: {len(unique_proj_game_ids)}")
        if all_projections:
            dates = sorted(set(p.get("projection_date") for p in all_projections if p.get("projection_date")))
            print(f"   Date range: {dates[0]} to {dates[-1]}")
            print(f"   Unique dates: {len(dates)}")
    except Exception as e:
        print(f"   Error: {e}")
        all_projections = []
        unique_proj_game_ids = set()
    
    # 4. Compare
    print("\n4. COMPARISON:")
    print("-" * 80)
    print(f"Games in nhl_games: {len(all_games)}")
    print(f"Games with stats: {len(unique_game_ids)}")
    print(f"Games with projections: {len(unique_proj_game_ids)}")
    
    if all_games:
        nhl_game_ids = set(int(g.get("game_id", 0)) for g in all_games if g.get("game_id"))
        missing_stats = nhl_game_ids - unique_game_ids
        missing_projections = unique_game_ids - unique_proj_game_ids
        
        print(f"\nGames in nhl_games but no stats: {len(missing_stats)}")
        if missing_stats and len(missing_stats) <= 20:
            print(f"   Sample: {sorted(list(missing_stats))[:10]}")
        
        print(f"\nGames with stats but no projections: {len(missing_projections)}")
        if missing_projections and len(missing_projections) <= 20:
            print(f"   Sample: {sorted(list(missing_projections))[:10]}")
        elif missing_projections:
            print(f"   First 10: {sorted(list(missing_projections))[:10]}")
    
    # 5. Date breakdown
    if all_games:
        print("\n5. GAMES BY MONTH:")
        print("-" * 80)
        games_by_month = defaultdict(int)
        for game in all_games:
            game_date = game.get("game_date")
            if game_date:
                month = game_date[:7]  # YYYY-MM
                games_by_month[month] += 1
        
        for month in sorted(games_by_month.keys()):
            print(f"   {month}: {games_by_month[month]} games")
    
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    if all_games:
        print(f"Total NHL games in database: {len(all_games)}")
        print(f"Games with actual stats: {len(unique_game_ids)}")
        print(f"Games needing projections: {len(missing_projections) if all_games else 0}")
        
        if len(missing_projections) > 0:
            print(f"\n⚠️  Need to backfill projections for {len(missing_projections)} games")
            if all_games:
                dates = sorted(set(g.get("game_date") for g in all_games if g.get("game_date")))
                print(f"   Date range to backfill: {dates[0]} to {dates[-1]}")
    print("="*80 + "\n")

if __name__ == "__main__":
    season = 2025
    if len(sys.argv) > 1:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    check_actual_counts(db, season)



