#!/usr/bin/env python3
"""Quick check of score status"""

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

games = db.select('nhl_games', select='game_id,home_score,away_score,status', limit=10000)

total = len(games)
with_scores = sum(1 for g in games if g.get('home_score') is not None and g.get('away_score') is not None)
without_scores = total - with_scores

print(f"Total games: {total}")
print(f"Games with scores: {with_scores} ({with_scores*100//total if total > 0 else 0}%)")
print(f"Games without scores: {without_scores} ({without_scores*100//total if total > 0 else 0}%)")

