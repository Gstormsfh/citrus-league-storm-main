#!/usr/bin/env python3
"""
Verify Genesis Week (Dec 15-21, 2025) NHL stats are populated.
Quick check to confirm the scraper worked and data is queryable.
"""

import os
from datetime import date
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def main():
    print("=" * 70)
    print("VERIFY GENESIS WEEK NHL STATS")
    print("=" * 70)
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Check each day of Genesis Week
    genesis_dates = [
        "2025-12-15", "2025-12-16", "2025-12-17", "2025-12-18",
        "2025-12-19", "2025-12-20", "2025-12-21"
    ]
    
    print("\nGames with NHL stats by date:")
    print("-" * 70)
    
    total_records = 0
    for date_str in genesis_dates:
        # Count player_game_stats records with nhl_goals > 0 or nhl_saves > 0
        result = db.select(
            "player_game_stats",
            select="player_id,nhl_goals,nhl_assists,nhl_hits,nhl_blocks,nhl_saves",
            filters=[],
            limit=1000
        )
        
        # Query games for this date
        games = db.select(
            "nhl_games",
            select="game_id,home_team,away_team,status",
            filters=[("game_date", "eq", date_str)],
            limit=50
        )
        
        # For each game, count how many have stats
        games_with_stats = 0
        players_with_stats = 0
        
        if games:
            for game in games:
                game_id = game.get("game_id")
                # Check if this game has nhl stats populated
                stats = db.select(
                    "player_game_stats",
                    select="player_id,nhl_goals,nhl_assists,nhl_hits",
                    filters=[("game_id", "eq", game_id)],
                    limit=50
                )
                if stats:
                    # Check if any have actual stats (not all zeros)
                    has_real_stats = any(
                        s.get("nhl_goals", 0) > 0 or 
                        s.get("nhl_assists", 0) > 0 or
                        s.get("nhl_hits", 0) > 0
                        for s in stats
                    )
                    if has_real_stats:
                        games_with_stats += 1
                        players_with_stats += len(stats)
        
        print(f"{date_str}: {len(games) if games else 0} games, {games_with_stats} with stats, {players_with_stats} player records")
        total_records += players_with_stats
    
    print("-" * 70)
    print(f"Total player records with NHL stats: {total_records}")
    
    # Sample some actual stats
    print("\n" + "=" * 70)
    print("SAMPLE PLAYER STATS (Dec 15, 2025)")
    print("=" * 70)
    
    # Get a sample game from Dec 15
    sample_games = db.select(
        "nhl_games",
        select="game_id,home_team,away_team",
        filters=[("game_date", "eq", "2025-12-15")],
        limit=1
    )
    
    if sample_games:
        game_id = sample_games[0].get("game_id")
        print(f"\nGame: {sample_games[0].get('away_team')} @ {sample_games[0].get('home_team')}")
        
        # Get top scorers from this game
        stats = db.select(
            "player_game_stats",
            select="player_id,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,nhl_hits,nhl_blocks,nhl_faceoff_wins,nhl_takeaways",
            filters=[("game_id", "eq", game_id)],
            order="nhl_points.desc",
            limit=5
        )
        
        if stats:
            print(f"\nTop performers:")
            for s in stats:
                print(f"  Player {s.get('player_id')}: {s.get('nhl_goals')}G, {s.get('nhl_assists')}A, "
                      f"{s.get('nhl_shots_on_goal')}SOG, {s.get('nhl_hits')}H, {s.get('nhl_blocks')}BLK, "
                      f"{s.get('nhl_faceoff_wins')}FOW, {s.get('nhl_takeaways')}TK")
    
    print("\n✅ Verification complete!")
    return 0

if __name__ == "__main__":
    main()
