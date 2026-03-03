#!/usr/bin/env python3
"""
fix_stuck_pbp_games.py

Emergency script to mark stuck games as processed, stopping the infinite loop.
Run this ONCE to fix the current stuck state, then restart the service.
"""

import os
from dotenv import load_dotenv
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def fix_stuck_games():
    """Mark the stuck games as processed to stop the infinite loop."""
    
    # These are the game IDs that were stuck in the infinite loop
    stuck_game_ids = [
        2025020896, 2025020894, 2025020895, 2025020893,
        2025020897, 2025020901, 2025020902, 2025020899,
        2025020898, 2025020900
    ]
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    print("=" * 60)
    print("FIXING STUCK GAMES - Marking as processed")
    print("=" * 60)
    
    fixed_count = 0
    
    for game_id in stuck_game_ids:
        try:
            # Check current state
            result = db.select(
                "raw_nhl_data",
                select="game_id,processed,game_date",
                filters=[("game_id", "eq", game_id)],
                limit=1
            )
            
            if result and len(result) > 0:
                game = result[0]
                processed = game.get("processed", False)
                game_date = game.get("game_date", "unknown")
                
                if not processed:
                    # Mark as processed
                    db.update(
                        "raw_nhl_data",
                        {"processed": True},
                        filters=[("game_id", "eq", game_id)]
                    )
                    print(f"[FIXED] Game {game_id} ({game_date}) - marked as processed")
                    fixed_count += 1
                else:
                    print(f"[SKIP] Game {game_id} ({game_date}) - Already processed")
            else:
                print(f"[NOT FOUND] Game {game_id} - Not in database")
                
        except Exception as e:
            print(f"[ERROR] Game {game_id} - {e}")
    
    print("=" * 60)
    print(f"FIXED {fixed_count} games")
    print("=" * 60)
    print()
    print("Next steps:")
    print("1. Stop the current run_daily_pbp_processing.py process (Ctrl+C)")
    print("2. The fixed script will now work correctly")
    print("3. Restart data_scraping_service.py or run_daily_pbp_processing.py")
    
    return fixed_count


if __name__ == "__main__":
    fix_stuck_games()
