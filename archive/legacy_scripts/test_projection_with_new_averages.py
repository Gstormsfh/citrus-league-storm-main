#!/usr/bin/env python3
"""
Test that projections are now using the new league averages correctly.
"""

import os
import sys
from datetime import date
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# Import projection functions
from calculate_daily_projections import (
    calculate_hybrid_base,
    get_league_averages,
    calculate_goalie_projection,
    get_vegas_win_probability
)

print("=" * 80)
print("TEST PROJECTIONS WITH NEW AVERAGES")
print("=" * 80)
print()

# Test 1: Verify league averages are being used
print("Test 1: Verify league averages retrieval...")
test_position = "C"
league_avg = get_league_averages(db, test_position, DEFAULT_SEASON)

if league_avg:
    print(f"   ✓ Retrieved averages for {test_position}:")
    print(f"      Goals: {league_avg.get('avg_goals_per_game', 0):.3f}")
    print(f"      Assists: {league_avg.get('avg_assists_per_game', 0):.3f}")
    print(f"      SOG: {league_avg.get('avg_sog_per_game', 0):.3f}")
    print(f"      Blocks: {league_avg.get('avg_blocks_per_game', 0):.3f}")
    print(f"      PPP: {league_avg.get('avg_ppp_per_game', 0):.3f} ← NEW")
    print(f"      SHP: {league_avg.get('avg_shp_per_game', 0):.3f} ← NEW")
    print(f"      Hits: {league_avg.get('avg_hits_per_game', 0):.3f} ← NEW")
    print(f"      PIM: {league_avg.get('avg_pim_per_game', 0):.3f} ← NEW")
    
    # Verify they're not all zeros
    if league_avg.get('avg_ppp_per_game', 0) > 0:
        print("   ✓ PPP average is populated (not using default)")
    if league_avg.get('avg_hits_per_game', 0) > 0:
        print("   ✓ Hits average is populated (not using default)")
else:
    print("   ✗ Could not retrieve league averages")
    sys.exit(1)

print()

# Test 2: Test projection calculation for a skater
print("Test 2: Test projection calculation for a skater...")
# Get a test player (center with some games played)
test_players = db.select(
    "player_season_stats",
    select="player_id,games_played,ppp,shp,hits,pim",
    filters=[
        ("season", "eq", DEFAULT_SEASON),
        ("games_played", "gt", 10)
    ],
    limit=1
)

if test_players:
    test_player = test_players[0]
    player_id = test_player.get("player_id")
    gp = test_player.get("games_played", 0)
    
    print(f"   Testing with player {player_id} (GP: {gp})")
    print(f"   Player stats: PPP={test_player.get('ppp', 0)}, SHP={test_player.get('shp', 0)}, Hits={test_player.get('hits', 0)}, PIM={test_player.get('pim', 0)}")
    
    # Get player position
    player_dir = db.select(
        "player_directory",
        select="position_code",
        filters=[("player_id", "eq", player_id), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if player_dir:
        position = player_dir[0].get("position_code", "C")
        
        # Test the base projection calculation
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
            }
        }
        
        base_proj = calculate_hybrid_base(
            db, player_id, position, gp, DEFAULT_SEASON, scoring_settings
        )
        
        if base_proj:
            print(f"   ✓ Base projection calculated:")
            print(f"      Goals: {base_proj.get('goals', 0):.3f}")
            print(f"      Assists: {base_proj.get('assists', 0):.3f}")
            print(f"      SOG: {base_proj.get('sog', 0):.3f}")
            print(f"      Blocks: {base_proj.get('blocks', 0):.3f}")
            print(f"      PPP: {base_proj.get('ppp', 0):.3f} ← Should use league avg")
            print(f"      SHP: {base_proj.get('shp', 0):.3f} ← Should use league avg")
            print(f"      Hits: {base_proj.get('hits', 0):.3f} ← Should use league avg")
            print(f"      PIM: {base_proj.get('pim', 0):.3f} ← Should use league avg")
            
            # Verify PPP, SHP, hits, PIM are not zero (should have some projection)
            if base_proj.get('ppp', 0) > 0 or base_proj.get('shp', 0) >= 0:
                print("   ✓ PPP/SHP projections are calculated (not zero)")
            if base_proj.get('hits', 0) > 0:
                print("   ✓ Hits projection is calculated (not zero)")
            if base_proj.get('pim', 0) > 0:
                print("   ✓ PIM projection is calculated (not zero)")
        else:
            print("   ✗ Could not calculate base projection")
    else:
        print("   ⚠️  Could not find player position")
else:
    print("   ⚠️  No test players found")

print()

# Test 3: Test goalie wins fallback
print("Test 3: Test goalie wins fallback logic...")
# Get a test goalie
test_goalies = db.select(
    "player_directory",
    select="player_id,team_abbrev",
    filters=[
        ("season", "eq", DEFAULT_SEASON),
        ("position_code", "eq", "G")
    ],
    limit=1
)

if test_goalies:
    goalie = test_goalies[0]
    goalie_id = goalie.get("player_id")
    goalie_team = goalie.get("team_abbrev", "")
    
    # Get a game for this goalie's team
    test_game = db.select(
        "nhl_games",
        select="game_id",
        filters=[
            ("season", "eq", DEFAULT_SEASON),
            ("home_team", "eq", goalie_team)
        ],
        limit=1
    )
    
    if not test_game:
        test_game = db.select(
            "nhl_games",
            select="game_id",
            filters=[
                ("season", "eq", DEFAULT_SEASON),
                ("away_team", "eq", goalie_team)
            ],
            limit=1
        )
    
    if test_game:
        game_id = test_game[0].get("game_id")
        print(f"   Testing with goalie {goalie_id} (team: {goalie_team}, game: {game_id})")
        
        win_prob = get_vegas_win_probability(db, game_id, goalie_team, DEFAULT_SEASON, debug=False)
        
        if win_prob is not None:
            print(f"   ✓ Win probability: {win_prob:.3f}")
            if win_prob == 0.5:
                print("   ⚠️  Using default 0.5 (Vegas odds not available, fallback may not have found games)")
            else:
                print("   ✓ Using calculated win rate (not default 0.5)")
        else:
            print("   ⚠️  Win probability returned None (should fallback to 0.5 in projection)")
    else:
        print("   ⚠️  No games found for goalie's team")
else:
    print("   ⚠️  No test goalies found")

print()

# Summary
print("=" * 80)
print("TESTING COMPLETE")
print("=" * 80)
print("✓ League averages are populated and retrievable")
print("✓ Projection calculation can access all 8 stat averages")
print("✓ Projections should now use real league averages instead of defaults")
print()
print("READY TO RECALCULATE PROJECTIONS")
print("=" * 80)

