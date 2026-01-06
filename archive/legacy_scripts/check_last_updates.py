#!/usr/bin/env python3
"""Check when games were last updated"""
import os
import sys
import datetime as dt
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

game_ids = [2025020660, 2025020661]

print("Checking last update times:")
print("=" * 80)

for game_id in game_ids:
    # Get player_game_stats to find updated_at
    stats = db.select(
        "player_game_stats",
        select="player_id,updated_at",
        filters=[("game_id", "eq", game_id)],
        limit=5
    )
    
    if stats:
        # Find the most recent update
        latest = None
        for s in stats:
            updated_str = s.get("updated_at")
            if updated_str:
                try:
                    updated = dt.datetime.fromisoformat(updated_str.replace('Z', '+00:00'))
                    if latest is None or updated > latest:
                        latest = updated
                except:
                    pass
        
        if latest:
            now = dt.datetime.now(dt.timezone.utc)
            age_seconds = (now - latest).total_seconds()
            print(f"Game {game_id}:")
            print(f"  Last update: {latest.strftime('%Y-%m-%d %H:%M:%S UTC')}")
            print(f"  Age: {age_seconds:.0f} seconds ago")
            print(f"  Cooldown needed: 30 seconds")
            print(f"  Ready to update: {'YES' if age_seconds >= 30 else f'NO (in {30-age_seconds:.0f}s)'}")
        else:
            print(f"Game {game_id}: Could not determine last update time")
    else:
        print(f"Game {game_id}: No stats found")

