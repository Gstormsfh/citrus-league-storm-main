#!/usr/bin/env python3
"""Check how many games have player_game_stats records with pagination."""
import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

def paginate_distinct_games(table, filters, limit=1000):
    """Get all distinct game_ids with pagination."""
    all_game_ids = set()
    offset = 0
    while True:
        batch = db.select(table, select='game_id', filters=filters, limit=limit, offset=offset)
        if not batch:
            break
        for r in batch:
            all_game_ids.add(r['game_id'])
        if len(batch) < limit:
            break
        offset += limit
    return all_game_ids

print('=' * 60)
print('GAME COVERAGE ANALYSIS (with pagination)')
print('=' * 60)

# Count final games in nhl_games
game_ids_final = paginate_distinct_games('nhl_games', [('season', 'eq', 2025), ('status', 'eq', 'final')])
print(f'Total final games in nhl_games: {len(game_ids_final)}')

# Count distinct game_ids in player_game_stats
game_ids_pgs = paginate_distinct_games('player_game_stats', [('season', 'eq', 2025)])
print(f'Games with player_game_stats records: {len(game_ids_pgs)}')

# Count games with nhl_hits populated
game_ids_hits = paginate_distinct_games('player_game_stats', [('season', 'eq', 2025), ('nhl_hits', 'gt', 0)])
print(f'Games with nhl_hits > 0: {len(game_ids_hits)}')

print()
print(f'Games missing from player_game_stats: {len(game_ids_final - game_ids_pgs)}')
print(f'Games in PGS but no nhl_hits: {len(game_ids_pgs - game_ids_hits)}')
print('=' * 60)

