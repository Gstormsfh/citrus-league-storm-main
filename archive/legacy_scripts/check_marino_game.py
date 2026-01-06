#!/usr/bin/env python3
"""Check John Marino's game on Jan 1"""

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import requests

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 80)
print("CHECKING JOHN MARINO'S GAME - JAN 1")
print("=" * 80)
print()

# First, find John Marino's team
print("Finding John Marino...")
players = db.select(
    'player_directory',
    select='player_id,full_name,team',
    filters=[('full_name', 'ilike', '%Marino%')],
    limit=10
)

if not players:
    print("John Marino not found in player_directory")
    exit(1)

marino = players[0]
marino_team = marino.get('team', '')
marino_id = marino.get('player_id')

print(f"Found: {marino.get('full_name')} - Team: {marino_team}")
print()

# Now find games on Jan 1 with that team
print(f"Finding games for {marino_team} on Jan 1, 2026...")
games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[('game_date', 'eq', '2026-01-01')],
    limit=50
)

# Filter for games with marino's team
marino_games = [
    g for g in games 
    if g.get('home_team') == marino_team or g.get('away_team') == marino_team
]

print(f"Found {len(marino_games)} game(s) for {marino_team} on Jan 1:")
print()

for g in marino_games:
    game_id = g.get('game_id')
    home = g.get('home_team', '?')
    away = g.get('away_team', '?')
    home_score = g.get('home_score')
    away_score = g.get('away_score')
    status = g.get('status', '?')
    
    print(f"Game {game_id}:")
    print(f"  {away} @ {home}")
    print(f"  Score: {away_score}-{home_score}")
    print(f"  Status: {status}")
    print()
    
    # Check actual NHL API
    if status == 'final' and home_score == 0 and away_score == 0:
        print(f"  ⚠️  WARNING: Final game with 0-0 score!")
        print(f"  Checking NHL API...")
        try:
            boxscore = requests.get(
                f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore",
                timeout=10
            ).json()
            
            api_home_score = boxscore.get('homeTeam', {}).get('score')
            api_away_score = boxscore.get('awayTeam', {}).get('score')
            api_state = boxscore.get('gameState', '')
            
            print(f"  NHL API says:")
            print(f"    Score: {api_away_score}-{api_home_score}")
            print(f"    State: {api_state}")
            
            if api_state == 'OFF' and (api_home_score != 0 or api_away_score != 0):
                print(f"  ❌ DATABASE IS WRONG! Should be {api_away_score}-{api_home_score}")
        except Exception as e:
            print(f"  Error checking NHL API: {e}")
    print()

