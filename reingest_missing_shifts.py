#!/usr/bin/env python3
"""
reingest_missing_shifts.py

Rescue & Repair Script: Find games in raw_nhl_data that are missing shifts
and force re-ingestion to bridge the gap in the pipeline.

This script identifies the "gap" - games that the Extractor is currently rejecting
because they have 0 shifts, and fetches those shifts from the NHL API.
"""

import os
import sys
import time
from typing import List, Set
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Import functions from ingest_shiftcharts.py
from ingest_shiftcharts import (
    supabase_client,
    fetch_shiftcharts,
    upsert_shifts,
    mmss_to_seconds,
    _now_iso,
)

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


def get_games_without_shifts(db: SupabaseRest, season: int = 2025) -> List[int]:
    """
    Find games in raw_nhl_data that don't have shifts in player_shifts_official.
    This identifies the "gap" that needs to be filled.
    """
    print("=" * 80)
    print("RESCUE: Finding games missing shifts")
    print("=" * 80)
    print()
    
    game_id_min = int(f"{season}000000")
    game_id_max = int(f"{season + 1}000000")
    
    # Get all games from raw_nhl_data
    print("1. Fetching all games from raw_nhl_data...")
    all_games = []
    offset = 0
    while True:
        page = db.select(
            "raw_nhl_data",
            select="game_id",
            filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
            limit=1000,
            offset=offset,
        )
        if not page:
            break
        all_games.extend([g.get("game_id") for g in page if g.get("game_id")])
        if len(page) < 1000:
            break
        offset += 1000
        if offset % 5000 == 0:
            print(f"   ... fetched {len(all_games)} games so far...")
    
    print(f"   Found {len(all_games)} total games")
    
    # Get games that have shifts
    print("\n2. Fetching games with shifts from player_shifts_official...")
    games_with_shifts = set()
    offset = 0
    while True:
        page = db.select(
            "player_shifts_official",
            select="game_id",
            filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
            limit=1000,
            offset=offset,
        )
        if not page:
            break
        games_with_shifts.update(g.get("game_id") for g in page if g.get("game_id"))
        if len(page) < 1000:
            break
        offset += 1000
        if offset % 10000 == 0:
            print(f"   ... found {len(games_with_shifts)} games with shifts so far...")
    
    print(f"   Found {len(games_with_shifts)} games with shifts")
    
    # Find the gap
    all_games_set = set(all_games)
    games_without_shifts = sorted(list(all_games_set - games_with_shifts))
    
    print(f"\n3. GAP IDENTIFIED: {len(games_without_shifts)} games missing shifts")
    print("=" * 80)
    print()
    
    return games_without_shifts


def rescue_game_shifts(db: SupabaseRest, game_id: int) -> tuple[bool, int, str]:
    """
    Rescue a single game by fetching and storing its shifts.
    
    Returns: (success, shift_count, error_message)
    """
    try:
        # Fetch shifts from NHL API
        rows = fetch_shiftcharts(game_id)
        
        # Process shifts (only typeCode == 517)
        shift_rows = []
        for r in rows:
            if int(r.get("typeCode") or 0) != 517:
                continue
            
            shift_id = int(r["id"])
            start_s = mmss_to_seconds(r.get("startTime"))
            end_s = mmss_to_seconds(r.get("endTime"))
            dur_s = mmss_to_seconds(r.get("duration")) if r.get("duration") else None

            shift_rows.append({
                "shift_id": shift_id,
                "game_id": int(r.get("gameId")),
                "player_id": int(r.get("playerId")),
                "team_id": int(r.get("teamId")),
                "team_abbrev": r.get("teamAbbrev"),
                "period": int(r.get("period")),
                "shift_number": int(r.get("shiftNumber") or 0),
                "start_time": r.get("startTime"),
                "end_time": r.get("endTime"),
                "duration": r.get("duration"),
                "shift_start_time_seconds": int(start_s),
                "shift_end_time_seconds": int(end_s),
                "duration_seconds": int(dur_s) if dur_s is not None else None,
                "updated_at": _now_iso(),
            })
        
        if shift_rows:
            # Store shifts
            upsert_shifts(db, shift_rows)
            return (True, len(shift_rows), "")
        else:
            return (False, 0, "No shifts found in API (game may not have shifts available)")
            
    except Exception as e:
        return (False, 0, str(e))


def main() -> int:
    print("=" * 80)
    print("RESCUE & REPAIR: Re-Ingest Missing Shifts")
    print("=" * 80)
    print()
    print("This script finds games missing shifts and fetches them from the NHL API.")
    print("This bridges the gap so the Extractor can process all games.")
    print()
    
    db = supabase_client()
    
    # Find games missing shifts
    games_without_shifts = get_games_without_shifts(db, season=2025)
    
    if not games_without_shifts:
        print("[SUCCESS] All games have shifts! No rescue needed.")
        return 0
    
    print(f"Found {len(games_without_shifts)} games that need shifts")
    print(f"Sample game IDs: {games_without_shifts[:10]}")
    print()
    print("Starting rescue operation...")
    print("=" * 80)
    print()
    
    success_count = 0
    no_data_count = 0
    error_count = 0
    
    # Process each game
    for idx, game_id in enumerate(games_without_shifts, 1):
        print(f"[{idx}/{len(games_without_shifts)}] Rescuing game {game_id}...", end=" ", flush=True)
        
        success, shift_count, error = rescue_game_shifts(db, game_id)
        
        if success:
            success_count += 1
            print(f"SUCCESS - {shift_count} shifts saved")
        elif "No shifts found" in error:
            no_data_count += 1
            print(f"NO DATA - {error}")
        else:
            error_count += 1
            print(f"ERROR - {error}")
        
        # Progress update every 25 games
        if idx % 25 == 0:
            print()
            print(f"Progress: {idx}/{len(games_without_shifts)} | Success: {success_count} | No data: {no_data_count} | Errors: {error_count}")
            print()
        
        # Rate limiting
        time.sleep(0.2)
    
    # Final summary
    print()
    print("=" * 80)
    print("RESCUE OPERATION COMPLETE")
    print("=" * 80)
    print(f"Total games processed: {len(games_without_shifts)}")
    print(f"Successfully rescued: {success_count}")
    print(f"No data available: {no_data_count}")
    print(f"Errors: {error_count}")
    print()
    
    if success_count > 0:
        print(f"[SUCCESS] {success_count} games now have shifts and can be processed by the Extractor!")
    
    if no_data_count > 0:
        print(f"[WARNING] {no_data_count} games don't have shifts available in the NHL API.")
        print("          These may be invalid game IDs or games that were cancelled/postponed.")
    
    if error_count > 0:
        print(f"[ERROR] {error_count} games had errors during rescue.")
        print("        Check the logs above for details.")
    
    print()
    print("Next step: Run the Extractor to process all games with shifts:")
    print("  python extractor_job.py")
    print("=" * 80)
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())





