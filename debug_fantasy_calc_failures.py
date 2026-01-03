#!/usr/bin/env python3
"""
Debug why fantasy point calculation is failing for players who have stats.
"""

from dotenv import load_dotenv
import os
import sys

from supabase_rest import SupabaseRest
from calculate_daily_projections import calculate_fantasy_points

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

DEFAULT_SCORING = {
    "skater": {
        "goals": 3.0,
        "assists": 2.0,
        "shots_on_goal": 0.4,
        "blocks": 0.5,
        "ppp": 1.0,
        "shp": 2.0,
        "hits": 0.2,
        "pim": 0.1
    },
    "goalie": {
        "wins": 5.0,
        "saves": 0.2,
        "shutouts": 3.0,
        "goals_against": -1.0
    }
}

def debug_fantasy_calc(db: SupabaseRest, season: int):
    """
    Debug why fantasy calculation fails for some players.
    """
    print("\n" + "="*80)
    print("DEBUGGING FANTASY CALCULATION FAILURES")
    print("="*80 + "\n")
    
    # Get sample of players where calc failed
    problem_players = [
        (8479992, 2025020321),
        (8479359, 2025020408),
        (8480798, 2025020314),
        (8476889, 2025020415),
        (8474151, 2025020113),
    ]
    
    print("1. Checking problem players:")
    print("-" * 80)
    
    for player_id, game_id in problem_players:
        print(f"\n   Player {player_id}, Game {game_id}:")
        
        # Get the actual stat record
        stats = db.select(
            "player_game_stats",
            select="player_id,game_id,goals,primary_assists,secondary_assists,shots_on_goal,blocks,ppp,shp,hits,pim,wins,shutouts,saves,goals_against,is_goalie",
            filters=[("player_id", "eq", player_id), ("game_id", "eq", game_id), ("season", "eq", season)],
            limit=1
        )
        
        if not stats or len(stats) == 0:
            print("      ERROR: No stats found!")
            continue
        
        stat = stats[0]
        print(f"      Raw stats: {dict(stat)}")
        
        is_goalie = bool(stat.get("is_goalie", False))
        print(f"      Is goalie: {is_goalie}")
        
        # Try to calculate
        try:
            if is_goalie:
                goalie_stats = {
                    "wins": int(stat.get("wins", 0)),
                    "shutouts": int(stat.get("shutouts", 0)),
                    "saves": int(stat.get("saves", 0)),
                    "goals_against": int(stat.get("goals_against", 0))
                }
                print(f"      Goalie stats dict: {goalie_stats}")
                points = calculate_fantasy_points(goalie_stats, DEFAULT_SCORING, is_goalie=True)
                print(f"      Calculated points: {points}")
            else:
                skater_stats = {
                    "goals": int(stat.get("goals", 0)),
                    "assists": int(stat.get("primary_assists", 0)) + int(stat.get("secondary_assists", 0)),
                    "sog": int(stat.get("shots_on_goal", 0)),
                    "blocks": int(stat.get("blocks", 0)),
                    "ppp": int(stat.get("ppp", 0)),
                    "shp": int(stat.get("shp", 0)),
                    "hits": int(stat.get("hits", 0)),
                    "pim": int(stat.get("pim", 0))
                }
                print(f"      Skater stats dict: {skater_stats}")
                points = calculate_fantasy_points(skater_stats, DEFAULT_SCORING, is_goalie=False)
                print(f"      Calculated points: {points}")
        except Exception as e:
            print(f"      ERROR calculating: {e}")
            import traceback
            traceback.print_exc()
    
    print("\n" + "="*80)
    print("2. Checking for NULL values in stats:")
    print("-" * 80)
    
    # Check a larger sample for NULL values
    sample_stats = db.select(
        "player_game_stats",
        select="player_id,game_id,goals,primary_assists,secondary_assists,shots_on_goal,blocks,ppp,shp,hits,pim,wins,shutouts,saves,goals_against,is_goalie",
        filters=[("season", "eq", season)],
        limit=1000
    )
    
    null_counts = {}
    for stat in sample_stats:
        for key, value in stat.items():
            if value is None:
                null_counts[key] = null_counts.get(key, 0) + 1
    
    if null_counts:
        print("   Found NULL values:")
        for key, count in null_counts.items():
            print(f"      {key}: {count} NULL values")
    else:
        print("   No NULL values found in sample")
    
    print("\n" + "="*80 + "\n")

if __name__ == "__main__":
    season = 2025
    if len(sys.argv) > 1:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    debug_fantasy_calc(db, season)



