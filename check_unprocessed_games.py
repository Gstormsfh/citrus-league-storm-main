#!/usr/bin/env python3
"""Check unprocessed games"""

from data_acquisition import supabase

r = supabase.table('raw_nhl_data').select('game_id, processed').eq('processed', False).limit(10).execute()
print('Sample unprocessed games:')
for g in (r.data[:10] if r.data else []):
    print(f'  Game {g["game_id"]}')

