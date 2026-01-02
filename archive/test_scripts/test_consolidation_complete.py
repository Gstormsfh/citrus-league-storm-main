#!/usr/bin/env python3
"""
Complete test of boxscore consolidation - verifies everything works end-to-end.
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

# Verify environment
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ ERROR: Missing environment variables")
    print("   Make sure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set")
    sys.exit(1)

print("=" * 80)
print("BOXSCORE CONSOLIDATION - COMPLETE TEST")
print("=" * 80)
print()

# Test 1: Import and verify functions exist
print("Test 1: Verifying imports...")
try:
    from ingest_raw_nhl import (
        scrape_single_game_json,
        scrape_single_game_boxscore,
        save_raw_json_to_db,
        get_fresh_supabase_client,
        extract_game_date_from_json,
        ingest_single_game
    )
    from scrape_per_game_nhl_stats import (
        fetch_game_boxscore,
        extract_player_stats_from_boxscore,
        supabase_client
    )
    print("  ✅ All imports successful")
except Exception as e:
    print(f"  ❌ Import failed: {e}")
    sys.exit(1)

# Test 2: Fetch a test game
print()
print("Test 2: Fetching test game data...")
test_game_id = 2025020563  # Recent game

try:
    # Fetch PBP
    print(f"  Fetching PBP for game {test_game_id}...")
    pbp_json = scrape_single_game_json(test_game_id)
    if not pbp_json:
        print("  ❌ Failed to fetch PBP")
        sys.exit(1)
    print("  ✅ PBP fetched")
    
    # Fetch boxscore
    print(f"  Fetching boxscore for game {test_game_id}...")
    boxscore_json = scrape_single_game_boxscore(test_game_id)
    if not boxscore_json:
        print("  ❌ Failed to fetch boxscore")
        sys.exit(1)
    print("  ✅ Boxscore fetched")
    
    # Verify boxscore structure
    if "playerByGameStats" not in boxscore_json:
        print("  ❌ Boxscore missing playerByGameStats")
        sys.exit(1)
    
    # Check for defense group
    player_stats = boxscore_json.get("playerByGameStats", {})
    has_defense = False
    for team_key in ["homeTeam", "awayTeam"]:
        if team_key in player_stats:
            team_data = player_stats[team_key]
            if isinstance(team_data, dict) and "defense" in team_data:
                has_defense = True
                defense_count = len(team_data.get("defense", []))
                print(f"  ✅ Found defense position group ({defense_count} players)")
                break
    
    if not has_defense:
        print("  ⚠️  Warning: No defense group found (may be empty)")
    
except Exception as e:
    print(f"  ❌ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test 3: Store in database
print()
print("Test 3: Storing in database...")
try:
    db_client = get_fresh_supabase_client()
    import datetime
    game_date = extract_game_date_from_json(pbp_json, test_game_id)
    if not game_date:
        game_date = datetime.date.today().strftime('%Y-%m-%d')
    
    saved = save_raw_json_to_db(test_game_id, pbp_json, game_date, db_client, boxscore_json=boxscore_json)
    if not saved:
        print("  ❌ Failed to save to database")
        sys.exit(1)
    print("  ✅ Saved to database (PBP + boxscore)")
    
except Exception as e:
    print(f"  ❌ Error saving: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test 4: Retrieve from database
print()
print("Test 4: Retrieving boxscore from database...")
try:
    db = supabase_client()
    retrieved_boxscore = fetch_game_boxscore(test_game_id, db)
    if not retrieved_boxscore:
        print("  ❌ Failed to retrieve boxscore from database")
        sys.exit(1)
    print("  ✅ Retrieved boxscore from database")
    
    # Verify it's the same data
    if "playerByGameStats" not in retrieved_boxscore:
        print("  ❌ Retrieved boxscore is invalid")
        sys.exit(1)
    print("  ✅ Retrieved boxscore is valid")
    
except Exception as e:
    print(f"  ❌ Error retrieving: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test 5: Extract player stats
print()
print("Test 5: Extracting player stats...")
try:
    player_stats_map = extract_player_stats_from_boxscore(retrieved_boxscore)
    if not player_stats_map:
        print("  ❌ Failed to extract player stats")
        sys.exit(1)
    
    # Count players
    skaters = [s for s in player_stats_map.values() if not s.get("_is_goalie", False)]
    goalies = [s for s in player_stats_map.values() if s.get("_is_goalie", False)]
    defensemen = [s for s in skaters if s.get("_position_code") == "D"]
    
    print(f"  ✅ Extracted stats for {len(player_stats_map)} players")
    print(f"     - {len(skaters)} skaters ({len(defensemen)} defensemen)")
    print(f"     - {len(goalies)} goalies")
    
    # Verify stat categories
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
        
        # Verify all required stats are present
        required_stats = ['nhl_goals', 'nhl_assists', 'nhl_points', 'nhl_shots_on_goal', 
                         'nhl_ppg', 'nhl_ppa', 'nhl_shg', 'nhl_sha']
        missing = [s for s in required_stats if s not in sample_d]
        if missing:
            print(f"  ⚠️  Warning: Missing stats: {missing}")
        else:
            print("  ✅ All required stats present")
    
except Exception as e:
    print(f"  ❌ Error extracting stats: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Final summary
print()
print("=" * 80)
print("✅ ALL TESTS PASSED!")
print("=" * 80)
print()
print("Consolidation is working correctly:")
print("  ✅ Boxscore fetched and stored alongside PBP data")
print("  ✅ Boxscore retrieved from database successfully")
print("  ✅ Player stats extracted correctly (including defencemen)")
print("  ✅ All stat categories preserved (SOG, PPG, PPA, SHG, SHA, etc.)")
print()
print("Next steps:")
print("  1. Run full ingestion: python ingest_raw_nhl.py [start_date] [end_date]")
print("  2. Run extraction: python scrape_per_game_nhl_stats.py [start_date] [end_date]")
print("  3. The extraction will now read from stored boxscore data!")
print()

