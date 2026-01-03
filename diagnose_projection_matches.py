#!/usr/bin/env python3
"""
Diagnostic script to investigate why only 126/1000 projections match with actuals.
Identifies the root cause of the "Ghost Projection" problem.
"""

from dotenv import load_dotenv
import os
import sys
from datetime import date, datetime
from collections import defaultdict

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def diagnose_missing_matches(
    db: SupabaseRest,
    season: int,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None
):
    """
    Diagnose why projections don't match with actual game stats.
    """
    print("\n" + "="*80)
    print("PROJECTION MATCH DIAGNOSTIC")
    print("="*80 + "\n")
    
    # Build filters
    filters = [("season", "eq", season)]
    if start_date:
        filters.append(("projection_date", "gte", start_date.isoformat()))
    if end_date:
        filters.append(("projection_date", "lte", end_date.isoformat()))
    
    # Fetch all projections
    print("1. Fetching projections...")
    projections = db.select(
        "player_projected_stats",
        select="player_id,game_id,projection_date,is_goalie",
        filters=filters,
        limit=10000
    )
    print(f"   Found {len(projections)} projections\n")
    
    # Fetch player directory for names
    player_ids = list(set(int(p.get("player_id", 0)) for p in projections if p.get("player_id")))
    print(f"2. Fetching player directory for {len(player_ids)} players...")
    
    player_info = {}
    batch_size = 1000
    for i in range(0, len(player_ids), batch_size):
        batch = player_ids[i:i+batch_size]
        players = db.select(
            "player_directory",
            select="player_id,full_name,position_code",
            filters=[("player_id", "in", batch), ("season", "eq", season)],
            limit=batch_size
        )
        for p in players:
            player_info[int(p.get("player_id", 0))] = {
                "name": p.get("full_name", "Unknown"),
                "position": p.get("position_code", "Unknown")
            }
    print(f"   Loaded {len(player_info)} player names\n")
    
    # Fetch all game stats for these games
    game_ids = list(set(int(p.get("game_id", 0)) for p in projections if p.get("game_id")))
    print(f"3. Fetching game stats for {len(game_ids)} games...")
    
    game_stats_map = {}
    batch_size = 100
    for i in range(0, len(game_ids), batch_size):
        batch = game_ids[i:i+batch_size]
        stats = db.select(
            "player_game_stats",
            select="player_id,game_id,goals,primary_assists,secondary_assists,shots_on_goal,blocks,is_goalie",
            filters=[("game_id", "in", batch), ("season", "eq", season)],
            limit=batch_size * 50
        )
        for stat in stats:
            key = (int(stat.get("player_id", 0)), int(stat.get("game_id", 0)))
            game_stats_map[key] = stat
    print(f"   Found {len(game_stats_map)} game stat records\n")
    
    # Analyze matches
    print("4. Analyzing matches...")
    matched = []
    unmatched = []
    unmatched_reasons = defaultdict(int)
    
    for proj in projections:
        player_id = int(proj.get("player_id", 0))
        game_id = int(proj.get("game_id", 0))
        key = (player_id, game_id)
        
        if key in game_stats_map:
            matched.append(proj)
        else:
            unmatched.append(proj)
            # Try to diagnose why
            # Check if player exists in directory
            if player_id not in player_info:
                unmatched_reasons["player_not_in_directory"] += 1
            # Check if any stats exist for this game
            elif game_id not in [gid for (pid, gid) in game_stats_map.keys()]:
                unmatched_reasons["no_stats_for_game"] += 1
            # Check if player has stats for other games (player exists but not this game)
            elif player_id not in [pid for (pid, gid) in game_stats_map.keys()]:
                unmatched_reasons["player_never_played"] += 1
            else:
                unmatched_reasons["player_didnt_play_this_game"] += 1
    
    print(f"   Matched: {len(matched)} ({100*len(matched)/len(projections):.1f}%)")
    print(f"   Unmatched: {len(unmatched)} ({100*len(unmatched)/len(projections):.1f}%)\n")
    
    # Breakdown by reason
    print("5. Unmatched Projections - Reason Breakdown:")
    print("-" * 80)
    for reason, count in sorted(unmatched_reasons.items(), key=lambda x: x[1], reverse=True):
        print(f"   {reason}: {count} ({100*count/len(unmatched):.1f}%)")
    print()
    
    # Sample unmatched projections
    print("6. Sample Unmatched Projections (First 20):")
    print("-" * 80)
    for i, proj in enumerate(unmatched[:20], 1):
        player_id = int(proj.get("player_id", 0))
        game_id = int(proj.get("game_id", 0))
        proj_date = proj.get("projection_date")
        is_goalie = proj.get("is_goalie", False)
        
        player_name = player_info.get(player_id, {}).get("name", f"Player {player_id}")
        position = player_info.get(player_id, {}).get("position", "Unknown")
        
        # Check if player has ANY stats for this game
        has_any_stats = game_id in [gid for (pid, gid) in game_stats_map.keys()]
        player_has_other_stats = player_id in [pid for (pid, gid) in game_stats_map.keys()]
        
        reason = "Unknown"
        if not has_any_stats:
            reason = "No stats for this game"
        elif not player_has_other_stats:
            reason = "Player never played (scratched/injured)"
        else:
            reason = "Player didn't play this specific game"
        
        print(f"   {i}. {player_name} ({position}) - Game {game_id} on {proj_date}")
        print(f"      Reason: {reason}")
    print()
    
    # Check date alignment
    print("7. Date Alignment Check:")
    print("-" * 80)
    projection_dates = set(p.get("projection_date") for p in projections)
    game_dates = set()
    
    # Get game dates from nhl_games
    if game_ids:
        batch_size = 100
        for i in range(0, len(game_ids), batch_size):
            batch = game_ids[i:i+batch_size]
            games = db.select(
                "nhl_games",
                select="game_id,game_date",
                filters=[("game_id", "in", batch), ("season", "eq", season)],
                limit=batch_size
            )
            for game in games:
                game_dates.add(game.get("game_date"))
    
    print(f"   Projection dates: {sorted(projection_dates)}")
    print(f"   Game dates: {sorted(game_dates)[:10]}...")  # Show first 10
    if projection_dates != game_dates:
        print("   ⚠️  WARNING: Date mismatch detected!")
        print(f"   Projection dates not in game dates: {projection_dates - game_dates}")
    else:
        print("   ✓ Dates align correctly")
    print()
    
    # Check for player ID mismatches
    print("8. Player ID Consistency Check:")
    print("-" * 80)
    projection_player_ids = set(int(p.get("player_id", 0)) for p in projections)
    stats_player_ids = set(pid for (pid, gid) in game_stats_map.keys())
    directory_player_ids = set(player_info.keys())
    
    print(f"   Projections use {len(projection_player_ids)} unique player IDs")
    print(f"   Game stats use {len(stats_player_ids)} unique player IDs")
    print(f"   Directory has {len(directory_player_ids)} unique player IDs")
    
    proj_not_in_stats = projection_player_ids - stats_player_ids
    proj_not_in_dir = projection_player_ids - directory_player_ids
    
    if proj_not_in_stats:
        print(f"   ⚠️  {len(proj_not_in_stats)} projection player IDs not in game stats")
        print(f"      Sample: {list(proj_not_in_stats)[:5]}")
    
    if proj_not_in_dir:
        print(f"   ⚠️  {len(proj_not_in_dir)} projection player IDs not in directory")
        print(f"      Sample: {list(proj_not_in_dir)[:5]}")
    
    if not proj_not_in_stats and not proj_not_in_dir:
        print("   ✓ All player IDs are consistent")
    print()
    
    # Summary
    print("="*80)
    print("DIAGNOSTIC SUMMARY")
    print("="*80)
    print(f"Match Rate: {100*len(matched)/len(projections):.1f}%")
    print(f"Primary Issue: {max(unmatched_reasons.items(), key=lambda x: x[1])[0] if unmatched_reasons else 'Unknown'}")
    print("="*80 + "\n")
    
    return {
        "total_projections": len(projections),
        "matched": len(matched),
        "unmatched": len(unmatched),
        "match_rate": len(matched) / len(projections) if projections else 0,
        "unmatched_reasons": dict(unmatched_reasons)
    }

def main():
    if len(sys.argv) < 2:
        season = 2025
    else:
        season = int(sys.argv[1])
    
    start_date = None
    end_date = None
    
    if len(sys.argv) > 2:
        try:
            start_date = datetime.fromisoformat(sys.argv[2]).date()
        except:
            pass
    
    if len(sys.argv) > 3:
        try:
            end_date = datetime.fromisoformat(sys.argv[3]).date()
        except:
            pass
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    result = diagnose_missing_matches(db, season, start_date, end_date)
    
    if result["match_rate"] < 0.5:
        print("⚠️  WARNING: Match rate is below 50%. This indicates a significant data alignment issue.")
        print("   Recommendations:")
        print("   1. Check if projections are being created for scratched/injured players")
        print("   2. Verify player_id consistency between projections and game stats")
        print("   3. Check date/time alignment (UTC vs local time)")
        print("   4. Ensure game_stats are populated for all projected games")

if __name__ == "__main__":
    main()

