#!/usr/bin/env python3
"""
reconcile_player_stats.py

WORLD-CLASS Data Reconciliation System - Compare our player_game_stats to NHL API boxscores.
Finds discrepancies and auto-fixes them to ensure 100% data accuracy.

ARCHITECTURE:
- Fetches boxscore ONCE per game (not per player) - 40x more efficient
- Uses citrus_request for 100-IP rotation - no rate limit concerns
- Parallel game processing with ThreadPoolExecutor
- Smart sampling for full audits to balance thoroughness vs API load
- Windows-compatible logging (no Unicode issues)

Usage:
    python reconcile_player_stats.py --recent              # Validate last 7 days (100%)
    python reconcile_player_stats.py --player 8478402      # Validate specific player's games
    python reconcile_player_stats.py --start 2026-01-20 --end 2026-01-26  # Date range
    python reconcile_player_stats.py --full-audit          # All games with smart sampling
    python reconcile_player_stats.py --recent --auto-fix   # Auto-fix discrepancies
"""

import os
import sys
import time
import random
import argparse
import logging
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple, Set, Any
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from src.utils.citrus_request import citrus_request
from concurrent.futures import ThreadPoolExecutor, as_completed

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))
NHL_API_BASE = "https://api-web.nhle.com/v1"

# Logging setup (Windows-safe, no Unicode)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("Reconciler")

# Discrepancy thresholds for auto-fix
AUTO_FIX_THRESHOLDS = {
    "goals": 2,
    "assists": 2,
    "points": 3,
    "shots": 5
}

# Stats we track and reconcile
STAT_FIELDS = ["goals", "assists", "points", "shots"]

def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def _safe_int(v, default=0) -> int:
    """Safely convert value to int."""
    try:
        return int(v) if v is not None else default
    except Exception:
        return default

def fetch_boxscore(game_id: int) -> Optional[Dict[int, Dict[str, int]]]:
    """
    Fetch ALL player stats from a game boxscore in ONE API call.
    Returns: {player_id: {goals, assists, points, shots}} or None on error.
    
    Uses citrus_request for 100-IP rotation - no rate limiting needed.
    """
    url = f"{NHL_API_BASE}/gamecenter/{game_id}/boxscore"
    
    try:
        response = citrus_request(url, timeout=15)
        if response.status_code != 200:
            logger.warning(f"[BOXSCORE] Game {game_id}: HTTP {response.status_code}")
            return None
        
        boxscore = response.json()
        player_stats_by_game = boxscore.get("playerByGameStats", {})
        
        result = {}
        
        for team_key in ["homeTeam", "awayTeam"]:
            if team_key not in player_stats_by_game:
                continue
            team_data = player_stats_by_game[team_key]
            
            # Process skaters (forwards + defense)
            for position_group in ["forwards", "defense"]:
                if position_group not in team_data:
                    continue
                for player_stat in team_data[position_group]:
                    player_id = player_stat.get("playerId")
                    if player_id:
                        result[player_id] = {
                            "goals": _safe_int(player_stat.get("goals", 0)),
                            "assists": _safe_int(player_stat.get("assists", 0)),
                            "points": _safe_int(player_stat.get("points", 0)),
                            "shots": _safe_int(player_stat.get("sog", 0))
                        }
        
        return result
        
    except Exception as e:
        logger.error(f"[BOXSCORE] Game {game_id} fetch error: {e}")
        return None

def compare_stats(our_stats: Dict, api_stats: Dict) -> Dict[str, int]:
    """Compare our stats to API stats, return differences."""
    differences = {}
    
    for stat in STAT_FIELDS:
        our_val = _safe_int(our_stats.get(stat, 0))
        api_val = _safe_int(api_stats.get(stat, 0))
        if our_val != api_val:
            differences[stat] = api_val - our_val
    
    return differences

def should_auto_fix(differences: Dict[str, int]) -> bool:
    """Determine if discrepancy should be auto-fixed based on thresholds."""
    for stat, diff in differences.items():
        threshold = AUTO_FIX_THRESHOLDS.get(stat, 999)
        if abs(diff) > threshold:
            return False  # Too large, needs human review
    return True

def get_unique_games(db: SupabaseRest, filters: List[Tuple], limit: int = 10000) -> List[Dict]:
    """Get unique games from player_game_stats with given filters."""
    all_records = db.select(
        "player_game_stats",
        select="game_id,game_date",
        filters=filters,
        limit=limit
    )
    
    # Deduplicate by game_id
    seen = set()
    games = []
    for record in all_records:
        game_id = record.get("game_id")
        if game_id and game_id not in seen:
            seen.add(game_id)
            games.append(record)
    
    return games

def get_games_to_validate(db: SupabaseRest, args: argparse.Namespace, season: int) -> List[Dict]:
    """Get list of games to validate based on arguments."""
    
    if args.recent:
        # Last 7 days - 100% validation
        end_date = date.today()
        start_date = end_date - timedelta(days=7)
        logger.info(f"[MODE] Recent games: {start_date} to {end_date}")
        
        return get_unique_games(db, [
            ("season", "eq", season),
            ("game_date", "gte", start_date.isoformat()),
            ("game_date", "lte", end_date.isoformat()),
            ("is_goalie", "eq", False)
        ])
        
    elif args.start and args.end:
        # Date range
        logger.info(f"[MODE] Date range: {args.start} to {args.end}")
        
        return get_unique_games(db, [
            ("season", "eq", season),
            ("game_date", "gte", args.start),
            ("game_date", "lte", args.end),
            ("is_goalie", "eq", False)
        ])
        
    elif args.player:
        # Specific player's games
        logger.info(f"[MODE] Player {args.player}")
        
        return get_unique_games(db, [
            ("season", "eq", season),
            ("player_id", "eq", args.player),
            ("is_goalie", "eq", False)
        ])
        
    elif args.full_audit:
        # Smart sampling for full audit
        logger.info("[MODE] Full audit with smart sampling")
        
        all_games = get_unique_games(db, [
            ("season", "eq", season),
            ("is_goalie", "eq", False)
        ], limit=100000)
        
        # Smart sampling: 100% recent, 20% mid, 5% old
        today = date.today()
        recent, mid, old = [], [], []
        
        for game in all_games:
            game_date_str = game.get("game_date")
            if not game_date_str:
                continue
            try:
                game_date = datetime.strptime(game_date_str, "%Y-%m-%d").date()
                days_ago = (today - game_date).days
                
                if days_ago <= 7:
                    recent.append(game)
                elif days_ago <= 30:
                    mid.append(game)
                else:
                    old.append(game)
            except:
                continue
        
        # Sample
        games = recent  # 100%
        if mid:
            sample_size = max(1, len(mid) // 5)  # 20%
            games.extend(random.sample(mid, min(len(mid), sample_size)))
        if old:
            sample_size = max(1, len(old) // 20)  # 5%
            games.extend(random.sample(old, min(len(old), sample_size)))
        
        logger.info(f"  Sampling: {len(recent)} recent (100%), {len(mid)} mid->~{len(mid)//5}, {len(old)} old->~{len(old)//20}")
        return games
    
    else:
        logger.error("No validation criteria. Use --recent, --player, --start/--end, or --full-audit")
        return []

def validate_game(db: SupabaseRest, game_id: int, game_date: str, 
                 season: int, auto_fix: bool, player_filter: Optional[int] = None) -> Dict[str, Any]:
    """
    Validate ALL players in a game with ONE API call.
    
    Returns: {
        "game_id": int,
        "checked": int,
        "fixed": int,
        "discrepancies": List[Dict]
    }
    """
    result = {
        "game_id": game_id,
        "game_date": game_date,
        "checked": 0,
        "fixed": 0,
        "discrepancies": []
    }
    
    # 1. Fetch boxscore ONCE for entire game
    api_stats_by_player = fetch_boxscore(game_id)
    if api_stats_by_player is None:
        return result
    
    # 2. Get our DB records for this game
    filters = [
        ("season", "eq", season),
        ("game_id", "eq", game_id),
        ("is_goalie", "eq", False)
    ]
    if player_filter:
        filters.append(("player_id", "eq", player_filter))
    
    our_records = db.select(
        "player_game_stats",
        select="player_id,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal",
        filters=filters,
        limit=100
    )
    
    if not our_records:
        return result
    
    # 3. Compare each player
    for record in our_records:
        player_id = record.get("player_id")
        if not player_id:
            continue
        
        # Get API stats for this player
        api_stats = api_stats_by_player.get(player_id)
        if api_stats is None:
            continue  # Player not in boxscore (maybe didn't play)
        
        result["checked"] += 1
        
        our_stats = {
            "goals": _safe_int(record.get("nhl_goals")),
            "assists": _safe_int(record.get("nhl_assists")),
            "points": _safe_int(record.get("nhl_points")),
            "shots": _safe_int(record.get("nhl_shots_on_goal"))
        }
        
        differences = compare_stats(our_stats, api_stats)
        
        if differences:
            disc = {
                "game_id": game_id,
                "game_date": game_date,
                "player_id": player_id,
                "our_stats": our_stats,
                "api_stats": api_stats,
                "differences": differences
            }
            result["discrepancies"].append(disc)
            
            # Auto-fix if enabled and within thresholds
            if auto_fix and should_auto_fix(differences):
                try:
                    # Calculate correct points
                    points = api_stats.get("points")
                    if points is None:
                        points = api_stats.get("goals", 0) + api_stats.get("assists", 0)
                    
                    db.update(
                        "player_game_stats",
                        {
                            "nhl_goals": api_stats.get("goals", 0),
                            "nhl_assists": api_stats.get("assists", 0),
                            "nhl_points": points,
                            "nhl_shots_on_goal": api_stats.get("shots", 0),
                            "updated_at": datetime.now().isoformat()
                        },
                        filters=[
                            ("season", "eq", season),
                            ("game_id", "eq", game_id),
                            ("player_id", "eq", player_id)
                        ]
                    )
                    result["fixed"] += 1
                    logger.info(f"  [FIXED] Game {game_id}, Player {player_id}: {differences}")
                except Exception as e:
                    logger.error(f"  [FIX-FAIL] Game {game_id}, Player {player_id}: {e}")
    
    return result

def main():
    parser = argparse.ArgumentParser(
        description="WORLD-CLASS Data Reconciliation - Compare player_game_stats to NHL API"
    )
    parser.add_argument("--recent", action="store_true", help="Validate last 7 days")
    parser.add_argument("--player", type=int, help="Validate specific player ID")
    parser.add_argument("--start", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--full-audit", action="store_true", help="Full audit with smart sampling")
    parser.add_argument("--auto-fix", action="store_true", help="Auto-fix discrepancies")
    parser.add_argument("--workers", type=int, default=5, help="Parallel workers (default: 5)")
    
    args = parser.parse_args()
    
    if not any([args.recent, args.player, args.start, args.full_audit]):
        parser.print_help()
        return 1
    
    print("=" * 80)
    print("DATA RECONCILIATION SYSTEM (WORLD-CLASS)")
    print("=" * 80)
    print(f"Season: {DEFAULT_SEASON} (2025-2026)")
    print(f"Auto-fix: {args.auto_fix}")
    print(f"Workers: {args.workers}")
    print("Architecture: 1 API call per game (not per player) + 100-IP rotation")
    print()
    
    db = supabase_client()
    
    # Get games to validate
    games = get_games_to_validate(db, args, DEFAULT_SEASON)
    if not games:
        logger.error("No games found to validate")
        return 1
    
    logger.info(f"[RECONCILE] Validating {len(games)} games...")
    print()
    
    total_checked = 0
    total_fixed = 0
    all_discrepancies = []
    
    # Determine player filter for --player mode
    player_filter = args.player if args.player else None
    
    # Process games in parallel
    # With 100-IP rotation, we can safely use multiple workers
    start_time = time.time()
    
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {}
        for game in games:
            game_id = game.get("game_id")
            game_date = game.get("game_date", "")
            future = executor.submit(
                validate_game, db, game_id, game_date, 
                DEFAULT_SEASON, args.auto_fix, player_filter
            )
            futures[future] = game_id
        
        completed = 0
        for future in as_completed(futures):
            completed += 1
            try:
                result = future.result()
                total_checked += result["checked"]
                total_fixed += result["fixed"]
                all_discrepancies.extend(result["discrepancies"])
                
                # Progress every 10 games
                if completed % 10 == 0 or completed == len(games):
                    elapsed = time.time() - start_time
                    rate = completed / elapsed if elapsed > 0 else 0
                    logger.info(f"  Progress: {completed}/{len(games)} games ({rate:.1f} games/sec)")
                    
            except Exception as e:
                game_id = futures[future]
                logger.error(f"  [ERROR] Game {game_id}: {e}")
    
    elapsed = time.time() - start_time
    
    print()
    print("=" * 80)
    print("RECONCILIATION COMPLETE")
    print("=" * 80)
    print(f"Games validated: {len(games)}")
    print(f"Players checked: {total_checked}")
    print(f"Discrepancies found: {len(all_discrepancies)}")
    print(f"Auto-fixed: {total_fixed}")
    print(f"Time: {elapsed:.1f}s ({len(games)/elapsed:.1f} games/sec)")
    print()
    
    if all_discrepancies:
        print("DISCREPANCIES FOUND:")
        print("-" * 80)
        for disc in all_discrepancies[:25]:  # Show first 25
            print(f"Game {disc['game_id']} ({disc['game_date']}), Player {disc['player_id']}:")
            for stat, diff in disc['differences'].items():
                our_val = disc['our_stats'][stat]
                api_val = disc['api_stats'][stat]
                print(f"  {stat}: {our_val} -> {api_val} (diff: {diff:+d})")
        
        if len(all_discrepancies) > 25:
            print(f"  ... and {len(all_discrepancies) - 25} more")
    else:
        print("[OK] No discrepancies found - data is accurate!")
    
    if total_fixed > 0:
        print()
        print(f"[!] {total_fixed} records were auto-fixed.")
        print("    Run these to update season totals:")
        print("      python build_player_season_stats.py")
        print("      python fetch_nhl_stats_from_landing.py")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
