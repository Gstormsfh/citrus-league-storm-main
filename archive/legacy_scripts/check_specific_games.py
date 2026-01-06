#!/usr/bin/env python3
"""Check specific games user mentioned"""

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
print("CHECKING SPECIFIC GAMES")
print("=" * 80)
print()

# Check Jan 1 Islanders games
print("January 1, 2026 - Islanders games:")
print()
nyi_jan1 = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'eq', '2026-01-01'),
        ('home_team', 'eq', 'NYI')
    ],
    limit=10
)

nyi_jan1_away = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'eq', '2026-01-01'),
        ('away_team', 'eq', 'NYI')
    ],
    limit=10
)

all_nyi_jan1 = (nyi_jan1 or []) + (nyi_jan1_away or [])

for g in all_nyi_jan1:
    game_id = g.get('game_id')
    home = g.get('home_team', '?')
    away = g.get('away_team', '?')
    home_score = g.get('home_score')
    away_score = g.get('away_score')
    status = g.get('status', '?')
    
    print(f"Game {game_id}: {away} @ {home}")
    print(f"  Status: {status}")
    print(f"  Score: {away_score}-{home_score}")
    print(f"  home_score type: {type(home_score)}, value: {repr(home_score)}")
    print(f"  away_score type: {type(away_score)}, value: {repr(away_score)}")
    
    # Check if scores are None vs 0
    if home_score is None or away_score is None:
        print(f"  [ISSUE] Scores are NULL!")
    elif home_score == 0 and away_score == 0:
        print(f"  [ISSUE] Scores are 0-0 (will be hidden by frontend)")
        # Check NHL API
        try:
            boxscore = requests.get(f"{NHL_BASE_URL}/gamecenter/{game_id}/boxscore", timeout=10).json()
            api_home = boxscore.get('homeTeam', {}).get('score')
            api_away = boxscore.get('awayTeam', {}).get('score')
            api_state = boxscore.get('gameState', '')
            print(f"  NHL API: {api_away}-{api_home} ({api_state})")
            if api_state == 'OFF' and (api_home != 0 or api_away != 0):
                print(f"  [FIX NEEDED] Database has 0-0 but API has {api_away}-{api_home}")
        except Exception as e:
            print(f"  Error checking API: {e}")
    print()

# Check Jan 29 Predators games (future date)
print()
print("January 29, 2026 - Predators games (future):")
print()
nsh_jan29 = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'eq', '2026-01-29'),
        ('home_team', 'eq', 'NSH')
    ],
    limit=10
)

nsh_jan29_away = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'eq', '2026-01-29'),
        ('away_team', 'eq', 'NSH')
    ],
    limit=10
)

all_nsh_jan29 = (nsh_jan29 or []) + (nsh_jan29_away or [])

for g in all_nsh_jan29:
    game_id = g.get('game_id')
    home = g.get('home_team', '?')
    away = g.get('away_team', '?')
    home_score = g.get('home_score')
    away_score = g.get('away_score')
    status = g.get('status', '?')
    
    print(f"Game {game_id}: {away} @ {home}")
    print(f"  Status: {status}")
    print(f"  Score: {away_score}-{home_score}")
    print()

# Check all final games with missing/null scores
print()
print("Checking all final games with NULL or missing scores...")
print()

final_games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('status', 'eq', 'final'),
        ('game_date', 'gte', '2026-01-01'),
        ('game_date', 'lte', '2026-01-04')
    ],
    limit=50
)

final_no_score = [
    g for g in final_games
    if g.get('home_score') is None or g.get('away_score') is None or
       (g.get('home_score') == 0 and g.get('away_score') == 0)
]

if final_no_score:
    print(f"Found {len(final_no_score)} final games with missing/0-0 scores:")
    for g in final_no_score[:10]:
        print(f"  Game {g.get('game_id')} ({g.get('game_date')}): {g.get('away_team')} @ {g.get('home_team')} - scores: {g.get('away_score')}-{g.get('home_score')}")
else:
    print("[OK] All final games have valid scores")

