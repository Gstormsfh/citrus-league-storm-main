#!/usr/bin/env python3
"""Check McDavid's TOI breakdown from player_toi_by_situation"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
MCDAVID_ID = 8478402

# Get all TOI records for McDavid
toi_records = db.select(
    "player_toi_by_situation",
    select="game_id,situation,toi_seconds",
    filters=[("player_id", "eq", MCDAVID_ID)]
)

if toi_records:
    # Group by game
    toi_by_game = {}
    for record in toi_records:
        game_id = record.get("game_id")
        toi = record.get("toi_seconds") or 0
        if game_id not in toi_by_game:
            toi_by_game[game_id] = 0
        toi_by_game[game_id] += toi
    
    total_toi = sum(toi_by_game.values())
    avg_toi = total_toi / len(toi_by_game) if toi_by_game else 0
    
    print(f"Total games with TOI data: {len(toi_by_game)}")
    print(f"Total TOI: {total_toi} seconds ({total_toi/60:.1f} minutes)")
    print(f"Average TOI per game: {avg_toi:.1f} seconds ({avg_toi/60:.2f} minutes)")
    print()
    
    # Show games with lowest TOI
    sorted_games = sorted(toi_by_game.items(), key=lambda x: x[1])
    print("Games with lowest TOI (first 5):")
    for game_id, toi in sorted_games[:5]:
        print(f"  Game {game_id}: {toi} seconds ({toi/60:.2f} minutes)")
    
    print()
    print("Games with highest TOI (last 5):")
    for game_id, toi in sorted_games[-5:]:
        print(f"  Game {game_id}: {toi} seconds ({toi/60:.2f} minutes)")
else:
    print("No TOI records found in player_toi_by_situation")
