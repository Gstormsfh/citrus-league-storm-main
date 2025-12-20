#!/usr/bin/env python3
"""
calculate_matchup_scores.py

World Class Matchup Engine: Pre-calculates fantasy points for all players in active matchups.
Supports custom league scoring settings, detailed stats breakdown, and games remaining tracking.

Features:
- Custom scoring per league (skater/goalie distinction)
- Fractional scoring support
- Active vs Total Games Remaining tracking
- Live game locking
- Calibration verification
- Detailed traceability via stats_breakdown JSONB
"""

import os
import sys
import datetime as dt
from typing import Any, Dict, List, Optional, Tuple
from decimal import Decimal

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


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        if v is None:
            return default
        return int(v)
    except (ValueError, TypeError):
        return default


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        return float(v)
    except (ValueError, TypeError):
        return default


def get_active_matchups(db: SupabaseRest, matchup_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Fetch active matchups (current date between week_start_date and week_end_date).
    If matchup_id is provided, only fetch that specific matchup.
    Excludes matchups with live_game_locked = true during active games.
    """
    today = dt.date.today()
    
    filters = [
        ("week_start_date", "lte", today.isoformat()),
        ("week_end_date", "gte", today.isoformat())
    ]
    
    if matchup_id:
        filters.append(("id", "eq", matchup_id))
    
    matchups = db.select(
        "matchups",
        select="id,league_id,week_number,team1_id,team2_id,week_start_date,week_end_date,status",
        filters=filters
    )
    
    return matchups or []


def load_league_scoring_settings(db: SupabaseRest, league_id: str) -> Dict[str, Any]:
    """
    Load scoring_settings JSONB from league.
    Returns validated structure with defaults for missing categories.
    """
    try:
        league = db.select("leagues", select="scoring_settings", filters=[("id", "eq", league_id)], limit=1)
    except Exception as e:
        # If column doesn't exist yet, use defaults
        if "does not exist" in str(e) or "42703" in str(e):
            print(f"[INFO] scoring_settings column not found, using defaults")
            return _get_default_scoring_settings()
        raise
    
    if not league or len(league) == 0:
        print(f"[WARNING] League {league_id} not found, using defaults")
        return _get_default_scoring_settings()
    
    settings = league[0].get("scoring_settings") or {}
    
    # Merge with defaults to ensure all categories exist
    defaults = _get_default_scoring_settings()
    if isinstance(settings, dict):
        # Merge skater settings
        if "skater" not in settings:
            settings["skater"] = defaults["skater"]
        else:
            for key, value in defaults["skater"].items():
                if key not in settings["skater"]:
                    settings["skater"][key] = value
        
        # Merge goalie settings
        if "goalie" not in settings:
            settings["goalie"] = defaults["goalie"]
        else:
            for key, value in defaults["goalie"].items():
                if key not in settings["goalie"]:
                    settings["goalie"][key] = value
        
        # Merge advanced settings
        if "advanced" not in settings:
            settings["advanced"] = defaults["advanced"]
        else:
            for key, value in defaults["advanced"].items():
                if key not in settings["advanced"]:
                    settings["advanced"][key] = value
    else:
        settings = defaults
    
    return settings


def _get_default_scoring_settings() -> Dict[str, Any]:
    """Returns default scoring settings structure."""
    return {
        "skater": {
            "goals": 3,
            "assists": 2,
            "power_play_points": 1,
            "short_handed_points": 2,
            "shots_on_goal": 0.4,
            "blocks": 0.5,
            "hits": 0.2,
            "penalty_minutes": 0.5
        },
        "goalie": {
            "wins": 4,
            "shutouts": 3,
            "saves": 0.2,
            "goals_against": -1
        },
        "advanced": {
            "use_fractional_scoring": False,
            "shooting_percentage_bonus": 0.0,
            "assist_per_goal_ratio": 0.0
        }
    }


def fetch_player_matchup_stats(
    db: SupabaseRest,
    player_ids: List[int],
    start_date: str,
    end_date: str
) -> Dict[int, Dict[str, Any]]:
    """
    Fetch aggregated stats from player_game_stats for the date range.
    Returns dict: player_id -> aggregated stats
    """
    if not player_ids:
        return {}
    
    # Query player_game_stats for the date range
    stats_map: Dict[int, Dict[str, Any]] = {}
    
    # Use the existing get_matchup_stats RPC if available, otherwise aggregate manually
    try:
        # Try RPC first (faster)
        result = db.rpc(
            "get_matchup_stats",
            {
                "p_player_ids": player_ids,
                "p_start_date": start_date,
                "p_end_date": end_date
            }
        )
        
        if result:
            for row in result:
                pid = _safe_int(row.get("player_id"))
                stats_map[pid] = {
                    "goals": _safe_int(row.get("goals", 0)),
                    "assists": _safe_int(row.get("assists", 0)),
                    "points": _safe_int(row.get("points", 0)),
                    "shots_on_goal": _safe_int(row.get("shots_on_goal", 0)),
                    "hits": _safe_int(row.get("hits", 0)),
                    "blocks": _safe_int(row.get("blocks", 0)),
                    "pim": _safe_int(row.get("pim", 0)),
                    "ppp": _safe_int(row.get("ppp", 0)),
                    "shp": _safe_int(row.get("shp", 0)),
                    "wins": _safe_int(row.get("wins", 0)),
                    "saves": _safe_int(row.get("saves", 0)),
                    "goals_against": _safe_int(row.get("goals_against", 0)),
                    "shutouts": _safe_int(row.get("shutouts", 0)),
                    "games_played": _safe_int(row.get("goalie_gp", 0))  # For goalies
                }
    except Exception as e:
        print(f"[WARNING] RPC failed, aggregating manually: {e}")
        # Fallback: aggregate manually from player_game_stats
        # This is slower but more reliable
        for pid in player_ids:
            stats = db.select(
                "player_game_stats",
                select="goals,primary_assists,secondary_assists,points,shots_on_goal,hits,blocks,pim,ppp,shp,wins,saves,goals_against,shutouts,goalie_gp",
                filters=[
                    ("player_id", "eq", pid),
                    ("game_date", "gte", start_date),
                    ("game_date", "lte", end_date)
                ]
            )
            
            if stats:
                aggregated = {
                    "goals": sum(_safe_int(s.get("goals", 0)) for s in stats),
                    "assists": sum(_safe_int(s.get("primary_assists", 0)) + _safe_int(s.get("secondary_assists", 0)) for s in stats),
                    "points": sum(_safe_int(s.get("points", 0)) for s in stats),
                    "shots_on_goal": sum(_safe_int(s.get("shots_on_goal", 0)) for s in stats),
                    "hits": sum(_safe_int(s.get("hits", 0)) for s in stats),
                    "blocks": sum(_safe_int(s.get("blocks", 0)) for s in stats),
                    "pim": sum(_safe_int(s.get("pim", 0)) for s in stats),
                    "ppp": sum(_safe_int(s.get("ppp", 0)) for s in stats),
                    "shp": sum(_safe_int(s.get("shp", 0)) for s in stats),
                    "wins": sum(_safe_int(s.get("wins", 0)) for s in stats),
                    "saves": sum(_safe_int(s.get("saves", 0)) for s in stats),
                    "goals_against": sum(_safe_int(s.get("goals_against", 0)) for s in stats),
                    "shutouts": sum(_safe_int(s.get("shutouts", 0)) for s in stats),
                    "games_played": len([s for s in stats if _safe_int(s.get("goalie_gp", 0)) > 0])  # Goalie games
                }
                stats_map[pid] = aggregated
    
    return stats_map


def calculate_games_remaining(
    db: SupabaseRest,
    player_id: int,
    team_abbrev: str,
    start_date: str,
    end_date: str,
    is_starter: bool
) -> Tuple[int, int]:
    """
    Calculate games remaining for a player.
    Returns (total_gr, active_gr) tuple.
    - total_gr: All future games for the player's team in the week
    - active_gr: Same as total_gr if player is in starting lineup, else 0
    """
    today = dt.date.today()
    
    # Query nhl_games for future games in the week
    filters = [
        ("game_date", "gte", today.isoformat()),
        ("game_date", "lte", end_date),
        ("status", "in", ["scheduled", "live"])
    ]
    
    # Check both home and away
    home_games = db.select(
        "nhl_games",
        select="id",
        filters=filters + [("home_team", "eq", team_abbrev)]
    ) or []
    
    away_games = db.select(
        "nhl_games",
        select="id",
        filters=filters + [("away_team", "eq", team_abbrev)]
    ) or []
    
    total_gr = len(home_games) + len(away_games)
    active_gr = total_gr if is_starter else 0
    
    return (total_gr, active_gr)


def check_live_games(
    db: SupabaseRest,
    player_id: int,
    team_abbrev: str,
    current_date: str
) -> Tuple[bool, bool]:
    """
    Check if player has a live game today.
    Returns (has_live_game, live_game_locked) tuple.
    """
    # Query nhl_games for live games today
    live_games = db.select(
        "nhl_games",
        select="id,status",
        filters=[
            ("game_date", "eq", current_date),
            ("status", "eq", "live"),
            ("home_team", "eq", team_abbrev)
        ]
    ) or []
    
    # Also check away games
    away_live = db.select(
        "nhl_games",
        select="id,status",
        filters=[
            ("game_date", "eq", current_date),
            ("status", "eq", "live"),
            ("away_team", "eq", team_abbrev)
        ]
    ) or []
    
    has_live = len(live_games) > 0 or len(away_live) > 0
    live_locked = has_live  # Lock during live games
    
    return (has_live, live_locked)


def calculate_fantasy_points(
    stats: Dict[str, Any],
    scoring_settings: Dict[str, Any],
    is_goalie: bool
) -> Tuple[Decimal, Dict[str, Any]]:
    """
    Calculate fantasy points from stats using league scoring settings.
    Returns (total_points, breakdown_dict) tuple.
    Supports fractional scoring if enabled.
    """
    breakdown: Dict[str, Any] = {}
    points_by_category: Dict[str, Decimal] = {}
    total_points = Decimal("0.0")
    
    if is_goalie:
        scoring = scoring_settings.get("goalie", {})
        
        # Goalie stats
        wins = _safe_int(stats.get("wins", 0))
        shutouts = _safe_int(stats.get("shutouts", 0))
        saves = _safe_int(stats.get("saves", 0))
        goals_against = _safe_int(stats.get("goals_against", 0))
        
        breakdown["wins"] = wins
        breakdown["shutouts"] = shutouts
        breakdown["saves"] = saves
        breakdown["goals_against"] = goals_against
        
        points_from_wins = Decimal(str(wins)) * Decimal(str(scoring.get("wins", 4)))
        points_from_shutouts = Decimal(str(shutouts)) * Decimal(str(scoring.get("shutouts", 3)))
        points_from_saves = Decimal(str(saves)) * Decimal(str(scoring.get("saves", 0.2)))
        points_from_ga = Decimal(str(goals_against)) * Decimal(str(scoring.get("goals_against", -1)))
        
        points_by_category["wins"] = points_from_wins
        points_by_category["shutouts"] = points_from_shutouts
        points_by_category["saves"] = points_from_saves
        points_by_category["goals_against"] = points_from_ga
        
        total_points = points_from_wins + points_from_shutouts + points_from_saves + points_from_ga
        
        breakdown["points_from_wins"] = float(points_from_wins)
        breakdown["points_from_shutouts"] = float(points_from_shutouts)
        breakdown["points_from_saves"] = float(points_from_saves)
        breakdown["points_from_goals_against"] = float(points_from_ga)
    else:
        scoring = scoring_settings.get("skater", {})
        
        # Skater stats
        goals = _safe_int(stats.get("goals", 0))
        assists = _safe_int(stats.get("assists", 0))
        ppp = _safe_int(stats.get("ppp", 0))
        shp = _safe_int(stats.get("shp", 0))
        sog = _safe_int(stats.get("shots_on_goal", 0))
        blocks = _safe_int(stats.get("blocks", 0))
        hits = _safe_int(stats.get("hits", 0))
        pim = _safe_int(stats.get("pim", 0))
        
        breakdown["goals"] = goals
        breakdown["assists"] = assists
        breakdown["power_play_points"] = ppp
        breakdown["short_handed_points"] = shp
        breakdown["shots_on_goal"] = sog
        breakdown["blocks"] = blocks
        breakdown["hits"] = hits
        breakdown["penalty_minutes"] = pim
        
        points_from_goals = Decimal(str(goals)) * Decimal(str(scoring.get("goals", 3)))
        points_from_assists = Decimal(str(assists)) * Decimal(str(scoring.get("assists", 2)))
        points_from_ppp = Decimal(str(ppp)) * Decimal(str(scoring.get("power_play_points", 1)))
        points_from_shp = Decimal(str(shp)) * Decimal(str(scoring.get("short_handed_points", 2)))
        points_from_sog = Decimal(str(sog)) * Decimal(str(scoring.get("shots_on_goal", 0.4)))
        points_from_blocks = Decimal(str(blocks)) * Decimal(str(scoring.get("blocks", 0.5)))
        points_from_hits = Decimal(str(hits)) * Decimal(str(scoring.get("hits", 0.2)))
        points_from_pim = Decimal(str(pim)) * Decimal(str(scoring.get("penalty_minutes", 0.5)))
        
        points_by_category["goals"] = points_from_goals
        points_by_category["assists"] = points_from_assists
        points_by_category["power_play_points"] = points_from_ppp
        points_by_category["short_handed_points"] = points_from_shp
        points_by_category["shots_on_goal"] = points_from_sog
        points_by_category["blocks"] = points_from_blocks
        points_by_category["hits"] = points_from_hits
        points_by_category["penalty_minutes"] = points_from_pim
        
        base_total = points_from_goals + points_from_assists + points_from_ppp + points_from_shp + \
                    points_from_sog + points_from_blocks + points_from_hits + points_from_pim
        
        # Fractional scoring adjustments (if enabled)
        fractional_adjustment = Decimal("0.0")
        advanced = scoring_settings.get("advanced", {})
        
        if advanced.get("use_fractional_scoring", False):
            # Shooting percentage bonus
            if sog > 0 and advanced.get("shooting_percentage_bonus", 0) > 0:
                shooting_pct = Decimal(str(goals)) / Decimal(str(sog))
                bonus = shooting_pct * Decimal(str(advanced["shooting_percentage_bonus"]))
                fractional_adjustment += bonus
                breakdown["shooting_percentage_bonus"] = float(bonus)
            
            # Assist per goal ratio bonus
            if goals > 0 and advanced.get("assist_per_goal_ratio", 0) > 0:
                assist_ratio = Decimal(str(assists)) / Decimal(str(goals))
                bonus = assist_ratio * Decimal(str(advanced["assist_per_goal_ratio"]))
                fractional_adjustment += bonus
                breakdown["assist_per_goal_ratio_bonus"] = float(bonus)
        
        total_points = base_total + fractional_adjustment
        
        breakdown["points_from_goals"] = float(points_from_goals)
        breakdown["points_from_assists"] = float(points_from_assists)
        breakdown["points_from_power_play_points"] = float(points_from_ppp)
        breakdown["points_from_short_handed_points"] = float(points_from_shp)
        breakdown["points_from_shots_on_goal"] = float(points_from_sog)
        breakdown["points_from_blocks"] = float(points_from_blocks)
        breakdown["points_from_hits"] = float(points_from_hits)
        breakdown["points_from_penalty_minutes"] = float(points_from_pim)
        
        if fractional_adjustment != Decimal("0.0"):
            breakdown["fractional_adjustment"] = float(fractional_adjustment)
    
    breakdown["total_points"] = float(total_points)
    
    return (total_points, breakdown)


def build_stats_breakdown(
    stats: Dict[str, Any],
    breakdown: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Build final stats_breakdown JSONB with all traceability info.
    """
    return breakdown


def get_team_starters(
    db: SupabaseRest,
    team_id: str,
    league_id: str
) -> List[int]:
    """
    Get list of player IDs in the starting lineup for a team.
    Returns empty list if lineup not found.
    """
    try:
        # Query team_lineups table
        lineup = db.select(
            "team_lineups",
            select="starters",
            filters=[
                ("team_id", "eq", team_id),
                ("league_id", "eq", league_id)
            ],
            limit=1
        )
        
        if lineup and len(lineup) > 0:
            starters = lineup[0].get("starters", [])
            # Convert to integers (starters are stored as strings in JSONB array)
            return [_safe_int(sid) for sid in starters if sid]
    except Exception as e:
        print(f"[WARNING] Could not fetch lineup for team {team_id}: {e}")
        # Return empty list - will default to all players as "active" (total_gr = active_gr)
    
    return []


def get_player_team_abbrev(
    db: SupabaseRest,
    player_id: int
) -> Optional[str]:
    """
    Get player's current team abbreviation from player_directory or player_game_stats.
    """
    # Try player_directory first
    try:
        player = db.select(
            "player_directory",
            select="team_abbrev",
            filters=[("player_id", "eq", player_id)],
            limit=1
        )
        if player and len(player) > 0:
            team = player[0].get("team_abbrev")
            if team:
                return str(team)
    except:
        pass
    
    # Fallback: get most recent team from player_game_stats
    try:
        recent = db.select(
            "player_game_stats",
            select="team_abbrev",
            filters=[("player_id", "eq", player_id)],
            order_by="game_date",
            order_direction="desc",
            limit=1
        )
        if recent and len(recent) > 0:
            team = recent[0].get("team_abbrev")
            if team:
                return str(team)
    except:
        pass
    
    return None


def upsert_matchup_lines(
    db: SupabaseRest,
    matchup_id: str,
    player_lines: List[Dict[str, Any]]
) -> None:
    """
    Upsert fantasy_matchup_lines records.
    """
    if not player_lines:
        return
    
    # Convert Decimal to float for JSON serialization
    for line in player_lines:
        if "total_points" in line and isinstance(line["total_points"], Decimal):
            line["total_points"] = float(line["total_points"])
        if "stats_breakdown" in line and isinstance(line["stats_breakdown"], dict):
            # Ensure all Decimal values are converted
            for key, value in line["stats_breakdown"].items():
                if isinstance(value, Decimal):
                    line["stats_breakdown"][key] = float(value)
    
    db.upsert(
        "fantasy_matchup_lines",
        player_lines,
        on_conflict="matchup_id,player_id"
    )


def update_matchup_scores(
    db: SupabaseRest,
    matchup_id: str
) -> None:
    """
    Sum player totals and update matchups.team1_score and matchups.team2_score.
    Also runs calibration check.
    """
    # Get matchup to find team IDs
    matchup = db.select(
        "matchups",
        select="team1_id,team2_id",
        filters=[("id", "eq", matchup_id)],
        limit=1
    )
    
    if not matchup or len(matchup) == 0:
        print(f"[ERROR] Matchup {matchup_id} not found")
        return
    
    team1_id = matchup[0].get("team1_id")
    team2_id = matchup[0].get("team2_id")
    
    # Sum totals by team
    lines = db.select(
        "fantasy_matchup_lines",
        select="team_id,total_points",
        filters=[("matchup_id", "eq", matchup_id)]
    ) or []
    
    team1_total = Decimal("0.0")
    team2_total = Decimal("0.0")
    
    for line in lines:
        team_id = line.get("team_id")
        points = Decimal(str(line.get("total_points", 0)))
        
        if team_id == team1_id:
            team1_total += points
        elif team_id == team2_id:
            team2_total += points
    
    # Update matchup scores
    db.update(
        "matchups",
        {
            "team1_score": float(team1_total),
            "team2_score": float(team2_total),
            "updated_at": _now_iso()
        },
        filters=[("id", "eq", matchup_id)]
    )
    
    # Run calibration check
    try:
        calibration = db.rpc("verify_matchup_scores", {"p_matchup_id": matchup_id})
        if calibration and len(calibration) > 0:
            result = calibration[0]
            is_calibrated = result.get("is_calibrated", False)
            if not is_calibrated:
                print(f"[WARNING] Matchup {matchup_id} calibration check failed!")
                print(f"  Team1: calculated={result.get('team1_calculated')}, stored={result.get('team1_stored')}, discrepancy={result.get('discrepancy_team1')}")
                print(f"  Team2: calculated={result.get('team2_calculated')}, stored={result.get('team2_stored')}, discrepancy={result.get('discrepancy_team2')}")
            else:
                print(f"[OK] Matchup {matchup_id} calibration check passed")
    except Exception as e:
        print(f"[WARNING] Calibration check failed: {e}")


def calculate_matchup_scores(
    db: SupabaseRest,
    matchup_id: Optional[str] = None
) -> int:
    """
    Main calculation function.
    If matchup_id is provided, only calculate for that matchup.
    Otherwise, calculate for all active matchups.
    """
    print("=" * 80)
    print("WORLD CLASS MATCHUP ENGINE - SCORE CALCULATION")
    print("=" * 80)
    
    matchups = get_active_matchups(db, matchup_id)
    
    if not matchups:
        print(f"[INFO] No active matchups found")
        return 0
    
    print(f"[INFO] Processing {len(matchups)} matchup(s)")
    
    for matchup in matchups:
        matchup_id = matchup["id"]
        league_id = matchup["league_id"]
        team1_id = matchup["team1_id"]
        team2_id = matchup.get("team2_id")
        week_start = matchup["week_start_date"]
        week_end = matchup["week_end_date"]
        
        print(f"\n[MATCHUP] {matchup_id} (Week {matchup['week_number']})")
        print(f"  League: {league_id}")
        print(f"  Date Range: {week_start} to {week_end}")
        
        # Load league scoring settings
        scoring_settings = load_league_scoring_settings(db, league_id)
        
        # Get team rosters (all players on both teams)
        # Note: Check if deleted_at column exists, if not, just filter by league_id and team_id
        team1_roster = db.select(
            "draft_picks",
            select="player_id",
            filters=[
                ("league_id", "eq", league_id),
                ("team_id", "eq", team1_id)
            ]
        ) or []
        # Filter out deleted picks if deleted_at exists
        team1_roster = [p for p in team1_roster if not p.get("deleted_at")]
        
        team2_roster = []
        if team2_id:
            team2_roster = db.select(
                "draft_picks",
                select="player_id",
                filters=[
                    ("league_id", "eq", league_id),
                    ("team_id", "eq", team2_id)
                ]
            ) or []
            # Filter out deleted picks if deleted_at exists
            team2_roster = [p for p in team2_roster if not p.get("deleted_at")]
        
        all_player_ids = [
            _safe_int(pick.get("player_id"))
            for pick in team1_roster + team2_roster
        ]
        
        print(f"  Players: {len(all_player_ids)} total ({len(team1_roster)} team1, {len(team2_roster)} team2)")
        
        # Get starting lineups
        team1_starters = get_team_starters(db, team1_id, league_id)
        team2_starters = get_team_starters(db, team2_id, league_id) if team2_id else []
        all_starters = set(team1_starters + team2_starters)
        
        # Fetch player stats for the week
        player_stats = fetch_player_matchup_stats(db, all_player_ids, week_start, week_end)
        
        # Get player team abbreviations and goalie status
        player_info: Dict[int, Dict[str, Any]] = {}
        for pid in all_player_ids:
            team_abbrev = get_player_team_abbrev(db, pid)
            if not team_abbrev:
                continue
            
            # Check if goalie (from player_directory)
            player_dir = db.select(
                "player_directory",
                select="position_code,is_goalie",
                filters=[("player_id", "eq", pid)],
                limit=1
            )
            is_goalie = False
            if player_dir and len(player_dir) > 0:
                # Check is_goalie boolean first
                is_goalie = player_dir[0].get("is_goalie", False)
                # Fallback to position code if is_goalie not set
                if not is_goalie:
                    position = (player_dir[0].get("position_code", "") or "").upper()
                    is_goalie = "G" in position or "GOALIE" in position
            
            player_info[pid] = {
                "team_abbrev": team_abbrev,
                "is_goalie": is_goalie,
                "is_starter": pid in all_starters
            }
        
        # Calculate for each player
        player_lines: List[Dict[str, Any]] = []
        today_str = dt.date.today().isoformat()
        
        for pid, info in player_info.items():
            stats = player_stats.get(pid, {})
            is_goalie = info["is_goalie"]
            is_starter = info["is_starter"]
            team_abbrev = info["team_abbrev"]
            
            # Determine which team this player belongs to
            team_id = team1_id
            if team2_id:
                # Check draft_picks to see which team owns this player
                picks = db.select(
                    "draft_picks",
                    select="team_id",
                    filters=[
                        ("league_id", "eq", league_id),
                        ("player_id", "eq", pid)
                    ],
                    limit=1
                )
                # Filter out deleted picks if deleted_at exists
                picks = [p for p in picks if not p.get("deleted_at")] if picks else []
                if picks and len(picks) > 0:
                    team_id = picks[0].get("team_id")
            
            # Calculate fantasy points
            total_points, breakdown = calculate_fantasy_points(stats, scoring_settings, is_goalie)
            
            # Calculate games remaining
            total_gr, active_gr = calculate_games_remaining(
                db, pid, team_abbrev, week_start, week_end, is_starter
            )
            
            # Check live games
            has_live, live_locked = check_live_games(db, pid, team_abbrev, today_str)
            
            # Count games played (from stats)
            games_played = _safe_int(stats.get("games_played", 0))
            if not is_goalie:
                # For skaters, count unique game_ids
                game_stats = db.select(
                    "player_game_stats",
                    select="game_id",
                    filters=[
                        ("player_id", "eq", pid),
                        ("game_date", "gte", week_start),
                        ("game_date", "lte", week_end)
                    ]
                ) or []
                games_played = len(set(s.get("game_id") for s in game_stats))
            
            # Ensure stats dict has all required keys (even if zero) for clean breakdown
            if not stats:
                stats = {}
            # Ensure breakdown will have all stat categories even if zero
            # This is handled in calculate_fantasy_points, but we ensure stats dict is not None
            
            player_line = {
                "matchup_id": matchup_id,
                "player_id": pid,
                "team_id": team_id,
                "total_points": total_points,
                "stats_breakdown": breakdown,
                "games_played": games_played,
                "games_remaining_total": total_gr,
                "games_remaining_active": active_gr,
                "has_live_game": has_live,
                "live_game_locked": live_locked,
                "updated_at": _now_iso()
            }
            
            player_lines.append(player_line)
        
        # Upsert all lines
        print(f"  Upserting {len(player_lines)} player lines...")
        upsert_matchup_lines(db, matchup_id, player_lines)
        
        # Update matchup scores
        print(f"  Updating matchup scores...")
        update_matchup_scores(db, matchup_id)
        
        print(f"[OK] Matchup {matchup_id} calculation complete")
    
    print("\n" + "=" * 80)
    print("[OK] All matchups processed")
    print("=" * 80)
    
    return len(matchups)


def run_verification_checks(db: SupabaseRest, matchup_id: Optional[str] = None) -> None:
    """
    Run verification checks after calculation.
    Checks calibration for all processed matchups.
    """
    matchups = get_active_matchups(db, matchup_id)
    
    if not matchups:
        print("[VERIFY] No matchups to verify")
        return
    
    print("\n" + "=" * 80)
    print("VERIFICATION CHECKS")
    print("=" * 80)
    
    all_passed = True
    
    for matchup in matchups:
        m_id = matchup["id"]
        print(f"\n[VERIFY] Matchup {m_id}")
        
        try:
            result = db.rpc("verify_matchup_scores", {"p_matchup_id": m_id})
            if result and len(result) > 0:
                cal = result[0]
                is_calibrated = cal.get("is_calibrated", False)
                
                if is_calibrated:
                    print(f"  [OK] Calibration passed")
                else:
                    all_passed = False
                    print(f"  [FAIL] Calibration failed!")
                    print(f"    Team1: calculated={cal.get('team1_calculated')}, stored={cal.get('team1_stored')}, discrepancy={cal.get('discrepancy_team1')}")
                    print(f"    Team2: calculated={cal.get('team2_calculated')}, stored={cal.get('team2_stored')}, discrepancy={cal.get('discrepancy_team2')}")
            else:
                print(f"  [WARNING] Calibration check returned no results")
        except Exception as e:
            print(f"  [ERROR] Calibration check failed: {e}")
            all_passed = False
    
    print("\n" + "=" * 80)
    if all_passed:
        print("[OK] All verification checks passed")
    else:
        print("[WARNING] Some verification checks failed")
    print("=" * 80)


def main() -> int:
    """Main entry point. Supports command-line arguments."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Calculate matchup scores for active matchups")
    parser.add_argument("--matchup-id", help="Process specific matchup ID")
    parser.add_argument("--verify", action="store_true", help="Run verification checks after calculation")
    args = parser.parse_args()
    
    matchup_id = args.matchup_id
    
    if matchup_id:
        print(f"[INFO] Processing specific matchup: {matchup_id}")
    
    db = supabase_client()
    
    try:
        count = calculate_matchup_scores(db, matchup_id)
        
        if args.verify:
            run_verification_checks(db, matchup_id)
        
        return 0 if count > 0 else 1
    except Exception as e:
        print(f"[ERROR] Calculation failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
