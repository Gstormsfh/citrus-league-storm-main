#!/usr/bin/env python3
"""Check if player_game_stats exists for today's live games"""
import os
import sys
import datetime as dt
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
today = dt.date.today()

# Get today's live games
games = db.select("nhl_games", select="game_id,home_team,away_team,status", filters=[("game_date", "eq", today.isoformat()), ("status", "eq", "live")], limit=10)
print(f"Today's live games: {len(games)}")
for g in games:
    game_id = g['game_id']
    # Check if player_game_stats exists for this game
    stats = db.select("player_game_stats", select="COUNT(*) as count", filters=[("game_id", "eq", game_id)], limit=1)
    count = stats[0].get('count', 0) if stats else 0
    print(f"  Game {game_id}: {count} player_game_stats rows")

