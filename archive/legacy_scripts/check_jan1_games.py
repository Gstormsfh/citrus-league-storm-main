#!/usr/bin/env python3
"""Check all games on Jan 1 for 0-0 final scores"""

import sys
sys.stdout.reconfigure(encoding='utf-8')

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import requests

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 80)
print("CHECKING JAN 1 GAMES FOR 0-0 FINAL SCORES")
print("=" * 80)
print()

games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[('game_date', 'eq', '2026-01-01')],
    limit=50
)

print(f"Found {len(games)} games on Jan 1, 2026")
print()

# Find final games with 0-0 scores
final_zero_zero = [
    g for g in games 
    if g.get('status') == 'final' and g.get('home_score') == 0 and g.get('away_score') == 0
]

if final_zero_zero:
    print(f"⚠️  Found {len(final_zero_zero)} final game(s) with 0-0 scores:")
    print()
    
    for g in final_zero_zero:
        game_id = g.get('game_id')
        home = g.get('home_team', '?')
        away = g.get('away_team', '?')
        
        print(f"Game {game_id}: {away} @ {home}")
        
        # Check NHL API
        try:
            boxscore = requests.get(
                f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore",
                timeout=10
            ).json()
            
            api_home_score = boxscore.get('homeTeam', {}).get('score')
            api_away_score = boxscore.get('awayTeam', {}).get('score')
            api_state = boxscore.get('gameState', '')
            
            print(f"  Database: 0-0 (final)")
            print(f"  NHL API: {api_away_score}-{api_home_score} ({api_state})")
            
            if api_state == 'OFF' and (api_home_score != 0 or api_away_score != 0):
                print(f"  [ERROR] DATABASE NEEDS UPDATE!")
        except Exception as e:
            print(f"  Error checking NHL API: {e}")
        print()
else:
    print("[OK] No final games with 0-0 scores found")

# Also check for UTA vs NYI specifically
uta_nyi = [
    g for g in games 
    if ('UTA' in [g.get('home_team'), g.get('away_team')] and 
        'NYI' in [g.get('home_team'), g.get('away_team')])
]

if uta_nyi:
    print()
    print("UTA vs NYI game(s):")
    for g in uta_nyi:
        game_id = g.get('game_id')
        home = g.get('home_team', '?')
        away = g.get('away_team', '?')
        home_score = g.get('home_score')
        away_score = g.get('away_score')
        status = g.get('status', '?')
        
        print(f"  Game {game_id}: {away} {away_score}-{home_score} {home} [{status}]")

