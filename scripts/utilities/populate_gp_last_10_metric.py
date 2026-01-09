#!/usr/bin/env python3
"""
populate_gp_last_10_metric.py

Pre-calculates GP_Last_10 metric for all players to enable fast "Likely-to-Play" filtering.
This metric counts games played in the last 10 games (14-day window) and is used to
filter out inactive players in VOPA calculations.

Usage:
    python populate_gp_last_10_metric.py [season]
    
    Default season: 2025
"""

from dotenv import load_dotenv
import os
import sys
import time
import requests
from datetime import date, timedelta, datetime
from src.utils.citrus_request import citrus_request
from typing import Dict, List, Optional
from collections import defaultdict

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest
from calculate_daily_projections import get_canonical_team_code

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def fetch_nhl_roster_status(db: SupabaseRest, season: int) -> int:
    """
    Fetch official NHL roster statuses from API and update player_talent_metrics.
    
    Calls NHL Roster API (https://api-web.nhle.com/v1/roster/{team}/current) for all teams,
    maps NHL player IDs to our player_id, and updates roster_status and is_ir_eligible.
    
    Args:
        db: Supabase client
        season: Season year
    
    Returns:
        Number of players updated
    """
    print(f"📡 Fetching NHL roster statuses for season {season}...")
    
    # Get all unique team abbreviations from player_directory
    players = db.select(
        "player_directory",
        select="team_abbrev",
        filters=[("season", "eq", season)],
        limit=10000
    )
    
    if not players:
        print("⚠️  No players found for roster status fetch")
        return 0
    
    # Get unique team abbreviations
    team_abbrevs = set()
    for player in players:
        team_abbrev = player.get("team_abbrev")
        if team_abbrev:
            team_abbrevs.add(team_abbrev)
    
    if not team_abbrevs:
        print("⚠️  No team abbreviations found")
        return 0
    
    print(f"   Found {len(team_abbrevs)} unique teams")
    
    # Create mapping of NHL player ID to our player_id
    # Note: Assuming player_directory.player_id is the NHL player ID
    # If there's a separate nhl_player_id field, adjust accordingly
    player_id_map = {}
    all_players = db.select(
        "player_directory",
        select="player_id,team_abbrev",
        filters=[("season", "eq", season)],
        limit=10000
    )
    
    for player in all_players:
        player_id = player.get("player_id")
        team_abbrev = player.get("team_abbrev")
        if player_id and team_abbrev:
            # Use player_id as NHL player ID (adjust if different field exists)
            if team_abbrev not in player_id_map:
                player_id_map[team_abbrev] = {}
            player_id_map[team_abbrev][player_id] = player_id
    
    updated_count = 0
    failed_teams = []
    
    # Fetch roster status for each team
    for team_abbrev in sorted(team_abbrevs):
        try:
            # CRITICAL: Use canonical team code for API call
            canonical_team = get_canonical_team_code(db, team_abbrev)
            
            # Call NHL Roster API
            api_url = f"https://api-web.nhle.com/v1/roster/{canonical_team}/current"
            
            # Retry logic (max 3 retries)
            max_retries = 3
            response = None
            for attempt in range(max_retries):
                try:
                    response = citrus_request(api_url, timeout=10)
                    if response.status_code == 200:
                        break
                    elif response.status_code == 404:
                        # Team not found - skip
                        print(f"   ⚠️  Team {canonical_team} not found in NHL API (404)")
                        break
                    else:
                        if attempt < max_retries - 1:
                            time.sleep(0.5 * (attempt + 1))  # Exponential backoff
                            continue
                except requests.RequestException as e:
                    if attempt < max_retries - 1:
                        time.sleep(0.5 * (attempt + 1))
                        continue
                    else:
                        raise
            
            if not response or response.status_code != 200:
                failed_teams.append(canonical_team)
                continue
            
            # Parse response
            roster_data = response.json()
            
            # Extract players from roster
            # API structure may vary - adjust based on actual response
            roster_players = []
            if isinstance(roster_data, dict):
                # Try common response structures
                if "forwards" in roster_data:
                    roster_players.extend(roster_data.get("forwards", []))
                if "defense" in roster_data:
                    roster_players.extend(roster_data.get("defense", []))
                if "goalies" in roster_data:
                    roster_players.extend(roster_data.get("goalies", []))
                if "players" in roster_data:
                    roster_players.extend(roster_data.get("players", []))
            elif isinstance(roster_data, list):
                roster_players = roster_data
            
            if not roster_players:
                print(f"   ⚠️  No players found in roster for {canonical_team}")
                continue
            
            # Update player_talent_metrics for each player in roster
            team_updated = 0
            for roster_player in roster_players:
                try:
                    # Extract NHL player ID and status from roster response
                    # Adjust field names based on actual API response structure
                    nhl_player_id = roster_player.get("id") or roster_player.get("playerId") or roster_player.get("player_id")
                    roster_status = roster_player.get("status") or roster_player.get("rosterStatus") or roster_player.get("roster_status")
                    
                    if not nhl_player_id:
                        continue
                    
                    # Map NHL player ID to our player_id
                    # Note: This assumes player_directory.player_id matches NHL player ID
                    # If different, adjust mapping logic
                    our_player_id = None
                    if team_abbrev in player_id_map:
                        our_player_id = player_id_map[team_abbrev].get(nhl_player_id)
                    
                    # Also try canonical team mapping
                    if not our_player_id and canonical_team in player_id_map:
                        our_player_id = player_id_map[canonical_team].get(nhl_player_id)
                    
                    if not our_player_id:
                        # Try direct lookup by NHL player ID across all teams
                        player_lookup = db.select(
                            "player_directory",
                            select="player_id",
                            filters=[("player_id", "eq", nhl_player_id), ("season", "eq", season)],
                            limit=1
                        )
                        if player_lookup:
                            our_player_id = player_lookup[0].get("player_id")
                    
                    if not our_player_id:
                        continue
                    
                    # Map status to is_ir_eligible
                    is_ir_eligible = False
                    if roster_status:
                        roster_status_upper = roster_status.upper()
                        if roster_status_upper in ["IR", "LTIR"]:
                            is_ir_eligible = True
                    
                    # Update player_talent_metrics
                    # Preserve existing roster_status if API call fails (don't set to NULL)
                    update_data = {
                        "player_id": our_player_id,
                        "season": season,
                        "is_ir_eligible": is_ir_eligible,
                        "roster_status_updated_at": datetime.now().isoformat()
                    }
                    
                    # Only update roster_status if we got a valid value from API
                    if roster_status:
                        update_data["roster_status"] = roster_status
                    
                    # Check if row exists
                    existing = db.select(
                        "player_talent_metrics",
                        select="player_id",
                        filters=[
                            ("player_id", "eq", our_player_id),
                            ("season", "eq", season)
                        ],
                        limit=1
                    )
                    
                    if existing:
                        db.update(
                            "player_talent_metrics",
                            update_data,
                            filters=[
                                ("player_id", "eq", our_player_id),
                                ("season", "eq", season)
                            ]
                        )
                    else:
                        # Insert new row
                        update_data["gp_last_10"] = 0
                        update_data["is_likely_to_play"] = False
                        update_data["last_updated"] = date.today().isoformat()
                        db.upsert("player_talent_metrics", update_data, on_conflict="player_id,season")
                    
                    team_updated += 1
                    updated_count += 1
                
                except Exception as e:
                    print(f"   ⚠️  Error processing roster player: {e}")
                    continue
            
            print(f"   ✅ {canonical_team}: Updated {team_updated} players")
            
            # Rate limiting: 100ms delay between team requests
            time.sleep(0.1)
        
        except Exception as e:
            print(f"   ❌ Error fetching roster for {team_abbrev} (canonical: {get_canonical_team_code(db, team_abbrev)}): {e}")
            failed_teams.append(team_abbrev)
            continue
    
    print(f"✅ Updated roster status for {updated_count} players")
    if failed_teams:
        print(f"⚠️  Failed to fetch roster for {len(failed_teams)} teams: {', '.join(failed_teams[:5])}")
    
    return updated_count


def calculate_gp_last_10(
    db: SupabaseRest,
    player_id: int,
    season: int,
    today: date
) -> int:
    """
    Calculate games played in last 10 games (14-day window).
    
    Args:
        db: Supabase client
        player_id: Player ID
        season: Season year
        today: Today's date (for window calculation)
    
    Returns:
        Number of games played in last 10 games (within 14-day window)
    """
    # Calculate 14-day window
    window_start = today - timedelta(days=14)
    
    # Get player's games in the window
    player_games = db.select(
        "player_game_stats",
        select="game_id,game_date",
        filters=[
            ("player_id", "eq", player_id),
            ("season", "eq", season),
            ("game_date", "gte", window_start.isoformat()),
            ("game_date", "lte", today.isoformat())
        ],
        limit=20  # More than 10 to account for multiple games per day
    )
    
    if not player_games:
        return 0
    
    # Count distinct game_ids (last 10 games)
    unique_games = set()
    for game in player_games:
        game_id = game.get("game_id")
        if game_id:
            unique_games.add(game_id)
    
    # Return count of last 10 games
    return min(len(unique_games), 10)


def populate_gp_last_10_for_all_players(
    db: SupabaseRest,
    season: int
) -> int:
    """
    Populate GP_Last_10 for all players in the season.
    
    Also fetches NHL roster statuses before calculating GP_Last_10.
    
    Args:
        db: Supabase client
        season: Season year
    
    Returns:
        Number of players updated
    """
    # CRITICAL: Fetch NHL roster statuses first (before GP_Last_10 calculation)
    fetch_nhl_roster_status(db, season)
    
    today = date.today()
    
    # Get all players for the season
    players = db.select(
        "player_directory",
        select="player_id",
        filters=[("season", "eq", season)],
        limit=10000
    )
    
    if not players:
        print(f"⚠️  No players found for season {season}")
        return 0
    
    updated_count = 0
    
    print(f"Calculating GP_Last_10 for {len(players)} players...")
    
    for i, player in enumerate(players, 1):
        player_id = int(player.get("player_id", 0))
        if not player_id:
            continue
        
        try:
            # Calculate GP_Last_10
            gp_last_10 = calculate_gp_last_10(db, player_id, season, today)
            is_likely_to_play = gp_last_10 > 0
            
            # Upsert to player_talent_metrics
            # Check if row exists first to preserve existing columns (like ros_projection_xg)
            existing = db.select(
                "player_talent_metrics",
                select="player_id",
                filters=[
                    ("player_id", "eq", player_id),
                    ("season", "eq", season)
                ],
                limit=1
            )
            
            talent_data = {
                "player_id": player_id,
                "season": season,
                "gp_last_10": gp_last_10,
                "is_likely_to_play": is_likely_to_play,
                "last_updated": today.isoformat()
            }
            
            if existing:
                # Update existing row (preserves other columns like ros_projection_xg)
                db.update(
                    "player_talent_metrics",
                    talent_data,
                    filters=[
                        ("player_id", "eq", player_id),
                        ("season", "eq", season)
                    ]
                )
            else:
                # Insert new row - if ros_projection_xg is NOT NULL, provide a default
                # Try upsert first, and if it fails due to NOT NULL constraint, add default
                try:
                    db.upsert("player_talent_metrics", talent_data, on_conflict="player_id,season")
                except Exception as upsert_error:
                    # If upsert fails due to NOT NULL constraint on ros_projection_xg, add default
                    error_str = str(upsert_error).lower()
                    if "ros_projection_xg" in error_str and ("null value" in error_str or "not null" in error_str):
                        talent_data["ros_projection_xg"] = 0.0  # Default value
                        db.upsert("player_talent_metrics", talent_data, on_conflict="player_id,season")
                    else:
                        raise
            
            updated_count += 1
            
            if i % 100 == 0:
                print(f"  Processed {i}/{len(players)} players...")
        
        except Exception as e:
            print(f"⚠️  Error processing player {player_id}: {e}")
            continue
    
    print(f"✅ Updated GP_Last_10 for {updated_count} players")
    return updated_count


def main():
    db = supabase_client()
    
    # Parse command line arguments
    season = DEFAULT_SEASON
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except ValueError:
            print(f"⚠️  Invalid season: {sys.argv[1]}. Using default: {DEFAULT_SEASON}")
    
    print(f"🚀 Populate GP_Last_10 Metric")
    print(f"   Season: {season}")
    print()
    
    # Populate for all players
    updated = populate_gp_last_10_for_all_players(db, season)
    
    print()
    print(f"✅ Complete: Updated {updated} players")


if __name__ == "__main__":
    main()

