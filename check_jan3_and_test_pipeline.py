#!/usr/bin/env python3
"""Check for January 3rd 2026 games and test the pipeline"""

import os
from datetime import date
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] Missing Supabase credentials in .env file")
    exit(1)

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("=" * 80)
print("CHECKING FOR JANUARY 3RD 2026 GAMES")
print("=" * 80)
print()

# Check for games on January 3rd, 2026
target_date = "2026-01-03"

# Check raw_nhl_data table
print(f"Checking raw_nhl_data table for games on {target_date}...")
try:
    games = db.select(
        "raw_nhl_data",
        select="game_id,game_date,processed",
        filters=[("game_date", "eq", target_date)],
        limit=100
    )
    
    if games:
        print(f"[OK] Found {len(games)} games on {target_date}")
        processed = sum(1 for g in games if g.get("processed", False))
        unprocessed = len(games) - processed
        print(f"  - Processed: {processed}")
        print(f"  - Unprocessed: {unprocessed}")
        print()
        print("Game IDs:")
        for game in games[:10]:  # Show first 10
            game_id = game.get("game_id")
            processed_status = "PROCESSED" if game.get("processed", False) else "UNPROCESSED"
            print(f"  - {game_id} ({processed_status})")
        if len(games) > 10:
            print(f"  ... and {len(games) - 10} more")
        
        # Get first unprocessed game for testing
        unprocessed_games = [g for g in games if not g.get("processed", False)]
        if unprocessed_games:
            test_game_id = unprocessed_games[0].get("game_id")
            print()
            print(f"[INFO] Test game ID for pipeline: {test_game_id}")
    else:
        print(f"[WARNING] No games found in raw_nhl_data for {target_date}")
        print()
        print("Checking nhl_games table...")
        nhl_games = db.select(
            "nhl_games",
            select="game_id,game_date,status",
            filters=[("game_date", "eq", target_date)],
            limit=100
        )
        if nhl_games:
            print(f"[INFO] Found {len(nhl_games)} games in nhl_games table for {target_date}")
            print("  These games need to be scraped into raw_nhl_data first.")
            print("  Run: python ingest_raw_nhl.py 2026-01-03 2026-01-03")
        else:
            print(f"[INFO] No games found in nhl_games table for {target_date}")
            print("  No games were played on this date, or games haven't been added to nhl_games yet.")
    
except Exception as e:
    print(f"[ERROR] Error checking games: {e}")
    import traceback
    traceback.print_exc()

print()
print("=" * 80)
print("CHECKING FOR ANY RECENT UNPROCESSED GAMES")
print("=" * 80)
print()

# Also check for any recent unprocessed games (for testing)
try:
    recent_unprocessed = db.select(
        "raw_nhl_data",
        select="game_id,game_date",
        filters=[("processed", "eq", False)],
        order="game_date.desc",
        limit=10
    )
    
    if recent_unprocessed:
        print(f"[OK] Found {len(recent_unprocessed)} unprocessed games (most recent first):")
        for game in recent_unprocessed:
            print(f"  - {game.get('game_id')} ({game.get('game_date')})")
        print()
        print(f"[INFO] You can test the pipeline with:")
        print(f"  python process_xg_stats.py --game-id {recent_unprocessed[0].get('game_id')}")
    else:
        print("[INFO] No unprocessed games found in raw_nhl_data")
        print("  All games have been processed, or no games exist in the table.")
        
except Exception as e:
    print(f"[ERROR] Error checking unprocessed games: {e}")

print()
print("=" * 80)


