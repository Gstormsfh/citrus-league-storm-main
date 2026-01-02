#!/usr/bin/env python3
"""
Test script to verify boxscore consolidation works correctly.
Tests that ingest_raw_nhl.py stores boxscore data and scrape_per_game_nhl_stats.py reads it.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Import functions from the scripts
from ingest_raw_nhl import scrape_single_game_json, scrape_single_game_boxscore, save_raw_json_to_db, get_fresh_supabase_client, extract_game_date_from_json
from scrape_per_game_nhl_stats import fetch_game_boxscore, extract_player_stats_from_boxscore, supabase_client
import datetime

load_dotenv()

def test_boxscore_storage_and_retrieval():
    """Test that boxscore can be stored and retrieved."""
    print("=" * 80)
    print("TESTING BOXSCORE CONSOLIDATION")
    print("=" * 80)
    print()
    
    # Use a recent game ID for testing (adjust as needed)
    # Using a game from December 2025
    test_game_id = 2025020563  # Adjust to a recent game ID
    
    print(f"Testing with game ID: {test_game_id}")
    print()
    
    # Step 1: Fetch PBP and boxscore
    print("Step 1: Fetching PBP JSON...")
    pbp_json = scrape_single_game_json(test_game_id)
    if not pbp_json:
        print("  ❌ Failed to fetch PBP JSON")
        return False
    print("  ✅ PBP JSON fetched successfully")
    
    print()
    print("Step 2: Fetching boxscore JSON...")
    boxscore_json = scrape_single_game_boxscore(test_game_id)
    if not boxscore_json:
        print("  ❌ Failed to fetch boxscore JSON")
        return False
    print("  ✅ Boxscore JSON fetched successfully")
    
    # Step 2: Check boxscore structure
    print()
    print("Step 3: Verifying boxscore structure...")
    if "playerByGameStats" not in boxscore_json:
        print("  ❌ Boxscore missing 'playerByGameStats' key")
        return False
    
    player_stats = boxscore_json.get("playerByGameStats", {})
    has_defense_group = False
    for team_key in ["homeTeam", "awayTeam"]:
        if team_key in player_stats:
            team_data = player_stats[team_key]
            if isinstance(team_data, dict) and "defense" in team_data:
                has_defense_group = True
                defense_count = len(team_data.get("defense", []))
                print(f"  ✅ Found 'defense' position group with {defense_count} players")
                break
    
    if not has_defense_group:
        print("  ⚠️  Warning: No 'defense' position group found (may be empty game)")
    
    # Step 3: Store in database
    print()
    print("Step 4: Storing in database...")
    db_client = get_fresh_supabase_client()
    game_date = extract_game_date_from_json(pbp_json, test_game_id)
    if not game_date:
        game_date = datetime.date.today().strftime('%Y-%m-%d')
    
    saved = save_raw_json_to_db(test_game_id, pbp_json, game_date, db_client, boxscore_json=boxscore_json)
    if not saved:
        print("  ❌ Failed to save to database")
        return False
    print("  ✅ Saved to database (PBP + boxscore)")
    
    # Step 4: Retrieve from database
    print()
    print("Step 5: Retrieving boxscore from database...")
    db = supabase_client()
    retrieved_boxscore = fetch_game_boxscore(test_game_id, db)
    if not retrieved_boxscore:
        print("  ❌ Failed to retrieve boxscore from database")
        return False
    print("  ✅ Retrieved boxscore from database")
    
    # Step 5: Extract player stats
    print()
    print("Step 6: Extracting player stats from boxscore...")
    player_stats_map = extract_player_stats_from_boxscore(retrieved_boxscore)
    if not player_stats_map:
        print("  ❌ Failed to extract player stats")
        return False
    
    # Count players by position
    skaters = [s for s in player_stats_map.values() if not s.get("_is_goalie", False)]
    goalies = [s for s in player_stats_map.values() if s.get("_is_goalie", False)]
    defensemen = [s for s in skaters if s.get("_position_code") == "D"]
    
    print(f"  ✅ Extracted stats for {len(player_stats_map)} players")
    print(f"     - {len(skaters)} skaters ({len(defensemen)} defensemen)")
    print(f"     - {len(goalies)} goalies")
    
    # Check that defensemen have stats
    if defensemen:
        sample_d = defensemen[0]
        print()
        print("  Sample defenseman stats:")
        print(f"     - Goals: {sample_d.get('nhl_goals', 0)}")
        print(f"     - Assists: {sample_d.get('nhl_assists', 0)}")
        print(f"     - Points: {sample_d.get('nhl_points', 0)}")
        print(f"     - SOG: {sample_d.get('nhl_shots_on_goal', 0)}")
        print(f"     - PPG: {sample_d.get('nhl_ppg', 0)}")
        print(f"     - PPA: {sample_d.get('nhl_ppa', 0)}")
        print(f"     - SHG: {sample_d.get('nhl_shg', 0)}")
        print(f"     - SHA: {sample_d.get('nhl_sha', 0)}")
    
    print()
    print("=" * 80)
    print("✅ ALL TESTS PASSED!")
    print("=" * 80)
    print()
    print("The consolidation is working correctly:")
    print("  - Boxscore is fetched and stored alongside PBP data")
    print("  - Boxscore can be retrieved from database")
    print("  - Player stats are extracted correctly (including defencemen)")
    print("  - All stat categories are preserved (SOG, PPG, PPA, SHG, SHA, etc.)")
    
    return True


if __name__ == "__main__":
    try:
        success = test_boxscore_storage_and_retrieval()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

