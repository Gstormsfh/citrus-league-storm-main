#!/usr/bin/env python3
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
    Phase 5: ROS Aggregates (sum projections by player)
    Phase 6: Matchup Difficulty Table Update
"""

import sys
import os
import argparse
import time
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Any, Tuple
from concurrent.futures import ProcessPoolExecutor, as_completed
from collections import defaultdict
import statistics

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

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

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

# Team ID to abbreviation mapping (NHL standard)
TEAM_ABBREV_MAP = {
    1: "NJD", 2: "NYI", 3: "NYR", 4: "PHI", 5: "PIT", 6: "BOS", 7: "BUF", 8: "MTL",
    9: "OTT", 10: "TOR", 12: "CAR", 13: "FLA", 14: "TBL", 15: "WSH", 16: "CHI",
    17: "DET", 18: "NSH", 19: "STL", 20: "CGY", 21: "COL", 22: "EDM", 23: "VAN",
    24: "ANA", 25: "DAL", 26: "LAK", 28: "SJS", 29: "CBJ", 30: "MIN", 52: "WPG",
    53: "ARI", 54: "VGK", 55: "SEA", 59: "UTA"
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
    
    print(f"  Fetching schedule from {today} onwards...")
    
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
    
    print(f"  Found {len(all_games)} remaining games")
    return all_games


def fetch_all_players(db: SupabaseRest, season: int) -> List[Dict]:
    """
    Fetch all active players with their stats.
    
    Returns list of players with: player_id, name, team_abbrev, position_code, stats
    """
    all_players = []
    offset = 0
    
    print(f"  Fetching all players for season {season}...")
    
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
    
    print(f"  Found {len(all_players)} players")
    return all_players


def fetch_player_stats(db: SupabaseRest, season: int) -> Dict[int, Dict]:
    """
    Fetch all player season stats into a lookup dict.
    
    Returns: {player_id: stats_dict}
    """
    all_stats = {}
    offset = 0
    
    print(f"  Fetching player stats...")
    
    while True:
        # Use actual column names from player_season_stats table
        stats = db.select(
            "player_season_stats",
            select="player_id,games_played,goals,primary_assists,secondary_assists,shots_on_goal,blocks,hits,pim,ppp,shp",
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
    
    print(f"  Loaded stats for {len(all_stats)} players")
    return all_stats


def fetch_team_defense_stats(db: SupabaseRest, season: int) -> Dict[str, Dict]:
    """
    Fetch team defensive statistics for matchup difficulty calculation.
    
    Note: If team_stats table doesn't exist, we'll calculate from game data
    or use league-average defaults.
    
    Returns: {team_abbrev: defense_stats}
    """
    print(f"  Fetching team defense stats...")
    
    try:
        # First try team_stats table
        teams = db.select(
            "team_stats",
            select="team_abbrev,goals_against,shots_against,xg_against,games_played",
            filters=[("season", "eq", season)],
            limit=50
        )
        
        if teams:
            team_stats = {}
            for t in teams:
                gp = max(t.get("games_played", 1), 1)
                team_stats[t["team_abbrev"]] = {
                    "goals_against_avg": t.get("goals_against", 0) / gp,
                    "shots_against_avg": t.get("shots_against", 0) / gp,
                    "xg_against_avg": t.get("xg_against", 0) / gp,
                    "games_played": gp
                }
            print(f"  Loaded defense stats for {len(team_stats)} teams")
            return team_stats
    except Exception as e:
        print(f"  Warning: team_stats table not available: {e}")
    
    # Fallback: Use default league-average values for all teams
    # This means matchup difficulty will be neutral (1.0) for all matchups
    print("  Using default defense stats (neutral matchup difficulty)")
    
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
            print(f"  Created default stats for {len(team_stats)} teams")
            return team_stats
    except Exception:
        pass
    
    # Final fallback: hardcoded team list
    print("  Using hardcoded team list with defaults")
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
    print(f"  Fetching injury report...")
    
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
        
        print(f"  Found {len(injury_map)} injury records")
        return injury_map
    except Exception as e:
        print(f"  Warning: Could not fetch injuries: {e}")
        print(f"  Assuming all players healthy")
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
    return {
        "goals": 3.0,
        "assists": 2.0,
        "shots_on_goal": 0.3,
        "blocked_shots": 0.5,
        "hits": 0.25,
        "pim": 0.25,
        "powerplay_points": 0.5,
        "shorthanded_points": 1.0,
        "wins": 4.0,
        "saves": 0.2,
        "goals_against": -1.0,
        "shutouts": 3.0
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
    
    for i in range(0, len(projections), UPSERT_BATCH_SIZE):
        batch = projections[i:i + UPSERT_BATCH_SIZE]
        
        # Filter to valid columns only
        filtered_batch = []
        for proj in batch:
            filtered = {k: v for k, v in proj.items() if k in valid_columns}
            if filtered.get("player_id") and filtered.get("game_id"):
                filtered_batch.append(filtered)
        
        if not filtered_batch:
            continue
        
        try:
            db.upsert(
                "player_projected_stats",
                filtered_batch,
                on_conflict="player_id,game_id,projection_date"
            )
            total_upserted += len(filtered_batch)
        except Exception as e:
            print(f"  Warning: Error upserting batch {i//UPSERT_BATCH_SIZE + 1}: {e}")
            # Try individual upserts for failed batch
            for proj in filtered_batch:
                try:
                    db.upsert("player_projected_stats", proj, on_conflict="player_id,game_id,projection_date")
                    total_upserted += 1
                except:
                    pass
    
    return total_upserted


# ============================================================================
# PHASE 5: ROS AGGREGATES
# ============================================================================

def calculate_ros_aggregates(projections: List[Dict], players: List[Dict]) -> List[Dict]:
    """
    Calculate Rest-of-Season aggregates from individual projections.
    
    Returns list of ROS projection dicts ready for upsert.
    """
    # Group projections by player
    player_projections = defaultdict(list)
    for proj in projections:
        player_id = proj.get("player_id")
        if player_id:
            player_projections[player_id].append(proj)
    
    # Create player lookup
    player_lookup = {p["player_id"]: p for p in players}
    
    ros_projections = []
    
    for player_id, projs in player_projections.items():
        if not projs:
            continue
        
        player_info = player_lookup.get(player_id, {})
        is_goalie = player_info.get("position_code") == "G"
        
        ros = {
            "player_id": player_id,
            "season": projs[0].get("season", DEFAULT_SEASON),
            "games_remaining": len(projs),
            "player_name": player_info.get("full_name", ""),
            "team_abbrev": player_info.get("team_abbrev", ""),
            "position": player_info.get("position_code", ""),
            "is_goalie": is_goalie,
            
            # Sum projections
            "total_projected_points": round(sum(p.get("total_projected_points", 0) for p in projs), 2),
            "projected_goals": round(sum(p.get("projected_goals", 0) for p in projs), 2),
            "projected_assists": round(sum(p.get("projected_assists", 0) for p in projs), 2),
            "projected_sog": round(sum(p.get("projected_sog", 0) for p in projs), 2),
            "projected_blocks": round(sum(p.get("projected_blocks", 0) for p in projs), 2),
            "projected_ppp": round(sum(p.get("projected_ppp", 0) for p in projs), 2),
            "projected_shp": round(sum(p.get("projected_shp", 0) for p in projs), 2),
            "projected_hits": round(sum(p.get("projected_hits", 0) for p in projs), 2),
            "projected_pim": round(sum(p.get("projected_pim", 0) for p in projs), 2),
        }
        
        # Calculate per-game averages
        if ros["games_remaining"] > 0:
            ros["avg_points_per_game"] = round(ros["total_projected_points"] / ros["games_remaining"], 2)
            ros["avg_goals_per_game"] = round(ros["projected_goals"] / ros["games_remaining"], 3)
            ros["avg_assists_per_game"] = round(ros["projected_assists"] / ros["games_remaining"], 3)
        
        # Goalie-specific
        if is_goalie:
            ros["projected_wins_ros"] = round(sum(p.get("projected_wins", 0) for p in projs), 2)
            ros["projected_saves_ros"] = round(sum(p.get("projected_saves", 0) for p in projs), 2)
            ros["projected_shutouts_ros"] = round(sum(p.get("projected_shutouts", 0) for p in projs), 2)
        
        ros_projections.append(ros)
    
    return ros_projections


def bulk_upsert_ros(db: SupabaseRest, ros_projections: List[Dict]) -> int:
    """
    Bulk upsert ROS projections.
    """
    if not ros_projections:
        return 0
    
    total = 0
    
    for i in range(0, len(ros_projections), UPSERT_BATCH_SIZE):
        batch = ros_projections[i:i + UPSERT_BATCH_SIZE]
        
        try:
            db.upsert(
                "player_ros_projections",
                batch,
                on_conflict="player_id"
            )
            total += len(batch)
        except Exception as e:
            print(f"  Warning: Error upserting ROS batch: {e}")
    
    return total


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
            print(f"  Warning: Error upserting matchup difficulty: {e}")
    
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
    
    print("=" * 80)
    print("CITRUS NIGHTLY PROJECTION BATCH")
    print("Yahoo/Sleeper-Grade Projection System")
    print("=" * 80)
    print(f"Season: {args.season}")
    print(f"Workers: {args.workers}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    db = get_db()
    
    # ========================================================================
    # PHASE 1: DATA LOADING
    # ========================================================================
    print("PHASE 1: Loading Data")
    print("-" * 40)
    
    phase1_start = time.time()
    
    schedule = fetch_remaining_schedule(db, args.season)
    players = fetch_all_players(db, args.season)
    player_stats = fetch_player_stats(db, args.season)
    team_defense = fetch_team_defense_stats(db, args.season)
    injuries = fetch_injury_report(db)
    scoring_settings = fetch_scoring_settings(db)
    
    phase1_elapsed = time.time() - phase1_start
    print(f"  Phase 1 complete in {phase1_elapsed:.1f}s")
    print()
    
    if not schedule:
        print("No remaining games found. Exiting.")
        return
    
    # ========================================================================
    # PHASE 2: MATCHUP DIFFICULTY
    # ========================================================================
    print("PHASE 2: Calculating Matchup Difficulty")
    print("-" * 40)
    
    phase2_start = time.time()
    matchup_ratings = calculate_matchup_difficulty(team_defense)
    phase2_elapsed = time.time() - phase2_start
    
    print(f"  Calculated {len(matchup_ratings)} matchup ratings")
    print(f"  Phase 2 complete in {phase2_elapsed:.1f}s")
    print()
    
    # ========================================================================
    # PHASE 3: PROJECTION CALCULATION
    # ========================================================================
    print("PHASE 3: Calculating Projections")
    print("-" * 40)
    
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
    
    print(f"  Created {len(worker_tasks)} projection tasks")
    
    # Execute in parallel
    projections = []
    completed = 0
    last_progress = 0
    
    if len(worker_tasks) > 100:
        # Use multiprocessing for large batches
        print(f"  Processing with {args.workers} workers...")
        
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(calculate_projection_worker, task): task for task in worker_tasks}
            
            for future in as_completed(futures):
                try:
                    result = future.result(timeout=30)
                    if result:
                        projections.append(result)
                except Exception:
                    pass
                
                completed += 1
                
                # Progress update every 10%
                progress = (completed * 100) // len(worker_tasks)
                if progress >= last_progress + 10:
                    elapsed = time.time() - phase3_start
                    rate = completed / elapsed if elapsed > 0 else 0
                    eta = (len(worker_tasks) - completed) / rate if rate > 0 else 0
                    print(f"  [{elapsed:.0f}s] {progress}% | {completed}/{len(worker_tasks)} | Rate: {rate:.1f}/s | ETA: {eta:.0f}s")
                    last_progress = progress
    else:
        # Sequential for small batches
        for task in worker_tasks:
            result = calculate_projection_worker(task)
            if result:
                projections.append(result)
            completed += 1
    
    phase3_elapsed = time.time() - phase3_start
    print(f"  Calculated {len(projections)} projections")
    print(f"  Phase 3 complete in {phase3_elapsed:.1f}s")
    print()
    
    if args.dry_run:
        print("DRY RUN - Skipping database writes")
        print(f"Would have written {len(projections)} projections")
        return
    
    # ========================================================================
    # PHASE 4: BULK UPSERT
    # ========================================================================
    print("PHASE 4: Upserting Projections")
    print("-" * 40)
    
    phase4_start = time.time()
    upserted = bulk_upsert_projections(db, projections)
    phase4_elapsed = time.time() - phase4_start
    
    print(f"  Upserted {upserted} projections")
    print(f"  Phase 4 complete in {phase4_elapsed:.1f}s")
    print()
    
    # ========================================================================
    # PHASE 5: ROS AGGREGATES
    # ========================================================================
    print("PHASE 5: Calculating ROS Aggregates")
    print("-" * 40)
    
    phase5_start = time.time()
    ros_projections = calculate_ros_aggregates(projections, players)
    ros_upserted = bulk_upsert_ros(db, ros_projections)
    phase5_elapsed = time.time() - phase5_start
    
    print(f"  Calculated {len(ros_projections)} ROS projections")
    print(f"  Upserted {ros_upserted} ROS records")
    print(f"  Phase 5 complete in {phase5_elapsed:.1f}s")
    print()
    
    # ========================================================================
    # PHASE 6: MATCHUP DIFFICULTY TABLE
    # ========================================================================
    print("PHASE 6: Updating Matchup Difficulty Table")
    print("-" * 40)
    
    phase6_start = time.time()
    matchup_upserted = upsert_matchup_difficulty(db, team_defense, args.season)
    phase6_elapsed = time.time() - phase6_start
    
    print(f"  Upserted {matchup_upserted} matchup difficulty records")
    print(f"  Phase 6 complete in {phase6_elapsed:.1f}s")
    print()
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    total_elapsed = time.time() - start_time
    
    print("=" * 80)
    print("BATCH COMPLETE")
    print("=" * 80)
    print(f"Total Time: {total_elapsed:.1f}s ({total_elapsed/60:.1f} minutes)")
    print(f"Projections: {upserted}")
    print(f"ROS Aggregates: {ros_upserted}")
    print(f"Matchup Ratings: {matchup_upserted}")
    print(f"Rate: {upserted / total_elapsed:.1f} projections/second")
    print("=" * 80)


if __name__ == "__main__":
    main()

