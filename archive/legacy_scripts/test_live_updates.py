#!/usr/bin/env python3
"""Test live updates"""

from scrape_live_nhl_stats import update_live_game_stats
from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 80)
print("TESTING LIVE UPDATES")
print("=" * 80)
print()

print("1. Running live stats update...")
result = update_live_game_stats()
print(f"   Updated: {result.get('updated', 0)} games")
print(f"   Failed: {result.get('failed', 0)} games")
print()

print("2. Checking nhl_games scores...")
games = db.select('nhl_games', select='game_id,home_team,away_team,home_score,away_score,status,period', filters=[('game_date', 'eq', '2026-01-04')], limit=10)
if games:
    for g in games:
        game_id = g.get('game_id')
        home = g.get('home_team', '?')
        away = g.get('away_team', '?')
        home_score = g.get('home_score', 0)
        away_score = g.get('away_score', 0)
        status = g.get('status', 'unknown')
        period = g.get('period', '')
        
        score_str = f"{away} {away_score}-{home_score} {home}"
        if period:
            score_str += f" ({period})"
        
        print(f"   Game {game_id}: {score_str} - Status: {status}")
else:
    print("   No games found")

print()
print("=" * 80)

