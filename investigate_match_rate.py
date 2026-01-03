#!/usr/bin/env python3
"""
Investigate why match rate is only 22.6% when 50% of games have been played.
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

def investigate_match_rate(db: SupabaseRest, season: int):
    """
    Deep dive into why match rate is so low.
    """
    print("\n" + "="*80)
    print("MATCH RATE INVESTIGATION")
    print("="*80 + "\n")
    
    # 1. Get ALL games with stats (no limits)
    print("1. Getting ALL games with actual stats...")
    all_stats = []
    offset = 0
    limit = 1000
    while True:
        stats = db.select(
            "player_game_stats",
            select="player_id,game_id,game_date",
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
        if offset % 10000 == 0:
            print(f"   Fetched {len(all_stats)} stat records...")
    
    stats_by_game = defaultdict(set)
    for stat in all_stats:
        game_id = int(stat.get("game_id", 0))
        player_id = int(stat.get("player_id", 0))
        if game_id and player_id:
            stats_by_game[game_id].add(player_id)
    
    unique_games_with_stats = len(stats_by_game)
    total_stat_records = len(all_stats)
    print(f"   Total stat records: {total_stat_records:,}")
    print(f"   Unique games with stats: {unique_games_with_stats}")
    print(f"   Average players per game: {total_stat_records / unique_games_with_stats:.1f}")
    print()
    
    # 2. Get ALL projections for games that have stats
    print("2. Getting ALL projections for games with stats...")
    game_ids_with_stats = list(stats_by_game.keys())
    
    all_projections = []
    batch_size = 100
    for i in range(0, len(game_ids_with_stats), batch_size):
        game_batch = game_ids_with_stats[i:i+batch_size]
        projs = db.select(
            "player_projected_stats",
            select="player_id,game_id,projection_date",
            filters=[("game_id", "in", game_batch), ("season", "eq", season)],
            limit=10000
        )
        if projs:
            all_projections.extend(projs)
        if (i + batch_size) % 500 == 0:
            print(f"   Processed {min(i + batch_size, len(game_ids_with_stats))}/{len(game_ids_with_stats)} games...")
    
    print(f"   Total projections for games with stats: {len(all_projections):,}")
    print()
    
    # 3. Analyze matching
    print("3. Analyzing matches...")
    
    # Create lookup: (player_id, game_id) -> True
    stats_keys = set()
    for stat in all_stats:
        key = (int(stat.get("player_id", 0)), int(stat.get("game_id", 0)))
        if key[0] and key[1]:
            stats_keys.add(key)
    
    # Check projections
    matched = []
    unmatched = []
    unmatched_reasons = defaultdict(int)
    
    for proj in all_projections:
        player_id = int(proj.get("player_id", 0))
        game_id = int(proj.get("game_id", 0))
        key = (player_id, game_id)
        
        if key in stats_keys:
            matched.append(proj)
        else:
            unmatched.append(proj)
            # Diagnose why
            if game_id not in stats_by_game:
                unmatched_reasons["game_has_no_stats"] += 1
            elif player_id not in stats_by_game[game_id]:
                unmatched_reasons["player_didnt_play_this_game"] += 1
            else:
                unmatched_reasons["unknown"] += 1
    
    print(f"   Matched: {len(matched):,} ({100*len(matched)/len(all_projections):.1f}%)")
    print(f"   Unmatched: {len(unmatched):,} ({100*len(unmatched)/len(all_projections):.1f}%)")
    print()
    
    print("4. Unmatched Reasons:")
    print("-" * 80)
    for reason, count in sorted(unmatched_reasons.items(), key=lambda x: x[1], reverse=True):
        print(f"   {reason}: {count:,} ({100*count/len(unmatched):.1f}%)")
    print()
    
    # 5. Sample unmatched projections
    print("5. Sample Unmatched Projections (First 20):")
    print("-" * 80)
    
    # Get player names
    player_ids = list(set(int(p.get("player_id", 0)) for p in unmatched[:100] if p.get("player_id")))
    player_names = {}
    if player_ids:
        batch_size = 1000
        for i in range(0, len(player_ids), batch_size):
            batch = player_ids[i:i+batch_size]
            players = db.select(
                "player_directory",
                select="player_id,full_name",
                filters=[("player_id", "in", batch), ("season", "eq", season)],
                limit=batch_size
            )
            for p in players:
                player_names[int(p.get("player_id", 0))] = p.get("full_name", "Unknown")
    
    for i, proj in enumerate(unmatched[:20], 1):
        player_id = int(proj.get("player_id", 0))
        game_id = int(proj.get("game_id", 0))
        player_name = player_names.get(player_id, f"Player {player_id}")
        
        reason = "Unknown"
        if game_id not in stats_by_game:
            reason = "Game has no stats"
        elif player_id not in stats_by_game[game_id]:
            reason = "Player didn't play this game (scratched/injured)"
        
        print(f"   {i}. {player_name} (ID: {player_id}) - Game {game_id}")
        print(f"      Reason: {reason}")
    print()
    
    # 6. Projections per game analysis
    print("6. Projections vs Stats per Game:")
    print("-" * 80)
    
    proj_by_game = defaultdict(int)
    for proj in all_projections:
        game_id = int(proj.get("game_id", 0))
        if game_id:
            proj_by_game[game_id] += 1
    
    games_with_both = []
    for game_id in stats_by_game.keys():
        stats_count = len(stats_by_game[game_id])
        proj_count = proj_by_game.get(game_id, 0)
        games_with_both.append((game_id, stats_count, proj_count))
    
    games_with_both.sort(key=lambda x: x[1], reverse=True)
    
    print("   Top 10 games by stat count:")
    for game_id, stats_count, proj_count in games_with_both[:10]:
        match_pct = 100 * min(proj_count, stats_count) / max(proj_count, stats_count) if max(proj_count, stats_count) > 0 else 0
        print(f"   Game {game_id}: {stats_count} stats, {proj_count} projections ({match_pct:.1f}% coverage)")
    print()
    
    # 7. Summary
    print("="*80)
    print("SUMMARY")
    print("="*80)
    print(f"Total games with stats: {unique_games_with_stats}")
    print(f"Total projections for those games: {len(all_projections):,}")
    print(f"Matched projections: {len(matched):,} ({100*len(matched)/len(all_projections):.1f}%)")
    print(f"Unmatched projections: {len(unmatched):,} ({100*len(unmatched)/len(all_projections):.1f}%)")
    print()
    
    if len(unmatched) > len(matched):
        print("ROOT CAUSE ANALYSIS:")
        primary_reason = max(unmatched_reasons.items(), key=lambda x: x[1])[0]
        print(f"   Primary issue: {primary_reason}")
        print()
        print("SOLUTION:")
        if "player_didnt_play_this_game" in primary_reason:
            print("   → Projections are being created for players who didn't play")
            print("   → Need to filter projections to only players who actually played")
            print("   → Or implement 'likely to play' filter in backtest")
        elif "game_has_no_stats" in primary_reason:
            print("   → Some games have projections but no stats")
            print("   → These are likely future games or games without data")
    
    print("="*80 + "\n")

if __name__ == "__main__":
    season = 2025
    if len(sys.argv) > 1:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    investigate_match_rate(db, season)



