#!/usr/bin/env python3
"""
run_daily_projections.py

Citrus Projections 3.0 - Batch Daily Projections with Parallel Processing
Calculates daily projections for ALL active NHL players (league-agnostic).
Uses DEFAULT_FALLBACK_SCORING for total_projected_points as a convenience baseline.
League-specific scoring is applied dynamically on the frontend via ScoringCalculator.
Uses multiprocessing for fast execution on 600+ players.

Usage:
    python run_daily_projections.py [--date YYYY-MM-DD] [--force] [--workers N] [--chunksize N]
"""

import signal
import sys
import argparse
import json
import multiprocessing
import os
import time
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple, Any
import statistics
import logging

logger = logging.getLogger(__name__)

_shutdown_requested = False

def _handle_shutdown(signum, frame):
    global _shutdown_requested
    _shutdown_requested = True
    logger.info(f"\n[SHUTDOWN] Signal {signum} received, finishing current operation...")

signal.signal(signal.SIGINT, _handle_shutdown)
if sys.platform != "win32":
    signal.signal(signal.SIGTERM, _handle_shutdown)

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

# Support both old and new service role key variable names
# The new variable may contain extra characters that need cleaning
_raw_key = os.getenv("SUPABASE_Real_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if _raw_key and '(' in _raw_key and ')' in _raw_key:
    # Clean the key: extract JWT from "eyJ... (actualJWT)"
    _start = _raw_key.index('(') + 1
    _end = _raw_key.rindex(')')
    SUPABASE_KEY = _raw_key[_start:_end]
else:
    SUPABASE_KEY = _raw_key

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


# Single source of truth for fallback scoring — matches DEFAULT_SCORING in src/utils/scoringUtils.ts
# Used when a player has no league context (free agents) or when league settings can't be loaded.
DEFAULT_FALLBACK_SCORING = {
    "skater": {
        "goals": 3,
        "assists": 2,
        "power_play_points": 1,
        "short_handed_points": 2,
        "shots_on_goal": 0.4,
        "blocks": 0.5,
        "hits": 0.2,
        "penalty_minutes": 0.5,
    },
    "goalie": {
        "wins": 4,
        "shutouts": 3,
        "saves": 0.2,
        "goals_against": -1,
    }
}


def get_fresh_supabase_client() -> SupabaseRest:
    """Create a fresh Supabase client for process-safe multiprocessing."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_active_players_with_games(db: SupabaseRest, target_date: date, season: int) -> List[Tuple[int, int]]:
    """
    Get all active NHL players who have games on target date.

    Universal approach: finds ALL active players on playing teams, regardless of
    league roster status. Projections are league-agnostic — scoring is applied
    dynamically on the frontend using ScoringCalculator.

    Returns:
        List of (player_id, game_id) tuples
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

    # Get ALL players on playing teams
    logger.info(f"   Fetching players from {len(playing_teams)} teams...")
    all_players = db.select(
        "player_directory",
        select="player_id,team_abbrev",
        filters=[
            ("team_abbrev", "in", list(playing_teams)),
            ("season", "eq", season)
        ],
        limit=100000
    )
    logger.info(f"   Found {len(all_players)} players")

    if not all_players:
        return []

    # Filter to active players (games_played > 0 in player_season_stats)
    player_ids = [int(p.get("player_id")) for p in all_players if p.get("player_id")]
    active_players = []

    logger.info(f"   Checking active players ({len(player_ids)} total)...")
    for i in range(0, len(player_ids), 500):
        batch = player_ids[i:i+500]
        if i % 1000 == 0:
            logger.info(f"   Checking batch {i//500 + 1}...")
        stats_batch = db.select(
            "player_season_stats",
            select="player_id,games_played",
            filters=[("player_id", "in", batch), ("season", "eq", season)],
            limit=100000
        )

        games_played_map = {}
        for stat in stats_batch:
            pid = stat.get("player_id")
            if pid:
                games_played_map[int(pid)] = int(stat.get("games_played", 0))

        for player in all_players:
            pid = int(player.get("player_id", 0))
            if pid in batch and games_played_map.get(pid, 0) > 0:
                active_players.append(player)
    logger.info(f"   Found {len(active_players)} active players")

    # Build result list: (player_id, game_id) — no league coupling
    seen = set()
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

        key = (player_id, game_id)
        if key not in seen:
            seen.add(key)
            result.append(key)

    return result


## get_league_scoring_settings() — REMOVED
## League-specific scoring is no longer applied in the pipeline.
## The pipeline uses DEFAULT_FALLBACK_SCORING universally.
## League-specific scoring is applied dynamically on the frontend
## via ScoringCalculator (src/utils/scoringUtils.ts).


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
        # Suppress verbose per-player logging from calc engine in batch mode.
        # Only warnings/errors will show; info-level detail (DDR, goalie debug) is silenced.
        calc_logger = logging.getLogger("calculate_daily_projections")
        calc_logger.setLevel(logging.WARNING)

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
    
    Goalies have higher thresholds since they can legitimately score 15+ points.
    
    Args:
        projections: List of projection dicts
        threshold: Warning threshold (default 25.0 points for skaters, 20.0 for goalies) - flags for review
        rejection_threshold: Rejection threshold (default 35.0 points for skaters, 30.0 for goalies) - rejects from upsert
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
        is_goalie = proj.get('is_goalie', False)
        
        # Goalies have different thresholds
        goalie_rejection = 30.0
        goalie_threshold = 20.0
        skater_rejection = rejection_threshold
        skater_threshold = threshold
        
        effective_rejection = goalie_rejection if is_goalie else skater_rejection
        effective_threshold = goalie_threshold if is_goalie else skater_threshold
        
        if points_val > effective_rejection:
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
    except Exception:
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
    
    # Get player season stats (use official nhl_* columns)
    season_stats = db.select(
        "player_season_stats",
        select="nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_blocks,games_played",
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
        goals = int(stats.get("nhl_goals", 0))
        assists = int(stats.get("nhl_assists", 0))
        sog = int(stats.get("nhl_shots_on_goal", 0))
        blocks = int(stats.get("nhl_blocks", 0))
    
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
        logger.warning(f"⚠️  Warning: Could not save rejected projections log: {e}")
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
    
    # Complete column list from player_projected_stats schema.
    # Split into NOT NULL (default 0) vs nullable (default None) to avoid constraint violations.
    not_null_columns = {
        # These are NOT NULL DEFAULT 0 in the DB — must send 0, never None
        'player_id', 'game_id', 'projection_date', 'season',
        'projected_goals', 'projected_assists', 'projected_sog', 'projected_blocks', 'projected_xg',
        'total_projected_points', 'is_goalie',
    }
    nullable_columns = {
        # Skater stat columns (DEFAULT 0 but nullable)
        'projected_ppp', 'projected_shp', 'projected_hits', 'projected_pim',
        # Model transparency
        'base_ppg', 'shrinkage_weight', 'finishing_multiplier', 'opponent_adjustment',
        'b2b_penalty', 'home_away_adjustment',
        'calculation_method', 'confidence_score',
        # Goalie columns (DEFAULT 0 but nullable)
        'projected_wins', 'projected_saves', 'projected_shutouts',
        'projected_goals_against', 'projected_gaa', 'projected_save_pct',
        'projected_gp', 'starter_confirmed',
        # Value metrics
        'projected_vopa',
        # Monte Carlo uncertainty (Citrus 3.1)
        'projection_mean', 'projection_std_dev',
        'projection_ci_lower', 'projection_ci_upper',
        'projection_ci_50_lower', 'projection_ci_50_upper',
        'projection_median', 'projection_skewness',
        'upside_probability', 'floor_probability', 'dynamic_confidence',
        'likely_low', 'likely_high', 'confidence_label',
    }
    all_valid_columns = not_null_columns | nullable_columns

    # Map calc engine keys → DB column names where they differ
    key_remap = {
        'total_vopa': 'projected_vopa',
    }

    # Process in batches
    for i in range(0, len(projections), batch_size):
        batch = projections[i:i+batch_size]

        # Build uniform rows: every row has identical keys (PostgREST requirement).
        # NOT NULL columns get 0/False defaults; nullable columns get None.
        filtered_batch = []
        for proj in batch:
            # Apply key remapping first
            remapped = {}
            for k, v in proj.items():
                db_key = key_remap.get(k, k)
                if db_key in all_valid_columns:
                    remapped[db_key] = v

            # Build uniform row with correct defaults
            row = {}
            for col in all_valid_columns:
                if col in remapped:
                    row[col] = remapped[col]
                elif col == 'is_goalie':
                    row[col] = False
                elif col in not_null_columns:
                    row[col] = 0
                else:
                    row[col] = None
            filtered_batch.append(row)
        
        try:
            db.upsert(
                "player_projected_stats",
                filtered_batch,
                on_conflict="player_id,game_id,projection_date"
            )
            total_upserted += len(filtered_batch)
        except Exception as e:
            logger.error(f"⚠️  Error upserting batch {i//batch_size + 1}: {e}")
            # Try individual upserts for this batch
            for proj in filtered_batch:
                try:
                    db.upsert(
                        "player_projected_stats",
                        proj,
                        on_conflict="player_id,game_id,projection_date"
                    )
                    total_upserted += 1
                except Exception as err:
                    logger.error(f"⚠️  Error upserting player {proj.get('player_id')}, game {proj.get('game_id')}: {err}")
    
    return total_upserted


def populate_gp_last_10_metric(db: SupabaseRest, season: int) -> int:
    """
    Pre-calculate GP_Last_10 metric for all players.
    
    This should be called before calculating projections to enable
    fast "Likely-to-Play" filtering in VOPA calculations.
    """
    try:
        # The module lives in scripts/utilities/ — add to path if needed
        import importlib
        scripts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts", "utilities")
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        from populate_gp_last_10_metric import populate_gp_last_10_for_all_players
        return populate_gp_last_10_for_all_players(db, season)
    except ImportError:
        logger.warning("⚠️  populate_gp_last_10_metric.py not found, skipping GP_Last_10")
        return 0
    except Exception as e:
        logger.error(f"⚠️  Warning: Error calculating GP_Last_10: {e}")
        return 0


def main():
    parser = argparse.ArgumentParser(
        description="Calculate daily projections for all active NHL players with parallel processing"
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
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force recalculation of all projections (ignore existing). Use after schema changes."
    )
    parser.add_argument(
        "--date-range",
        nargs=2,
        metavar=("START", "END"),
        help="Project for a range of dates (YYYY-MM-DD YYYY-MM-DD). Overrides --date."
    )

    args = parser.parse_args()

    # Parse target dates (supports single date or date range)
    if args.date_range:
        try:
            range_start = datetime.strptime(args.date_range[0], "%Y-%m-%d").date()
            range_end = datetime.strptime(args.date_range[1], "%Y-%m-%d").date()
            if range_end < range_start:
                logger.error(f"❌ Invalid date range: {range_start} to {range_end} (end before start)")
                sys.exit(1)
            target_dates = []
            current = range_start
            while current <= range_end:
                target_dates.append(current)
                current += timedelta(days=1)
            logger.info(f"📅 Date range mode: {range_start} to {range_end} ({len(target_dates)} days)")
        except ValueError:
            logger.error(f"❌ Invalid date format in --date-range. Use YYYY-MM-DD YYYY-MM-DD")
            sys.exit(1)
    elif args.date:
        try:
            target_dates = [datetime.strptime(args.date, "%Y-%m-%d").date()]
        except ValueError:
            logger.error(f"❌ Invalid date format: {args.date}. Use YYYY-MM-DD")
            sys.exit(1)
    else:
        target_dates = [date.today()]

    # For backward compatibility, set target_date to first date
    target_date = target_dates[0]
    
    # Determine worker count
    if args.workers:
        max_workers = max(1, min(args.workers, 16))
    else:
        # Default: 1x-2x CPU cores, min 4, max 16
        cpu_count = multiprocessing.cpu_count()
        max_workers = max(4, min(cpu_count * 2, 16))
    
    logger.info("")
    logger.info("=" * 60)
    logger.info("  CITRUS PROJECTIONS 3.0")
    logger.info("=" * 60)
    if len(target_dates) > 1:
        logger.info(f"  Dates: {target_dates[0]} to {target_dates[-1]} ({len(target_dates)} days)")
    else:
        logger.info(f"  Date: {target_date}")
    logger.info(f"  Season: {args.season}  |  Workers: {max_workers}")
    if args.force:
        logger.info("  Mode: --force (recalculating ALL projections)")
    logger.info("=" * 60)
    logger.info("")
    
    # Initialize database connection (main process)
    db = supabase_client()

    # Step 0: Sync rosters from NHL API (team changes, new players, multi-position)
    logger.info("[0/7] Syncing rosters from NHL API...")
    try:
        scripts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts", "utilities")
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        from sync_rosters import sync_rosters
        roster_sync = sync_rosters(db, args.season)
        logger.info(f"       {roster_sync.get('team_updates', 0)} team moves, {roster_sync.get('new_players', 0)} new players, {roster_sync.get('multi_position', 0)} multi-pos")
    except ImportError:
        logger.warning("       sync_rosters.py not found, skipping roster sync")
    except Exception as e:
        logger.warning(f"       Roster sync error (non-fatal): {e}")
    logger.info("")

    # Step 1: Pre-calculate GP_Last_10 metric
    logger.info("[1/7] Updating GP_Last_10 metric...")
    gp_updated = populate_gp_last_10_metric(db, args.season)
    if gp_updated > 0:
        logger.info(f"       Updated {gp_updated} players")

    # Loop over all target dates (single date or --date-range)
    for date_idx, target_date in enumerate(target_dates):
        if len(target_dates) > 1:
            logger.info("")
            logger.info(f"{'─' * 60}")
            logger.info(f"  DATE {date_idx + 1}/{len(target_dates)}: {target_date}")
            logger.info(f"{'─' * 60}")

        # Step 2: Get ALL active players with games on this date (league-agnostic)
        logger.info("[2/6] Finding active players with games on {target_date}...".format(target_date=target_date))
        sys.stdout.flush()
        active_players = get_active_players_with_games(db, target_date, args.season)

        if not active_players:
            logger.warning(f"⚠️  No active players found with games on {target_date}. Is there an NHL game scheduled?")
            continue

        logger.info(f"       {len(active_players)} active players across teams playing on {target_date}")
        sys.stdout.flush()

        # Step 3: REMOVED — League scoring settings no longer loaded in pipeline.
        # Projections use DEFAULT_FALLBACK_SCORING universally.
        # League-specific scoring is applied dynamically on the frontend.

        # Step 3: Check existing projections (unless --force)
        existing_projections = set()
        if args.force:
            logger.info("[3/6] --force set, recalculating ALL projections")
        else:
            logger.info("[3/6] Checking for existing projections...")
            offset = 0
            while True:
                batch = db.select(
                    "player_projected_stats",
                    select="player_id,game_id",
                    filters=[("projection_date", "eq", target_date.isoformat())],
                    limit=1000,
                    offset=offset
                )
                if not batch:
                    break
                for proj in batch:
                    existing_projections.add((int(proj.get("player_id", 0)), int(proj.get("game_id", 0))))
                if len(batch) < 1000:
                    break
                offset += 1000
            if existing_projections:
                logger.info(f"       {len(existing_projections)} already exist, will skip")

        # Prepare worker arguments — universal scoring for all players
        worker_args = []
        skipped = 0

        for player_id, game_id in active_players:
            # Skip if projection already exists (unless --force)
            if not args.force and (player_id, game_id) in existing_projections:
                skipped += 1
                continue
            worker_args.append((player_id, game_id, target_date, args.season, DEFAULT_FALLBACK_SCORING))

        logger.info(f"       {len(worker_args)} to calculate, {skipped} skipped")

        if len(worker_args) == 0:
            logger.info(f"✅ All projections for {target_date} already exist! Nothing to calculate.")
            continue
        logger.info("")

        # Step 4: Calculate projections
        logger.info("[4/6] Calculating projections...")
        total = len(worker_args)
        start_time = time.time()
        results = []
        errors_shown = 0
        MAX_INLINE_ERRORS = 5  # Only show first N errors during processing

        def _progress_bar(done, total_count, elapsed_s):
            """Build a clean visual progress bar string."""
            pct = (done / total_count) * 100 if total_count else 0
            rate = done / elapsed_s if elapsed_s > 0 else 0
            eta = (total_count - done) / rate if rate > 0 else 0
            filled = int(pct / 5)  # 20-char bar
            bar = "█" * filled + "░" * (20 - filled)
            return f"   [{bar}] {pct:5.1f}%  {done}/{total_count}  ({rate:.1f}/s, ~{eta:.0f}s left)"

        # OPTIMIZATION: Use single-threaded mode for small batches to avoid Windows multiprocessing issues
        if total < 100:
            logger.info(f"   Processing {total} players (single-threaded)...")
            sys.stdout.flush()
            try:
                last_progress_time = time.time()

                for idx, worker_task in enumerate(worker_args, 1):
                    if _shutdown_requested:
                        logger.info(f"\n[SHUTDOWN] Stopped after {idx - 1}/{total} players.")
                        sys.exit(0)

                    current_time = time.time()
                    # Show progress every 5 seconds or on first/last player
                    if (current_time - last_progress_time >= 5.0) or (idx == 1) or (idx == total):
                        elapsed = current_time - start_time
                        logger.info(_progress_bar(idx, total, elapsed))
                        last_progress_time = current_time

                    result = calculate_player_projection_worker(worker_task)
                    results.append(result)

                    if not result.get('success') and errors_shown < MAX_INLINE_ERRORS:
                        errors_shown += 1
                        logger.error(f"      Player {result.get('player_id')} failed: {result.get('error', 'Unknown')[:80]}")
            except Exception as e:
                logger.error(f"❌ Fatal error: {e}")
                import traceback
                traceback.print_exc()
                sys.exit(1)
        else:
            logger.info(f"   Processing {total} players across {max_workers} workers...")
            sys.stdout.flush()
            try:
                with multiprocessing.Pool(max_workers) as pool:
                    results = []
                    completed = 0
                    last_progress_time = time.time()

                    for result in pool.imap_unordered(
                        calculate_player_projection_worker,
                        worker_args,
                        chunksize=args.chunksize
                    ):
                        if _shutdown_requested:
                            pool.terminate()
                            logger.info(f"\n[SHUTDOWN] Stopped after {completed}/{total} players.")
                            sys.exit(0)

                        results.append(result)
                        completed += 1

                        current_time = time.time()
                        # Show progress every 5 seconds (more frequent than before)
                        if current_time - last_progress_time >= 5.0:
                            elapsed = current_time - start_time
                            logger.info(_progress_bar(completed, total, elapsed))
                            sys.stdout.flush()
                            last_progress_time = current_time

                        if not result.get('success') and errors_shown < MAX_INLINE_ERRORS:
                            errors_shown += 1
                            logger.error(f"      Player {result.get('player_id')} failed: {result.get('error', 'Unknown')[:80]}")

                    # Final bar
                    elapsed = time.time() - start_time
                    logger.info(_progress_bar(total, total, elapsed))
            except Exception as e:
                logger.error(f"❌ Fatal error: {e}")
                import traceback
                traceback.print_exc()
                sys.exit(1)

        elapsed_time = time.time() - start_time
        logger.info(f"   Completed in {elapsed_time:.2f} seconds")
        logger.info("")

        # Tally results
        successes = [r for r in results if r.get('success')]
        failures = [r for r in results if not r.get('success')]
        projections = [r['projection'] for r in successes if 'projection' in r]

        logger.info(f"       {len(successes)} succeeded, {len(failures)} failed")

        if failures and len(failures) <= 20:
            for fail in failures[:10]:
                logger.warning(f"       Player {fail.get('player_id')}: {fail.get('error', 'Unknown')[:80]}")
            if len(failures) > 10:
                logger.info(f"       ... and {len(failures) - 10} more")
        logger.info("")

        # Step 6: Quality Gate - Outlier Detection
        valid_projections = projections
        rejected_projections = []
        rejected_log_path = ""
        review_projections = []
        stats = {}

        if not args.skip_outlier_detection and projections:
            logger.info("[5/6] Quality gate — outlier detection...")
            rejected, review, valid, stats = detect_outliers(
                projections,
                threshold=args.threshold,
                rejection_threshold=args.rejection_threshold,
                z_score_threshold=args.z_score_threshold
            )

            rejected_projections = rejected
            review_projections = review
            valid_projections = valid

            logger.info(f"       {stats.get('valid', 0)} valid, {stats.get('review', 0)} review, {stats.get('rejected', 0)} rejected")
            logger.info(f"       Points: mean={stats.get('mean_points', 0):.2f}, std={stats.get('stdev_points', 0):.2f}, "
                         f"range=[{stats.get('min_points', 0):.2f}, {stats.get('max_points', 0):.2f}]")

            if rejected_projections:
                logger.error("❌ REJECTED PROJECTIONS (Impossible - > {:.1f} pts):".format(args.rejection_threshold))
                logger.info("-" * 80)
                for rejected in rejected_projections[:10]:  # Show first 10
                    reason = rejected.get('rejection_reason', 'unknown')
                    outlier_reason = rejected.get('outlier_reason', 'unknown')
                    z_score = rejected.get('z_score', 'N/A')
                    logger.info(f"   Player {rejected.get('player_id')}, Game {rejected.get('game_id')}: " f"{rejected.get('total_projected_points', 0):.3f} pts " f"(Reason: {reason}, Outlier: {outlier_reason}, Z-score: {z_score})")
                if len(rejected_projections) > 10:
                    logger.info(f"   ... and {len(rejected_projections) - 10} more rejected")
                logger.info("-" * 80)
                logger.info("")

                # Generate traceability logs for rejected projections
                if args.reject_outliers:
                    logger.info("📋 Generating traceability logs for rejected projections...")
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
                        logger.info(f"   ✅ Saved traceability log to: {rejected_log_path}")
                    logger.info("")

            if review_projections:
                review_pts = [r.get('total_projected_points', 0) for r in review_projections]
                review_min = min(review_pts)
                review_max = max(review_pts)
                logger.warning("⚠️  REVIEW PROJECTIONS (Unusually High - {:.1f} to {:.1f} pts):".format( review_min, review_max ))
                logger.info("-" * 80)
                for review in review_projections[:10]:  # Show first 10
                    reason = review.get('outlier_reason', 'unknown')
                    z_score = review.get('z_score', 'N/A')
                    logger.info(f"   Player {review.get('player_id')}, Game {review.get('game_id')}: " f"{review.get('total_projected_points', 0):.3f} pts " f"(Reason: {reason}, Z-score: {z_score})")
                if len(review_projections) > 10:
                    logger.info(f"   ... and {len(review_projections) - 10} more for review")
                logger.info("-" * 80)
                logger.info("")

        # Step 7: Batch Upsert (only valid projections if reject_outliers is enabled)
        if args.reject_outliers:
            # Only upsert valid + review projections, skip rejected
            projections_to_upsert = valid_projections + review_projections
        else:
            # Upsert all projections (including outliers, for manual review)
            projections_to_upsert = projections

        upserted = 0
        if projections_to_upsert:
            logger.info(f"[6/6] Saving {len(projections_to_upsert)} projections to database...")
            if args.reject_outliers and rejected_projections:
                logger.info(f"       (skipping {len(rejected_projections)} rejected)")
            upsert_start = time.time()
            upserted = batch_upsert_projections(db, projections_to_upsert)
            upsert_elapsed = time.time() - upsert_start
            logger.info(f"       Done — {upserted} rows in {upsert_elapsed:.1f}s")
            logger.info("")

        # Per-date Summary
        logger.info("")
        logger.info("=" * 60)
        logger.info(f"  DONE — {target_date}")
        logger.info("=" * 60)
        logger.info(f"  Date:       {target_date}")
        logger.info(f"  Time:       {elapsed_time:.1f}s")
        logger.info(f"  Players:    {len(active_players)} (teams with games)")
        logger.info(f"  Calculated: {len(successes)} OK, {len(failures)} failed")
        if not args.skip_outlier_detection and projections:
            logger.info(f"  Quality:    {len(valid_projections)} valid, {len(review_projections)} review, {len(rejected_projections)} rejected")
        logger.info(f"  Upserted:   {upserted if projections_to_upsert else 0} rows to player_projected_stats")
        if args.reject_outliers and rejected_projections and rejected_log_path:
            logger.info(f"  Log:        {rejected_log_path}")
        logger.info("=" * 60)

    # End of date loop
    logger.info("")
    logger.info("Projections are live! Refresh your browser to see updated data.")


if __name__ == "__main__":
    # Clean, human-friendly log format (no module name noise)
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s  %(message)s',
        datefmt='%H:%M:%S'
    )
    # Suppress verbose per-player logs from the calculation engine
    logging.getLogger("calculate_daily_projections").setLevel(logging.WARNING)
    main()
