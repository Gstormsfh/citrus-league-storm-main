#!/usr/bin/env python3
"""
run_daily_projections.py

Citrus Projections 2.0 - Batch Daily Projections with Parallel Processing
Calculates daily fantasy point projections for all rostered players across all leagues.
Uses multiprocessing for sub-60-second execution on 600+ players.

Usage:
    python run_daily_projections.py [--date YYYY-MM-DD] [--workers N] [--chunksize N] [--threshold X] [--z-score-threshold X]
"""

import sys
import argparse
import json
import multiprocessing
import os
import time
from datetime import datetime, date
from functools import partial
from typing import Dict, List, Optional, Tuple, Any
import statistics

# Set UTF-8 encoding for stdout (Windows compatibility)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Import calculation functions
from calculate_daily_projections import (
    supabase_client,
    calculate_daily_projection,
    DEFAULT_SEASON
)

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


def get_fresh_supabase_client() -> SupabaseRest:
    """Create a fresh Supabase client for process-safe multiprocessing."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_rostered_players(db: SupabaseRest, target_date: date, season: int) -> List[Tuple[int, int, Optional[str]]]:
    """
    Get all active players who have games on target date (LEFT JOIN approach).
    
    Returns:
        List of (player_id, game_id, league_id) tuples
        - league_id is None if player is not rostered (still calculate projection)
    """
    # Get all games on target date
    games = db.select(
        "nhl_games",
        select="game_id,home_team,away_team",
        filters=[("game_date", "eq", target_date.isoformat()), ("season", "eq", season)]
    )
    
    if not games:
        return []
    
    # Get all teams playing on this date
    playing_teams = set()
    game_map = {}  # team -> game_id
    for game in games:
        home_team = game.get("home_team")
        away_team = game.get("away_team")
        game_id = int(game.get("game_id"))
        playing_teams.add(home_team)
        playing_teams.add(away_team)
        game_map[home_team] = game_id
        game_map[away_team] = game_id
    
    # LEFT JOIN Pattern: Get ALL players on playing teams (not just rostered)
    all_players = db.select(
        "player_directory",
        select="player_id,team_abbrev",
        filters=[
            ("team_abbrev", "in", list(playing_teams)),
            ("season", "eq", season)
        ],
        limit=10000  # Large limit for all players
    )
    
    if not all_players:
        return []
    
    # LEFT JOIN with player_season_stats to filter inactive players
    player_ids = [int(p.get("player_id")) for p in all_players if p.get("player_id")]
    active_players = []
    
    # Query player_season_stats in batches to check games_played > 0
    for i in range(0, len(player_ids), 100):
        batch = player_ids[i:i+100]
        stats_batch = db.select(
            "player_season_stats",
            select="player_id,games_played",
            filters=[("player_id", "in", batch), ("season", "eq", season)],
            limit=100
        )
        
        # Create map of player_id -> games_played
        games_played_map = {}
        for stat in stats_batch:
            pid = stat.get("player_id")
            if pid:
                games_played_map[int(pid)] = int(stat.get("games_played", 0))
        
        # Filter to active players (games_played > 0)
        for player in all_players:
            pid = int(player.get("player_id", 0))
            if pid in batch and games_played_map.get(pid, 0) > 0:
                active_players.append(player)
    
    # LEFT JOIN with draft_picks to get league_id (if rostered)
    # Create map of player_id -> league_id from draft_picks
    all_picks = db.select(
        "draft_picks",
        select="player_id,league_id",
        filters=[],
        limit=10000
    )
    
    player_to_league = {}
    for pick in all_picks:
        pid_str = pick.get("player_id")
        if pid_str:
            try:
                pid = int(pid_str)
                league_id = pick.get("league_id")
                if league_id:
                    player_to_league[pid] = league_id
            except (ValueError, TypeError):
                continue
    
    # Build result list: (player_id, game_id, league_id)
    # league_id is None if not rostered (LEFT JOIN behavior)
    result = []
    for player in active_players:
        player_id = int(player.get("player_id", 0))
        if not player_id:
            continue
        
        team_abbrev = player.get("team_abbrev", "")
        if not team_abbrev or team_abbrev not in playing_teams:
            continue
        
        game_id = game_map.get(team_abbrev)
        if not game_id:
            continue
        
        # LEFT JOIN: league_id from draft_picks, or None if not rostered
        league_id = player_to_league.get(player_id)
        
        result.append((player_id, game_id, league_id))
    
    # Remove duplicates (same player, same game, different leagues)
    # If player is in multiple leagues, use first league_id found
    unique_players = {}
    for player_id, game_id, league_id in result:
        key = (player_id, game_id)
        if key not in unique_players:
            unique_players[key] = league_id
    
    return [(pid, gid, lid) for (pid, gid), lid in unique_players.items()]


def get_league_scoring_settings(db: SupabaseRest, league_id: str) -> Dict[str, Any]:
    """Get scoring settings for a league, with defaults if missing."""
    try:
        leagues = db.select(
            "leagues",
            select="scoring_settings",
            filters=[("id", "eq", league_id)],
            limit=1
        )
        
        if leagues and len(leagues) > 0:
            settings = leagues[0].get("scoring_settings")
            if settings and isinstance(settings, dict):
                return settings
        
        # Return defaults
        return {
            "skater": {
                "goals": 3,
                "assists": 2,
                "shots_on_goal": 0.4,
                "blocks": 0.5,
            },
            "goalie": {
                "wins": 4,
                "shutouts": 3,
                "saves": 0.2,
                "goals_against": -1,
            }
        }
    except Exception as e:
        print(f"⚠️  Warning: Could not fetch scoring settings for league {league_id}: {e}")
        # Return defaults
        return {
            "skater": {
                "goals": 3,
                "assists": 2,
                "shots_on_goal": 0.4,
                "blocks": 0.5,
            },
            "goalie": {
                "wins": 4,
                "shutouts": 3,
                "saves": 0.2,
                "goals_against": -1,
            }
        }


def calculate_player_projection_worker(args: Tuple[int, int, date, int, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Worker function for multiprocessing pool.
    Each worker creates its own database connection (process-safe).
    
    Args:
        args: (player_id, game_id, game_date, season, scoring_settings)
    
    Returns:
        Dict with 'success', 'player_id', 'game_id', and either 'projection' or 'error'
    """
    player_id, game_id, game_date, season, scoring_settings = args
    
    try:
        # Create fresh database connection for this worker
        db = get_fresh_supabase_client()
        
        # Calculate projection
        projection = calculate_daily_projection(
            db, player_id, game_id, game_date, season, scoring_settings
        )
        
        if projection:
            return {
                'success': True,
                'player_id': player_id,
                'game_id': game_id,
                'projection': projection
            }
        else:
            return {
                'success': False,
                'player_id': player_id,
                'game_id': game_id,
                'error': 'calculate_daily_projection returned None'
            }
    except Exception as e:
        return {
            'success': False,
            'player_id': player_id,
            'game_id': game_id,
            'error': str(e)
        }


def detect_outliers(
    projections: List[Dict[str, Any]],
    threshold: float = 25.0,
    rejection_threshold: float = 35.0,
    z_score_threshold: float = 3.0
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Detect outlier projections using both flat threshold and Z-score approach.
    Separates into "rejected" (impossible) and "review" (unusually high) categories.
    
    Args:
        projections: List of projection dicts
        threshold: Warning threshold (default 25.0 points) - flags for review
        rejection_threshold: Rejection threshold (default 35.0 points) - rejects from upsert
        z_score_threshold: Z-score threshold (default 3.0 standard deviations)
    
    Returns:
        Tuple of (rejected list, review list, valid list, stats dict)
    """
    if not projections:
        return [], [], [], {}
    
    # Extract projected points
    points = [p.get('total_projected_points', 0) for p in projections]
    
    if not points:
        return [], [], [], {}
    
    # Calculate statistics
    mean_points = statistics.mean(points)
    stdev_points = statistics.stdev(points) if len(points) > 1 else 0.0
    
    # Find outliers using flat threshold (warning level)
    flat_threshold_outliers = [
        p for p in projections
        if p.get('total_projected_points', 0) > threshold
    ]
    
    # Find outliers using Z-score (if we have enough data)
    z_score_outliers = []
    if stdev_points > 0:
        for p in projections:
            points_val = p.get('total_projected_points', 0)
            if points_val > mean_points:
                z_score = (points_val - mean_points) / stdev_points
                if z_score > z_score_threshold:
                    z_score_outliers.append({**p, 'z_score': z_score})
    
    # Combine outliers (unique by player_id, game_id)
    outlier_map = {}
    for outlier in flat_threshold_outliers:
        key = (outlier.get('player_id'), outlier.get('game_id'))
        outlier_map[key] = {**outlier, 'outlier_reason': 'flat_threshold'}
    
    for outlier in z_score_outliers:
        key = (outlier.get('player_id'), outlier.get('game_id'))
        if key not in outlier_map:
            outlier_map[key] = {**outlier, 'outlier_reason': 'z_score'}
        else:
            outlier_map[key]['outlier_reason'] = 'both'
            outlier_map[key]['z_score'] = outlier.get('z_score')
    
    all_outliers = list(outlier_map.values())
    
    # Separate into rejected (> rejection_threshold) and review (between threshold and rejection_threshold)
    rejected = []
    review = []
    valid = []
    
    outlier_keys = set((o.get('player_id'), o.get('game_id')) for o in all_outliers)
    
    for proj in projections:
        key = (proj.get('player_id'), proj.get('game_id'))
        points_val = proj.get('total_projected_points', 0)
        
        if points_val > rejection_threshold:
            # Rejected: Impossible projection
            outlier_info = next((o for o in all_outliers if (o.get('player_id'), o.get('game_id')) == key), {})
            rejected.append({**proj, **outlier_info, 'rejection_reason': 'exceeds_rejection_threshold'})
        elif key in outlier_keys:
            # Review: Unusually high but not impossible
            outlier_info = next((o for o in all_outliers if (o.get('player_id'), o.get('game_id')) == key), {})
            review.append({**proj, **outlier_info})
        else:
            # Valid: Normal projection
            valid.append(proj)
    
    stats = {
        'total_projections': len(projections),
        'mean_points': mean_points,
        'stdev_points': stdev_points,
        'max_points': max(points),
        'min_points': min(points),
        'valid': len(valid),
        'rejected': len(rejected),
        'review': len(review),
        'flat_threshold_outliers': len(flat_threshold_outliers),
        'z_score_outliers': len(z_score_outliers),
        'unique_outliers': len(all_outliers)
    }
    
    return rejected, review, valid, stats


def generate_traceability_log_for_rejection(
    db: SupabaseRest,
    projection: Dict[str, Any],
    season: int,
    scoring_settings: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Generate full traceability log for a rejected projection.
    Similar to debug_projection.py but returns as dict for JSON logging.
    
    Returns:
        Dict with full traceability breakdown (Steps 1-6)
    """
    player_id = projection.get('player_id')
    game_id = projection.get('game_id')
    game_date_str = projection.get('projection_date')
    
    try:
        game_date = datetime.strptime(game_date_str, "%Y-%m-%d").date()
    except:
        game_date = date.today()
    
    # Get player info
    player_dir = db.select(
        "player_directory",
        select="full_name,position_code,team_abbrev",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    player_name = player_dir[0].get("full_name", f"Player {player_id}") if player_dir else f"Player {player_id}"
    position = player_dir[0].get("position_code", "C") if player_dir else "C"
    player_team = player_dir[0].get("team_abbrev", "") if player_dir else ""
    
    # Get game info
    game_info = db.select(
        "nhl_games",
        select="home_team,away_team",
        filters=[("game_id", "eq", game_id)],
        limit=1
    )
    
    opponent_team = "UNK"
    is_home = False
    if game_info and len(game_info) > 0:
        game = game_info[0]
        home_team = game.get("home_team", "")
        away_team = game.get("away_team", "")
        opponent_team = away_team if home_team == player_team else home_team
        is_home = home_team == player_team
    
    # Get player season stats
    season_stats = db.select(
        "player_season_stats",
        select="goals,primary_assists,secondary_assists,shots_on_goal,blocks,games_played",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    gp = 0
    goals = 0
    assists = 0
    sog = 0
    blocks = 0
    
    if season_stats and len(season_stats) > 0:
        stats = season_stats[0]
        gp = int(stats.get("games_played", 0))
        goals = int(stats.get("goals", 0))
        primary_assists = int(stats.get("primary_assists", 0))
        secondary_assists = int(stats.get("secondary_assists", 0))
        assists = primary_assists + secondary_assists
        sog = int(stats.get("shots_on_goal", 0))
        blocks = int(stats.get("blocks", 0))
    
    # Build traceability log
    traceability = {
        "player_id": player_id,
        "player_name": player_name,
        "game_id": game_id,
        "game_date": game_date_str,
        "position": position,
        "team": player_team,
        "opponent": opponent_team,
        "is_home": is_home,
        "season": season,
        "rejection_reason": projection.get('rejection_reason', 'unknown'),
        "projected_points": projection.get('total_projected_points', 0),
        "step_1_player_history": {
            "games_played": gp,
            "goals": goals,
            "assists": assists,
            "shots_on_goal": sog,
            "blocks": blocks,
            "goals_per_game": goals / gp if gp > 0 else 0,
            "assists_per_game": assists / gp if gp > 0 else 0,
            "sog_per_game": sog / gp if gp > 0 else 0,
            "blocks_per_game": blocks / gp if gp > 0 else 0,
        },
        "step_2_league_averages": {
            # Will be populated if needed
        },
        "step_3_bayesian_shrinkage": {
            "shrinkage_weight": projection.get('shrinkage_weight', 0),
            "base_ppg": projection.get('base_ppg', 0),
        },
        "step_4_finishing_talent": {
            "finishing_multiplier": projection.get('finishing_multiplier', 1.0),
        },
        "step_5_environmental": {
            "opponent_adjustment": projection.get('opponent_adjustment', 1.0),
            "b2b_penalty": projection.get('b2b_penalty', 1.0),
            "home_away_adjustment": projection.get('home_away_adjustment', 1.0),
        },
        "step_6_final_projection": {
            "projected_goals": projection.get('projected_goals', 0),
            "projected_assists": projection.get('projected_assists', 0),
            "projected_sog": projection.get('projected_sog', 0),
            "projected_blocks": projection.get('projected_blocks', 0),
            "total_projected_points": projection.get('total_projected_points', 0),
        },
        "model_components": {
            "base_ppg": projection.get('base_ppg', 0),
            "shrinkage_weight": projection.get('shrinkage_weight', 0),
            "finishing_multiplier": projection.get('finishing_multiplier', 1.0),
            "opponent_adjustment": projection.get('opponent_adjustment', 1.0),
            "b2b_penalty": projection.get('b2b_penalty', 1.0),
            "home_away_adjustment": projection.get('home_away_adjustment', 1.0),
            "confidence_score": projection.get('confidence_score', 0),
        }
    }
    
    return traceability


def save_rejected_projections_log(
    rejected_traceability_logs: List[Dict[str, Any]],
    target_date: date,
    log_dir: str = "."
) -> str:
    """
    Save rejected projections with full traceability to JSON log file.
    
    Args:
        rejected_traceability_logs: List of traceability log dicts (from generate_traceability_log_for_rejection)
        target_date: Target date for projections
        log_dir: Directory to save log file (default: current directory)
    
    Returns:
        Path to log file
    """
    if not rejected_traceability_logs:
        return ""
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_filename = f"rejected_projections_{target_date.isoformat()}_{timestamp}.json"
    log_path = os.path.join(log_dir, log_filename)
    
    try:
        with open(log_path, 'w', encoding='utf-8') as f:
            json.dump({
                "date": target_date.isoformat(),
                "timestamp": datetime.now().isoformat(),
                "total_rejected": len(rejected_traceability_logs),
                "rejected_projections": rejected_traceability_logs
            }, f, indent=2, ensure_ascii=False)
        
        return log_path
    except Exception as e:
        print(f"⚠️  Warning: Could not save rejected projections log: {e}")
        return ""


def batch_upsert_projections(db: SupabaseRest, projections: List[Dict[str, Any]], batch_size: int = 200) -> int:
    """
    Batch upsert projections to player_projected_stats table.
    
    Args:
        db: Supabase client
        projections: List of projection dicts
        batch_size: Number of projections per batch
    
    Returns:
        Number of projections upserted
    """
    if not projections:
        return 0
    
    total_upserted = 0
    
    # Process in batches
    for i in range(0, len(projections), batch_size):
        batch = projections[i:i+batch_size]
        
        try:
            db.upsert(
                "player_projected_stats",
                batch,
                on_conflict="player_id,game_id,projection_date"
            )
            total_upserted += len(batch)
        except Exception as e:
            print(f"⚠️  Error upserting batch {i//batch_size + 1}: {e}")
            # Try individual upserts for this batch
            for proj in batch:
                try:
                    db.upsert(
                        "player_projected_stats",
                        proj,
                        on_conflict="player_id,game_id,projection_date"
                    )
                    total_upserted += 1
                except Exception as err:
                    print(f"⚠️  Error upserting player {proj.get('player_id')}, game {proj.get('game_id')}: {err}")
    
    return total_upserted


def main():
    parser = argparse.ArgumentParser(
        description="Calculate daily projections for all rostered players with parallel processing"
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Target date (YYYY-MM-DD), default: today"
    )
    parser.add_argument(
        "--season",
        type=int,
        default=DEFAULT_SEASON,
        help=f"Season year (default: {DEFAULT_SEASON})"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Number of worker processes (default: 1x-2x CPU cores, min 4, max 16)"
    )
    parser.add_argument(
        "--chunksize",
        type=int,
        default=30,
        help="Chunksize for pool.map() (default: 30)"
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=25.0,
        help="Flat threshold for outlier detection (default: 25.0 points)"
    )
    parser.add_argument(
        "--z-score-threshold",
        type=float,
        default=3.0,
        help="Z-score threshold for outlier detection (default: 3.0 standard deviations)"
    )
    parser.add_argument(
        "--skip-outlier-detection",
        action="store_true",
        help="Skip outlier detection (faster, but less safe)"
    )
    parser.add_argument(
        "--reject-outliers",
        action="store_true",
        help="Reject outliers from database upsert (quarantine mode)"
    )
    parser.add_argument(
        "--rejection-threshold",
        type=float,
        default=35.0,
        help="Rejection threshold for impossible projections (default: 35.0 points)"
    )
    
    args = parser.parse_args()
    
    # Parse target date
    if args.date:
        try:
            target_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print(f"❌ Invalid date format: {args.date}. Use YYYY-MM-DD")
            sys.exit(1)
    else:
        target_date = date.today()
    
    # Determine worker count
    if args.workers:
        max_workers = max(1, min(args.workers, 16))
    else:
        # Default: 1x-2x CPU cores, min 4, max 16
        cpu_count = multiprocessing.cpu_count()
        max_workers = max(4, min(cpu_count * 2, 16))
    
    print("=" * 80)
    print("CITRUS PROJECTIONS 2.0 - BATCH DAILY PROJECTIONS")
    print("=" * 80)
    print(f"Target Date: {target_date}")
    print(f"Season: {args.season}")
    print(f"Workers: {max_workers}")
    print(f"Chunksize: {args.chunksize}")
    print()
    
    # Initialize database connection (main process)
    db = supabase_client()
    
    # Step 1: Get rostered players
    print("📋 Step 1: Fetching rostered players...")
    rostered_players = get_rostered_players(db, target_date, args.season)
    
    if not rostered_players:
        print(f"⚠️  No rostered players found with games on {target_date}")
        return
    
    print(f"   Found {len(rostered_players)} player-game combinations")
    print()
    
    # Step 2: Group by league to get scoring settings
    print("📋 Step 2: Loading league scoring settings...")
    league_scoring = {}
    unique_leagues = set(league_id for _, _, league_id in rostered_players if league_id is not None)

    for league_id in unique_leagues:
        league_scoring[league_id] = get_league_scoring_settings(db, league_id)
    
    print(f"   Loaded scoring settings for {len(unique_leagues)} leagues")
    print()
    
    # Step 3: Prepare worker arguments
    print("📋 Step 3: Preparing worker tasks...")
    worker_args = []
    for player_id, game_id, league_id in rostered_players:
        # Use league scoring if available, otherwise use defaults
        # league_id can be None for unrostered players - use defaults
        scoring_settings = league_scoring.get(league_id) if league_id else {
            "skater": {"goals": 3, "assists": 2, "shots_on_goal": 0.4, "blocks": 0.5},
            "goalie": {"wins": 4, "shutouts": 3, "saves": 0.2, "goals_against": -1}
        }
        if not scoring_settings:
            scoring_settings = {
                "skater": {"goals": 3, "assists": 2, "shots_on_goal": 0.4, "blocks": 0.5},
                "goalie": {"wins": 4, "shutouts": 3, "saves": 0.2, "goals_against": -1}
            }
        worker_args.append((player_id, game_id, target_date, args.season, scoring_settings))
    
    print(f"   Prepared {len(worker_args)} calculation tasks")
    print()
    
    # Step 4: Process in parallel
    print("📋 Step 4: Calculating projections in parallel...")
    start_time = time.time()
    results = []
    
    try:
        with multiprocessing.Pool(max_workers) as pool:
            # Use chunksize to optimize inter-process communication
            results = pool.map(
                calculate_player_projection_worker,
                worker_args,
                chunksize=args.chunksize
            )
    except Exception as e:
        print(f"❌ Fatal error in parallel processing: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    elapsed_time = time.time() - start_time
    print(f"   Completed in {elapsed_time:.2f} seconds")
    print()
    
    # Step 5: Separate successes and failures
    successes = [r for r in results if r.get('success')]
    failures = [r for r in results if not r.get('success')]
    projections = [r['projection'] for r in successes if 'projection' in r]
    
    print(f"✅ Successful: {len(successes)}")
    print(f"❌ Failed: {len(failures)}")
    print()
    
    if failures:
        print("⚠️  Failed calculations (first 10):")
        for fail in failures[:10]:
            print(f"   Player {fail.get('player_id')}, Game {fail.get('game_id')}: {fail.get('error', 'Unknown error')}")
        if len(failures) > 10:
            print(f"   ... and {len(failures) - 10} more")
        print()
    
    # Step 6: Quality Gate - Outlier Detection
    valid_projections = projections
    rejected_projections = []
    review_projections = []
    stats = {}
    
    if not args.skip_outlier_detection and projections:
        print("📋 Step 6: Quality Gate - Outlier Detection...")
        rejected, review, valid, stats = detect_outliers(
            projections,
            threshold=args.threshold,
            rejection_threshold=args.rejection_threshold,
            z_score_threshold=args.z_score_threshold
        )
        
        rejected_projections = rejected
        review_projections = review
        valid_projections = valid
        
        print(f"   Total Projections: {stats.get('total_projections', 0)}")
        print(f"   Mean Points: {stats.get('mean_points', 0):.3f}")
        print(f"   Std Dev: {stats.get('stdev_points', 0):.3f}")
        print(f"   Max Points: {stats.get('max_points', 0):.3f}")
        print(f"   Min Points: {stats.get('min_points', 0):.3f}")
        print()
        print(f"   ✅ Valid: {stats.get('valid', 0)}")
        print(f"   ⚠️  Review Needed: {stats.get('review', 0)}")
        print(f"   ❌ Rejected: {stats.get('rejected', 0)}")
        print()
        
        if rejected_projections:
            print("❌ REJECTED PROJECTIONS (Impossible - > {:.1f} pts):".format(args.rejection_threshold))
            print("-" * 80)
            for rejected in rejected_projections[:10]:  # Show first 10
                reason = rejected.get('rejection_reason', 'unknown')
                outlier_reason = rejected.get('outlier_reason', 'unknown')
                z_score = rejected.get('z_score', 'N/A')
                print(f"   Player {rejected.get('player_id')}, Game {rejected.get('game_id')}: "
                      f"{rejected.get('total_projected_points', 0):.3f} pts "
                      f"(Reason: {reason}, Outlier: {outlier_reason}, Z-score: {z_score})")
            if len(rejected_projections) > 10:
                print(f"   ... and {len(rejected_projections) - 10} more rejected")
            print("-" * 80)
            print()
            
            # Generate traceability logs for rejected projections
            if args.reject_outliers:
                print("📋 Generating traceability logs for rejected projections...")
                rejected_logs = []
                for rejected in rejected_projections:
                    # Get scoring settings (use default for traceability - main goal is debugging)
                    default_scoring = {
                        "skater": {"goals": 3, "assists": 2, "shots_on_goal": 0.4, "blocks": 0.5},
                        "goalie": {"wins": 4, "shutouts": 3, "saves": 0.2, "goals_against": -1}
                    }
                    traceability = generate_traceability_log_for_rejection(
                        db, rejected, args.season, default_scoring
                    )
                    rejected_logs.append(traceability)
                
                # Save to log file (use traceability logs, not raw projections)
                rejected_log_path = save_rejected_projections_log(rejected_logs, target_date)
                if rejected_log_path:
                    print(f"   ✅ Saved traceability log to: {rejected_log_path}")
                print()
        
        if review_projections:
            print("⚠️  REVIEW PROJECTIONS (Unusually High - {:.1f} to {:.1f} pts):".format(
                args.threshold, args.rejection_threshold
            ))
            print("-" * 80)
            for review in review_projections[:10]:  # Show first 10
                reason = review.get('outlier_reason', 'unknown')
                z_score = review.get('z_score', 'N/A')
                print(f"   Player {review.get('player_id')}, Game {review.get('game_id')}: "
                      f"{review.get('total_projected_points', 0):.3f} pts "
                      f"(Reason: {reason}, Z-score: {z_score})")
            if len(review_projections) > 10:
                print(f"   ... and {len(review_projections) - 10} more for review")
            print("-" * 80)
            print()
    
    # Step 7: Batch Upsert (only valid projections if reject_outliers is enabled)
    projections_to_upsert = valid_projections
    if args.reject_outliers:
        # Only upsert valid projections, skip rejected ones
        projections_to_upsert = valid_projections
        if review_projections:
            # Also include review projections (they're high but not impossible)
            projections_to_upsert.extend(review_projections)
    else:
        # Upsert all projections (including outliers, for manual review)
        projections_to_upsert = projections
    
    if projections_to_upsert:
        print("📋 Step 7: Batch Upserting to Database...")
        if args.reject_outliers and rejected_projections:
            print(f"   ⚠️  Skipping {len(rejected_projections)} rejected projections")
        upserted = batch_upsert_projections(db, projections_to_upsert)
        print(f"   Upserted {upserted} projections to player_projected_stats")
        print()
    
    # Final Summary
    print("=" * 80)
    print("BATCH PROCESSING COMPLETE")
    print("=" * 80)
    print(f"Total Time: {elapsed_time:.2f} seconds")
    print(f"Players Processed: {len(rostered_players)}")
    print(f"Successful: {len(successes)}")
    print(f"Failed: {len(failures)}")
    if not args.skip_outlier_detection and projections:
        print(f"✅ Valid: {len(valid_projections)}")
        print(f"⚠️  Manual Review Needed: {len(review_projections)}")
        print(f"❌ Rejected: {len(rejected_projections)}")
    print(f"Projections Upserted: {len(projections_to_upsert)}")
    if args.reject_outliers and rejected_projections and rejected_log_path:
        print(f"📄 Rejected projections log: {rejected_log_path}")
    print("=" * 80)


if __name__ == "__main__":
    main()
