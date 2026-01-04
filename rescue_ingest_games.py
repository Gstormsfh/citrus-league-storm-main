#!/usr/bin/env python3
"""
Rescue script to ingest games directly from database game IDs.
Bypasses the API lookup that's failing.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Import the ingestion function
from ingest_raw_nhl import ingest_games_parallel

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

def get_all_game_ids_from_db(start_date, end_date):
    """Get all game IDs from nhl_games table for date range."""
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Get all games in date range (no status filter)
    all_games = []
    offset = 0
    batch_size = 1000
    
    while True:
        games = db.select(
            'nhl_games',
            select='game_id',
            filters=[
                ('game_date', 'gte', start_date),
                ('game_date', 'lte', end_date)
            ],
            limit=batch_size,
            offset=offset
        )
        
        if not games:
            break
            
        all_games.extend([g['game_id'] for g in games if g.get('game_id')])
        
        if len(games) < batch_size:
            break
            
        offset += batch_size
    
    return all_games

def get_already_scraped_game_ids():
    """Get game IDs already in raw_nhl_data."""
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    already_scraped = set()
    offset = 0
    batch_size = 1000
    
    while True:
        games = db.select(
            'raw_nhl_data',
            select='game_id',
            limit=batch_size,
            offset=offset
        )
        
        if not games:
            break
            
        already_scraped.update([g['game_id'] for g in games if g.get('game_id')])
        
        if len(games) < batch_size:
            break
            
        offset += batch_size
    
    return already_scraped

def main():
    start_date = '2025-10-07'
    end_date = '2026-01-03'
    
    print("=" * 80)
    print("RESCUE INGESTION: Getting games from database")
    print("=" * 80)
    print(f"Date range: {start_date} to {end_date}")
    print()
    
    # Get all game IDs from database
    print("Fetching game IDs from nhl_games table...")
    all_game_ids = get_all_game_ids_from_db(start_date, end_date)
    print(f"Found {len(all_game_ids)} total games in date range")
    
    # Get already scraped games
    print("Checking which games are already scraped...")
    already_scraped = get_already_scraped_game_ids()
    print(f"Found {len(already_scraped)} games already in raw_nhl_data")
    
    # Find games that need scraping
    games_to_scrape = [gid for gid in all_game_ids if gid not in already_scraped]
    print(f"\nGames to scrape: {len(games_to_scrape)}")
    
    if not games_to_scrape:
        print("No games to scrape. All games already in raw_nhl_data.")
        return 0
    
    print(f"Sample game IDs: {games_to_scrape[:10]}")
    print()
    
    # Ingest games
    print("Starting ingestion...")
    summary = ingest_games_parallel(games_to_scrape, max_processes=10)
    
    print(f"\n[OK] Ingestion complete. {summary['successes']:,} games saved to raw_nhl_data table.")
    if summary['failures'] > 0:
        print(f"[WARNING] {summary['failures']:,} games failed to scrape.")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())

