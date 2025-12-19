#!/usr/bin/env python3
"""Check McDavid's TOI from official shifts"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
MCDAVID_ID = 8478402

# Get all official shifts for McDavid
shifts = db.select(
    "player_shifts_official",
    select="game_id,shift_start_time_seconds,shift_end_time_seconds",
    filters=[("player_id", "eq", MCDAVID_ID)]
)

if shifts:
    # Group by game and calculate TOI
    toi_by_game = {}
    for shift in shifts:
        game_id = shift.get("game_id")
        start = shift.get("shift_start_time_seconds")
        end = shift.get("shift_end_time_seconds")
        
        if not game_id or start is None or end is None:
            continue
        
        duration = max(0, float(end) - float(start))
        
        if game_id not in toi_by_game:
            toi_by_game[game_id] = 0
        toi_by_game[game_id] += duration
    
    total_toi = sum(toi_by_game.values())
    avg_toi = total_toi / len(toi_by_game) if toi_by_game else 0
    
    print(f"Total games with official shifts: {len(toi_by_game)}")
    print(f"Total TOI: {total_toi:.1f} seconds ({total_toi/60:.1f} minutes)")
    print(f"Average TOI per game: {avg_toi:.1f} seconds ({avg_toi/60:.2f} minutes)")
    print()
    
    # Show games with lowest TOI
    sorted_games = sorted(toi_by_game.items(), key=lambda x: x[1])
    print("Games with lowest TOI (first 5):")
    for game_id, toi in sorted_games[:5]:
        print(f"  Game {game_id}: {toi:.1f} seconds ({toi/60:.2f} minutes)")
    
    print()
    print("Games with highest TOI (last 5):")
    for game_id, toi in sorted_games[-5:]:
        print(f"  Game {game_id}: {toi:.1f} seconds ({toi/60:.2f} minutes)")
else:
    print("No official shifts found")
