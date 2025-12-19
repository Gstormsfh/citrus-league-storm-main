#!/usr/bin/env python3
"""Quick script to check Connor McDavid's stats"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# Find McDavid's player_id
directory = db.select("player_directory", select="player_id,full_name,team_abbrev", filters=[("full_name", "ilike", "%McDavid%")], limit=10)
print("Player Directory:")
for p in directory:
    print(f"  {p}")

if directory:
    player_id = directory[0].get("player_id")
    print(f"\nPlayer ID: {player_id}\n")
    
    # Get season stats
    season_stats = db.select("player_season_stats", select="*", filters=[("player_id", "eq", player_id), ("season", "eq", 2025)], limit=1)
    print("Season Stats (2025):")
    if season_stats:
        stats = season_stats[0]
        print(f"  Games: {stats.get('games_played')}")
        print(f"  Goals: {stats.get('goals')}")
        primary_a = stats.get('primary_assists', 0) or 0
        secondary_a = stats.get('secondary_assists', 0) or 0
        total_assists = primary_a + secondary_a
        print(f"  Assists: {total_assists} (Primary: {primary_a}, Secondary: {secondary_a})")
        print(f"  Points: {stats.get('goals', 0) + total_assists}")
        print(f"  PPP: {stats.get('ppp')}")
        print(f"  SHP: {stats.get('shp')}")
        print(f"  TOI: {stats.get('icetime_seconds')} seconds ({stats.get('icetime_seconds', 0) // 60} minutes)")
        print(f"  Plus/Minus: {stats.get('plus_minus')}")
        print(f"  Hits: {stats.get('hits')}")
        print(f"  Blocks: {stats.get('blocks')}")
        print(f"  PIM: {stats.get('pim')}")
        print(f"  Updated: {stats.get('updated_at')}")
    else:
        print("  No season stats found!")
    
    # Get game stats count
    game_stats = db.select("player_game_stats", select="game_id,goals,primary_assists,secondary_assists,ppp,shp,icetime_seconds,plus_minus", filters=[("player_id", "eq", player_id), ("season", "eq", 2025)], limit=100)
    print(f"\nGame Stats Count: {len(game_stats) if game_stats else 0}")
    if game_stats:
        total_ppp = sum(g.get("ppp", 0) or 0 for g in game_stats)
        total_shp = sum(g.get("shp", 0) or 0 for g in game_stats)
        total_toi = sum(g.get("icetime_seconds", 0) or 0 for g in game_stats)
        total_assists = sum((g.get("primary_assists", 0) or 0) + (g.get("secondary_assists", 0) or 0) for g in game_stats)
        print(f"  Sum of PPP from games: {total_ppp}")
        print(f"  Sum of SHP from games: {total_shp}")
        print(f"  Sum of TOI from games: {total_toi} seconds ({total_toi // 60} minutes)")
        print(f"  Sum of Assists from games: {total_assists}")
        print(f"\nSample games (last 5):")
        for g in game_stats[-5:]:
            assists = (g.get("primary_assists", 0) or 0) + (g.get("secondary_assists", 0) or 0)
            print(f"  Game {g.get('game_id')}: G={g.get('goals')} A={assists} PPP={g.get('ppp')} SHP={g.get('shp')} TOI={g.get('icetime_seconds')}")
