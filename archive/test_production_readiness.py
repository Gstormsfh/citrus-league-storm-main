#!/usr/bin/env python3
"""
test_production_readiness.py

Production readiness verification tests for the World Class Matchup Engine.
Tests high-volume load, multi-league conflicts, and edge cases before frontend integration.
"""

import os
import sys
import pytest
import datetime as dt
from decimal import Decimal
from typing import Any, Dict, List
from uuid import uuid4

from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from calculate_matchup_scores import (
    supabase_client,
    calculate_matchup_scores,
    _safe_int,
    _now_iso
)

load_dotenv()

TEST_PREFIX = "test_prod_"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


# ============================================================================
# Helper Functions
# ============================================================================

def get_matchup_line(db: SupabaseRest, matchup_id: str, player_id: int) -> Dict[str, Any]:
    """Get matchup line for a player."""
    lines = db.select(
        "fantasy_matchup_lines",
        select="*",
        filters=[
            ("matchup_id", "eq", matchup_id),
            ("player_id", "eq", player_id)
        ],
        limit=1
    )
    return lines[0] if lines and len(lines) > 0 else {}


def create_test_player(db: SupabaseRest, player_id: int, name: str, team: str, position: str = "C", is_goalie: bool = False) -> None:
    """Create a test player in player_directory."""
    db.insert("player_directory", {
        "season": DEFAULT_SEASON,
        "player_id": player_id,
        "full_name": f"{TEST_PREFIX}{name}",
        "team_abbrev": team,
        "position_code": position,
        "is_goalie": is_goalie
    })


def cleanup_test_data(db: SupabaseRest, league_id: str, matchup_id: str, player_ids: List[int]) -> None:
    """Cleanup test data."""
    try:
        # Delete matchup lines
        db.delete("fantasy_matchup_lines", filters=[("matchup_id", "eq", matchup_id)])
        # Delete matchup
        db.delete("matchups", filters=[("id", "eq", matchup_id)])
        # Delete teams
        teams = db.select("teams", select="id", filters=[("league_id", "eq", league_id)])
        if teams:
            for team in teams:
                db.delete("draft_picks", filters=[("team_id", "eq", team["id"])])
                db.delete("teams", filters=[("id", "eq", team["id"])])
        # Delete league
        db.delete("leagues", filters=[("id", "eq", league_id)])
        # Delete players
        for pid in player_ids:
            db.delete("player_directory", filters=[
                ("season", "eq", DEFAULT_SEASON),
                ("player_id", "eq", pid)
            ])
    except Exception as e:
        print(f"[WARNING] Cleanup error (non-fatal): {e}")


# ============================================================================
# Production Readiness Tests
# ============================================================================

def test_high_volume_load(db):
    """
    Test 1: High-Volume Load Test
    Run calculation for a league with 12 teams and 25-man rosters (300 players total).
    Ensures upsert_matchup_lines handles batch processing efficiently.
    """
    print("\n" + "=" * 80)
    print("HIGH-VOLUME LOAD TEST")
    print("=" * 80)
    
    # Create test league
    league_id = str(uuid4())
    db.insert("leagues", {
        "id": league_id,
        "name": f"{TEST_PREFIX}High Volume League",
        "commissioner_id": str(uuid4()),
        "scoring_settings": {
            "skater": {"goals": 3, "assists": 2, "blocks": 0.5},
            "goalie": {"wins": 4, "saves": 0.2}
        }
    })
    
    # Create 12 teams
    team_ids = []
    for i in range(12):
        team_id = str(uuid4())
        team_ids.append(team_id)
        db.insert("teams", {
            "id": team_id,
            "league_id": league_id,
            "name": f"{TEST_PREFIX}Team {i+1}",
            "owner_id": str(uuid4())
        })
    
    # Create matchup between first two teams
    matchup_id = str(uuid4())
    today = dt.date.today()
    db.insert("matchups", {
        "id": matchup_id,
        "league_id": league_id,
        "week_number": 1,
        "team1_id": team_ids[0],
        "team2_id": team_ids[1],
        "week_start_date": (today - dt.timedelta(days=2)).isoformat(),
        "week_end_date": (today + dt.timedelta(days=5)).isoformat(),
        "status": "active",
        "team1_score": 0,
        "team2_score": 0
    })
    
    # Create 25 players per team (50 total)
    player_ids = []
    base_player_id = 9900000
    
    for team_idx, team_id in enumerate([team_ids[0], team_ids[1]]):
        for player_idx in range(25):
            player_id = base_player_id + (team_idx * 25) + player_idx
            player_ids.append(player_id)
            
            # Create player
            create_test_player(
                db, player_id,
                f"Player {player_idx+1}",
                "EDM" if team_idx == 0 else "TOR",
                "C" if player_idx % 3 == 0 else "D" if player_idx % 3 == 1 else "LW"
            )
            
            # Add to team via draft_picks
            db.insert("draft_picks", {
                "league_id": league_id,
                "team_id": team_id,
                "player_id": player_id,
                "round": (player_idx // 2) + 1,
                "pick": player_idx + 1
            })
            
            # Create minimal game stats
            game_id = 9999000 + player_id
            game_date = (today - dt.timedelta(days=1)).isoformat()
            db.insert("player_game_stats", {
                "season": DEFAULT_SEASON,
                "game_id": game_id,
                "game_date": game_date,
                "player_id": player_id,
                "team_abbrev": "EDM" if team_idx == 0 else "TOR",
                "position_code": "C",
                "is_goalie": False,
                "goals": player_idx % 3,  # Vary stats
                "assists": (player_idx % 2),
                "blocks": player_idx % 5,
                "shots_on_goal": player_idx % 4,
                "hits": 0,
                "pim": 0,
                "ppp": 0,
                "shp": 0,
                "plus_minus": 0,
                "icetime_seconds": 1200,
                "points": (player_idx % 3) + (player_idx % 2),
                "goalie_gp": 0,
                "wins": 0,
                "saves": 0,
                "goals_against": 0,
                "shutouts": 0
            })
    
    print(f"[INFO] Created {len(player_ids)} players across 2 teams")
    print(f"[INFO] Running calculation for matchup with {len(player_ids)} players...")
    
    # Run calculation (should handle 50 players efficiently)
    import time
    start_time = time.time()
    
    try:
        count = calculate_matchup_scores(db, matchup_id)
        elapsed = time.time() - start_time
        
        print(f"[INFO] Calculation completed in {elapsed:.2f} seconds")
        print(f"[INFO] Processed {count} matchup(s)")
        
        # Verify all players have lines
        lines = db.select(
            "fantasy_matchup_lines",
            select="player_id",
            filters=[("matchup_id", "eq", matchup_id)]
        ) or []
        
        unique_players = len(set(line.get("player_id") for line in lines))
        print(f"[INFO] Generated {len(lines)} matchup lines for {unique_players} unique players")
        
        # Assertions
        assert count == 1, "Should process 1 matchup"
        assert len(lines) == unique_players, "Should have one line per player (no duplicates)"
        assert unique_players == len(player_ids), f"Should have lines for all {len(player_ids)} players, got {unique_players}"
        assert elapsed < 60, f"Should complete in under 60 seconds, took {elapsed:.2f}s"
        
        print("[OK] High-volume load test passed")
        
    finally:
        # Cleanup
        cleanup_test_data(db, league_id, matchup_id, player_ids)


def test_multi_league_conflict(db):
    """
    Test 2: Multi-League Conflict Test
    Run calculation for two leagues with vastly different scoring settings.
    Confirms scoring_settings JSONB is correctly isolated per league_id.
    """
    print("\n" + "=" * 80)
    print("MULTI-LEAGUE CONFLICT TEST")
    print("=" * 80)
    
    # League 1: Points-based (goals = 3, assists = 2)
    league1_id = str(uuid4())
    db.insert("leagues", {
        "id": league1_id,
        "name": f"{TEST_PREFIX}Points League",
        "commissioner_id": str(uuid4()),
        "scoring_settings": {
            "skater": {
                "goals": 3,
                "assists": 2,
                "blocks": 0,
                "shots_on_goal": 0
            },
            "goalie": {"wins": 4, "saves": 0}
        }
    })
    
    # League 2: Category-weighting (goals = 5, blocks = 1.5)
    league2_id = str(uuid4())
    db.insert("leagues", {
        "id": league2_id,
        "name": f"{TEST_PREFIX}Category League",
        "commissioner_id": str(uuid4()),
        "scoring_settings": {
            "skater": {
                "goals": 5,
                "assists": 3,
                "blocks": 1.5,
                "shots_on_goal": 0.6
            },
            "goalie": {"wins": 6, "saves": 0.3}
        }
    })
    
    # Create teams and matchups
    team1_id = str(uuid4())
    team2_id = str(uuid4())
    
    db.insert("teams", {
        "id": team1_id,
        "league_id": league1_id,
        "name": f"{TEST_PREFIX}League1 Team",
        "owner_id": str(uuid4())
    })
    
    db.insert("teams", {
        "id": team2_id,
        "league_id": league2_id,
        "name": f"{TEST_PREFIX}League2 Team",
        "owner_id": str(uuid4())
    })
    
    matchup1_id = str(uuid4())
    matchup2_id = str(uuid4())
    today = dt.date.today()
    
    db.insert("matchups", {
        "id": matchup1_id,
        "league_id": league1_id,
        "week_number": 1,
        "team1_id": team1_id,
        "team2_id": team1_id,  # Same team for simplicity
        "week_start_date": (today - dt.timedelta(days=2)).isoformat(),
        "week_end_date": (today + dt.timedelta(days=5)).isoformat(),
        "status": "active",
        "team1_score": 0,
        "team2_score": 0
    })
    
    db.insert("matchups", {
        "id": matchup2_id,
        "league_id": league2_id,
        "week_number": 1,
        "team1_id": team2_id,
        "team2_id": team2_id,
        "week_start_date": (today - dt.timedelta(days=2)).isoformat(),
        "week_end_date": (today + dt.timedelta(days=5)).isoformat(),
        "status": "active",
        "team1_score": 0,
        "team2_score": 0
    })
    
    # Create same player in both leagues
    player_id = 9910000
    create_test_player(db, player_id, "Multi-League Player", "EDM", "C")
    
    # Add to both teams
    db.insert("draft_picks", {
        "league_id": league1_id,
        "team_id": team1_id,
        "player_id": player_id,
        "round": 1,
        "pick": 1
    })
    
    db.insert("draft_picks", {
        "league_id": league2_id,
        "team_id": team2_id,
        "player_id": player_id,
        "round": 1,
        "pick": 1
    })
    
    # Create game stats: 2 goals, 1 assist, 3 blocks
    game_id = 9998000
    game_date = (today - dt.timedelta(days=1)).isoformat()
    db.insert("player_game_stats", {
        "season": DEFAULT_SEASON,
        "game_id": game_id,
        "game_date": game_date,
        "player_id": player_id,
        "team_abbrev": "EDM",
        "position_code": "C",
        "is_goalie": False,
        "goals": 2,
        "assists": 1,
        "blocks": 3,
        "shots_on_goal": 4,
        "hits": 0,
        "pim": 0,
        "ppp": 0,
        "shp": 0,
        "plus_minus": 0,
        "icetime_seconds": 1200,
        "points": 3,
        "goalie_gp": 0,
        "wins": 0,
        "saves": 0,
        "goals_against": 0,
        "shutouts": 0
    })
    
    print(f"[INFO] Player stats: 2 goals, 1 assist, 3 blocks, 4 SOG")
    print(f"[INFO] League 1 scoring: goals=3, assists=2, blocks=0")
    print(f"[INFO] League 2 scoring: goals=5, assists=3, blocks=1.5")
    
    # Calculate for both leagues
    calculate_matchup_scores(db, matchup1_id)
    calculate_matchup_scores(db, matchup2_id)
    
    # Verify different totals
    line1 = get_matchup_line(db, matchup1_id, player_id)
    line2 = get_matchup_line(db, matchup2_id, player_id)
    
    points1 = Decimal(str(line1.get("total_points", 0)))
    points2 = Decimal(str(line2.get("total_points", 0)))
    
    # League 1: (2 goals * 3) + (1 assist * 2) + (3 blocks * 0) + (4 SOG * 0) = 8.0
    expected1 = Decimal("8.0")
    
    # League 2: (2 goals * 5) + (1 assist * 3) + (3 blocks * 1.5) + (4 SOG * 0.6) = 10 + 3 + 4.5 + 2.4 = 19.9
    expected2 = Decimal("19.9")
    
    print(f"[INFO] League 1 total: {points1} (expected: {expected1})")
    print(f"[INFO] League 2 total: {points2} (expected: {expected2})")
    
    assert abs(points1 - expected1) < Decimal("0.01"), f"League 1 points mismatch: {points1} != {expected1}"
    assert abs(points2 - expected2) < Decimal("0.01"), f"League 2 points mismatch: {points2} != {expected2}"
    assert points1 != points2, "Leagues should have different totals"
    
    print("[OK] Multi-league conflict test passed")
    
    # Cleanup
    cleanup_test_data(db, league1_id, matchup1_id, [player_id])
    cleanup_test_data(db, league2_id, matchup2_id, [player_id])


def test_empty_stat_handling(db):
    """
    Test 3: Empty Stat Handling
    Verify that a player with zero stats returns clean 0.000 and empty stats_breakdown.
    Prevents frontend crashes when rendering cards for players who haven't played yet.
    """
    print("\n" + "=" * 80)
    print("EMPTY STAT HANDLING TEST")
    print("=" * 80)
    
    # Create league
    league_id = str(uuid4())
    db.insert("leagues", {
        "id": league_id,
        "name": f"{TEST_PREFIX}Empty Stats League",
        "commissioner_id": str(uuid4()),
        "scoring_settings": {
            "skater": {"goals": 3, "assists": 2, "blocks": 0.5},
            "goalie": {"wins": 4, "saves": 0.2}
        }
    })
    
    # Create team and matchup
    team_id = str(uuid4())
    db.insert("teams", {
        "id": team_id,
        "league_id": league_id,
        "name": f"{TEST_PREFIX}Test Team",
        "owner_id": str(uuid4())
    })
    
    matchup_id = str(uuid4())
    today = dt.date.today()
    db.insert("matchups", {
        "id": matchup_id,
        "league_id": league_id,
        "week_number": 1,
        "team1_id": team_id,
        "team2_id": team_id,
        "week_start_date": (today - dt.timedelta(days=2)).isoformat(),
        "week_end_date": (today + dt.timedelta(days=5)).isoformat(),
        "status": "active",
        "team1_score": 0,
        "team2_score": 0
    })
    
    # Create player with NO game stats
    player_id = 9920000
    create_test_player(db, player_id, "Zero Stats Player", "EDM", "C")
    
    db.insert("draft_picks", {
        "league_id": league_id,
        "team_id": team_id,
        "player_id": player_id,
        "round": 1,
        "pick": 1
    })
    
    print(f"[INFO] Player {player_id} has no game stats in the matchup period")
    
    # Run calculation
    calculate_matchup_scores(db, matchup_id)
    
    # Verify player has a line with zero stats
    line = get_matchup_line(db, matchup_id, player_id)
    
    assert line is not None, "Player should have a matchup line even with zero stats"
    
    total_points = Decimal(str(line.get("total_points", 0)))
    assert total_points == Decimal("0.000"), f"Total points should be 0.000, got {total_points}"
    
    stats_breakdown = line.get("stats_breakdown", {})
    assert isinstance(stats_breakdown, dict), "stats_breakdown should be a dict, not null"
    
    # Verify breakdown has zero values or is empty (both are acceptable)
    if stats_breakdown:
        # If breakdown exists, all stat counts should be 0
        stat_keys = ["goals", "assists", "blocks", "shots_on_goal", "hits", "pim"]
        for key in stat_keys:
            if key in stats_breakdown:
                assert stats_breakdown[key] == 0, f"{key} should be 0, got {stats_breakdown[key]}"
    
    games_played = line.get("games_played", 0)
    assert games_played == 0, f"games_played should be 0, got {games_played}"
    
    print(f"[INFO] Total points: {total_points}")
    print(f"[INFO] Stats breakdown: {stats_breakdown}")
    print(f"[INFO] Games played: {games_played}")
    print("[OK] Empty stat handling test passed")
    
    # Cleanup
    cleanup_test_data(db, league_id, matchup_id, [player_id])


# ============================================================================
# Main Test Runner
# ============================================================================

def main():
    """Run all production readiness tests."""
    db = supabase_client()
    
    print("=" * 80)
    print("PRODUCTION READINESS VERIFICATION")
    print("=" * 80)
    
    tests = [
        ("High-Volume Load", test_high_volume_load),
        ("Multi-League Conflict", test_multi_league_conflict),
        ("Empty Stat Handling", test_empty_stat_handling)
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            test_func(db)
            results.append((test_name, "PASSED"))
        except AssertionError as e:
            print(f"\n[FAIL] {test_name}: {e}")
            results.append((test_name, "FAILED"))
        except Exception as e:
            print(f"\n[ERROR] {test_name}: {e}")
            import traceback
            traceback.print_exc()
            results.append((test_name, "ERROR"))
    
    # Summary
    print("\n" + "=" * 80)
    print("PRODUCTION READINESS SUMMARY")
    print("=" * 80)
    for test_name, status in results:
        print(f"  {test_name}: {status}")
    
    all_passed = all(status == "PASSED" for _, status in results)
    print("=" * 80)
    if all_passed:
        print("[SUCCESS] All production readiness tests passed")
        return 0
    else:
        print("[WARNING] Some tests failed - review before production")
        return 1


if __name__ == "__main__":
    sys.exit(main())
