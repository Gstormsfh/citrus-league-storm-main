#!/usr/bin/env python3
"""
run_complete_pipeline.py

MASTER PIPELINE ORCHESTRATOR - The ONE script to rule them all.

This script runs the complete data pipeline for both silos:

SILO 1: PBP Data (Internal - for projections, GSAx, analytics)
  - Ingest raw NHL data
  - Extract PBP events to player_game_stats
  - Compute shift data for TOI
  - Compute plus/minus

SILO 2: NHL Official Stats (Public - for matchups, fantasy scoring)
  - Scrape NHL boxscore stats (official source of truth)
  - Creates goalie records, updates all nhl_* columns

SHARED:
  - Build season stats aggregations
  - Verify data quality

Usage:
  python run_complete_pipeline.py                    # Run full pipeline
  python run_complete_pipeline.py --silo1-only      # PBP pipeline only
  python run_complete_pipeline.py --silo2-only      # Official stats only
  python run_complete_pipeline.py --week 2025-12-16 2025-12-22  # Specific date range
"""

import os
import sys
import time
import argparse
import datetime as dt
from datetime import date, timedelta
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def get_current_week_dates():
    """Get Monday-Sunday of current week."""
    today = date.today()
    days_since_monday = today.weekday()
    week_start = today - timedelta(days=days_since_monday)
    week_end = week_start + timedelta(days=6)
    return week_start, week_end


def run_silo1_pbp_pipeline(db: SupabaseRest, season: int) -> dict:
    """
    SILO 1: PBP Data Pipeline (Internal)
    
    Extracts play-by-play data for advanced analytics and projections.
    This data is NOT shown to users directly.
    """
    print()
    print("=" * 60)
    print("SILO 1: PBP DATA PIPELINE (Internal Analytics)")
    print("=" * 60)
    
    results = {
        "shifts_computed": 0,
        "games_extracted": 0,
        "plus_minus_players": 0,
        "errors": []
    }
    
    # Step 1.1: Ensure shifts exist for unextracted games
    print("\n[SILO1] Step 1: Ensuring shifts exist for unextracted games...")
    try:
        from ensure_shifts_for_all_games import get_games_without_shifts, compute_shifts_for_game
        
        games_without = get_games_without_shifts(db, season)
        if games_without:
            limit = min(50, len(games_without))  # Limit per run
            print(f"  Computing shifts for {limit}/{len(games_without)} games...")
            for idx, game_id in enumerate(games_without[:limit], 1):
                success, _, _ = compute_shifts_for_game(db, game_id)
                if success:
                    results["shifts_computed"] += 1
                if idx % 10 == 0:
                    print(f"    Progress: {idx}/{limit}")
                time.sleep(0.3)
            print(f"  [OK] Computed {results['shifts_computed']} shifts")
        else:
            print("  [OK] All games have shifts")
    except Exception as e:
        results["errors"].append(f"Shifts: {e}")
        print(f"  [WARN] Shift computation failed: {e}")
    
    # Step 1.2: Extract PBP events
    print("\n[SILO1] Step 2: Extracting PBP events to player_game_stats...")
    try:
        from extractor_job import (
            _get_unextracted_games, _aggregate_player_stats_from_pbp,
            _upsert_player_game_stats, _is_final_game_state,
            _mark_extracted_if_final, _safe_int
        )
        
        games = _get_unextracted_games(db, 25)  # Process up to 25 per run
        if games:
            print(f"  Processing {len(games)} unextracted games...")
            for game in games:
                game_id = _safe_int(game.get("game_id"), 0)
                if not game_id:
                    continue
                
                pbp = game.get("raw_json") or {}
                state = pbp.get("gameState")
                
                rows_map = _aggregate_player_stats_from_pbp(pbp, season)
                rows = list(rows_map.values())
                
                if rows:
                    _upsert_player_game_stats(db, rows, game_id)
                    results["games_extracted"] += 1
                    
                    if _is_final_game_state(state):
                        _mark_extracted_if_final(db, game_id)
            
            print(f"  [OK] Extracted {results['games_extracted']}/{len(games)} games")
        else:
            print("  [OK] No unextracted games")
    except Exception as e:
        results["errors"].append(f"Extraction: {e}")
        print(f"  [WARN] Extraction failed: {e}")
    
    # Step 1.3: Compute plus/minus
    print("\n[SILO1] Step 3: Computing plus/minus...")
    try:
        from compute_player_season_plus_minus import compute_plus_minus, upsert_plus_minus
        
        pm = compute_plus_minus(season, db)
        if pm:
            upsert_plus_minus(db, season, pm)
            results["plus_minus_players"] = len(pm)
            print(f"  [OK] Computed plus/minus for {len(pm)} players")
        else:
            print("  [OK] No plus/minus to compute")
    except Exception as e:
        results["errors"].append(f"Plus/minus: {e}")
        print(f"  [WARN] Plus/minus failed: {e}")
    
    return results


def run_silo2_official_pipeline(db: SupabaseRest, season: int, week_start: date, week_end: date) -> dict:
    """
    SILO 2: NHL Official Stats Pipeline (Public)
    
    Scrapes official NHL boxscore stats. This is the SOURCE OF TRUTH
    for what users see in matchups and fantasy scoring.
    
    - Creates goalie records (goalies don't come from PBP)
    - Updates nhl_* columns for all players
    """
    print()
    print("=" * 60)
    print("SILO 2: NHL OFFICIAL STATS PIPELINE (Public Facing)")
    print("=" * 60)
    print(f"Date range: {week_start} to {week_end}")
    
    results = {
        "games_processed": 0,
        "players_updated": 0,
        "goalies_created": 0,
        "errors": []
    }
    
    print("\n[SILO2] Scraping NHL official boxscore stats...")
    try:
        from scrape_per_game_nhl_stats import (
            fetch_game_boxscore, extract_player_stats_from_boxscore,
            update_player_game_stats_nhl_columns, get_games_for_week
        )
        
        games = get_games_for_week(db, week_start, week_end)
        if not games:
            print("  [OK] No games in date range")
            return results
        
        print(f"  Found {len(games)} games to process...")
        
        for idx, game in enumerate(games, 1):
            game_id = game.get("game_id")
            game_date_str = game.get("game_date")
            
            # Fetch boxscore
            boxscore = fetch_game_boxscore(game_id)
            if not boxscore:
                continue
            
            # Extract stats
            player_stats = extract_player_stats_from_boxscore(boxscore)
            if not player_stats:
                continue
            
            # Update database
            from datetime import datetime
            game_date_obj = datetime.strptime(game_date_str, "%Y-%m-%d").date() if isinstance(game_date_str, str) else game_date_str
            
            result = update_player_game_stats_nhl_columns(
                db, game_id, game_date_obj, player_stats, season
            )
            
            results["games_processed"] += 1
            results["players_updated"] += result.get("updated", 0)
            results["goalies_created"] += result.get("created", 0)
            
            if idx % 20 == 0:
                print(f"    Progress: {idx}/{len(games)} games")
            
            time.sleep(0.5)  # Rate limiting
        
        print(f"  [OK] Processed {results['games_processed']} games")
        print(f"       Updated {results['players_updated']} players")
        print(f"       Created {results['goalies_created']} goalies")
        
    except Exception as e:
        results["errors"].append(f"Scrape: {e}")
        print(f"  [WARN] Official stats scraping failed: {e}")
        import traceback
        traceback.print_exc()
    
    return results


def run_shared_aggregation(db: SupabaseRest, season: int) -> dict:
    """
    SHARED: Build aggregated stats from both silos.
    """
    print()
    print("=" * 60)
    print("SHARED: AGGREGATION & VERIFICATION")
    print("=" * 60)
    
    results = {
        "season_stats_built": False,
        "verification": {},
        "errors": []
    }
    
    # Build season stats
    print("\n[SHARED] Step 1: Building season stats...")
    try:
        from build_player_season_stats import main as build_main
        build_main()
        results["season_stats_built"] = True
        print("  [OK] Season stats built")
    except Exception as e:
        results["errors"].append(f"Season stats: {e}")
        print(f"  [WARN] Season stats failed: {e}")
    
    # Verification
    print("\n[SHARED] Step 2: Data verification...")
    try:
        from verify_stats_completeness import check_player_stats_completeness
        stats_check = check_player_stats_completeness(db, season)
        results["verification"] = stats_check
        print(f"  Players with games: {stats_check.get('players_with_games', 0)}")
        print(f"  Goalies with games: {stats_check.get('goalies_with_games', 0) if 'goalies_with_games' in stats_check else 'N/A'}")
    except Exception as e:
        results["errors"].append(f"Verification: {e}")
        print(f"  [WARN] Verification failed: {e}")
    
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Master Pipeline Orchestrator")
    parser.add_argument("--silo1-only", action="store_true", help="Run only PBP pipeline")
    parser.add_argument("--silo2-only", action="store_true", help="Run only Official stats pipeline")
    parser.add_argument("--week", nargs=2, metavar=("START", "END"), help="Date range YYYY-MM-DD YYYY-MM-DD")
    parser.add_argument("--season", type=int, default=DEFAULT_SEASON, help=f"Season (default: {DEFAULT_SEASON})")
    args = parser.parse_args()
    
    # Determine date range
    if args.week:
        from datetime import datetime
        week_start = datetime.strptime(args.week[0], "%Y-%m-%d").date()
        week_end = datetime.strptime(args.week[1], "%Y-%m-%d").date()
    else:
        week_start, week_end = get_current_week_dates()
    
    print("=" * 80)
    print("CITRUS LEAGUE STORM - MASTER PIPELINE")
    print("=" * 80)
    print(f"Season: {args.season}")
    print(f"Week: {week_start} to {week_end}")
    print(f"Timestamp: {_now_iso()}")
    
    if args.silo1_only:
        print("Mode: SILO 1 ONLY (PBP/Internal)")
    elif args.silo2_only:
        print("Mode: SILO 2 ONLY (Official/Public)")
    else:
        print("Mode: FULL PIPELINE (Both Silos)")
    
    try:
        db = supabase_client()
        print("\n[PIPELINE] Connected to Supabase")
    except Exception as e:
        print(f"\n[PIPELINE] ERROR: Failed to connect: {e}")
        return 1
    
    start_time = time.time()
    all_results = {}
    
    # Run appropriate silos
    if not args.silo2_only:
        all_results["silo1"] = run_silo1_pbp_pipeline(db, args.season)
    
    if not args.silo1_only:
        all_results["silo2"] = run_silo2_official_pipeline(db, args.season, week_start, week_end)
    
    # Always run shared aggregation
    all_results["shared"] = run_shared_aggregation(db, args.season)
    
    elapsed = time.time() - start_time
    
    # Summary
    print()
    print("=" * 80)
    print("PIPELINE COMPLETE - SUMMARY")
    print("=" * 80)
    
    if "silo1" in all_results:
        s1 = all_results["silo1"]
        print(f"\nSILO 1 (PBP/Internal):")
        print(f"  Shifts computed: {s1['shifts_computed']}")
        print(f"  Games extracted: {s1['games_extracted']}")
        print(f"  Plus/minus players: {s1['plus_minus_players']}")
        if s1["errors"]:
            print(f"  Errors: {s1['errors']}")
    
    if "silo2" in all_results:
        s2 = all_results["silo2"]
        print(f"\nSILO 2 (Official/Public):")
        print(f"  Games processed: {s2['games_processed']}")
        print(f"  Players updated: {s2['players_updated']}")
        print(f"  Goalies created: {s2['goalies_created']}")
        if s2["errors"]:
            print(f"  Errors: {s2['errors']}")
    
    shared = all_results["shared"]
    print(f"\nSHARED:")
    print(f"  Season stats built: {shared['season_stats_built']}")
    if shared["errors"]:
        print(f"  Errors: {shared['errors']}")
    
    print(f"\nTotal time: {elapsed:.1f} seconds")
    print()
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
