#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: UTILITY
# Purpose:     Sync fantasy team rosters with current NHL rosters
# Last active: 2026-03-01
# Invoked:     manual run when teams change
# Reads:       team_lineups, NHL roster API
# Writes:      team_lineups
# ────────────────────────────────────────────────────────────
"""
sync_rosters.py

Fast roster synchronization from NHL API to player_directory.
Ensures team assignments, positions, and new players are up-to-date.

This script:
1. Fetches all 32 NHL team rosters from /v1/roster/{team}/current
2. Updates team_abbrev for traded/moved players
3. Inserts new players (call-ups, trades) not yet in player_directory
4. Computes multi-position eligibility from player_game_stats
5. Stores eligible_positions in player_directory

Designed to be fast (<60s) and called before every projection run.
"""

import os
import sys
import time
import datetime as dt
from typing import Dict, List, Optional, Set, Tuple

from dotenv import load_dotenv
from src.utils.citrus_request import citrus_request

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

load_dotenv()

from supabase_rest import SupabaseRest

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

NHL_API_BASE = "https://api-web.nhle.com/v1"

TEAMS = [
    "ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ",
    "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NSH",
    "NJD", "NYI", "NYR", "OTT", "PHI", "PIT", "SJS", "SEA",
    "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WSH", "WPG",
]

# Map NHL API team codes to our canonical codes
_API_TO_CANONICAL = {
    "UTA": "UTA",  # Utah Hockey Club (use UTA as canonical)
}

# Map our canonical codes to NHL API codes for fetching
_CANONICAL_TO_API = {
    "ARI": "UTA",  # Arizona relocated to Utah
}

# Minimum games at a secondary position to gain eligibility.
# Industry standard: Yahoo = 5 GP, ESPN = 10 GP. We use 5 (Yahoo standard).
MIN_GAMES_FOR_ELIGIBILITY = 5


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _normalize_position(pos: str) -> str:
    """Normalize NHL API position codes to our standard codes."""
    if not pos:
        return ""
    pos = pos.upper().strip()
    if pos == "L":
        return "LW"
    elif pos == "R":
        return "RW"
    return pos


def fetch_all_rosters() -> Dict[int, dict]:
    """
    Fetch current rosters for all 32 NHL teams.

    Returns:
        Dict mapping player_id -> {
            team_abbrev, full_name, position_code, is_goalie,
            jersey_number, headshot_url, shoots_catches
        }
    """
    all_players = {}

    for team_abbrev in TEAMS:
        api_team = _CANONICAL_TO_API.get(team_abbrev, team_abbrev)

        try:
            url = f"{NHL_API_BASE}/roster/{api_team}/current"
            response = citrus_request(url, timeout=10)

            if response.status_code != 200:
                print(f"   [sync_rosters] WARNING: {team_abbrev} returned {response.status_code}")
                continue

            data = response.json()

            # NHL API returns: forwards, defensemen, goalies
            roster = (
                data.get("forwards", []) +
                data.get("defensemen", []) +
                data.get("goalies", [])
            )

            for player in roster:
                player_id = player.get("id")
                if not player_id:
                    continue

                first_name = player.get("firstName", {}).get("default", "")
                last_name = player.get("lastName", {}).get("default", "")
                full_name = f"{first_name} {last_name}".strip()

                position_code = _normalize_position(
                    player.get("positionCode", "")
                )
                is_goalie = (position_code == "G")

                # Use our canonical team code
                canonical_team = _API_TO_CANONICAL.get(api_team, team_abbrev)

                all_players[player_id] = {
                    "player_id": player_id,
                    "team_abbrev": canonical_team,
                    "full_name": full_name,
                    "position_code": position_code,
                    "is_goalie": is_goalie,
                    "jersey_number": str(player.get("sweaterNumber", "")) or None,
                    "headshot_url": player.get("headshot"),
                    "shoots_catches": player.get("shootsCatches"),
                }

            time.sleep(0.1)  # Rate limit between teams

        except Exception as e:
            print(f"   [sync_rosters] ERROR fetching {team_abbrev}: {e}")
            continue

    return all_players


def get_current_directory(db: SupabaseRest, season: int) -> Dict[int, dict]:
    """
    Get all players currently in player_directory for this season.

    Returns:
        Dict mapping player_id -> {team_abbrev, position_code, full_name}
    """
    batch_size = 1000
    offset = 0
    result = {}

    while True:
        rows = db.select(
            "player_directory",
            select="player_id,team_abbrev,position_code,full_name",
            filters=[("season", "eq", season)],
            limit=batch_size,
            offset=offset
        )
        if not rows:
            break

        for row in rows:
            pid = row.get("player_id")
            if pid:
                result[int(pid)] = {
                    "team_abbrev": row.get("team_abbrev"),
                    "position_code": row.get("position_code"),
                    "full_name": row.get("full_name"),
                }

        if len(rows) < batch_size:
            break
        offset += batch_size

    return result


def compute_multi_position_eligibility(
    db: SupabaseRest,
    season: int,
    player_ids: List[int],
    api_players: Optional[Dict[int, dict]] = None,
) -> Dict[int, List[str]]:
    """
    Compute multi-position eligibility from player_game_stats.

    Industry standard (Yahoo Fantasy): A player gains eligibility at a position
    if they have played MIN_GAMES_FOR_ELIGIBILITY (5) games at that position
    during the current season.

    Data sources (in priority order):
    1. player_game_stats.position_code — actual game-by-game position data
    2. NHL API roster position — current official position (always included as primary)

    Rules:
    - Primary position (most games) is always included
    - Secondary positions require 5+ games played (MIN_GAMES_FOR_ELIGIBILITY)
    - Maximum 3 positions per player (primary + up to 2 secondary)
    - Goalies cannot gain skater eligibility and vice versa

    Returns:
        Dict mapping player_id -> list of eligible position codes (e.g., ["C", "LW"])
    """
    if not player_ids:
        return {}

    VALID_POSITIONS = {"C", "LW", "RW", "D", "G"}
    GOALIE_POSITIONS = {"G"}

    # Query game-level position data in batches
    position_counts: Dict[int, Dict[str, int]] = {}  # player_id -> {position: game_count}
    _diag_null_count = 0
    _diag_total_rows = 0

    for i in range(0, len(player_ids), 100):
        batch = player_ids[i:i+100]

        try:
            rows = db.select(
                "player_game_stats",
                select="player_id,position_code",
                filters=[
                    ("player_id", "in", batch),
                    ("season", "eq", season),
                ],
                limit=10000
            )

            for row in rows:
                _diag_total_rows += 1
                pid = int(row.get("player_id", 0))
                raw_pos = row.get("position_code") or ""
                pos = _normalize_position(raw_pos)
                # Skip invalid/generic positions (NULL, empty, "F" fallback)
                if pid and pos and pos in VALID_POSITIONS:
                    if pid not in position_counts:
                        position_counts[pid] = {}
                    position_counts[pid][pos] = position_counts[pid].get(pos, 0) + 1
                elif pid and not pos:
                    _diag_null_count += 1
        except Exception as e:
            print(f"   [sync_rosters] WARNING: Error fetching game positions batch: {e}")
            continue

    # Diagnostic: report data quality
    _players_with_data = len(position_counts)
    if _diag_total_rows > 0:
        null_pct = (_diag_null_count / _diag_total_rows * 100)
        print(f"   [sync_rosters] Position data: {_diag_total_rows} game rows, "
              f"{_players_with_data} players with position data, "
              f"{_diag_null_count} NULL position_codes ({null_pct:.0f}%)")
        if null_pct > 50:
            print(f"   [sync_rosters] NOTE: Most position_codes are NULL. "
                  f"Run scrape_per_game_nhl_stats.py to backfill game positions.")
    else:
        print(f"   [sync_rosters] Position data: no game rows found for season {season}")

    # Build eligibility map
    eligibility: Dict[int, List[str]] = {}

    for pid in player_ids:
        pos_counts = position_counts.get(pid, {})

        # Get the API roster position as baseline (always the primary)
        api_primary = ""
        if api_players and pid in api_players:
            api_primary = api_players[pid].get("position_code", "")

        if not pos_counts and not api_primary:
            continue

        # Merge: ensure API primary position is represented
        if api_primary and api_primary in VALID_POSITIONS and api_primary not in pos_counts:
            pos_counts[api_primary] = 0  # 0 games but it's their listed position

        # Filter to valid positions only (skip "F" fallback, empty, etc.)
        pos_counts = {p: c for p, c in pos_counts.items() if p in VALID_POSITIONS}

        # Sort positions by game count (most played first)
        sorted_positions = sorted(pos_counts.items(), key=lambda x: -x[1])

        if not sorted_positions:
            continue

        # Determine if player is a goalie or skater
        primary_pos = sorted_positions[0][0]
        # If API says goalie, treat as goalie even if game stats say otherwise
        is_goalie = (api_primary == "G") or (primary_pos == "G")

        eligible = []

        if is_goalie:
            # Goalies only get G eligibility
            eligible = ["G"]
        else:
            # Skaters: primary + secondary positions meeting threshold
            for pos, count in sorted_positions:
                if pos in GOALIE_POSITIONS:
                    continue  # Skaters can't gain goalie eligibility

                if len(eligible) == 0:
                    # Primary position: always included (even with 0 game stats,
                    # because the NHL roster says this is their position)
                    eligible.append(pos)
                elif count >= MIN_GAMES_FOR_ELIGIBILITY and len(eligible) < 3:
                    # Secondary/tertiary: must meet the games threshold
                    eligible.append(pos)

            # Ensure API primary is first if it's in the list
            if api_primary and api_primary in eligible and eligible[0] != api_primary:
                eligible.remove(api_primary)
                eligible.insert(0, api_primary)

        if eligible:
            eligibility[pid] = eligible

    return eligibility


def sync_rosters(
    db: Optional[SupabaseRest] = None,
    season: Optional[int] = None
) -> dict:
    """
    Main roster sync function. Updates player_directory with current NHL rosters.

    Returns:
        Summary dict with counts of updates/inserts
    """
    if db is None:
        db = supabase_client()
    if season is None:
        season = DEFAULT_SEASON

    print(f"   [sync_rosters] Syncing rosters for season {season}...")

    # Step 1: Fetch all current NHL rosters
    print(f"   [sync_rosters] Fetching rosters from NHL API...")
    api_players = fetch_all_rosters()
    print(f"   [sync_rosters] Found {len(api_players)} players across 32 teams")

    # Step 2: Get current directory state
    print(f"   [sync_rosters] Loading current player_directory...")
    current_dir = get_current_directory(db, season)
    print(f"   [sync_rosters] {len(current_dir)} players in directory")

    # Step 3: Diff - find team changes and new players
    team_updates = []  # Players whose team changed
    new_players = []   # Players not in directory at all
    position_updates = []  # Players whose position changed

    for pid, api_data in api_players.items():
        current = current_dir.get(pid)

        if current is None:
            # New player - not in directory
            new_players.append(api_data)
        else:
            # Existing player - check if team changed
            if current["team_abbrev"] != api_data["team_abbrev"]:
                team_updates.append({
                    "player_id": pid,
                    "old_team": current["team_abbrev"],
                    "new_team": api_data["team_abbrev"],
                    "name": api_data["full_name"],
                })

            # Check if primary position changed
            if (current["position_code"] != api_data["position_code"]
                and api_data["position_code"]):
                position_updates.append({
                    "player_id": pid,
                    "old_position": current["position_code"],
                    "new_position": api_data["position_code"],
                    "name": api_data["full_name"],
                })

    # Step 4: Apply team updates
    if team_updates:
        print(f"   [sync_rosters] Updating {len(team_updates)} team assignments:")
        for update in team_updates:
            print(f"      {update['name']}: {update['old_team']} -> {update['new_team']}")
            try:
                db.update(
                    "player_directory",
                    {
                        "team_abbrev": update["new_team"],
                        "updated_at": _now_iso(),
                    },
                    filters=[
                        ("player_id", "eq", update["player_id"]),
                        ("season", "eq", season),
                    ]
                )
            except Exception as e:
                print(f"      ERROR updating {update['name']}: {e}")
    else:
        print(f"   [sync_rosters] No team changes detected")

    # Step 5: Apply position updates
    if position_updates:
        print(f"   [sync_rosters] Updating {len(position_updates)} position changes:")
        for update in position_updates:
            print(f"      {update['name']}: {update['old_position']} -> {update['new_position']}")
            try:
                db.update(
                    "player_directory",
                    {
                        "position_code": update["new_position"],
                        "is_goalie": update["new_position"] == "G",
                        "updated_at": _now_iso(),
                    },
                    filters=[
                        ("player_id", "eq", update["player_id"]),
                        ("season", "eq", season),
                    ]
                )
            except Exception as e:
                print(f"      ERROR updating position for {update['name']}: {e}")

    # Step 6: Insert new players
    if new_players:
        print(f"   [sync_rosters] Adding {len(new_players)} new players:")
        rows_to_insert = []
        for player in new_players:
            name = player["full_name"]
            team = player["team_abbrev"]
            print(f"      + {name} ({team})")

            rows_to_insert.append({
                "season": season,
                "player_id": player["player_id"],
                "full_name": name,
                "team_abbrev": team,
                "position_code": player["position_code"],
                "is_goalie": player["is_goalie"],
                "jersey_number": player.get("jersey_number"),
                "headshot_url": player.get("headshot_url"),
                "shoots_catches": player.get("shoots_catches"),
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "source_last_fetched_at": _now_iso(),
            })

        if rows_to_insert:
            try:
                db.upsert("player_directory", rows_to_insert, on_conflict="season,player_id")
                print(f"   [sync_rosters] Inserted {len(rows_to_insert)} new players")
            except Exception as e:
                print(f"   [sync_rosters] ERROR inserting new players: {e}")
    else:
        print(f"   [sync_rosters] No new players to add")

    # Step 7: Compute multi-position eligibility (industry standard: 5 GP threshold)
    print(f"   [sync_rosters] Computing multi-position eligibility (threshold: {MIN_GAMES_FOR_ELIGIBILITY} GP)...")
    all_player_ids = list(set(list(api_players.keys()) + list(current_dir.keys())))
    eligibility = compute_multi_position_eligibility(db, season, all_player_ids, api_players)

    multi_pos_count = 0
    multi_pos_updates = []
    for pid, positions in eligibility.items():
        if len(positions) > 1:
            multi_pos_count += 1
            # Format as comma-separated: "C,LW" or "RW,LW"
            eligible_str = ",".join(positions)
            multi_pos_updates.append({
                "player_id": pid,
                "eligible_positions": eligible_str,
            })

    # Batch update eligible_positions
    if multi_pos_updates:
        print(f"   [sync_rosters] {multi_pos_count} players have multi-position eligibility")
        # Show a few examples
        examples = multi_pos_updates[:5]
        for ex in examples:
            name = ""
            if api_players and ex["player_id"] in api_players:
                name = api_players[ex["player_id"]].get("full_name", "")
            elif ex["player_id"] in current_dir:
                name = current_dir[ex["player_id"]].get("full_name", "")
            print(f"      {name or ex['player_id']}: {ex['eligible_positions']}")
        if len(multi_pos_updates) > 5:
            print(f"      ... and {len(multi_pos_updates) - 5} more")
        for update in multi_pos_updates:
            try:
                db.update(
                    "player_directory",
                    {
                        "eligible_positions": update["eligible_positions"],
                        "updated_at": _now_iso(),
                    },
                    filters=[
                        ("player_id", "eq", update["player_id"]),
                        ("season", "eq", season),
                    ]
                )
            except Exception as e:
                # eligible_positions column might not exist yet - that's OK
                if "eligible_positions" in str(e).lower() or "column" in str(e).lower():
                    print(f"   [sync_rosters] NOTE: eligible_positions column not found in DB.")
                    print(f"   [sync_rosters] Run migration 20260301000000_add_eligible_positions.sql to enable.")
                    break
                print(f"   [sync_rosters] WARNING: Error updating eligibility for {update['player_id']}: {e}")

    # Also set eligible_positions for single-position players from API data
    for pid, api_data in api_players.items():
        if pid not in eligibility or len(eligibility.get(pid, [])) <= 1:
            pos = api_data["position_code"]
            if pos:
                try:
                    db.update(
                        "player_directory",
                        {
                            "eligible_positions": pos,
                            "updated_at": _now_iso(),
                        },
                        filters=[
                            ("player_id", "eq", pid),
                            ("season", "eq", season),
                        ]
                    )
                except Exception:
                    break  # Column doesn't exist, stop trying

    summary = {
        "api_players": len(api_players),
        "directory_players": len(current_dir),
        "team_updates": len(team_updates),
        "position_updates": len(position_updates),
        "new_players": len(new_players),
        "multi_position": multi_pos_count,
    }

    print(f"   [sync_rosters] Done:")
    print(f"      API players scanned: {summary['api_players']}")
    print(f"      Team reassignments:  {summary['team_updates']}")
    print(f"      Position updates:    {summary['position_updates']}")
    print(f"      New players added:   {summary['new_players']}")
    print(f"      Multi-position:      {summary['multi_position']}")

    return summary


if __name__ == "__main__":
    print("=" * 70)
    print("  CITRUS ROSTER SYNC")
    print("=" * 70)

    season = DEFAULT_SEASON
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except ValueError:
            print(f"Invalid season: {sys.argv[1]}, using default: {DEFAULT_SEASON}")

    print(f"  Season: {season}")
    print(f"  Timestamp: {_now_iso()}")
    print()

    result = sync_rosters(season=season)

    print()
    print("=" * 70)
    print("  ROSTER SYNC COMPLETE")
    print("=" * 70)
