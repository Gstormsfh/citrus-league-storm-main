#!/usr/bin/env python3
"""
Fix McDavid's two games with incorrect stats
"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from datetime import datetime

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
PLAYER_ID = 8478402
SEASON = 2025  # 2025-2026 season

print("=" * 80)
print("FIXING MCDAVID'S GAMES")
print("=" * 80)
print()

# Game 2025020786: Update shots from 3 to 4
print("Fixing Game 2025020786 (2026-01-20): Shots 3 -> 4")
try:
    db.update(
        "player_game_stats",
        {
            "nhl_shots_on_goal": 4,
            "updated_at": datetime.now().isoformat()
        },
        filters=[
            ("player_id", "eq", PLAYER_ID),
            ("game_id", "eq", 2025020786),
            ("season", "eq", SEASON)
        ]
    )
    print("  [OK] Fixed")
except Exception as e:
    print(f"  [ERROR] {e}")

# Game 2025020818: Update goals from 1 to 2, points from 4 to 5, shots from 8 to 9
print("Fixing Game 2025020818 (2026-01-24): Goals 1->2, Points 4->5, Shots 8->9")
try:
    db.update(
        "player_game_stats",
        {
            "nhl_goals": 2,
            "nhl_points": 5,  # 2 goals + 3 assists
            "nhl_shots_on_goal": 9,
            "updated_at": datetime.now().isoformat()
        },
        filters=[
            ("player_id", "eq", PLAYER_ID),
            ("game_id", "eq", 2025020818),
            ("season", "eq", SEASON)
        ]
    )
    print("  [OK] Fixed")
except Exception as e:
    print(f"  [ERROR] {e}")

# Verify
print()
print("Verifying fixes...")
games = db.select(
    "player_game_stats",
    select="game_id,game_date,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal",
    filters=[
        ("player_id", "eq", PLAYER_ID),
        ("game_id", "in", [2025020786, 2025020818]),
        ("season", "eq", SEASON)
    ],
    limit=10
)

for game in games:
    print(f"  Game {game.get('game_id')} ({game.get('game_date')}):")
    print(f"    Goals: {game.get('nhl_goals')}, Assists: {game.get('nhl_assists')}, Points: {game.get('nhl_points')}, Shots: {game.get('nhl_shots_on_goal')}")

print()
print("=" * 80)
print("FIXES COMPLETE")
print("=" * 80)
print()
print("Next steps:")
print("  1. Run: python build_player_season_stats.py")
print("  2. Run: python fetch_nhl_stats_from_landing.py")
