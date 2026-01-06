#!/usr/bin/env python3
"""
backfill_missing_games.py

Easy tool to backfill missing games without full season rescrape.
Provides functions to:
1. Find missing games by date range
2. Backfill games by date range
3. Backfill specific game IDs
4. Process backfilled games immediately
"""

import os
import sys
import datetime as dt
from typing import Dict, List, Optional
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def find_missing_games(start_date: str, end_date: str) -> List[Dict[str, any]]:
    """
    Find games that are in nhl_games but missing from raw_nhl_data.
    
    Args:
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
    
    Returns:
        List of dictionaries with game_id and game_date
    """
    print("=" * 80)
    print(f"Finding missing games from {start_date} to {end_date}")
    print("=" * 80)
    
    db = supabase_client()
    
    try:
        # Get all games from nhl_games in date range
        all_games = db.select(
            "nhl_games",
            select="game_id,game_date,status",
            filters=[
                ("game_date", "gte", start_date),
                ("game_date", "lte", end_date)
            ],
            limit=10000
        )
        
        if not all_games:
            print(f"No games found in nhl_games for date range {start_date} to {end_date}")
            return []
        
        all_game_ids = set([g.get("game_id") for g in all_games if g.get("game_id")])
        print(f"Found {len(all_game_ids)} total games in nhl_games")
        
        # Get games already in raw_nhl_data
        existing_games = db.select(
            "raw_nhl_data",
            select="game_id",
            filters=[
                ("game_date", "gte", start_date),
                ("game_date", "lte", end_date)
            ],
            limit=10000
        )
        
        existing_game_ids = set([g.get("game_id") for g in (existing_games or []) if g.get("game_id")])
        print(f"Found {len(existing_game_ids)} games already in raw_nhl_data")
        
        # Find missing games
        missing_game_ids = all_game_ids - existing_game_ids
        
        if not missing_game_ids:
            print("\n✓ No missing games found - all games are already in raw_nhl_data")
            return []
        
        # Get details for missing games
        missing_games = []
        for game in all_games:
            if game.get("game_id") in missing_game_ids:
                missing_games.append({
                    "game_id": game.get("game_id"),
                    "game_date": game.get("game_date"),
                    "status": game.get("status")
                })
        
        # Sort by date
        missing_games.sort(key=lambda x: x.get("game_date", ""))
        
        print(f"\nFound {len(missing_games)} missing games:")
        for game in missing_games[:10]:  # Show first 10
            print(f"  - Game {game['game_id']} ({game['game_date']}) - Status: {game.get('status', 'unknown')}")
        if len(missing_games) > 10:
            print(f"  ... and {len(missing_games) - 10} more")
        
        return missing_games
        
    except Exception as e:
        print(f"Error finding missing games: {e}")
        import traceback
        traceback.print_exc()
        return []


def backfill_games_by_date_range(start_date: str, end_date: str, process_immediately: bool = True) -> Dict[str, any]:
    """
    Backfill missing games by date range.
    Finds missing games, ingests them, and optionally processes them immediately.
    
    Args:
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
        process_immediately: If True, process games into raw_shots after ingestion
    
    Returns:
        Dictionary with backfill statistics
    """
    print("=" * 80)
    print(f"Backfilling missing games from {start_date} to {end_date}")
    print("=" * 80)
    
    # Find missing games
    missing_games = find_missing_games(start_date, end_date)
    
    if not missing_games:
        return {
            "ingested": 0,
            "processed": 0,
            "failed": 0,
            "game_ids": []
        }
    
    game_ids = [g["game_id"] for g in missing_games]
    
    # Ingest the games
    print(f"\nIngesting {len(game_ids)} missing games...")
    ingest_result = backfill_games_by_game_ids(game_ids, process_immediately=process_immediately)
    
    return ingest_result


def backfill_games_by_game_ids(game_ids: List[int], process_immediately: bool = True) -> Dict[str, any]:
    """
    Backfill specific game IDs.
    Ingests games and optionally processes them immediately.
    
    Args:
        game_ids: List of game IDs to backfill
        process_immediately: If True, process games into raw_shots after ingestion
    
    Returns:
        Dictionary with backfill statistics
    """
    print("=" * 80)
    print(f"Backfilling {len(game_ids)} game(s) by game ID")
    print("=" * 80)
    
    if not game_ids:
        print("No game IDs provided")
        return {
            "ingested": 0,
            "processed": 0,
            "failed": 0,
            "game_ids": []
        }
    
    # Import ingest function
    try:
        from ingest_raw_nhl import ingest_games_parallel
        
        print(f"\nIngesting {len(game_ids)} game(s)...")
        ingest_results = ingest_games_parallel(game_ids, max_processes=10)
        
        # Count successful ingestions
        ingested = sum(1 for r in ingest_results if r.get("success", False))
        failed = len(ingest_results) - ingested
        
        print(f"\nIngestion completed: {ingested} successful, {failed} failed")
        
        # Get successfully ingested game IDs
        ingested_game_ids = [r.get("game_id") for r in ingest_results if r.get("success", False)]
        
        processed_count = 0
        
        # Process games if requested
        if process_immediately and ingested_game_ids:
            print(f"\nProcessing {len(ingested_game_ids)} ingested game(s)...")
            try:
                from run_daily_pbp_processing import process_single_game, supabase_client
                
                db = supabase_client()
                
                for game_id in ingested_game_ids:
                    try:
                        # Get the raw JSON
                        game_data = db.select(
                            "raw_nhl_data",
                            select="raw_json",
                            filters=[("game_id", "eq", game_id)],
                            limit=1
                        )
                        
                        if game_data and len(game_data) > 0:
                            raw_json = game_data[0].get("raw_json")
                            if raw_json:
                                success = process_single_game(game_id, raw_json)
                                if success:
                                    processed_count += 1
                                    print(f"  ✓ Processed game {game_id}")
                                else:
                                    print(f"  ✗ Failed to process game {game_id}")
                            else:
                                print(f"  ✗ No raw_json found for game {game_id}")
                        else:
                            print(f"  ✗ Game {game_id} not found in raw_nhl_data")
                    except Exception as e:
                        print(f"  ✗ Error processing game {game_id}: {e}")
                
                print(f"\nProcessing completed: {processed_count} processed")
                
            except Exception as e:
                print(f"Error during processing: {e}")
                import traceback
                traceback.print_exc()
        
        # Update matchup scores if games were processed
        if processed_count > 0:
            print(f"\nTriggering matchup score updates...")
            try:
                from calculate_matchup_scores import update_active_matchup_scores
                
                db = supabase_client()
                update_result = update_active_matchup_scores(db, game_ids=ingested_game_ids)
                if update_result:
                    print(f"Matchup scores updated: {update_result.get('updated', 0)} matchups")
            except Exception as e:
                print(f"Warning: Could not update matchup scores: {e}")
        
        return {
            "ingested": ingested,
            "processed": processed_count,
            "failed": failed,
            "game_ids": ingested_game_ids
        }
        
    except ImportError as e:
        print(f"Error importing ingest function: {e}")
        import traceback
        traceback.print_exc()
        return {
            "ingested": 0,
            "processed": 0,
            "failed": len(game_ids),
            "game_ids": [],
            "error": str(e)
        }
    except Exception as e:
        print(f"Error backfilling games: {e}")
        import traceback
        traceback.print_exc()
        return {
            "ingested": 0,
            "processed": 0,
            "failed": len(game_ids),
            "game_ids": [],
            "error": str(e)
        }


def main():
    """Main entry point for command-line usage."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Backfill missing games without full rescrape")
    parser.add_argument("--start-date", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--game-ids", type=str, nargs="+", help="Specific game IDs to backfill")
    parser.add_argument("--find-only", action="store_true", help="Only find missing games, don't backfill")
    parser.add_argument("--no-process", action="store_true", help="Don't process games after ingestion")
    
    args = parser.parse_args()
    
    if args.game_ids:
        # Backfill specific game IDs
        game_ids = [int(gid) for gid in args.game_ids]
        result = backfill_games_by_game_ids(game_ids, process_immediately=not args.no_process)
        print("\n" + "=" * 80)
        print("BACKFILL SUMMARY")
        print("=" * 80)
        print(f"Ingested: {result.get('ingested', 0)}")
        print(f"Processed: {result.get('processed', 0)}")
        print(f"Failed: {result.get('failed', 0)}")
        return 0 if result.get('ingested', 0) > 0 else 1
    
    elif args.start_date and args.end_date:
        if args.find_only:
            # Just find missing games
            missing = find_missing_games(args.start_date, args.end_date)
            return 0 if not missing else 1
        else:
            # Backfill by date range
            result = backfill_games_by_date_range(
                args.start_date,
                args.end_date,
                process_immediately=not args.no_process
            )
            print("\n" + "=" * 80)
            print("BACKFILL SUMMARY")
            print("=" * 80)
            print(f"Ingested: {result.get('ingested', 0)}")
            print(f"Processed: {result.get('processed', 0)}")
            print(f"Failed: {result.get('failed', 0)}")
            return 0 if result.get('ingested', 0) > 0 else 1
    else:
        parser.print_help()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

