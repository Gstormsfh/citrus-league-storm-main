#!/usr/bin/env python3
"""Check stats for live games"""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

game_ids = [2025020660, 2025020661]

for game_id in game_ids:
    print(f"\nGame {game_id}:")
    stats = db.select(
        "player_game_stats",
        select="player_id,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal",
        filters=[("game_id", "eq", game_id)],
        limit=10
    )
    print(f"  {len(stats)} player_game_stats rows")
    if stats:
        all_zero = all(
            s.get("nhl_goals", 0) == 0 and 
            s.get("nhl_assists", 0) == 0 and 
            s.get("nhl_points", 0) == 0 and
            s.get("nhl_shots_on_goal", 0) == 0
            for s in stats
        )
        print(f"  All zero: {all_zero}")
        for s in stats[:5]:
            print(f"    Player {s['player_id']}: G={s.get('nhl_goals', 0)}, A={s.get('nhl_assists', 0)}, P={s.get('nhl_points', 0)}, SOG={s.get('nhl_shots_on_goal', 0)}")
    else:
        print("  No stats found")

