#!/usr/bin/env python3
"""Fix ALL past games that should be final"""

import sys
sys.stdout.reconfigure(encoding='utf-8')

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import datetime as dt
import requests
import time

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

NHL_BASE_URL = "https://api-web.nhle.com/v1"

print("=" * 80)
print("FIXING ALL PAST GAMES")
print("=" * 80)
print()

today = dt.date.today()

# Find ALL games from the past that are still scheduled or have 0-0 scores
past_games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'lt', today.isoformat())
    ],
    limit=1000
)

print(f"Found {len(past_games)} total past games")
print()

# Filter for games that need fixing
needs_fix = []
for game in past_games:
    status = game.get('status', 'scheduled')
    home_score = game.get('home_score', 0)
    away_score = game.get('away_score', 0)
    
    # Need to fix if:
    # 1. Still marked as scheduled
    # 2. Marked as final but has 0-0 scores
    if status == 'scheduled' or (status == 'final' and home_score == 0 and away_score == 0):
        needs_fix.append(game)

print(f"Found {len(needs_fix)} games that need fixing")
print()

if not needs_fix:
    print("No games to fix!")
    exit(0)

updated = 0
failed = 0
skipped = 0

for idx, game in enumerate(needs_fix, 1):
    game_id = game.get('game_id')
    game_date = game.get('game_date')
    
    if idx % 10 == 0:
        print(f"Progress: {idx}/{len(needs_fix)}...")
    
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
            
            updated += 1
        elif game_state in ('LIVE', 'CRIT', 'INTERMISSION'):
            # Game is live - update status and scores
            update_data = {
                'status': 'live',
                'home_score': int(home_score) if home_score is not None else 0,
                'away_score': int(away_score) if away_score is not None else 0
            }
            
            db.update(
                'nhl_games',
                update_data,
                filters=[('game_id', 'eq', game_id)]
            )
            
            updated += 1
        else:
            skipped += 1
            
        # Rate limiting
        time.sleep(0.2)
            
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            skipped += 1
        else:
            print(f"  [ERROR] Game {game_id}: {e}")
            failed += 1
    except Exception as e:
        print(f"  [ERROR] Game {game_id}: {e}")
        failed += 1

print()
print("=" * 80)
print(f"Fixed: {updated}")
print(f"Skipped: {skipped}")
print(f"Failed: {failed}")
print("=" * 80)

