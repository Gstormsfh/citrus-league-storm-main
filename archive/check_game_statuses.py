#!/usr/bin/env python3
from supabase_rest import SupabaseRest
import os
from dotenv import load_dotenv
from collections import Counter

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Check games for season 2025
games = db.select('nhl_games', select='game_id, status, season', filters=[('game_id', 'gte', 2025000000), ('game_id', 'lt', 2026000000)], limit=100)

print("Sample games:")
for g in games[:10]:
    print(f"  {g}")

print("\nStatus counts:")
statuses = Counter(g['status'] for g in games if g.get('status'))
print(statuses)

