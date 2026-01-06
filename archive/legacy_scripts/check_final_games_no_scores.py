#!/usr/bin/env python3
"""Check final games that might not have scores"""

import sys
sys.stdout.reconfigure(encoding='utf-8')

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import datetime as dt

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 80)
print("CHECKING FINAL GAMES WITHOUT SCORES")
print("=" * 80)
print()

# Check games from the past week that are final
today = dt.date.today()
week_ago = today - dt.timedelta(days=7)

games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'gte', week_ago.isoformat()),
        ('game_date', 'lte', today.isoformat()),
        ('status', 'eq', 'final')
    ],
    limit=100
)

print(f"Found {len(games)} final games in the past week")
print()

# Find final games with missing or 0-0 scores
final_no_score = [
    g for g in games 
    if (g.get('home_score') is None or g.get('away_score') is None) or
       (g.get('home_score') == 0 and g.get('away_score') == 0)
]

if final_no_score:
    print(f"Found {len(final_no_score)} final game(s) with missing or 0-0 scores:")
    print()
    
    for g in final_no_score[:10]:  # Show first 10
        game_id = g.get('game_id')
        date = g.get('game_date')
        home = g.get('home_team', '?')
        away = g.get('away_team', '?')
        home_score = g.get('home_score')
        away_score = g.get('away_score')
        
        if home_score is None or away_score is None:
            score_str = "MISSING SCORES"
        else:
            score_str = f"{away} {away_score}-{home_score} {home}"
        
        print(f"  Game {game_id} ({date}): {score_str}")
else:
    print("[OK] All final games have valid scores")

# Also check for games that should be final but aren't
print()
print("Checking games from past dates that aren't marked final...")
past_games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'lt', today.isoformat()),
        ('status', 'neq', 'final')
    ],
    limit=20
)

if past_games:
    print(f"Found {len(past_games)} past games not marked as final:")
    for g in past_games[:10]:
        game_id = g.get('game_id')
        date = g.get('game_date')
        home = g.get('home_team', '?')
        away = g.get('away_team', '?')
        status = g.get('status', '?')
        print(f"  Game {game_id} ({date}): {away} @ {home} [{status}]")

