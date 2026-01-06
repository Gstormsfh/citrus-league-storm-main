#!/usr/bin/env python3
"""Verify scores are in database and check a sample of games"""

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import datetime as dt

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 80)
print("VERIFYING GAME SCORES IN DATABASE")
print("=" * 80)
print()

# Check recent games (last 7 days)
today = dt.date.today()
week_ago = today - dt.timedelta(days=7)

games = db.select(
    'nhl_games',
    select='game_id,game_date,home_team,away_team,home_score,away_score,status',
    filters=[
        ('game_date', 'gte', week_ago.isoformat()),
        ('game_date', 'lte', today.isoformat())
    ],
    limit=100
)

if not games:
    print("No games found in last 7 days")
    exit(1)

print(f"Found {len(games)} games in last 7 days")
print()

# Group by status
by_status = {}
for g in games:
    status = g.get('status', 'unknown')
    if status not in by_status:
        by_status[status] = []
    by_status[status].append(g)

print("Games by status:")
for status, status_games in sorted(by_status.items()):
    with_scores = sum(1 for g in status_games if g.get('home_score') is not None and g.get('away_score') is not None)
    print(f"  {status}: {with_scores}/{len(status_games)} have scores")

print()
print("Sample games:")
print()

# Show sample of each status
for status in ['final', 'live', 'scheduled']:
    if status in by_status:
        sample = by_status[status][:3]
        print(f"{status.upper()} games:")
        for g in sample:
            game_id = g.get('game_id')
            date = g.get('game_date')
            home = g.get('home_team', '?')
            away = g.get('away_team', '?')
            home_score = g.get('home_score')
            away_score = g.get('away_score')
            status_val = g.get('status', '?')
            
            if home_score is not None and away_score is not None:
                score_str = f"{away} {away_score}-{home_score} {home}"
            else:
                score_str = "NO SCORE"
            
            print(f"  Game {game_id} ({date}): {score_str} [{status_val}]")
        print()

