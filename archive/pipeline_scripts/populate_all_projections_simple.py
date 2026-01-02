#!/usr/bin/env python3
"""
SIMPLE PROJECTION POPULATOR
============================
Lightweight, reliable projection population without multiprocessing complexity.
Processes one date at a time, handles errors gracefully.

Usage:
    python populate_all_projections_simple.py [--force] [--week N]
"""
import sys
import os
from datetime import datetime, date, timedelta
from typing import Dict, List, Set

# Set UTF-8 encoding for Windows
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Import the core calculation function
from calculate_daily_projections import calculate_daily_projection, DEFAULT_SEASON

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

SEASON = 2025


def get_db():
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def paginate_select(db, table, select, filters, max_records=50000):
    """Paginate through records."""
    all_records = []
    offset = 0
    while len(all_records) < max_records:
        batch = db.select(table, select=select, filters=filters, limit=1000, offset=offset)
        if not batch:
            break
        all_records.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return all_records


def get_games_for_date(db, target_date: str) -> List[Dict]:
    """Get games for a specific date."""
    games = db.select(
        "nhl_games",
        select="game_id,home_team,away_team",
        filters=[("game_date", "eq", target_date), ("season", "eq", SEASON)],
        limit=20
    )
    return games or []


def get_players_for_teams(db, teams: List[str]) -> List[Dict]:
    """Get active players for teams."""
    if not teams:
        return []
    
    players = db.select(
        "player_directory",
        select="player_id,team_abbrev,position_code",
        filters=[("team_abbrev", "in", teams), ("season", "eq", SEASON)],
        limit=1000
    )
    return players or []


def get_player_games_played(db, player_ids: List[int]) -> Dict[int, int]:
    """Get games played for players."""
    if not player_ids:
        return {}
    
    # Query in batches
    gp_map = {}
    for i in range(0, len(player_ids), 100):
        batch = player_ids[i:i+100]
        stats = db.select(
            "player_season_stats",
            select="player_id,games_played",
            filters=[("player_id", "in", batch), ("season", "eq", SEASON)],
            limit=100
        )
        for s in (stats or []):
            pid = s.get("player_id")
            if pid:
                gp_map[int(pid)] = int(s.get("games_played", 0))
    
    return gp_map


def calculate_projections_for_date(db, target_date: date, scoring_settings: Dict) -> List[Dict]:
    """Calculate projections for all players with games on a date."""
    date_str = target_date.isoformat()
    
    # Get games
    games = get_games_for_date(db, date_str)
    if not games:
        return []
    
    # Build team -> game_id map
    team_game_map = {}
    teams = set()
    for game in games:
        gid = int(game.get("game_id", 0))
        home = game.get("home_team", "")
        away = game.get("away_team", "")
        if home:
            team_game_map[home] = gid
            teams.add(home)
        if away:
            team_game_map[away] = gid
            teams.add(away)
    
    # Get players on those teams
    players = get_players_for_teams(db, list(teams))
    if not players:
        return []
    
    # Filter to active players (games_played > 0)
    player_ids = [int(p.get("player_id", 0)) for p in players if p.get("player_id")]
    gp_map = get_player_games_played(db, player_ids)
    
    active_players = [p for p in players if gp_map.get(int(p.get("player_id", 0)), 0) > 0]
    
    # Calculate projections
    projections = []
    for player in active_players:
        player_id = int(player.get("player_id", 0))
        team = player.get("team_abbrev", "")
        game_id = team_game_map.get(team)
        
        if not game_id:
            continue
        
        try:
            proj = calculate_daily_projection(
                db, player_id, game_id, target_date, SEASON, scoring_settings
            )
            if proj:
                projections.append(proj)
        except Exception as e:
            # Skip failed calculations silently
            pass
    
    return projections


def upsert_projections(db, projections: List[Dict]) -> int:
    """Upsert projections to database."""
    if not projections:
        return 0
    
    count = 0
    for proj in projections:
        try:
            db.upsert("player_projected_stats", proj, on_conflict="player_id,game_id,projection_date")
            count += 1
        except:
            pass
    
    return count


def get_week_dates(db, week_number: int) -> tuple:
    """Get start and end date for a week."""
    matchups = db.select(
        "matchups",
        select="week_start_date,week_end_date",
        filters=[("week_number", "eq", week_number)],
        limit=1
    )
    if matchups:
        return matchups[0].get("week_start_date"), matchups[0].get("week_end_date")
    return None, None


def main():
    force = "--force" in sys.argv
    
    # Check for specific week
    week_num = None
    for i, arg in enumerate(sys.argv):
        if arg == "--week" and i + 1 < len(sys.argv):
            try:
                week_num = int(sys.argv[i + 1])
            except:
                pass
    
    print("=" * 60)
    print("SIMPLE PROJECTION POPULATOR")
    print("=" * 60)
    
    db = get_db()
    
    # Default scoring settings (ALL 8 STATS)
    # Note: In production, these should come from leagues.scoring_settings JSONB
    scoring_settings = {
        "skater": {
            "goals": 3,
            "assists": 2,
            "shots_on_goal": 0.4,
            "blocks": 0.5,
            "power_play_points": 1,
            "short_handed_points": 2,
            "hits": 0.2,
            "penalty_minutes": 0.5
        },
        "goalie": {"wins": 4, "shutouts": 3, "saves": 0.2, "goals_against": -1}
    }
    
    # Determine date range
    if week_num:
        start_str, end_str = get_week_dates(db, week_num)
        if not start_str:
            print(f"Week {week_num} not found!")
            return
        print(f"Week {week_num}: {start_str} to {end_str}")
    else:
        # Get all weeks
        matchups = paginate_select(db, "matchups", "week_start_date,week_end_date", [])
        if not matchups:
            print("No matchups found!")
            return
        
        all_starts = [m["week_start_date"] for m in matchups if m.get("week_start_date")]
        all_ends = [m["week_end_date"] for m in matchups if m.get("week_end_date")]
        start_str = min(all_starts)
        end_str = max(all_ends)
        print(f"All weeks: {start_str} to {end_str}")
    
    # Get existing projections
    existing = set()
    if not force:
        projs = paginate_select(db, "player_projected_stats", "projection_date", [])
        existing = set([p["projection_date"] for p in projs if p.get("projection_date")])
        print(f"Existing projection dates: {len(existing)}")
    
    # Get dates with games
    games = paginate_select(db, "nhl_games", "game_date", [("season", "eq", SEASON)])
    game_dates = set([g["game_date"] for g in games if g.get("game_date") and start_str <= g["game_date"] <= end_str])
    print(f"Dates with games in range: {len(game_dates)}")
    
    # Determine dates to process
    if force:
        dates_to_process = sorted(game_dates)
    else:
        dates_to_process = sorted(game_dates - existing)
    
    print(f"Dates to process: {len(dates_to_process)}")
    print()
    
    if not dates_to_process:
        print("[OK] All dates have projections!")
        return
    
    # Process each date
    total_projections = 0
    for i, date_str in enumerate(dates_to_process):
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        print(f"[{i+1}/{len(dates_to_process)}] {date_str}...", end=" ", flush=True)
        
        projections = calculate_projections_for_date(db, target_date, scoring_settings)
        if projections:
            count = upsert_projections(db, projections)
            print(f"{count} projections")
            total_projections += count
        else:
            print("no players")
    
    print()
    print("=" * 60)
    print(f"COMPLETE: {total_projections} projections created")
    print("=" * 60)


if __name__ == "__main__":
    main()
