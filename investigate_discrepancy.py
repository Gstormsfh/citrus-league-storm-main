#!/usr/bin/env python3
"""
Investigate the discrepancy between audit (1,327 unmatched) and verification (292 unmatched).
Find exactly what's different and why.
"""

from dotenv import load_dotenv
import os
import sys
from collections import defaultdict

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

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

def investigate_discrepancy(db: SupabaseRest, season: int):
    """
    Find the exact discrepancy between audit and verification methods.
    """
    print("\n" + "="*80)
    print("DISCREPANCY INVESTIGATION")
    print("="*80 + "\n")
    
    # Get all games with stats
    print("1. Getting ALL games with stats...")
    all_stats = []
    offset = 0
    limit = 1000
    while True:
        stats = db.select(
            "player_game_stats",
            select="game_id",
            filters=[("season", "eq", season)],
            limit=limit,
            offset=offset
        )
        if not stats or len(stats) == 0:
            break
        all_stats.extend(stats)
        if len(stats) < limit:
            break
        offset += limit
    
    games_with_stats = set(int(s.get("game_id", 0)) for s in all_stats if s.get("game_id"))
    print(f"   Total games with stats: {len(games_with_stats)}\n")
    
    # Get ALL projections for these games
    print("2. Getting ALL projections for games with stats...")
    all_projections = []
    game_id_list = list(games_with_stats)
    batch_size = 100
    for i in range(0, len(game_id_list), batch_size):
        game_batch = game_id_list[i:i+batch_size]
        projs = db.select(
            "player_projected_stats",
            select="player_id,game_id,projection_date",
            filters=[("game_id", "in", game_batch), ("season", "eq", season)],
            limit=10000
        )
        if projs:
            all_projections.extend(projs)
        if (i + batch_size) % 500 == 0:
            print(f"   Processed {min(i + batch_size, len(game_id_list))}/{len(game_id_list)} games...")
    
    print(f"   Total projections: {len(all_projections):,}\n")
    
    # Method 1: Simple matching (like verification script)
    print("3. Method 1: Simple player_id + game_id matching...")
    stats_keys = set()
    offset = 0
    while True:
        stats = db.select(
            "player_game_stats",
            select="player_id,game_id",
            filters=[("game_id", "in", game_id_list), ("season", "eq", season)],
            limit=limit,
            offset=offset
        )
        if not stats or len(stats) == 0:
            break
        for stat in stats:
            key = (int(stat.get("player_id", 0)), int(stat.get("game_id", 0)))
            if key[0] and key[1]:
                stats_keys.add(key)
        if len(stats) < limit:
            break
        offset += limit
    
    method1_matched = []
    method1_unmatched = []
    for proj in all_projections:
        key = (int(proj.get("player_id", 0)), int(proj.get("game_id", 0)))
        if key in stats_keys:
            method1_matched.append(proj)
        else:
            method1_unmatched.append(proj)
    
    print(f"   Matched: {len(method1_matched):,}")
    print(f"   Unmatched: {len(method1_unmatched):,}")
    print(f"   Match Rate: {100*len(method1_matched)/len(all_projections):.1f}%\n")
    
    # Method 2: Audit method (with fantasy points calculation)
    print("4. Method 2: Audit method (with fantasy points calculation)...")
    
    # Get stats with full details for fantasy point calculation
    actual_points_map = {}
    offset = 0
    while True:
        stats = db.select(
            "player_game_stats",
            select="player_id,game_id,goals,primary_assists,secondary_assists,shots_on_goal,blocks,ppp,shp,hits,pim,wins,shutouts,saves,goals_against,is_goalie",
            filters=[("game_id", "in", game_id_list), ("season", "eq", season)],
            limit=limit,
            offset=offset
        )
        if not stats or len(stats) == 0:
            break
        for stat in stats:
            key = (int(stat.get("player_id", 0)), int(stat.get("game_id", 0)))
            is_goalie = bool(stat.get("is_goalie", False))
            
            try:
                if is_goalie:
                    goalie_stats = {
                        "wins": int(stat.get("wins", 0)),
                        "shutouts": int(stat.get("shutouts", 0)),
                        "saves": int(stat.get("saves", 0)),
                        "goals_against": int(stat.get("goals_against", 0))
                    }
                    actual_points_map[key] = calculate_fantasy_points(goalie_stats, DEFAULT_SCORING, is_goalie=True)
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
                    actual_points_map[key] = calculate_fantasy_points(skater_stats, DEFAULT_SCORING, is_goalie=False)
            except:
                # Skip if calculation fails
                pass
        
        if len(stats) < limit:
            break
        offset += limit
    
    method2_matched = []
    method2_unmatched = []
    for proj in all_projections:
        key = (int(proj.get("player_id", 0)), int(proj.get("game_id", 0)))
        if key in actual_points_map:
            method2_matched.append(proj)
        else:
            method2_unmatched.append(proj)
    
    print(f"   Matched: {len(method2_matched):,}")
    print(f"   Unmatched: {len(method2_unmatched):,}")
    print(f"   Match Rate: {100*len(method2_matched)/len(all_projections):.1f}%\n")
    
    # Compare the two methods
    print("5. Comparing Methods:")
    print("-" * 80)
    print(f"Method 1 (Simple): {len(method1_matched):,} matched, {len(method1_unmatched):,} unmatched")
    print(f"Method 2 (Audit):  {len(method2_matched):,} matched, {len(method2_unmatched):,} unmatched")
    print()
    
    # Find differences
    method1_unmatched_keys = set((int(p.get("player_id", 0)), int(p.get("game_id", 0))) for p in method1_unmatched)
    method2_unmatched_keys = set((int(p.get("player_id", 0)), int(p.get("game_id", 0))) for p in method2_unmatched)
    
    only_in_method1 = method1_unmatched_keys - method2_unmatched_keys
    only_in_method2 = method2_unmatched_keys - method1_unmatched_keys
    
    print(f"Unmatched only in Method 1: {len(only_in_method1)}")
    print(f"Unmatched only in Method 2: {len(only_in_method2)}")
    print()
    
    # Check why Method 2 has more unmatched
    if len(only_in_method2) > 0:
        print("6. Investigating why Method 2 has more unmatched:")
        print("-" * 80)
        
        # Sample some of the extra unmatched
        sample_keys = list(only_in_method2)[:20]
        for key in sample_keys:
            player_id, game_id = key
            # Check if this key exists in stats_keys
            if key in stats_keys:
                print(f"   Player {player_id}, Game {game_id}: Has stats but fantasy calc failed")
            else:
                print(f"   Player {player_id}, Game {game_id}: No stats (scratched)")
        print()
    
    # Check for data quality issues
    print("7. Data Quality Checks:")
    print("-" * 80)
    
    # Check for NULL or invalid values in stats
    invalid_stats = 0
    offset = 0
    while True:
        stats = db.select(
            "player_game_stats",
            select="player_id,game_id,goals,primary_assists,secondary_assists,shots_on_goal,blocks,ppp,shp,hits,pim,wins,shutouts,saves,goals_against,is_goalie",
            filters=[("game_id", "in", game_id_list[:100]), ("season", "eq", season)],  # Sample first 100 games
            limit=limit,
            offset=offset
        )
        if not stats or len(stats) == 0:
            break
        for stat in stats:
            # Check for NULL values that might break calculation
            if stat.get("goals") is None or stat.get("primary_assists") is None:
                invalid_stats += 1
        if len(stats) < limit:
            break
        offset += limit
    
    print(f"   Stats with NULL values (sample): {invalid_stats}")
    print()
    
    # Final summary
    print("="*80)
    print("FINAL SUMMARY")
    print("="*80)
    print(f"Total Projections: {len(all_projections):,}")
    print(f"Method 1 Matched: {len(method1_matched):,} ({100*len(method1_matched)/len(all_projections):.1f}%)")
    print(f"Method 2 Matched: {len(method2_matched):,} ({100*len(method2_matched)/len(all_projections):.1f}%)")
    print()
    
    if len(method1_unmatched) != len(method2_unmatched):
        print("DISCREPANCY FOUND:")
        diff = abs(len(method1_unmatched) - len(method2_unmatched))
        print(f"   Difference: {diff} projections")
        if len(method2_unmatched) > len(method1_unmatched):
            print(f"   Method 2 (Audit) has {diff} MORE unmatched")
            print("   Possible causes:")
            print("   - Fantasy point calculation failing for some stats")
            print("   - NULL values in stats breaking calculation")
            print("   - Stats exist but calculation returns None/error")
        else:
            print(f"   Method 1 (Simple) has {diff} MORE unmatched")
    else:
        print("NO DISCREPANCY: Both methods agree")
    
    print("="*80 + "\n")

if __name__ == "__main__":
    season = 2025
    if len(sys.argv) > 1:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    investigate_discrepancy(db, season)


