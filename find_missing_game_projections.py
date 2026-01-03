#!/usr/bin/env python3
"""
Find which games have stats but no projections.
"""

from dotenv import load_dotenv
import os
import sys
from collections import defaultdict

from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def find_missing_projections(db: SupabaseRest, season: int):
    """
    Find games with stats but no projections.
    """
    print("\n" + "="*80)
    print("FINDING MISSING PROJECTIONS")
    print("="*80 + "\n")
    
    # Get ALL games with stats
    print("Getting all games with stats...")
    all_stats = []
    offset = 0
    limit = 1000
    while True:
        stats = db.select(
            "player_game_stats",
            select="game_id,game_date",
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
    
    games_with_stats = set(int(s.get("game_id", 0)) for s in all_stats if s.get("game_id"))
    print(f"Found {len(games_with_stats)} games with stats\n")
    
    # Get ALL games with projections
    print("Getting all games with projections...")
    all_projections = []
    offset = 0
    while True:
        projs = db.select(
            "player_projected_stats",
            select="game_id",
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
    
    games_with_projections = set(int(p.get("game_id", 0)) for p in all_projections if p.get("game_id"))
    print(f"Found {len(games_with_projections)} games with projections\n")
    
    # Find missing
    missing_games = games_with_stats - games_with_projections
    print(f"Games with stats but NO projections: {len(missing_games)}\n")
    
    if missing_games:
        # Get game dates for missing games
        print("Getting dates for missing games...")
        missing_game_ids = list(missing_games)[:100]  # Sample first 100
        games_info = db.select(
            "nhl_games",
            select="game_id,game_date",
            filters=[("game_id", "in", missing_game_ids), ("season", "eq", season)],
            limit=100
        )
        
        dates_by_game = {int(g.get("game_id", 0)): g.get("game_date") for g in games_info}
        
        print("Sample missing games (first 20):")
        print("-" * 80)
        for i, game_id in enumerate(sorted(list(missing_games))[:20], 1):
            game_date = dates_by_game.get(game_id, "Unknown")
            print(f"   {i}. Game {game_id} - Date: {game_date}")
        
        if len(missing_games) > 20:
            print(f"   ... and {len(missing_games) - 20} more games")
        print()
        
        # Date range analysis
        dates = sorted([dates_by_game.get(gid) for gid in missing_games if dates_by_game.get(gid)])
        if dates:
            print(f"Date range of missing games: {dates[0]} to {dates[-1]}")
            print()
            print("SOLUTION:")
            print(f"   Run backtest for date range: {dates[0]} to {dates[-1]}")
            print(f"   Command: python backtest_vopa_model_fast.py {dates[0]} {dates[-1]} {season}")
    else:
        print("✓ All games with stats have projections!")
    
    print("\n" + "="*80 + "\n")

if __name__ == "__main__":
    season = 2025
    if len(sys.argv) > 1:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    find_missing_projections(db, season)


