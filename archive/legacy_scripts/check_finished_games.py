#!/usr/bin/env python3
"""Check for finished games that need score updates"""

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import datetime as dt
import requests
import sys

sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

NHL_BASE_URL = "https://api-web.nhle.com/v1"

print("=" * 80)
print("CHECKING FINISHED GAMES")
print("=" * 80)
print()

# Check today and yesterday
today = dt.date.today()
yesterday = today - dt.timedelta(days=1)

for check_date in [yesterday, today]:
    print(f"\n{check_date}:")
    print("-" * 80)
    
    games = db.select(
        'nhl_games',
        select='game_id,home_team,away_team,home_score,away_score,status',
        filters=[('game_date', 'eq', check_date.isoformat())],
        limit=20
    )
    
    if not games:
        print("  No games found")
        continue
    
    for g in games:
        game_id = g.get('game_id')
        home = g.get('home_team', '?')
        away = g.get('away_team', '?')
        home_score = g.get('home_score')
        away_score = g.get('away_score')
        status = g.get('status', 'unknown')
        
        has_score = home_score is not None and away_score is not None
        
        # Check actual game state from API
        try:
            pbp = requests.get(f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play", timeout=5).json()
            api_state = pbp.get('gameState', '').upper()
            api_home_score = pbp.get('homeTeam', {}).get('score')
            api_away_score = pbp.get('awayTeam', {}).get('score')
            
            needs_update = False
            if api_state == "OFF" and status != "final":
                needs_update = True
                print(f"  ⚠️  Game {game_id}: {away} @ {home}")
                print(f"      DB: {status} ({away_score or '?'}-{home_score or '?'})")
                print(f"      API: {api_state} ({api_away_score or '?'}-{api_home_score or '?'})")
                print(f"      → Needs update to 'final' with scores")
            elif api_state == "OFF" and not has_score:
                needs_update = True
                print(f"  ⚠️  Game {game_id}: {away} @ {home}")
                print(f"      DB: {status} (NO SCORES)")
                print(f"      API: {api_state} ({api_away_score or '?'}-{api_home_score or '?'})")
                print(f"      → Needs score update")
            elif not needs_update and api_state == "OFF":
                print(f"  ✓ Game {game_id}: {away} {away_score or 0}-{home_score or 0} {home} (final)")
        except Exception as e:
            print(f"  ✗ Game {game_id}: Error checking API - {e}")

print()
print("=" * 80)

