#!/usr/bin/env python3
"""Check progress of Phase 5 (NHL stats scraping)."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Count goalie records
goalies = db.select('player_game_stats', select='game_id', filters=[('is_goalie', 'eq', True), ('game_date', 'gte', '2025-10-07'), ('game_date', 'lte', '2026-01-03')], limit=10000)
goalie_count = len(goalies) if goalies else 0

# Count games with NHL stats
games_with_stats = db.select('player_game_stats', select='game_id', filters=[('game_date', 'gte', '2025-10-07'), ('game_date', 'lte', '2026-01-03')], limit=10000)
if games_with_stats:
    unique_games = len(set([g['game_id'] for g in games_with_stats if g.get('game_id')]))
else:
    unique_games = 0

print(f"Phase 5 Progress:")
print(f"  Goalie records: {goalie_count}")
print(f"  Games with player stats: {unique_games}")
print(f"  Target: ~656 games")

