#!/usr/bin/env python3
"""
check_data_freshness.py

Verifies data freshness across all data pipeline tables.
Checks for gaps or stale data that might indicate scraping issues.

Usage:
    python scripts/check_data_freshness.py
"""

import os
import sys
import datetime as dt
from typing import Dict, List

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def check_raw_nhl_data(db: SupabaseRest, days_back: int = 7) -> Dict[str, any]:
    """Check raw_nhl_data table for recent games."""
    try:
        cutoff = dt.date.today() - dt.timedelta(days=days_back)
        
        recent_games = db.select(
            "raw_nhl_data",
            select="game_id,game_date,scraped_at,processed",
            filters=[
                ("game_date", "gte", cutoff.isoformat())
            ],
            limit=1000,
            order="game_date.desc"
        )
        
        if not recent_games:
            return {
                "status": "warning",
                "message": f"No games found in last {days_back} days",
                "count": 0
            }
        
        processed_count = sum(1 for g in recent_games if g.get("processed", False))
        unprocessed_count = len(recent_games) - processed_count
        
        return {
            "status": "healthy" if unprocessed_count < len(recent_games) * 0.1 else "warning",
            "message": f"Found {len(recent_games)} games in last {days_back} days",
            "count": len(recent_games),
            "processed": processed_count,
            "unprocessed": unprocessed_count,
            "processed_pct": (processed_count / len(recent_games) * 100) if recent_games else 0
        }
    except Exception as e:
        return {
            "status": "critical",
            "message": f"Error checking raw_nhl_data: {e}",
            "error": str(e)
        }


def check_raw_shots(db: SupabaseRest, days_back: int = 7) -> Dict[str, any]:
    """Check raw_shots table for recent shots."""
    try:
        # Get games from last N days
        cutoff = dt.date.today() - dt.timedelta(days=days_back)
        
        # First get game_ids from raw_nhl_data
        games = db.select(
            "raw_nhl_data",
            select="game_id",
            filters=[
                ("game_date", "gte", cutoff.isoformat())
            ],
            limit=100
        )
        
        if not games:
            return {
                "status": "warning",
                "message": f"No games found to check shots for",
                "count": 0
            }
        
        game_ids = [g.get("game_id") for g in games if g.get("game_id")]
        
        # Check shots for these games (sample first 10 games)
        sample_game_ids = game_ids[:10]
        total_shots = 0
        
        for game_id in sample_game_ids:
            shots = db.select(
                "raw_shots",
                select="id",
                filters=[("game_id", "eq", game_id)],
                limit=1
            )
            if shots:
                total_shots += 1
        
        coverage_pct = (total_shots / len(sample_game_ids) * 100) if sample_game_ids else 0
        
        return {
            "status": "healthy" if coverage_pct > 50 else "warning",
            "message": f"Shot coverage: {coverage_pct:.1f}% of recent games have shots",
            "count": total_shots,
            "games_checked": len(sample_game_ids),
            "coverage_pct": coverage_pct
        }
    except Exception as e:
        return {
            "status": "critical",
            "message": f"Error checking raw_shots: {e}",
            "error": str(e)
        }


def check_player_game_stats(db: SupabaseRest, days_back: int = 7) -> Dict[str, any]:
    """Check player_game_stats table for recent updates."""
    try:
        cutoff = dt.date.today() - dt.timedelta(days=days_back)
        
        recent_stats = db.select(
            "player_game_stats",
            select="game_id,game_date,updated_at",
            filters=[
                ("game_date", "gte", cutoff.isoformat())
            ],
            limit=1000,
            order="game_date.desc"
        )
        
        if not recent_stats:
            return {
                "status": "warning",
                "message": f"No player stats found in last {days_back} days",
                "count": 0
            }
        
        # Check for games with NHL stats
        games_with_nhl_stats = set()
        for stat in recent_stats:
            # Check if any nhl_* column would be non-zero (we'll just count records)
            games_with_nhl_stats.add(stat.get("game_id"))
        
        return {
            "status": "healthy",
            "message": f"Found {len(recent_stats)} player stat records for {len(games_with_nhl_stats)} games",
            "count": len(recent_stats),
            "unique_games": len(games_with_nhl_stats)
        }
    except Exception as e:
        return {
            "status": "critical",
            "message": f"Error checking player_game_stats: {e}",
            "error": str(e)
        }


def main() -> int:
    """Main data freshness check function."""
    print("=" * 80)
    print("Data Freshness Check")
    print("=" * 80)
    print()
    
    db = supabase_client()
    
    # Check raw_nhl_data
    print("1. Checking raw_nhl_data table...")
    raw_status = check_raw_nhl_data(db, days_back=7)
    print(f"   Status: {raw_status['status'].upper()}")
    print(f"   {raw_status['message']}")
    if 'processed' in raw_status:
        print(f"   Processed: {raw_status['processed']}/{raw_status['count']} ({raw_status['processed_pct']:.1f}%)")
    print()
    
    # Check raw_shots
    print("2. Checking raw_shots table...")
    shots_status = check_raw_shots(db, days_back=7)
    print(f"   Status: {shots_status['status'].upper()}")
    print(f"   {shots_status['message']}")
    if 'games_checked' in shots_status:
        print(f"   Games with shots: {shots_status['count']}/{shots_status['games_checked']}")
    print()
    
    # Check player_game_stats
    print("3. Checking player_game_stats table...")
    stats_status = check_player_game_stats(db, days_back=7)
    print(f"   Status: {stats_status['status'].upper()}")
    print(f"   {stats_status['message']}")
    if 'unique_games' in stats_status:
        print(f"   Unique games: {stats_status['unique_games']}")
    print()
    
    # Overall status
    all_statuses = [raw_status['status'], shots_status['status'], stats_status['status']]
    
    if 'critical' in all_statuses:
        overall = "CRITICAL"
    elif 'warning' in all_statuses:
        overall = "WARNING"
    else:
        overall = "HEALTHY"
    
    print("=" * 80)
    print(f"Overall Status: {overall}")
    print("=" * 80)
    
    return 0 if overall == "HEALTHY" else 1


if __name__ == "__main__":
    raise SystemExit(main())

