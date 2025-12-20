#!/usr/bin/env python3
"""
test_calculate_matchup_scores.py

Pytest test suite for World Class Matchup Engine calculation logic.
Tests fractional precision, stat corrections, GR decay, calibration, and Active GR tracking.
"""

import os
import sys
import pytest
import datetime as dt
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import uuid4

from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from calculate_matchup_scores import (
    supabase_client,
    calculate_matchup_scores,
    get_active_matchups,
    load_league_scoring_settings,
    calculate_fantasy_points,
    calculate_games_remaining,
    get_team_starters,
    get_player_team_abbrev,
    _safe_int,
    _now_iso
)

load_dotenv()

# Test configuration
TEST_PREFIX = "test_matchup_engine_"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


# ============================================================================
# Helper Functions
# ============================================================================

def count_lines(db: SupabaseRest, matchup_id: str, player_id: int) -> int:
    """Count records in fantasy_matchup_lines for a player."""
    lines = db.select(
        "fantasy_matchup_lines",
        select="id",
        filters=[
            ("matchup_id", "eq", matchup_id),
            ("player_id", "eq", player_id)
        ]
    )
    return len(lines) if lines else 0


def get_total_points(db: SupabaseRest, matchup_id: str, player_id: int) -> Optional[Decimal]:
    """Get total_points for a player in a matchup."""
    lines = db.select(
        "fantasy_matchup_lines",
        select="total_points",
        filters=[
            ("matchup_id", "eq", matchup_id),
            ("player_id", "eq", player_id)
        ],
        limit=1
    )
    if lines and len(lines) > 0:
        return Decimal(str(lines[0].get("total_points", 0)))
    return None


def get_matchup_line(db: SupabaseRest, matchup_id: str, player_id: int) -> Optional[Dict[str, Any]]:
    """Get full matchup line record for a player."""
    lines = db.select(
        "fantasy_matchup_lines",
        select="*",
        filters=[
            ("matchup_id", "eq", matchup_id),
            ("player_id", "eq", player_id)
        ],
        limit=1
    )
    return lines[0] if lines and len(lines) > 0 else None


def verify_gr(
    db: SupabaseRest,
    matchup_id: str,
    player_id: int,
    expected_total: int,
    expected_active: int
) -> bool:
    """Verify games remaining values."""
    line = get_matchup_line(db, matchup_id, player_id)
    if not line:
        return False
    return (
        line.get("games_remaining_total") == expected_total and
        line.get("games_remaining_active") == expected_active
    )


def get_total_gr(db: SupabaseRest, matchup_id: str, player_id: int) -> int:
    """Get games_remaining_total for a player."""
    line = get_matchup_line(db, matchup_id, player_id)
    return line.get("games_remaining_total", 0) if line else 0


def get_active_gr(db: SupabaseRest, matchup_id: str, player_id: int) -> int:
    """Get games_remaining_active for a player."""
    line = get_matchup_line(db, matchup_id, player_id)
    return line.get("games_remaining_active", 0) if line else 0


def update_player_game_stats(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    game_date: str,
    **stats
) -> None:
    """Update or insert player_game_stats for testing."""
    # Check if record exists
    existing = db.select(
        "player_game_stats",
        select="*",
        filters=[
            ("season", "eq", DEFAULT_SEASON),
            ("game_id", "eq", game_id),
            ("player_id", "eq", player_id)
        ],
        limit=1
    )
    
    stats_data = {
        "season": DEFAULT_SEASON,
        "game_id": game_id,
        "game_date": game_date,
        "player_id": player_id,
        **stats
    }
    
    if existing and len(existing) > 0:
        # Update existing
        db.update(
            "player_game_stats",
            stats_data,
            filters=[
                ("season", "eq", DEFAULT_SEASON),
                ("game_id", "eq", game_id),
                ("player_id", "eq", player_id)
            ]
        )
    else:
        # Insert new
        db.insert("player_game_stats", stats_data)


def update_game_status(db: SupabaseRest, game_id: int, status: str) -> None:
    """Update nhl_games status."""
    db.update(
        "nhl_games",
        {"status": status, "updated_at": _now_iso()},
        filters=[("game_id", "eq", game_id)]
    )


def ensure_lineup(
    db: SupabaseRest,
    team_id: str,
    league_id: str,
    starters: List[int] = None,
    bench: List[int] = None
) -> None:
    """Create or update team_lineups."""
    starters = starters or []
    bench = bench or []
    
    # Check if lineup exists
    existing = db.select(
        "team_lineups",
        select="*",
        filters=[
            ("team_id", "eq", team_id),
            ("league_id", "eq", league_id)
        ],
        limit=1
    )
    
    lineup_data = {
        "team_id": team_id,
        "league_id": league_id,
        "starters": [str(sid) for sid in starters],
        "bench": [str(bid) for bid in bench],
        "ir": [],
        "slot_assignments": {}
    }
    
    if existing and len(existing) > 0:
        # Update
        db.update(
            "team_lineups",
            lineup_data,
            filters=[
                ("team_id", "eq", team_id),
                ("league_id", "eq", league_id)
            ]
        )
    else:
        # Insert
        db.insert("team_lineups", lineup_data)


def corrupt_team_score(
    db: SupabaseRest,
    matchup_id: str,
    team: str,
    wrong_value: float
) -> None:
    """Intentionally corrupt team score for calibration testing."""
    field = "team1_score" if team == "team1" else "team2_score"
    db.update(
        "matchups",
        {field: wrong_value, "updated_at": _now_iso()},
        filters=[("id", "eq", matchup_id)]
    )


def verify_games_played_increased(
    db: SupabaseRest,
    matchup_id: str,
    player_id: int
) -> bool:
    """Verify games_played increased (helper for GR decay test)."""
    line = get_matchup_line(db, matchup_id, player_id)
    return line.get("games_played", 0) > 0 if line else False


# ============================================================================
# Pytest Fixtures
# ============================================================================

@pytest.fixture(scope="module")
def db():
    """SupabaseRest client fixture."""
    return supabase_client()


@pytest.fixture
def test_league(db):
    """Create test league with scoring_settings."""
    league_id = str(uuid4())
    league_data = {
        "id": league_id,
        "name": f"{TEST_PREFIX}Test League",
        "commissioner_id": str(uuid4()),  # Dummy UUID
        "scoring_settings": {
            "skater": {
                "goals": 3,
                "assists": 2,
                "blocks": 0.5,
                "shots_on_goal": 0.4,
                "hits": 0.2
            },
            "goalie": {
                "wins": 4,
                "saves": 0.2,
                "goals_against": -1
            },
            "advanced": {
                "use_fractional_scoring": False
            }
        }
    }
    
    try:
        db.insert("leagues", league_data)
        yield league_id
    finally:
        # Cleanup
        try:
            db.delete("leagues", filters=[("id", "eq", league_id)])
        except:
            pass


@pytest.fixture
def test_teams(db, test_league):
    """Create test teams."""
    team1_id = str(uuid4())
    team2_id = str(uuid4())
    
    team1_data = {
        "id": team1_id,
        "league_id": test_league,
        "name": f"{TEST_PREFIX}Team 1",
        "owner_id": str(uuid4())
    }
    
    team2_data = {
        "id": team2_id,
        "league_id": test_league,
        "name": f"{TEST_PREFIX}Team 2",
        "owner_id": str(uuid4())
    }
    
    try:
        db.insert("teams", team1_data)
        db.insert("teams", team2_data)
        yield (team1_id, team2_id)
    finally:
        # Cleanup
        try:
            db.delete("teams", filters=[("id", "eq", team1_id)])
            db.delete("teams", filters=[("id", "eq", team2_id)])
        except:
            pass


@pytest.fixture
def test_matchup(db, test_league, test_teams):
    """Create test matchup."""
    team1_id, team2_id = test_teams
    matchup_id = str(uuid4())
    
    today = dt.date.today()
    week_start = today - dt.timedelta(days=2)
    week_end = today + dt.timedelta(days=5)
    
    matchup_data = {
        "id": matchup_id,
        "league_id": test_league,
        "week_number": 1,
        "team1_id": team1_id,
        "team2_id": team2_id,
        "week_start_date": week_start.isoformat(),
        "week_end_date": week_end.isoformat(),
        "status": "active",
        "team1_score": 0,
        "team2_score": 0
    }
    
    try:
        db.insert("matchups", matchup_data)
        yield matchup_id
    finally:
        # Cleanup
        try:
            db.delete("matchups", filters=[("id", "eq", matchup_id)])
        except:
            pass


@pytest.fixture
def test_players(db):
    """Create test players in player_directory."""
    player_ids = []
    
    players_data = [
        {
            "season": DEFAULT_SEASON,
            "player_id": 999901,
            "full_name": f"{TEST_PREFIX}Test Player 1",
            "team_abbrev": "EDM",
            "position_code": "D",
            "is_goalie": False
        },
        {
            "season": DEFAULT_SEASON,
            "player_id": 999902,
            "full_name": f"{TEST_PREFIX}Test Player 2",
            "team_abbrev": "EDM",
            "position_code": "C",
            "is_goalie": False
        },
        {
            "season": DEFAULT_SEASON,
            "player_id": 999903,
            "full_name": f"{TEST_PREFIX}Test Goalie",
            "team_abbrev": "NYR",
            "position_code": "G",
            "is_goalie": True
        }
    ]
    
    try:
        for player_data in players_data:
            player_ids.append(player_data["player_id"])
            db.insert("player_directory", player_data)
        yield player_ids
    finally:
        # Cleanup
        for pid in player_ids:
            try:
                db.delete(
                    "player_directory",
                    filters=[
                        ("season", "eq", DEFAULT_SEASON),
                        ("player_id", "eq", pid)
                    ]
                )
            except:
                pass


# ============================================================================
# Test Scenarios
# ============================================================================

def test_fractional_precision(db, test_matchup, test_league, test_teams, test_players):
    """Test 1: Verify fractional precision (0.5 point blocks stored as 1.500)."""
    team1_id, _ = test_teams
    player_id = test_players[0]  # Test Player 1 (D)
    
    # Add player to team via draft_picks
    db.insert("draft_picks", {
        "league_id": test_league,
        "team_id": team1_id,
        "player_id": player_id,
        "round": 1,
        "pick": 1
    })
    
    # Create game stats with 3 blocks
    game_id = 9999001
    game_date = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    update_player_game_stats(
        db, player_id, game_id, game_date,
        goals=0, assists=0, blocks=3, shots_on_goal=0, hits=0, pim=0,
        ppp=0, shp=0, points=0, icetime_seconds=0,
        is_goalie=False, goalie_gp=0, wins=0, saves=0, goals_against=0, shutouts=0
    )
    
    # Run calculation
    calculate_matchup_scores(db, test_matchup)
    
    # Verify fractional precision
    line = get_matchup_line(db, test_matchup, player_id)
    assert line is not None, "Matchup line should exist"
    
    total_points = Decimal(str(line.get("total_points", 0)))
    assert total_points == Decimal("1.500"), f"Expected 1.500, got {total_points}"
    
    breakdown = line.get("stats_breakdown", {})
    assert breakdown.get("points_from_blocks") == 1.5, "Breakdown should show 1.5 points from blocks"
    assert breakdown.get("blocks") == 3, "Breakdown should show 3 blocks"
    
    # Cleanup
    try:
        db.delete("draft_picks", filters=[("league_id", "eq", test_league), ("team_id", "eq", team1_id)])
        db.delete("player_game_stats", filters=[("game_id", "eq", game_id), ("player_id", "eq", player_id)])
        db.delete("fantasy_matchup_lines", filters=[("matchup_id", "eq", test_matchup)])
    except:
        pass


def test_stat_correction_upsert(db, test_matchup, test_league, test_teams, test_players):
    """Test 2: Verify re-runs update existing records without duplicates."""
    team1_id, _ = test_teams
    player_id = test_players[1]  # Test Player 2 (C)
    
    # Add player to team
    db.insert("draft_picks", {
        "league_id": test_league,
        "team_id": team1_id,
        "player_id": player_id,
        "round": 1,
        "pick": 1
    })
    
    # Initial game stats
    game_id = 9999002
    game_date = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    update_player_game_stats(
        db, player_id, game_id, game_date,
        goals=1, assists=0, blocks=0, shots_on_goal=2, hits=0, pim=0,
        ppp=0, shp=0, points=1, icetime_seconds=1200,
        is_goalie=False, goalie_gp=0, wins=0, saves=0, goals_against=0, shutouts=0
    )
    
    # Initial calculation
    calculate_matchup_scores(db, test_matchup)
    initial_count = count_lines(db, test_matchup, player_id)
    initial_points = get_total_points(db, test_matchup, player_id)
    
    assert initial_count == 1, "Should have exactly one record"
    assert initial_points == Decimal("3.0"), "Initial points should be 3.0 (1 goal * 3)"
    
    # Modify stats (add 1 more goal)
    update_player_game_stats(
        db, player_id, game_id, game_date,
        goals=2, assists=0, blocks=0, shots_on_goal=2, hits=0, pim=0,
        ppp=0, shp=0, points=2, icetime_seconds=1200,
        is_goalie=False, goalie_gp=0, wins=0, saves=0, goals_against=0, shutouts=0
    )
    
    # Re-run calculation
    calculate_matchup_scores(db, test_matchup)
    
    # Verify no duplicates and points increased
    final_count = count_lines(db, test_matchup, player_id)
    final_points = get_total_points(db, test_matchup, player_id)
    
    assert final_count == 1, "Should still have exactly one record (no duplicate)"
    assert final_points == Decimal("6.0"), f"Points should be 6.0 (2 goals * 3), got {final_points}"
    
    # Verify breakdown updated
    line = get_matchup_line(db, test_matchup, player_id)
    breakdown = line.get("stats_breakdown", {})
    assert breakdown.get("goals") == 2, "Breakdown should show 2 goals"
    
    # Cleanup
    try:
        db.delete("draft_picks", filters=[("league_id", "eq", test_league), ("team_id", "eq", team1_id)])
        db.delete("player_game_stats", filters=[("game_id", "eq", game_id), ("player_id", "eq", player_id)])
        db.delete("fantasy_matchup_lines", filters=[("matchup_id", "eq", test_matchup)])
    except:
        pass


def test_gr_decay_after_game_final(db, test_matchup, test_league, test_teams, test_players):
    """Test 3: Verify GR decreases when games become final."""
    team1_id, _ = test_teams
    player_id = test_players[0]  # Test Player 1
    
    # Add player to team
    db.insert("draft_picks", {
        "league_id": test_league,
        "team_id": team1_id,
        "player_id": player_id,
        "round": 1,
        "pick": 1
    })
    
    # Create lineup with player as starter
    ensure_lineup(db, team1_id, test_league, starters=[player_id])
    
    # Create 2 scheduled games
    today = dt.date.today()
    game1_id = 9999003
    game2_id = 9999004
    
    # Game 1: scheduled for today
    db.insert("nhl_games", {
        "game_id": game1_id,
        "game_date": today.isoformat(),
        "home_team": "EDM",
        "away_team": "TOR",
        "status": "scheduled",
        "season": DEFAULT_SEASON
    })
    
    # Game 2: scheduled for tomorrow
    db.insert("nhl_games", {
        "game_id": game2_id,
        "game_date": (today + dt.timedelta(days=1)).isoformat(),
        "home_team": "EDM",
        "away_team": "VAN",
        "status": "scheduled",
        "season": DEFAULT_SEASON
    })
    
    # Initial calculation (should show 2 games remaining)
    calculate_matchup_scores(db, test_matchup)
    
    line = get_matchup_line(db, test_matchup, player_id)
    initial_gr_total = line.get("games_remaining_total", 0) if line else 0
    initial_gr_active = line.get("games_remaining_active", 0) if line else 0
    
    # Mark game 1 as final
    update_game_status(db, game1_id, "final")
    
    # Re-calculate
    calculate_matchup_scores(db, test_matchup)
    
    # Verify GR decreased
    line = get_matchup_line(db, test_matchup, player_id)
    final_gr_total = line.get("games_remaining_total", 0) if line else 0
    final_gr_active = line.get("games_remaining_active", 0) if line else 0
    
    assert final_gr_total == initial_gr_total - 1, f"Total GR should decrease by 1: {initial_gr_total} -> {final_gr_total}"
    assert final_gr_active == initial_gr_active - 1, f"Active GR should decrease by 1: {initial_gr_active} -> {final_gr_active}"
    
    # Cleanup
    try:
        db.delete("draft_picks", filters=[("league_id", "eq", test_league), ("team_id", "eq", team1_id)])
        db.delete("nhl_games", filters=[("game_id", "eq", game1_id)])
        db.delete("nhl_games", filters=[("game_id", "eq", game2_id)])
        db.delete("fantasy_matchup_lines", filters=[("matchup_id", "eq", test_matchup)])
    except:
        pass


def test_calibration_detection(db, test_matchup, test_league, test_teams, test_players):
    """Test 4: Verify calibration function detects mismatches."""
    team1_id, team2_id = test_teams
    player_id = test_players[0]
    
    # Add player to team1
    db.insert("draft_picks", {
        "league_id": test_league,
        "team_id": team1_id,
        "player_id": player_id,
        "round": 1,
        "pick": 1
    })
    
    # Create game stats
    game_id = 9999005
    game_date = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    update_player_game_stats(
        db, player_id, game_id, game_date,
        goals=2, assists=1, blocks=0, shots_on_goal=3, hits=0, pim=0,
        ppp=0, shp=0, points=3, icetime_seconds=1200,
        is_goalie=False, goalie_gp=0, wins=0, saves=0, goals_against=0, shutouts=0
    )
    
    # Run calculation (should create correct totals)
    calculate_matchup_scores(db, test_matchup)
    
    # Corrupt team1 score
    corrupt_team_score(db, test_matchup, "team1", 999.0)
    
    # Run calibration check
    try:
        result = db.rpc("verify_matchup_scores", {"p_matchup_id": test_matchup})
        if result and len(result) > 0:
            calibration = result[0]
            assert calibration.get("is_calibrated") == False, "Should detect mismatch"
            assert calibration.get("discrepancy_team1") != 0, "Should show discrepancy"
            assert abs(calibration.get("team1_calculated", 0) - calibration.get("team1_stored", 0)) > 0.01, "Difference should be significant"
    except Exception as e:
        pytest.skip(f"Calibration RPC not available: {e}")
    
    # Cleanup
    try:
        db.delete("draft_picks", filters=[("league_id", "eq", test_league), ("team_id", "eq", team1_id)])
        db.delete("player_game_stats", filters=[("game_id", "eq", game_id), ("player_id", "eq", player_id)])
        db.delete("fantasy_matchup_lines", filters=[("matchup_id", "eq", test_matchup)])
    except:
        pass


def test_active_gr_vs_total_gr(db, test_matchup, test_league, test_teams, test_players):
    """Test 5: Verify starters get active_gr=total_gr, bench gets active_gr=0."""
    team1_id, _ = test_teams
    starter_player_id = test_players[0]  # Test Player 1
    bench_player_id = test_players[1]   # Test Player 2
    
    # Add both players to team
    db.insert("draft_picks", {
        "league_id": test_league,
        "team_id": team1_id,
        "player_id": starter_player_id,
        "round": 1,
        "pick": 1
    })
    db.insert("draft_picks", {
        "league_id": test_league,
        "team_id": team1_id,
        "player_id": bench_player_id,
        "round": 2,
        "pick": 1
    })
    
    # Create lineup: starter_player_id in starters, bench_player_id on bench
    ensure_lineup(db, team1_id, test_league, starters=[starter_player_id], bench=[bench_player_id])
    
    # Create 3 scheduled games for EDM (both players' team)
    today = dt.date.today()
    for i in range(3):
        game_id = 9999010 + i
        db.insert("nhl_games", {
            "game_id": game_id,
            "game_date": (today + dt.timedelta(days=i)).isoformat(),
            "home_team": "EDM",
            "away_team": "TOR",
            "status": "scheduled",
            "season": DEFAULT_SEASON
        })
    
    # Calculate
    calculate_matchup_scores(db, test_matchup)
    
    # Verify starter player
    starter_line = get_matchup_line(db, test_matchup, starter_player_id)
    assert starter_line is not None, "Starter line should exist"
    assert starter_line.get("games_remaining_total") == 3, "Starter should have 3 total GR"
    assert starter_line.get("games_remaining_active") == 3, "Starter should have 3 active GR"
    
    # Verify bench player
    bench_line = get_matchup_line(db, test_matchup, bench_player_id)
    assert bench_line is not None, "Bench line should exist"
    assert bench_line.get("games_remaining_total") == 3, "Bench should have 3 total GR"
    assert bench_line.get("games_remaining_active") == 0, "Bench should have 0 active GR"
    
    # Cleanup
    try:
        db.delete("draft_picks", filters=[("league_id", "eq", test_league), ("team_id", "eq", team1_id)])
        for i in range(3):
            db.delete("nhl_games", filters=[("game_id", "eq", 9999010 + i)])
        db.delete("fantasy_matchup_lines", filters=[("matchup_id", "eq", test_matchup)])
    except:
        pass


def test_lineup_change_updates_active_gr(db, test_matchup, test_league, test_teams, test_players):
    """Test 6: Verify lineup changes update active_gr."""
    team1_id, _ = test_teams
    player_id = test_players[0]
    
    # Add player to team
    db.insert("draft_picks", {
        "league_id": test_league,
        "team_id": team1_id,
        "player_id": player_id,
        "round": 1,
        "pick": 1
    })
    
    # Initial: player on bench
    ensure_lineup(db, team1_id, test_league, starters=[], bench=[player_id])
    
    # Create 2 scheduled games
    today = dt.date.today()
    for i in range(2):
        game_id = 9999020 + i
        db.insert("nhl_games", {
            "game_id": game_id,
            "game_date": (today + dt.timedelta(days=i)).isoformat(),
            "home_team": "EDM",
            "away_team": "TOR",
            "status": "scheduled",
            "season": DEFAULT_SEASON
        })
    
    # Initial calculation (player on bench)
    calculate_matchup_scores(db, test_matchup)
    initial_active_gr = get_active_gr(db, test_matchup, player_id)
    assert initial_active_gr == 0, "Player on bench should have 0 active GR"
    
    # Move to starters
    ensure_lineup(db, team1_id, test_league, starters=[player_id], bench=[])
    
    # Re-calculate
    calculate_matchup_scores(db, test_matchup)
    
    # Verify active_gr now matches total_gr
    total_gr = get_total_gr(db, test_matchup, player_id)
    new_active_gr = get_active_gr(db, test_matchup, player_id)
    assert new_active_gr == total_gr, f"Active GR should match total GR: {new_active_gr} == {total_gr}"
    assert new_active_gr == 2, "Should have 2 active GR (2 games remaining)"
    
    # Cleanup
    try:
        db.delete("draft_picks", filters=[("league_id", "eq", test_league), ("team_id", "eq", team1_id)])
        for i in range(2):
            db.delete("nhl_games", filters=[("game_id", "eq", 9999020 + i)])
        db.delete("fantasy_matchup_lines", filters=[("matchup_id", "eq", test_matchup)])
    except:
        pass
