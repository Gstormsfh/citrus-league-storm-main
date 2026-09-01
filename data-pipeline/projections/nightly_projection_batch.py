#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Cron entrypoint for nightly projection refresh
# Last active: 2026-03-03
# Invoked:     .github/workflows/main.yml (cron 0 7 * * * — daily 7am UTC / 2am ET)
# Reads:       raw_shots, player_season_stats, player_talent_metrics
# Writes:      player_projected_stats, projection_cache,
#              player_ros_projections (through the rebuild_ros_projections RPC)
# ────────────────────────────────────────────────────────────
"""
CITRUS NIGHTLY PROJECTION BATCH
================================
Yahoo/Sleeper-grade projection system

Runs at 2 AM ET after all games complete
Calculates projections for ALL players, ALL remaining games
Target runtime: 15-30 minutes for ~15,000 projections

Usage:
    python scripts/nightly_projection_batch.py [--season 2025] [--workers 16]

Architecture:
    Phase 1: Data Loading (single queries, cached in memory)
    Phase 2: Matchup Difficulty Calculation (32 teams)
    Phase 3: Per-Game Projections (parallel processing)
    Phase 4: Bulk Upsert (batched writes)
    Phase 5: ROS Projections (SQL rebuild_ros_projections RPC — the same
             start-aware rebuild the 08:50 UTC pg_cron job runs)
    Phase 6: Matchup Difficulty Table Update
"""

import signal
import sys
import os
import argparse
import time
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Any, Tuple
from concurrent.futures import ProcessPoolExecutor, as_completed
from collections import defaultdict
import statistics
import logging

logger = logging.getLogger(__name__)

_shutdown_requested = False

def _handle_shutdown(signum, frame):
    global _shutdown_requested
    _shutdown_requested = True
    logger.info(f"\n[SHUTDOWN] Signal {signum} received, finishing current operation...")

import threading
if threading.current_thread() is threading.main_thread():
    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except AttributeError:
            import io
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv
from data_pipeline.utils.supabase_rest import SupabaseRest

# Import core calculation functions
from calculate_daily_projections import (
    calculate_daily_projection,
    get_league_averages,
    DEFAULT_SEASON
)

load_dotenv()

# ============================================================================
# CONFIGURATION
# ============================================================================

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")

# Support both old and new service role key variable names
_raw_key = os.getenv("SUPABASE_Real_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if _raw_key and '(' in _raw_key and ')' in _raw_key:
    _start = _raw_key.index('(') + 1
    _end = _raw_key.rindex(')')
    SUPABASE_KEY = _raw_key[_start:_end]
else:
    SUPABASE_KEY = _raw_key

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

# Batch sizes for database operations
UPSERT_BATCH_SIZE = 500
FETCH_BATCH_SIZE = 1000
# DEFAULT_SEASON is imported from calculate_daily_projections (which now
# derives from today's date via season_config.current_season). The prior
# `DEFAULT_SEASON = 2025` redeclaration here shadowed the import and would
# have kept the projection pipeline pinned to season=2025 forever.

# Team ID to abbreviation mapping (NHL standard)
TEAM_ABBREV_MAP = {
    1: "NJD", 2: "NYI", 3: "NYR", 4: "PHI", 5: "PIT", 6: "BOS", 7: "BUF", 8: "MTL",
    9: "OTT", 10: "TOR", 12: "CAR", 13: "FLA", 14: "TBL", 15: "WSH", 16: "CHI",
    17: "DET", 18: "NSH", 19: "STL", 20: "CGY", 21: "COL", 22: "EDM", 23: "VAN",
    24: "ANA", 25: "DAL", 26: "LAK", 28: "SJS", 29: "CBJ", 30: "MIN", 52: "WPG",
    53: "UTA", 54: "VGK", 55: "SEA", 59: "UTA"
}


def get_db() -> SupabaseRest:
    """Get database client."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


# ============================================================================
# PHASE 1: DATA LOADING
# ============================================================================

def fetch_remaining_schedule(db: SupabaseRest, season: int) -> List[Dict]:
    """
    Fetch all remaining games for the season.
    
    Returns list of games with: game_id, game_date, home_team, away_team
    """
    today = date.today()
    all_games = []
    offset = 0
    
    logger.info(f"  Fetching schedule from {today} onwards...")
    
    while True:
        # Note: game_start_time may not exist in all schemas
        games = db.select(
            "nhl_games",
            select="game_id,game_date,home_team,away_team,season",
            filters=[
                ("game_date", "gte", today.isoformat()),
                ("season", "eq", season)
            ],
            order="game_date.asc",
            limit=FETCH_BATCH_SIZE,
            offset=offset
        )
        
        if not games:
            break
            
        all_games.extend(games)
        offset += FETCH_BATCH_SIZE
        
        if len(games) < FETCH_BATCH_SIZE:
            break
    
    logger.info(f"  Found {len(all_games)} remaining games")
    return all_games


def fetch_all_players(db: SupabaseRest, season: int) -> List[Dict]:
    """
    Fetch all active players with their stats.
    
    Returns list of players with: player_id, name, team_abbrev, position_code, stats
    """
    all_players = []
    offset = 0
    
    logger.info(f"  Fetching all players for season {season}...")
    
    while True:
        players = db.select(
            "player_directory",
            select="player_id,full_name,team_abbrev,position_code,season",
            filters=[("season", "eq", season)],
            limit=FETCH_BATCH_SIZE,
            offset=offset
        )
        
        if not players:
            break
            
        all_players.extend(players)
        offset += FETCH_BATCH_SIZE
        
        if len(players) < FETCH_BATCH_SIZE:
            break
    
    logger.info(f"  Found {len(all_players)} players")
    return all_players


def fetch_player_stats(db: SupabaseRest, season: int) -> Dict[int, Dict]:
    """
    Fetch all player season stats into a lookup dict.
    
    Returns: {player_id: stats_dict}
    """
    all_stats = {}
    offset = 0
    
    logger.info(f"  Fetching player stats...")
    
    while True:
        # Use official NHL.com column names from player_season_stats table
        stats = db.select(
            "player_season_stats",
            select="player_id,games_played,nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_blocks,nhl_hits,nhl_pim,nhl_ppp,nhl_shp",
            filters=[("season", "eq", season)],
            limit=FETCH_BATCH_SIZE,
            offset=offset
        )
        
        if not stats:
            break
            
        for s in stats:
            all_stats[s["player_id"]] = s
            
        offset += FETCH_BATCH_SIZE
        
        if len(stats) < FETCH_BATCH_SIZE:
            break
    
    logger.info(f"  Loaded stats for {len(all_stats)} players")
    return all_stats


def fetch_team_defense_stats(db: SupabaseRest, season: int) -> Dict[str, Dict]:
    """
    Fetch team defensive statistics for matchup difficulty calculation.
    
    Note: If team_stats table doesn't exist, we'll calculate from game data
    or use league-average defaults.
    
    Returns: {team_abbrev: defense_stats}
    """
    logger.info(f"  Fetching team defense stats...")
    
    try:
        # First try team_stats table (columns are already averages)
        teams = db.select(
            "team_stats",
            select="team_abbrev,goals_against_avg,shots_against_avg,games_played",
            filters=[("season", "eq", season)],
            limit=50
        )
        
        if teams:
            team_stats = {}
            for t in teams:
                gp = t.get("games_played", 1)
                team_stats[t["team_abbrev"]] = {
                    "goals_against_avg": t.get("goals_against_avg", 3.0),
                    "shots_against_avg": t.get("shots_against_avg", 30.0),
                    "xg_against_avg": 2.8,  # Not available in table, use default
                    "games_played": gp
                }
            logger.info(f"  ✅ Loaded defense stats for {len(team_stats)} teams")
            return team_stats
    except Exception as e:
        logger.warning(f"  Warning: team_stats table not available: {e}")
    
    # Fallback: Use default league-average values for all teams
    # This means matchup difficulty will be neutral (1.0) for all matchups
    logger.info("  Using default defense stats (neutral matchup difficulty)")
    
    # Get list of teams from nhl_teams table
    try:
        nhl_teams = db.select("nhl_teams", select="team_abbrev", limit=50)
        team_stats = {}
        for t in nhl_teams:
            abbrev = t.get("team_abbrev")
            if abbrev:
                team_stats[abbrev] = {
                    "goals_against_avg": 3.0,  # League average
                    "shots_against_avg": 30.0,
                    "xg_against_avg": 2.8,
                    "games_played": 41  # Half season
                }
        if team_stats:
            logger.info(f"  Created default stats for {len(team_stats)} teams")
            return team_stats
    except Exception:
        pass
    
    # Final fallback: hardcoded team list
    logger.info("  Using hardcoded team list with defaults")
    team_abbrevs = list(TEAM_ABBREV_MAP.values())
    return {abbrev: {
        "goals_against_avg": 3.0,
        "shots_against_avg": 30.0,
        "xg_against_avg": 2.8,
        "games_played": 41
    } for abbrev in team_abbrevs}


def fetch_injury_report(db: SupabaseRest) -> Dict[int, str]:
    """
    Fetch current injury statuses.
    
    Returns: {player_id: injury_status}
    """
    logger.info(f"  Fetching injury report...")
    
    try:
        injuries = db.select(
            "player_injuries",
            select="player_id,status",
            limit=500
        )
        
        injury_map = {}
        if injuries:
            for inj in injuries:
                injury_map[inj["player_id"]] = inj.get("status", "healthy")
        
        logger.info(f"  Found {len(injury_map)} injury records")
        return injury_map
    except Exception as e:
        logger.warning(f"  Warning: Could not fetch injuries: {e}")
        logger.info(f"  Assuming all players healthy")
        return {}


def fetch_scoring_settings(db: SupabaseRest) -> Dict[str, Any]:
    """
    Fetch default scoring settings from first league.
    """
    leagues = db.select("leagues", select="id,settings", limit=1)
    
    if leagues and leagues[0].get("settings"):
        settings = leagues[0]["settings"]
        if isinstance(settings, dict) and "scoring" in settings:
            return settings["scoring"]
    
    # Default scoring settings
    # INDUSTRY-STANDARD DEFAULTS (2026-09-01): Yahoo-aligned; SHP/hits/PIM
    # opt-in at 0. (This legacy fallback kept its own key names.)
    return {
        "goals": 6.0,
        "assists": 4.0,
        "shots_on_goal": 0.9,
        "blocked_shots": 1.0,
        "hits": 0.0,
        "pim": 0.0,
        "powerplay_points": 2.0,
        "shorthanded_points": 0.0,
        "wins": 5.0,
        "saves": 0.6,
        "goals_against": -3.0,
        "shutouts": 5.0
    }


# ============================================================================
# PHASE 2: MATCHUP DIFFICULTY CALCULATION
# ============================================================================

def calculate_matchup_difficulty(team_defense: Dict[str, Dict]) -> Dict[Tuple[str, str], float]:
    """
    Calculate matchup difficulty ratings between all team pairs.
    
    Returns: {(player_team, opponent_team): difficulty_rating}
    
    Rating scale:
    - 0.8 = Easy matchup (weak defense, favorable for fantasy)
    - 1.0 = Average matchup
    - 1.2 = Hard matchup (strong defense, unfavorable for fantasy)
    """
    if not team_defense:
        return {}
    
    # Calculate league averages
    all_ga = [t["goals_against_avg"] for t in team_defense.values()]
    league_avg_ga = statistics.mean(all_ga) if all_ga else 3.0
    
    matchup_ratings = {}
    
    for opp_team, opp_stats in team_defense.items():
        opp_ga = opp_stats.get("goals_against_avg", league_avg_ga)
        
        # Difficulty = how much harder/easier it is to score against this team
        # Lower GA = harder to score = higher difficulty
        if league_avg_ga > 0:
            difficulty = league_avg_ga / max(opp_ga, 0.1)
        else:
            difficulty = 1.0
        
        # Clamp to 0.8 - 1.2 range
        difficulty = max(0.8, min(1.2, difficulty))
        
        # Store for all teams playing against this opponent
        for player_team in team_defense.keys():
            if player_team != opp_team:
                matchup_ratings[(player_team, opp_team)] = round(difficulty, 2)
    
    return matchup_ratings


# ============================================================================
# PHASE 3: PROJECTION CALCULATION (WORKER)
# ============================================================================

def calculate_projection_worker(args: Tuple) -> Optional[Dict]:
    """
    Worker function for parallel projection calculation.
    
    Args is a tuple of: (player_id, game_id, game_date_str, season, scoring_settings, game_info)
    
    Returns projection dict or None on error.
    """
    player_id, game_id, game_date_str, season, scoring_settings, game_info = args
    
    try:
        db = get_db()
        game_date = date.fromisoformat(game_date_str)
        
        # Calculate projection using existing core function
        projection = calculate_daily_projection(
            db, player_id, game_id, game_date, season, scoring_settings
        )
        
        if not projection:
            return None
        
        # Add game context
        projection["game_id"] = game_id
        projection["projection_date"] = game_date_str
        projection["opponent_team_id"] = game_info.get("opponent_team_id")
        projection["opponent_abbrev"] = game_info.get("opponent_abbrev", "")
        projection["is_home_game"] = game_info.get("is_home_game", False)
        projection["game_start_time"] = game_info.get("game_start_time")
        projection["matchup_difficulty"] = game_info.get("matchup_difficulty", 1.0)
        
        return projection
        
    except Exception as e:
        # Don't print every error - too noisy for batch processing
        return None


# ============================================================================
# PHASE 4: BULK UPSERT
# ============================================================================

def bulk_upsert_projections(db: SupabaseRest, projections: List[Dict]) -> int:
    """
    Bulk upsert projections to player_projected_stats table.
    
    Returns number of projections upserted.
    """
    if not projections:
        return 0
    
    total_upserted = 0
    
    # Define valid columns for the table
    valid_columns = {
        'player_id', 'game_id', 'projection_date', 'season',
        'projected_goals', 'projected_assists', 'projected_sog', 'projected_blocks',
        'projected_xg', 'projected_ppp', 'projected_shp', 'projected_hits', 'projected_pim',
        'total_projected_points', 'base_ppg', 'shrinkage_weight', 'finishing_multiplier',
        'opponent_adjustment', 'b2b_penalty', 'home_away_adjustment', 'calculation_method',
        'confidence_score', 'opponent_team_id', 'opponent_abbrev', 'is_home_game',
        'matchup_difficulty', 'injury_status', 'game_start_time',
        # Goalie columns
        'projected_wins', 'projected_saves', 'projected_shutouts', 'projected_goals_against',
        'projected_gaa', 'projected_save_pct', 'projected_gp', 'starter_confirmed', 'is_goalie'
    }
    
    # Default values for columns with NOT NULL constraints (use 0 instead of None)
    column_defaults = {
        'projected_goals': 0.0,
        'projected_assists': 0.0,
        'projected_sog': 0.0,
        'projected_blocks': 0.0,
        'projected_xg': 0.0,
        'projected_ppp': 0.0,
        'projected_shp': 0.0,
        'projected_hits': 0.0,
        'projected_pim': 0.0,
        'total_projected_points': 0.0,
        'is_goalie': False,
        'season': DEFAULT_SEASON
    }
    
    total_batches = (len(projections) + UPSERT_BATCH_SIZE - 1) // UPSERT_BATCH_SIZE
    
    for batch_num, i in enumerate(range(0, len(projections), UPSERT_BATCH_SIZE), 1):
        batch = projections[i:i + UPSERT_BATCH_SIZE]
        
        # CRITICAL: Ensure ALL records have ALL valid columns (Supabase requirement)
        # Set missing columns to sensible defaults (NOT NULL columns get 0, others get None)
        filtered_batch = []
        for proj in batch:
            # Start with defaults for NOT NULL columns, None for others
            normalized = {col: column_defaults.get(col, None) for col in valid_columns}
            # Overwrite with actual values from projection
            for k, v in proj.items():
                if k in valid_columns:
                    normalized[k] = v
            
            # Only include if has required keys
            if normalized.get("player_id") and normalized.get("game_id"):
                filtered_batch.append(normalized)
        
        if not filtered_batch:
            continue
        
        # Progress tracking every 10 batches
        if batch_num % 10 == 0 or batch_num == total_batches:
            progress_pct = (batch_num / total_batches) * 100
            logger.info(f"  [{progress_pct:.0f}%] Batch {batch_num}/{total_batches} | {total_upserted} upserted")
        
        try:
            db.upsert(
                "player_projected_stats",
                filtered_batch,
                on_conflict="player_id,game_id,projection_date"
            )
            total_upserted += len(filtered_batch)
        except Exception as e:
            logger.error(f"  ❌ Batch {batch_num} failed: {e}")
            # Try individual upserts for failed batch
            for proj in filtered_batch:
                try:
                    db.upsert("player_projected_stats", proj, on_conflict="player_id,game_id,projection_date")
                    total_upserted += 1
                except Exception:
                    pass
    
    return total_upserted


# ============================================================================
# PHASE 5: ROS PROJECTIONS
# ============================================================================

# SQL: public.rebuild_ros_projections(p_season integer)
#   RETURNS TABLE(rows_written int, skaters int, goalies int, target_games int)
# Defined in supabase/migrations/20260820151500_rebuild_ros_projections_directory_filter.sql
# (and re-defined GA-aware by the 2026-09-01 industry-standard scoring migration).
ROS_REBUILD_RPC = "rebuild_ros_projections"
ROS_REBUILD_COUNT_KEYS = ("rows_written", "skaters", "goalies", "target_games")


def rebuild_ros_projections(db: SupabaseRest, season: int) -> Dict[str, int]:
    """
    Rebuild player_ros_projections through the SQL RPC, the writer of record.

    Until 2026-09-01 this phase summed the batch's own per-TEAM-game rows into
    rest-of-season rows and upserted them. Each per-game goalie row is an "if
    he starts" projection, so a goalie got games_remaining = every team game
    (~82) with W/SV/SO summed over all of them — a 55-start goalie was written
    as an ~82-start goalie, about 1.5x inflated — and projected_ga_ros was
    never written at all. The 08:50 UTC pg_cron job runs this same RPC
    (start-aware through project_ros.exp_starts, GA-aware) and overwrote those
    rows every day, which left the table wrong from this run (~07:00 UTC)
    until 08:50 UTC: every draft / autopick / free-agent view in that window
    ranked goalies against inflated totals. One writer now, in both places.

    Returns the RPC's counts (rows_written, skaters, goalies, target_games).
    Raises RuntimeError when the RPC fails, answers with an unexpected shape,
    or rebuilt the table to zero rows — the table is DELETE + INSERT, so a
    zero-row "success" is an empty player pool.
    """
    result = db.rpc(ROS_REBUILD_RPC, {"p_season": int(season)})

    # A RETURNS TABLE function comes back from PostgREST as a one-row JSON array.
    row = result[0] if isinstance(result, list) and result else result
    if not isinstance(row, dict) or "rows_written" not in row:
        raise RuntimeError(
            f"{ROS_REBUILD_RPC}({season}) returned an unexpected payload: {result!r}. "
            "Are the migrations applied?"
        )

    counts = {key: int(row.get(key) or 0) for key in ROS_REBUILD_COUNT_KEYS}
    if counts["rows_written"] <= 0:
        raise RuntimeError(
            f"{ROS_REBUILD_RPC}({season}) rebuilt player_ros_projections to 0 rows: {row!r}"
        )
    return counts


# ============================================================================
# PHASE 6: MATCHUP DIFFICULTY TABLE
# ============================================================================

def upsert_matchup_difficulty(db: SupabaseRest, team_defense: Dict[str, Dict], season: int) -> int:
    """
    Upsert matchup difficulty ratings to the table.
    """
    if not team_defense:
        return 0
    
    # Calculate league averages
    all_ga = [t["goals_against_avg"] for t in team_defense.values()]
    league_avg_ga = statistics.mean(all_ga) if all_ga else 3.0
    
    records = []
    positions = ["C", "LW", "RW", "D", "G"]
    
    # Get team ID lookup
    abbrev_to_id = {v: k for k, v in TEAM_ABBREV_MAP.items()}
    
    for opp_team, opp_stats in team_defense.items():
        opp_id = abbrev_to_id.get(opp_team)
        if not opp_id:
            continue
        
        opp_ga = opp_stats.get("goals_against_avg", league_avg_ga)
        base_difficulty = league_avg_ga / max(opp_ga, 0.1) if league_avg_ga > 0 else 1.0
        base_difficulty = max(0.8, min(1.2, base_difficulty))
        
        for player_team, player_id in abbrev_to_id.items():
            if player_team == opp_team:
                continue
            
            for pos in positions:
                # Slight position adjustments (defenders face harder matchups)
                pos_adjustment = 1.0
                if pos == "D":
                    pos_adjustment = 1.05
                elif pos == "G":
                    pos_adjustment = 0.95
                
                difficulty = round(base_difficulty * pos_adjustment, 2)
                difficulty = max(0.8, min(1.2, difficulty))
                
                records.append({
                    "team_id": player_id,
                    "opponent_team_id": opp_id,
                    "position": pos,
                    "difficulty_rating": difficulty,
                    "goals_against_avg": round(opp_ga, 2),
                    "shots_against_avg": round(opp_stats.get("shots_against_avg", 30), 2),
                    "season": season,
                    "games_analyzed": opp_stats.get("games_played", 0)
                })
    
    if not records:
        return 0
    
    total = 0
    for i in range(0, len(records), UPSERT_BATCH_SIZE):
        batch = records[i:i + UPSERT_BATCH_SIZE]
        try:
            db.upsert(
                "team_matchup_difficulty",
                batch,
                on_conflict="team_id,opponent_team_id,position,season"
            )
            total += len(batch)
        except Exception as e:
            logger.error(f"  Warning: Error upserting matchup difficulty: {e}")
    
    return total


# ============================================================================
# MAIN ORCHESTRATION
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Citrus Nightly Projection Batch")
    parser.add_argument("--season", type=int, default=DEFAULT_SEASON, help="Season year")
    parser.add_argument("--workers", type=int, default=16, help="Number of parallel workers")
    parser.add_argument("--dry-run", action="store_true", help="Calculate but don't save")
    args = parser.parse_args()
    
    start_time = time.time()
    
    logger.info("=" * 80)
    logger.info("CITRUS NIGHTLY PROJECTION BATCH")
    logger.info("Yahoo/Sleeper-Grade Projection System")
    logger.info("=" * 80)
    logger.info(f"Season: {args.season}")
    logger.info(f"Workers: {args.workers}")
    logger.info(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("")
    
    db = get_db()
    
    # ========================================================================
    # PHASE 1: DATA LOADING
    # ========================================================================
    logger.info("PHASE 1: Loading Data")
    logger.info("-" * 40)
    
    phase1_start = time.time()
    
    schedule = fetch_remaining_schedule(db, args.season)
    players = fetch_all_players(db, args.season)
    player_stats = fetch_player_stats(db, args.season)
    team_defense = fetch_team_defense_stats(db, args.season)
    injuries = fetch_injury_report(db)
    scoring_settings = fetch_scoring_settings(db)
    
    phase1_elapsed = time.time() - phase1_start
    logger.info(f"  Phase 1 complete in {phase1_elapsed:.1f}s")
    logger.info("")
    
    if not schedule:
        logger.info("No remaining games found. Exiting.")
        return
    
    # ========================================================================
    # PHASE 2: MATCHUP DIFFICULTY
    # ========================================================================
    logger.info("PHASE 2: Calculating Matchup Difficulty")
    logger.info("-" * 40)
    
    phase2_start = time.time()
    matchup_ratings = calculate_matchup_difficulty(team_defense)
    phase2_elapsed = time.time() - phase2_start
    
    logger.info(f"  Calculated {len(matchup_ratings)} matchup ratings")
    logger.info(f"  Phase 2 complete in {phase2_elapsed:.1f}s")
    logger.info("")
    
    # ========================================================================
    # PHASE 3: PROJECTION CALCULATION
    # ========================================================================
    logger.info("PHASE 3: Calculating Projections")
    logger.info("-" * 40)
    
    phase3_start = time.time()
    
    # Create player lookup by team
    players_by_team = defaultdict(list)
    for p in players:
        team = p.get("team_abbrev")
        if team:
            players_by_team[team].append(p)
    
    # Build worker tasks
    worker_tasks = []
    
    for game in schedule:
        game_id = game["game_id"]
        game_date = game["game_date"]
        home_team = game.get("home_team")
        away_team = game.get("away_team")
        game_time = game.get("game_start_time")  # May be None if column doesn't exist
        
        # Get players from both teams
        home_players = players_by_team.get(home_team, [])
        away_players = players_by_team.get(away_team, [])
        
        # Create tasks for home team players
        for p in home_players:
            player_id = p["player_id"]
            injury_status = injuries.get(player_id, "healthy")
            
            # Skip injured players
            if injury_status in ("IR", "OUT"):
                continue
            
            matchup_diff = matchup_ratings.get((home_team, away_team), 1.0)
            
            game_info = {
                "opponent_team_id": TEAM_ABBREV_MAP.get(away_team),
                "opponent_abbrev": away_team,
                "is_home_game": True,
                "game_start_time": game_time,
                "matchup_difficulty": matchup_diff,
                "injury_status": injury_status
            }
            
            worker_tasks.append((
                player_id, game_id, game_date, args.season, scoring_settings, game_info
            ))
        
        # Create tasks for away team players
        for p in away_players:
            player_id = p["player_id"]
            injury_status = injuries.get(player_id, "healthy")
            
            if injury_status in ("IR", "OUT"):
                continue
            
            matchup_diff = matchup_ratings.get((away_team, home_team), 1.0)
            
            game_info = {
                "opponent_team_id": TEAM_ABBREV_MAP.get(home_team),
                "opponent_abbrev": home_team,
                "is_home_game": False,
                "game_start_time": game_time,
                "matchup_difficulty": matchup_diff,
                "injury_status": injury_status
            }
            
            worker_tasks.append((
                player_id, game_id, game_date, args.season, scoring_settings, game_info
            ))
    
    logger.info(f"  Created {len(worker_tasks)} projection tasks")
    
    # Check for existing projections and skip them
    logger.info(f"  Checking for existing projections...")
    existing_projections = set()
    offset = 0
    while True:
        batch = db.select(
            "player_projected_stats",
            select="player_id,game_id",
            filters=[("season", "eq", args.season)],
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
    
    logger.info(f"  Found {len(existing_projections)} existing projections")
    
    # Filter out existing projections
    original_count = len(worker_tasks)
    worker_tasks = [
        task for task in worker_tasks
        if (task[0], task[1]) not in existing_projections
    ]
    skipped_count = original_count - len(worker_tasks)
    logger.info(f"  Filtered to {len(worker_tasks)} new projection tasks (skipped {skipped_count} existing)")
    
    if len(worker_tasks) == 0:
        logger.info(f"  ✅ All projections already exist! Nothing to calculate.")
        logger.info("")
        logger.info("=" * 80)
        logger.info("BATCH COMPLETE - NO NEW PROJECTIONS NEEDED")
        logger.info("=" * 80)
        return
    
    # Execute in parallel
    projections = []
    completed = 0
    last_progress_time = time.time()
    
    if len(worker_tasks) > 100:
        # Use multiprocessing for large batches
        logger.info(f"  Processing with {args.workers} workers...")
        logger.info(f"  Progress updates every 60 seconds...\n")
        
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(calculate_projection_worker, task): task for task in worker_tasks}

            for future in as_completed(futures):
                if _shutdown_requested:
                    executor.shutdown(wait=False, cancel_futures=True)
                    logger.info(f"\n[SHUTDOWN] Graceful shutdown complete. Calculated {completed}/{len(worker_tasks)} projections.")
                    sys.exit(0)

                try:
                    result = future.result(timeout=30)
                    if result:
                        projections.append(result)
                except Exception:
                    pass

                completed += 1

                # Progress update every 60 seconds
                current_time = time.time()
                if current_time - last_progress_time >= 60:
                    elapsed = current_time - phase3_start
                    progress = (completed * 100) / len(worker_tasks)
                    rate = completed / elapsed if elapsed > 0 else 0
                    eta_seconds = (len(worker_tasks) - completed) / rate if rate > 0 else 0
                    eta_minutes = eta_seconds / 60
                    logger.info(f"  ⏱️  [{int(elapsed)}s] {progress:.1f}% | {completed:,}/{len(worker_tasks):,} | Rate: {rate:.1f}/s | ETA: {eta_minutes:.1f} min")
                    last_progress_time = current_time
    else:
        # Sequential for small batches
        for task in worker_tasks:
            if _shutdown_requested:
                logger.info(f"\n[SHUTDOWN] Graceful shutdown complete. Calculated {completed}/{len(worker_tasks)} projections.")
                sys.exit(0)

            result = calculate_projection_worker(task)
            if result:
                projections.append(result)
            completed += 1
    
    phase3_elapsed = time.time() - phase3_start
    
    # Final 100% progress update
    rate = len(worker_tasks) / phase3_elapsed if phase3_elapsed > 0 else 0
    logger.info(f"  ✅ [100.0%] {len(worker_tasks):,}/{len(worker_tasks):,} | Rate: {rate:.1f}/s | Complete!")
    logger.info(f"  Calculated {len(projections)} projections")
    logger.info(f"  Phase 3 complete in {phase3_elapsed:.1f}s")
    logger.info("")
    
    if args.dry_run:
        logger.warning("DRY RUN - Skipping database writes")
        logger.info(f"Would have written {len(projections)} projections")
        return
    
    # ========================================================================
    # PHASE 4: BULK UPSERT
    # ========================================================================
    logger.info("PHASE 4: Upserting Projections")
    logger.info("-" * 40)
    
    phase4_start = time.time()
    upserted = bulk_upsert_projections(db, projections)
    phase4_elapsed = time.time() - phase4_start
    
    logger.info(f"  Upserted {upserted} projections")
    logger.info(f"  Phase 4 complete in {phase4_elapsed:.1f}s")
    logger.info("")
    
    # ========================================================================
    # PHASE 5: ROS PROJECTIONS
    # ========================================================================
    logger.info("PHASE 5: Rebuilding ROS Projections")
    logger.info("-" * 40)

    phase5_start = time.time()
    try:
        ros_counts = rebuild_ros_projections(db, args.season)
    except Exception as e:
        # Never swallow this: a failed rebuild must turn the workflow red.
        # The table keeps its last good rows (the rebuild is one transaction),
        # and the 08:50 UTC pg_cron job is the fallback writer.
        logger.error(f"  ❌ ROS rebuild failed: {e}", exc_info=True)
        logger.error(
            "  player_ros_projections was not rewritten by this run; "
            "exiting non-zero so the workflow surfaces it."
        )
        sys.exit(1)
    phase5_elapsed = time.time() - phase5_start

    logger.info(
        f"  Rebuilt {ros_counts['rows_written']} ROS projections "
        f"({ros_counts['skaters']} skaters / {ros_counts['goalies']} goalies, "
        f"{ros_counts['target_games']}-game season) via {ROS_REBUILD_RPC}"
    )
    logger.info(f"  Phase 5 complete in {phase5_elapsed:.1f}s")
    logger.info("")
    
    # ========================================================================
    # PHASE 6: MATCHUP DIFFICULTY TABLE
    # ========================================================================
    logger.info("PHASE 6: Updating Matchup Difficulty Table")
    logger.info("-" * 40)
    
    phase6_start = time.time()
    matchup_upserted = upsert_matchup_difficulty(db, team_defense, args.season)
    phase6_elapsed = time.time() - phase6_start
    
    logger.info(f"  Upserted {matchup_upserted} matchup difficulty records")
    logger.info(f"  Phase 6 complete in {phase6_elapsed:.1f}s")
    logger.info("")
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    total_elapsed = time.time() - start_time
    
    logger.info("=" * 80)
    logger.info("BATCH COMPLETE")
    logger.info("=" * 80)
    logger.info(f"Total Time: {total_elapsed:.1f}s ({total_elapsed/60:.1f} minutes)")
    logger.info(f"Projections: {upserted}")
    logger.info(f"ROS Projections: {ros_counts['rows_written']} (rebuilt via {ROS_REBUILD_RPC})")
    logger.info(f"Matchup Ratings: {matchup_upserted}")
    logger.info(f"Rate: {upserted / total_elapsed:.1f} projections/second")
    logger.info("=" * 80)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    main()

