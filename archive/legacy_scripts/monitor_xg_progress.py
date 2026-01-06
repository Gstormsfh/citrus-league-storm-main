#!/usr/bin/env python3
"""
monitor_xg_progress.py

Monitor the progress of xG processing in real-time.
Shows how many games have been processed and how many remain.
"""

import os
import time
from datetime import datetime
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] Missing Supabase credentials")
    exit(1)

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def get_processing_stats():
    """Get current processing statistics."""
    try:
        # Get all games up to Jan 3, 2026
        all_games = db.select(
            "raw_nhl_data",
            select="game_id,game_date,processed",
            filters=[("game_date", "lte", "2026-01-03")],
            limit=10000
        )
        
        if not all_games:
            return None
        
        total = len(all_games)
        processed = sum(1 for g in all_games if g.get("processed", False))
        unprocessed = total - processed
        
        # Get games with shots in raw_shots
        shots = db.select(
            "raw_shots",
            select="game_id",
            filters=[("game_id", "gte", 2025010100), ("game_id", "lt", 2026010100)],
            limit=10000
        )
        games_with_shots = len(set(s.get("game_id") for s in shots if s.get("game_id")))
        
        # Get recent processing activity (games processed in last hour)
        recent_games = [g for g in all_games if g.get("processed", False)]
        
        return {
            "total": total,
            "processed": processed,
            "unprocessed": unprocessed,
            "games_with_shots": games_with_shots,
            "pct_complete": (processed / total * 100) if total > 0 else 0,
            "recent_count": len(recent_games)
        }
    except Exception as e:
        print(f"[ERROR] {e}")
        return None

def main():
    """Monitor progress with periodic updates."""
    print("=" * 80)
    print("xG PROCESSING PROGRESS MONITOR")
    print("=" * 80)
    print()
    print("Press Ctrl+C to stop monitoring")
    print()
    
    last_processed = 0
    start_time = time.time()
    
    try:
        while True:
            stats = get_processing_stats()
            
            if stats is None:
                print("[ERROR] Could not get statistics")
                time.sleep(5)
                continue
            
            # Calculate rate
            elapsed = time.time() - start_time
            newly_processed = stats["processed"] - last_processed
            rate = newly_processed / elapsed if elapsed > 0 else 0
            
            # Clear screen (works on most terminals)
            print("\033[2J\033[H", end="")  # ANSI escape codes
            
            print("=" * 80)
            print("xG PROCESSING PROGRESS MONITOR")
            print(f"Last Update: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print("=" * 80)
            print()
            print(f"Total Games:        {stats['total']:,}")
            print(f"Processed:          {stats['processed']:,} ({stats['pct_complete']:.1f}%)")
            print(f"Unprocessed:        {stats['unprocessed']:,}")
            print(f"Games with Shots:   {stats['games_with_shots']:,}")
            print()
            
            if rate > 0:
                eta_seconds = stats['unprocessed'] / rate if rate > 0 else 0
                eta_minutes = eta_seconds / 60
                print(f"Processing Rate:    {rate:.2f} games/sec")
                if eta_minutes < 60:
                    print(f"Estimated Time:     {eta_minutes:.1f} minutes")
                else:
                    print(f"Estimated Time:     {eta_minutes/60:.1f} hours")
            else:
                print("Processing Rate:    Calculating...")
            
            print()
            print("=" * 80)
            print("(Refreshing every 5 seconds - Press Ctrl+C to stop)")
            
            last_processed = stats["processed"]
            start_time = time.time()
            time.sleep(5)
            
    except KeyboardInterrupt:
        print("\n\nMonitoring stopped.")
        print()
        # Final stats
        stats = get_processing_stats()
        if stats:
            print("=" * 80)
            print("FINAL STATUS")
            print("=" * 80)
            print(f"Processed:    {stats['processed']:,} / {stats['total']:,} ({stats['pct_complete']:.1f}%)")
            print(f"Remaining:    {stats['unprocessed']:,}")
            print("=" * 80)

if __name__ == "__main__":
    main()


