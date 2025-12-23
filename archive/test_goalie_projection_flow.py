#!/usr/bin/env python3
"""
Test the complete goalie projection flow:
1. Calculate projection
2. Store in database
3. Retrieve via RPC
"""

import sys
from datetime import date
from dotenv import load_dotenv

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()
from calculate_daily_projections import supabase_client, calculate_daily_projection, DEFAULT_SEASON
from supabase_rest import SupabaseRest

def main():
    db = supabase_client()
    
    # Test goalie: Jeremy Swayman (8480280)
    goalie_id = 8480280
    test_date = date(2025, 12, 20)
    
    print("=" * 80)
    print("GOALIE PROJECTION FLOW TEST")
    print("=" * 80)
    print(f"Goalie ID: {goalie_id}")
    print(f"Test Date: {test_date}")
    print()
    
    # Find a game for this goalie
    from debug_projection import find_next_game_for_player
    next_game = find_next_game_for_player(db, goalie_id, DEFAULT_SEASON)
    
    if not next_game:
        print("❌ No upcoming games found for this goalie")
        return
    
    game_id = int(next_game.get("game_id"))
    game_date_str = next_game.get("game_date")
    from datetime import datetime
    try:
        game_date = datetime.fromisoformat(game_date_str.replace("Z", "+00:00")).date()
    except:
        game_date = datetime.strptime(game_date_str, "%Y-%m-%d").date()
    
    print(f"Game ID: {game_id}")
    print(f"Game Date: {game_date}")
    print()
    
    # Scoring settings
    scoring_settings = {
        "skater": {
            "goals": 3,
            "assists": 2,
            "shots_on_goal": 0.4,
            "blocks": 0.5,
        },
        "goalie": {
            "wins": 4,
            "shutouts": 3,
            "saves": 0.2,
            "goals_against": -1,
        }
    }
    
    # Step 1: Calculate projection
    print("📊 Step 1: Calculating goalie projection...")
    projection = calculate_daily_projection(
        db, goalie_id, game_id, game_date, DEFAULT_SEASON, scoring_settings
    )
    
    if not projection:
        print("❌ Failed to calculate projection")
        return
    
    print(f"✅ Projection calculated:")
    print(f"   Total Points: {projection.get('total_projected_points', 0):.2f}")
    print(f"   Wins: {projection.get('projected_wins', 0):.3f}")
    print(f"   Saves: {projection.get('projected_saves', 0):.2f}")
    print(f"   Shutouts: {projection.get('projected_shutouts', 0):.3f}")
    print(f"   Is Goalie: {projection.get('is_goalie', False)}")
    print()
    
    # Step 2: Store in database
    print("💾 Step 2: Storing projection in database...")
    try:
        db.upsert(
            "player_projected_stats",
            projection,
            on_conflict="player_id,game_id,projection_date"
        )
        print("✅ Projection stored successfully")
    except Exception as e:
        print(f"❌ Failed to store projection: {e}")
        return
    
    print()
    
    # Step 3: Retrieve via RPC
    print("🔍 Step 3: Retrieving projection via RPC...")
    try:
        rpc_result = db.rpc(
            "get_daily_projections",
            {
                "p_player_ids": [goalie_id],
                "p_target_date": game_date.isoformat()
            }
        )
        
        if rpc_result and len(rpc_result) > 0:
            retrieved = rpc_result[0]
            print("✅ Projection retrieved via RPC:")
            print(f"   Player ID: {retrieved.get('player_id')}")
            print(f"   Is Goalie: {retrieved.get('is_goalie')}")
            print(f"   Total Points: {retrieved.get('total_projected_points', 0):.2f}")
            print(f"   Projected Wins: {retrieved.get('projected_wins')}")
            print(f"   Projected Saves: {retrieved.get('projected_saves')}")
            print(f"   Projected Shutouts: {retrieved.get('projected_shutouts')}")
            print(f"   Starter Confirmed: {retrieved.get('starter_confirmed')}")
        else:
            print("⚠️  No projection returned from RPC")
    except Exception as e:
        print(f"❌ Failed to retrieve via RPC: {e}")
        import traceback
        traceback.print_exc()
    
    print()
    print("=" * 80)
    print("✅ GOALIE PROJECTION FLOW TEST COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()
