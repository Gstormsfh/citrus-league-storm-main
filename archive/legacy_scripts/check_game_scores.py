#!/usr/bin/env python3
"""Check game scores status"""

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
import datetime as dt

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 80)
print("GAME SCORES STATUS")
print("=" * 80)
print()

today = dt.date.today()
games = db.select('nhl_games', select='game_id,home_team,away_team,home_score,away_score,status', filters=[('game_date', 'eq', today.isoformat())], limit=10)

if games:
    print(f"Today's games ({len(games)}):")
    print()
    for g in games:
        game_id = g.get('game_id')
        home = g.get('home_team', '?')
        away = g.get('away_team', '?')
        home_score = g.get('home_score')
        away_score = g.get('away_score')
        status = g.get('status', 'unknown')
        
        has_score = home_score is not None and away_score is not None
        score_str = f"{away} {away_score or 0}-{home_score or 0} {home}" if has_score else f"{away} @ {home} (no score)"
        
        print(f"  Game {game_id}: {score_str} - Status: {status}")
        
        # Check if game is finished but missing score
        if status in ('final', 'OFF') and not has_score:
            print(f"    ⚠️  FINISHED BUT NO SCORE!")
    print()
    
    # Count games with/without scores
    with_scores = [g for g in games if g.get('home_score') is not None and g.get('away_score') is not None]
    without_scores = [g for g in games if g.get('home_score') is None or g.get('away_score') is None]
    
    print(f"Games with scores: {len(with_scores)}")
    print(f"Games without scores: {len(without_scores)}")
    
    if without_scores:
        print()
        print("Games missing scores:")
        for g in without_scores:
            print(f"  - Game {g.get('game_id')} ({g.get('status')})")
else:
    print("No games found for today")

