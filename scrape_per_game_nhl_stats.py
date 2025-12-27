#!/usr/bin/env python3
"""
scrape_per_game_nhl_stats.py

Scrape per-game NHL official statistics from gamecenter boxscore endpoint.
Populates player_game_stats.nhl_* columns with official NHL.com game-by-game stats.

This is the source of truth for fantasy scoring - uses NHL official stats, not PBP assumptions.
"""

import os
import sys
import time
import requests
from datetime import datetime, date, timedelta
from typing import Dict, Optional, List, Any
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_API_BASE = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _safe_int(v, default=0) -> int:
    """Safely convert value to int."""
    try:
        return int(v) if v is not None else default
    except Exception:
        return default


def _safe_float(v, default=0.0) -> float:
    """Safely convert value to float."""
    try:
        return float(v) if v is not None else default
    except Exception:
        return default


def _calculate_save_pct(saves: int, shots_faced: int) -> float:
    """
    Calculate save percentage with divide-by-zero protection.
    Returns 0.000 if no shots faced (backup goalie edge case).
    """
    if shots_faced <= 0:
        return 0.000
    return round(saves / shots_faced, 3)


def parse_time_to_seconds(time_str: str) -> int:
    """
    Parse time string from NHL API (format: "MM:SS" or "HH:MM:SS").
    Returns total seconds.
    """
    if not time_str or not isinstance(time_str, str):
        return 0
    try:
        parts = time_str.split(":")
        if len(parts) == 3:  # HH:MM:SS
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:  # MM:SS
            return int(parts[0]) * 60 + int(parts[1])
        else:
            return int(time_str) if time_str.isdigit() else 0
    except Exception:
        return 0


def fetch_game_boxscore(game_id: int) -> Optional[Dict]:
    """Fetch boxscore from gamecenter endpoint."""
    url = f"{NHL_API_BASE}/gamecenter/{game_id}/boxscore"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  Error fetching game {game_id}: {e}")
        return None


def extract_player_stats_from_boxscore(boxscore: Dict) -> Dict[int, Dict[str, Any]]:
    """
    Extract COMPREHENSIVE player stats from boxscore for fantasy scoring.
    
    Returns dict: player_id -> stats dict
    
    Each stats dict includes:
    - All nhl_* fantasy stats
    - is_goalie: bool - whether this player is a goalie
    - team_abbrev: str - the team abbreviation (for creating new records)
    - position_code: str - position from boxscore ('G', 'C', 'L', 'R', 'D')
    
    Captures ALL fantasy-relevant stats including:
    - Core stats: G, A, P, SOG, PIM, +/-
    - Physical: Hits, Blocks
    - Faceoffs: Wins, Losses, Taken
    - Possession: Takeaways, Giveaways
    - Power Play: PPG, PPA, PPP
    - Shorthanded: SHG, SHA, SHP
    - Shot metrics: Missed, Blocked (for Corsi/Fenwick)
    - Game context: GWG, OTG, Shifts
    - Goalie: W, L, OTL, SV, SA, GA, SO, SV%, situation splits
    """
    player_stats_map = {}
    
    if "playerByGameStats" not in boxscore:
        return player_stats_map
    
    player_stats = boxscore["playerByGameStats"]
    
    # Extract team abbreviations from boxscore root (for creating new records)
    team_abbrevs = {}
    if "homeTeam" in boxscore and isinstance(boxscore["homeTeam"], dict):
        team_abbrevs["homeTeam"] = boxscore["homeTeam"].get("abbrev", "")
    if "awayTeam" in boxscore and isinstance(boxscore["awayTeam"], dict):
        team_abbrevs["awayTeam"] = boxscore["awayTeam"].get("abbrev", "")
    
    # Check both teams
    for team_key in ["homeTeam", "awayTeam"]:
        if team_key not in player_stats:
            continue
        
        team_data = player_stats[team_key]
        if not isinstance(team_data, dict):
            continue
        
        # Get team abbreviation for this team
        team_abbrev = team_abbrevs.get(team_key, "")
        
        # Check forwards, defensemen, goalies
        for position_group in ["forwards", "defense", "goalies"]:
            if position_group not in team_data:
                continue
            
            players = team_data[position_group]
            if not isinstance(players, list):
                continue
            
            for player_stat in players:
                if not isinstance(player_stat, dict):
                    continue
                
                player_id = _safe_int(player_stat.get("playerId"))
                if not player_id:
                    continue
                
                is_goalie = position_group == "goalies"
                
                # Extract position code from player data
                # Goalies are 'G', skaters could be 'C', 'L', 'R', 'D'
                position_code = "G" if is_goalie else player_stat.get("position", "F")
                
                # ===================
                # CORE SKATER STATS
                # ===================
                goals = _safe_int(player_stat.get("goals", 0))
                assists = _safe_int(player_stat.get("assists", 0))
                # Note: NHL boxscore API uses "shots" field (not "shotsOnGoal" or "shots_on_goal")
                # This represents official Shots on Goal (SOG) used by the league
                sog = _safe_int(player_stat.get("sog", 0))  # ALWAYS use "sog" - confirmed via API test, NOT "shots"
                
                stats = {
                    # Metadata for record creation (not stored in nhl_* columns)
                    "_is_goalie": is_goalie,
                    "_team_abbrev": team_abbrev,
                    "_position_code": position_code,
                    "nhl_goals": goals,
                    "nhl_assists": assists,
                    "nhl_points": _safe_int(player_stat.get("points", 0)) or (goals + assists),
                    "nhl_shots_on_goal": sog,
                    "nhl_pim": _safe_int(player_stat.get("pim") or player_stat.get("penaltyMinutes", 0)),
                    "nhl_plus_minus": _safe_int(player_stat.get("plusMinus", 0)),
                    "nhl_toi_seconds": parse_time_to_seconds(
                        player_stat.get("timeOnIce") or player_stat.get("toi") or "0:00"
                    ),
                    
                    # ===================
                    # PHYSICAL STATS
                    # ===================
                    "nhl_hits": _safe_int(player_stat.get("hits", 0)),
                    "nhl_blocks": _safe_int(player_stat.get("blockedShots") or player_stat.get("blocked", 0)),
                    
                    # ===================
                    # FACEOFF STATS
                    # ===================
                    "nhl_faceoff_wins": _safe_int(
                        player_stat.get("faceoffWins") or player_stat.get("faceOffWins", 0)
                    ),
                    "nhl_faceoff_taken": _safe_int(
                        player_stat.get("faceoffsTaken") or player_stat.get("faceOffs", 0)
                    ),
                    
                    # ===================
                    # POSSESSION STATS
                    # ===================
                    "nhl_takeaways": _safe_int(player_stat.get("takeaways", 0)),
                    "nhl_giveaways": _safe_int(player_stat.get("giveaways", 0)),
                    
                    # ===================
                    # POWER PLAY BREAKDOWN
                    # ===================
                    # Extract components first, then calculate totals
                    # Note: powerPlayPoints field doesn't exist in boxscore, so we calculate from components
                    "nhl_ppg": _safe_int(player_stat.get("powerPlayGoals", 0)),
                    "nhl_ppa": _safe_int(player_stat.get("powerPlayAssists", 0)),
                    "nhl_ppp": _safe_int(player_stat.get("powerPlayGoals", 0)) + _safe_int(player_stat.get("powerPlayAssists", 0)),
                    
                    # ===================
                    # SHORTHANDED BREAKDOWN
                    # ===================
                    # Extract components first, then calculate totals
                    # Note: shorthandedPoints field doesn't exist in boxscore, so we calculate from components
                    "nhl_shg": _safe_int(player_stat.get("shorthandedGoals", 0)),
                    "nhl_sha": _safe_int(player_stat.get("shorthandedAssists", 0)),
                    "nhl_shp": _safe_int(player_stat.get("shorthandedGoals", 0)) + _safe_int(player_stat.get("shorthandedAssists", 0)),
                    
                    # ===================
                    # SHOT METRICS (CORSI COMPONENTS)
                    # ===================
                    # Corsi = SOG + Missed + Blocked shots taken
                    # Fenwick = SOG + Missed (unblocked attempts)
                    "nhl_shots_missed": _safe_int(player_stat.get("missedShots") or player_stat.get("shotsMissed", 0)),
                    "nhl_shots_blocked": _safe_int(
                        player_stat.get("blockedShotsTaken") or player_stat.get("shotAttemptBlocked", 0)
                    ),
                    
                    # ===================
                    # GAME CONTEXT STATS
                    # ===================
                    "nhl_gwg": _safe_int(player_stat.get("gameWinningGoals", 0)),
                    "nhl_otg": _safe_int(player_stat.get("overtimeGoals") or player_stat.get("otGoals", 0)),
                    "nhl_shifts": _safe_int(player_stat.get("shifts", 0)),
                }
                
                # Calculate faceoff losses from taken - wins
                stats["nhl_faceoff_losses"] = max(0, stats["nhl_faceoff_taken"] - stats["nhl_faceoff_wins"])
                
                # Calculate shot attempts (Corsi) if not directly provided
                shot_attempts = _safe_int(player_stat.get("shotAttempts", 0))
                if shot_attempts == 0:
                    # Manually calculate: SOG + Missed + Blocked
                    shot_attempts = sog + stats["nhl_shots_missed"] + stats["nhl_shots_blocked"]
                stats["nhl_shot_attempts"] = shot_attempts
                
                # Derive PPG/PPA from PPP if not directly available
                if stats["nhl_ppp"] > 0 and stats["nhl_ppg"] == 0 and stats["nhl_ppa"] == 0:
                    # API didn't provide breakdown; we can't split accurately
                    # Leave as 0 - PPP is still accurate for total
                    pass
                
                # Derive SHG/SHA from SHP if not directly available  
                if stats["nhl_shp"] > 0 and stats["nhl_shg"] == 0 and stats["nhl_sha"] == 0:
                    # API didn't provide breakdown; we can't split accurately
                    # Leave as 0 - SHP is still accurate for total
                    pass
                
                # ===================
                # GOALIE STATS
                # ===================
                if is_goalie:
                    saves = _safe_int(player_stat.get("saves", 0))
                    shots_faced = _safe_int(
                        player_stat.get("shotsAgainst") or player_stat.get("shotsFaced", 0)
                    )
                    goals_against = _safe_int(player_stat.get("goalsAgainst", 0))
                    
                    # Decision: 'W', 'L', 'O' for Win, Loss, OT Loss
                    decision = player_stat.get("decision", "")
                    
                    stats.update({
                        "nhl_wins": 1 if decision == "W" else 0,
                        "nhl_losses": 1 if decision == "L" else 0,
                        "nhl_ot_losses": 1 if decision == "O" else 0,
                        "nhl_saves": saves,
                        "nhl_shots_faced": shots_faced,
                        "nhl_goals_against": goals_against,
                        "nhl_shutouts": 1 if goals_against == 0 and shots_faced > 0 else 0,
                        
                        # Save percentage with divide-by-zero protection
                        "nhl_save_pct": _calculate_save_pct(saves, shots_faced),
                        
                        # Situation-specific stats (if available)
                        "nhl_even_saves": _safe_int(player_stat.get("evenSaves") or player_stat.get("evenStrengthSaves", 0)),
                        "nhl_even_shots_against": _safe_int(
                            player_stat.get("evenShotsAgainst") or player_stat.get("evenStrengthShotsAgainst", 0)
                        ),
                        "nhl_pp_saves": _safe_int(
                            player_stat.get("powerPlaySaves") or player_stat.get("ppSaves", 0)
                        ),
                        "nhl_pp_shots_against": _safe_int(
                            player_stat.get("powerPlayShotsAgainst") or player_stat.get("ppShotsAgainst", 0)
                        ),
                        "nhl_sh_saves": _safe_int(
                            player_stat.get("shorthandedSaves") or player_stat.get("shSaves", 0)
                        ),
                        "nhl_sh_shots_against": _safe_int(
                            player_stat.get("shorthandedShotsAgainst") or player_stat.get("shShotsAgainst", 0)
                        ),
                    })
                else:
                    # Zero out goalie-specific stats for skaters
                    stats.update({
                        "nhl_wins": 0,
                        "nhl_losses": 0,
                        "nhl_ot_losses": 0,
                        "nhl_saves": 0,
                        "nhl_shots_faced": 0,
                        "nhl_goals_against": 0,
                        "nhl_shutouts": 0,
                        "nhl_save_pct": 0.000,
                        "nhl_even_saves": 0,
                        "nhl_even_shots_against": 0,
                        "nhl_pp_saves": 0,
                        "nhl_pp_shots_against": 0,
                        "nhl_sh_saves": 0,
                        "nhl_sh_shots_against": 0,
                    })
                
                player_stats_map[player_id] = stats
    
    return player_stats_map


def get_week_dates(week_start: date, week_end: date) -> List[date]:
    """Get all dates in the week (Mon-Sun)."""
    dates = []
    current = week_start
    while current <= week_end:
        dates.append(current)
        current += timedelta(days=1)
    return dates


def get_games_for_week(db: SupabaseRest, week_start: date, week_end: date) -> List[Dict]:
    """Get all games for the week from nhl_games table with pagination."""
    # Note: supabase_rest has a bug where multiple filters on same column overwrite
    # So we fetch more games and filter in Python
    # Use pagination to ensure we get all games
    all_games = _paginate_select(
        db,
        "nhl_games",
        select="game_id,game_date,home_team,away_team,status",
        filters=[
            ("game_date", "gte", week_start.isoformat())
        ]
    )
    
    # Filter by end date in Python
    week_end_str = week_end.isoformat()
    games = [g for g in (all_games or []) if g.get("game_date", "") <= week_end_str]
    
    return games


def _paginate_select(db: SupabaseRest, table: str, select: str, filters: list, max_records: int = 50000) -> list:
    """Paginate through all records to bypass the 1000 record API limit."""
    all_records = []
    offset = 0
    batch_size = 1000
    
    while len(all_records) < max_records:
        try:
            batch = db.select(table, select=select, filters=filters, limit=batch_size, offset=offset)
            if not batch:
                break
            all_records.extend(batch)
            if len(batch) < batch_size:
                break
            offset += batch_size
        except Exception as e:
            print(f"  [WARN] Pagination error: {e}")
            break
    
    return all_records


def get_games_missing_goalies(db: SupabaseRest, week_start: date, week_end: date, season: int) -> List[Dict]:
    """
    Get games that have skater data but NO goalie data in player_game_stats.
    This is the smart approach - only process games that need goalie records created.
    Uses pagination to handle large datasets.
    """
    # Get games that have player_game_stats records in our date range
    week_start_str = week_start.isoformat()
    week_end_str = week_end.isoformat()
    
    # Get distinct game_ids that have skater data (with pagination)
    skater_games = _paginate_select(
        db,
        "player_game_stats",
        select="game_id,game_date",
        filters=[
            ("season", "eq", season),
            ("is_goalie", "eq", False),
            ("game_date", "gte", week_start_str)
        ]
    )
    
    # Filter by end date and get unique game_ids
    game_ids_with_skaters = set()
    game_dates = {}
    for g in (skater_games or []):
        gdate = g.get("game_date", "")
        if gdate <= week_end_str:
            gid = g.get("game_id")
            game_ids_with_skaters.add(gid)
            game_dates[gid] = gdate
    
    # Get game_ids that have goalie data (with pagination)
    goalie_games = _paginate_select(
        db,
        "player_game_stats",
        select="game_id",
        filters=[
            ("season", "eq", season),
            ("is_goalie", "eq", True),
            ("game_date", "gte", week_start_str)
        ]
    )
    game_ids_with_goalies = set(g.get("game_id") for g in (goalie_games or []) if g.get("game_date", "") <= week_end_str)
    
    # Find games missing goalies
    missing_goalie_game_ids = game_ids_with_skaters - game_ids_with_goalies
    
    if not missing_goalie_game_ids:
        return []
    
    # Get full game info from nhl_games
    games = db.select(
        "nhl_games",
        select="game_id,game_date,home_team,away_team,status",
        filters=[
            ("game_id", "in", list(missing_goalie_game_ids))
        ],
        limit=500
    )
    
    return games or []


def update_player_game_stats_nhl_columns(
    db: SupabaseRest,
    game_id: int,
    game_date: date,
    player_stats: Dict[int, Dict[str, Any]],
    season: int
) -> Dict[str, int]:
    """
    Update player_game_stats.nhl_* columns for all players in the game.
    
    For GOALIES: Creates new records if they don't exist (same source as skaters).
    For SKATERS: Updates existing records (created by extractor_job.py from PBP).
    
    This ensures goalies and skaters both use official NHL boxscore data for
    public-facing stats (matchups, player cards, fantasy scoring).
    
    Returns dict with counts: {updated, created, skipped}
    """
    updated_count = 0
    created_count = 0
    skipped_count = 0
    
    for player_id, stats in player_stats.items():
        # Extract metadata (these are NOT stored as columns, just used for logic)
        is_goalie = stats.pop("_is_goalie", False)
        team_abbrev = stats.pop("_team_abbrev", "")
        position_code = stats.pop("_position_code", "F")
        
        # Check if player_game_stats record exists
        existing = db.select(
            "player_game_stats",
            select="player_id,team_abbrev,is_goalie",
            filters=[
                ("season", "eq", season),
                ("game_id", "eq", game_id),
                ("player_id", "eq", player_id)
            ],
            limit=1
        )
        
        if existing and len(existing) > 0:
            # =============================================
            # UPDATE existing record (skaters and goalies)
            # =============================================
            update_data = {
                **stats,
                "updated_at": datetime.now().isoformat()
            }
            
            try:
                db.update(
                    "player_game_stats",
                    update_data,
                    filters=[
                        ("season", "eq", season),
                        ("game_id", "eq", game_id),
                        ("player_id", "eq", player_id)
                    ]
                )
                updated_count += 1
            except Exception as e:
                print(f"    [ERROR] Failed to update player {player_id}: {e}")
        
        elif is_goalie:
            # =============================================
            # CREATE new record for GOALIES
            # This is the key fix: goalies get their records
            # from the same NHL boxscore source as skaters
            # =============================================
            
            # Build the complete goalie record
            goalie_record = {
                # Primary keys
                "season": season,
                "game_id": game_id,
                "player_id": player_id,
                
                # Game context
                "game_date": game_date.isoformat() if isinstance(game_date, date) else game_date,
                "team_abbrev": team_abbrev,
                
                # Position identifiers
                "position_code": "G",
                "is_goalie": True,
                
                # =============================================
                # NHL official stats (nhl_* columns)
                # These are the source of truth for fantasy
                # =============================================
                **stats,
                
                # =============================================
                # Legacy columns (for compatibility/fallback)
                # Mirror the nhl_* values to original columns
                # =============================================
                "goalie_gp": 1,
                "wins": stats.get("nhl_wins", 0),
                "saves": stats.get("nhl_saves", 0),
                "shots_faced": stats.get("nhl_shots_faced", 0),
                "goals_against": stats.get("nhl_goals_against", 0),
                "shutouts": stats.get("nhl_shutouts", 0),
                
                # Zero out skater stats for goalies
                "goals": 0,
                "primary_assists": 0,
                "secondary_assists": 0,
                "points": 0,
                "shots_on_goal": 0,
                "hits": 0,
                "blocks": 0,
                "pim": 0,
                "ppp": 0,
                "shp": 0,
                "plus_minus": 0,
                "icetime_seconds": stats.get("nhl_toi_seconds", 0),
                
                # Timestamps
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            try:
                db.upsert("player_game_stats", goalie_record, on_conflict="season,game_id,player_id")
                created_count += 1
            except Exception as e:
                print(f"    [ERROR] Failed to create goalie record for {player_id}: {e}")
        
        else:
            # Skater without existing record - will be created by extractor_job
            skipped_count += 1
    
    return {
        "updated": updated_count,
        "created": created_count,
        "skipped": skipped_count
    }


def main():
    print("=" * 80)
    print("SCRAPE PER-GAME NHL STATS")
    print("=" * 80)
    print(f"Season: {DEFAULT_SEASON}")
    print("This script scrapes NHL official game-by-game stats from gamecenter boxscore endpoint")
    print("and populates player_game_stats.nhl_* columns.")
    print()
    
    # Check for command line arguments for custom week dates
    # Usage: python scrape_per_game_nhl_stats.py [YYYY-MM-DD] [YYYY-MM-DD]
    # Example: python scrape_per_game_nhl_stats.py 2025-12-15 2025-12-21
    if len(sys.argv) >= 3:
        try:
            week_start = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
            week_end = datetime.strptime(sys.argv[2], "%Y-%m-%d").date()
            print(f"Using custom date range from command line arguments")
        except ValueError as e:
            print(f"ERROR: Invalid date format. Use YYYY-MM-DD. Error: {e}")
            return 1
    else:
        # Get current week dates (Monday-Sunday)
        today = date.today()
        # Calculate Monday of current week
        days_since_monday = today.weekday()  # 0 = Monday, 6 = Sunday
        week_start = today - timedelta(days=days_since_monday)
        week_end = week_start + timedelta(days=6)  # Sunday
    
    print(f"Week: {week_start.isoformat()} (Mon) to {week_end.isoformat()} (Sun)")
    print()
    
    try:
        db = supabase_client()
        print("[scrape_nhl_stats] Connected to Supabase")
    except Exception as e:
        print(f"[scrape_nhl_stats] ERROR: Failed to connect: {e}")
        return 1
    
    # Check for --missing-goalies flag
    missing_goalies_only = "--missing-goalies" in sys.argv
    
    # Get games for this week
    if missing_goalies_only:
        print(f"[scrape_nhl_stats] Finding games MISSING GOALIE DATA for {week_start} to {week_end}...")
        games = get_games_missing_goalies(db, week_start, week_end, DEFAULT_SEASON)
        print(f"[scrape_nhl_stats] Found {len(games)} games missing goalie records")
    else:
        print(f"[scrape_nhl_stats] Fetching ALL games for {week_start} to {week_end}...")
        games = get_games_for_week(db, week_start, week_end)
        print(f"[scrape_nhl_stats] Found {len(games)} games")
    print()
    
    if not games:
        print("[scrape_nhl_stats] No games found for this week. Exiting.")
        return 0
    
    # Process each game
    total_updated = 0
    total_created = 0
    total_skipped = 0
    total_players = 0
    errors = 0
    
    for idx, game in enumerate(games, 1):
        game_id = game.get("game_id")
        game_date = game.get("game_date")
        status = game.get("status", "unknown")
        
        print(f"[{idx}/{len(games)}] Processing game {game_id} ({game_date}, status: {status})...")
        
        # Fetch boxscore
        boxscore = fetch_game_boxscore(game_id)
        if not boxscore:
            print(f"  [ERROR] Failed to fetch boxscore")
            errors += 1
            time.sleep(0.5)  # Rate limiting
            continue
        
        # Extract player stats
        player_stats = extract_player_stats_from_boxscore(boxscore)
        if not player_stats:
            print(f"  [WARNING] No player stats found in boxscore")
            time.sleep(0.5)
            continue
        
        # Count goalies and skaters
        goalie_count = sum(1 for s in player_stats.values() if s.get("_is_goalie", False))
        skater_count = len(player_stats) - goalie_count
        print(f"  Found {len(player_stats)} players ({skater_count} skaters, {goalie_count} goalies)")
        
        # Update database
        game_date_obj = datetime.strptime(game_date, "%Y-%m-%d").date() if isinstance(game_date, str) else game_date
        result = update_player_game_stats_nhl_columns(
            db,
            game_id,
            game_date_obj,
            player_stats,
            DEFAULT_SEASON
        )
        
        total_updated += result["updated"]
        total_created += result["created"]
        total_skipped += result["skipped"]
        total_players += len(player_stats)
        
        # Detailed output per game
        parts = []
        if result["updated"] > 0:
            parts.append(f"updated {result['updated']}")
        if result["created"] > 0:
            parts.append(f"created {result['created']} goalies")
        if result["skipped"] > 0:
            parts.append(f"skipped {result['skipped']} skaters (no base record)")
        
        print(f"  -> {', '.join(parts) if parts else 'no changes'}")
        print()
        
        time.sleep(0.5)  # Rate limiting (500ms between requests)
    
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Games processed: {len(games)}")
    print(f"Players found: {total_players}")
    print(f"Players updated: {total_updated}")
    print(f"Goalies created: {total_created}")
    print(f"Skaters skipped (no base record): {total_skipped}")
    print(f"Errors: {errors}")
    print()
    print("ARCHITECTURE:")
    print("  - Skaters: Records created by extractor_job (PBP), updated here with NHL official stats")
    print("  - Goalies: Records created HERE from NHL boxscore (same official source as skaters)")
    print("  - Public-facing stats (matchups, fantasy) now use unified NHL official data")
    print()
    print("GOALIE STATS NOW AVAILABLE:")
    print("  nhl_wins, nhl_saves, nhl_shots_faced, nhl_goals_against, nhl_shutouts, nhl_save_pct")
    print()
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
