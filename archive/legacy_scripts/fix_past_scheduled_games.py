#!/usr/bin/env python3
"""Fix past games that are still marked as scheduled"""

import sys
sys.stdout.reconfigure(encoding='utf-8')

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import datetime as dt
import requests

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

NHL_BASE_URL = "https://api-web.nhle.com/v1"

print("=" * 80)
print("FIXING PAST GAMES STILL MARKED AS SCHEDULED")
print("=" * 80)
print()

today = dt.date.today()

# Find games from the past that are still marked as scheduled
past_games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'lt', today.isoformat()),
        ('status', 'eq', 'scheduled')
    ],
    limit=100
)

print(f"Found {len(past_games)} past games still marked as 'scheduled'")
print()

if not past_games:
    print("No games to fix!")
    exit(0)

updated = 0
failed = 0

for game in past_games:
    game_id = game.get('game_id')
    game_date = game.get('game_date')
    
    print(f"Checking game {game_id} ({game_date})...")
    
    try:
        # Check NHL API for actual game state
        boxscore = requests.get(
            f"{NHL_BASE_URL}/gamecenter/{game_id}/boxscore",
            timeout=10
        ).json()
        
        game_state = boxscore.get('gameState', '').upper()
        home_score = boxscore.get('homeTeam', {}).get('score')
        away_score = boxscore.get('awayTeam', {}).get('score')
        
        if game_state == 'OFF':
            # Game is finished - update to final with scores
            update_data = {
                'status': 'final',
                'home_score': int(home_score) if home_score is not None else 0,
                'away_score': int(away_score) if away_score is not None else 0
            }
            
            db.update(
                'nhl_games',
                update_data,
                filters=[('game_id', 'eq', game_id)]
            )
            
            print(f"  [FIXED] Updated to final: {game.get('away_team')} {away_score}-{home_score} {game.get('home_team')}")
            updated += 1
        else:
            print(f"  [SKIP] Game state is {game_state}, not OFF")
            
    except Exception as e:
        print(f"  [ERROR] {e}")
        failed += 1

print()
print("=" * 80)
print(f"Fixed: {updated}")
print(f"Failed: {failed}")
print("=" * 80)

