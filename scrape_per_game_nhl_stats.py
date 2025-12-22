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
    
    # Check both teams
    for team_key in ["homeTeam", "awayTeam"]:
        if team_key not in player_stats:
            continue
        
        team_data = player_stats[team_key]
        if not isinstance(team_data, dict):
            continue
        
        # Check forwards, defensemen, goalies
        for position_group in ["forwards", "defensemen", "goalies"]:
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
                
                # ===================
                # CORE SKATER STATS
                # ===================
                goals = _safe_int(player_stat.get("goals", 0))
                assists = _safe_int(player_stat.get("assists", 0))
                sog = _safe_int(player_stat.get("shots", 0))
                
                stats = {
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
                    "nhl_ppp": _safe_int(player_stat.get("powerPlayPoints", 0)),
                    "nhl_ppg": _safe_int(player_stat.get("powerPlayGoals", 0)),
                    "nhl_ppa": _safe_int(player_stat.get("powerPlayAssists", 0)),
                    
                    # ===================
                    # SHORTHANDED BREAKDOWN
                    # ===================
                    "nhl_shp": _safe_int(player_stat.get("shorthandedPoints", 0)),
                    "nhl_shg": _safe_int(player_stat.get("shorthandedGoals", 0)),
                    "nhl_sha": _safe_int(player_stat.get("shorthandedAssists", 0)),
                    
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
    """Get all games for the week from nhl_games table."""
    games = db.select(
        "nhl_games",
        select="game_id,game_date,home_team,away_team,status",
        filters=[
            ("game_date", "gte", week_start.isoformat()),
            ("game_date", "lte", week_end.isoformat())
        ],
        order="game_date.asc,game_id.asc"
    )
    return games or []


def update_player_game_stats_nhl_columns(
    db: SupabaseRest,
    game_id: int,
    game_date: date,
    player_stats: Dict[int, Dict[str, Any]],
    season: int
) -> int:
    """
    Update player_game_stats.nhl_* columns for all players in the game.
    Returns number of players updated.
    
    Note: This only updates existing records. If player_game_stats doesn't exist,
    it will be created by extractor_job.py first, then this script populates nhl_* columns.
    """
    updated_count = 0
    missing_count = 0
    
    for player_id, stats in player_stats.items():
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
            # Update existing record - only update nhl_* columns
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
        else:
            missing_count += 1
            # Record doesn't exist - this is expected if extractor_job hasn't run yet
            # We'll populate nhl_* columns after extractor_job creates the base records
    
    if missing_count > 0:
        print(f"    [INFO] {missing_count} players don't have player_game_stats records yet (will be created by extractor_job)")
    
    return updated_count


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
    
    # Get games for this week
    print(f"[scrape_nhl_stats] Fetching games for week {week_start} to {week_end}...")
    games = get_games_for_week(db, week_start, week_end)
    print(f"[scrape_nhl_stats] Found {len(games)} games this week")
    print()
    
    if not games:
        print("[scrape_nhl_stats] No games found for this week. Exiting.")
        return 0
    
    # Process each game
    total_updated = 0
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
        
        print(f"  Found stats for {len(player_stats)} players")
        
        # Update database
        game_date_obj = datetime.strptime(game_date, "%Y-%m-%d").date() if isinstance(game_date, str) else game_date
        updated = update_player_game_stats_nhl_columns(
            db,
            game_id,
            game_date_obj,
            player_stats,
            DEFAULT_SEASON
        )
        
        total_updated += updated
        total_players += len(player_stats)
        
        print(f"  Updated {updated} player records")
        print()
        
        time.sleep(0.5)  # Rate limiting (500ms between requests)
    
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Games processed: {len(games)}")
    print(f"Players found: {total_players}")
    print(f"Players updated: {total_updated}")
    print(f"Errors: {errors}")
    print()
    print("✅ Per-game NHL stats populated in player_game_stats.nhl_* columns")
    print("   These are now the source of truth for fantasy scoring!")
    print()
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
