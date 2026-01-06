#!/usr/bin/env python3
"""Full audit of game scores - find all issues"""

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
print("FULL GAME SCORES AUDIT")
print("=" * 80)
print()

today = dt.date.today()
week_ago = today - dt.timedelta(days=7)

# Get all games from past week
games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'gte', week_ago.isoformat()),
        ('game_date', 'lte', today.isoformat())
    ],
    limit=200
)

print(f"Checking {len(games)} games from {week_ago} to {today}")
print()

issues = []

for game in games:
    game_id = game.get('game_id')
    game_date = dt.datetime.strptime(game.get('game_date'), '%Y-%m-%d').date()
    home_score = game.get('home_score')
    away_score = game.get('away_score')
    status = game.get('status', 'scheduled')
    
    # Issue 1: Past games still marked as scheduled
    if game_date < today and status == 'scheduled':
        issues.append({
            'type': 'past_scheduled',
            'game_id': game_id,
            'date': game.get('game_date'),
            'home': game.get('home_team'),
            'away': game.get('away_team'),
            'status': status
        })
    
    # Issue 2: Final games with 0-0 scores (impossible!)
    if status == 'final' and home_score == 0 and away_score == 0:
        issues.append({
            'type': 'final_zero_zero',
            'game_id': game_id,
            'date': game.get('game_date'),
            'home': game.get('home_team'),
            'away': game.get('away_team'),
            'status': status
        })
    
    # Issue 3: Final games with missing scores
    if status == 'final' and (home_score is None or away_score is None):
        issues.append({
            'type': 'final_missing_score',
            'game_id': game_id,
            'date': game.get('game_date'),
            'home': game.get('home_team'),
            'away': game.get('away_team'),
            'status': status,
            'home_score': home_score,
            'away_score': away_score
        })

print(f"Found {len(issues)} issues:")
print()

past_scheduled = [i for i in issues if i['type'] == 'past_scheduled']
final_zero_zero = [i for i in issues if i['type'] == 'final_zero_zero']
final_missing = [i for i in issues if i['type'] == 'final_missing_score']

if past_scheduled:
    print(f"1. Past games still marked as 'scheduled': {len(past_scheduled)}")
    for issue in past_scheduled[:5]:
        print(f"   Game {issue['game_id']} ({issue['date']}): {issue['away']} @ {issue['home']}")
    print()

if final_zero_zero:
    print(f"2. Final games with 0-0 scores (IMPOSSIBLE!): {len(final_zero_zero)}")
    for issue in final_zero_zero[:5]:
        print(f"   Game {issue['game_id']} ({issue['date']}): {issue['away']} @ {issue['home']}")
    print()

if final_missing:
    print(f"3. Final games with missing scores: {len(final_missing)}")
    for issue in final_missing[:5]:
        print(f"   Game {issue['game_id']} ({issue['date']}): {issue['away']} @ {issue['home']} (scores: {issue['away_score']}-{issue['home_score']})")
    print()

if not issues:
    print("[OK] No issues found!")
else:
    print(f"\nTotal issues: {len(issues)}")
    print("\nThese need to be fixed in the database.")

