#!/usr/bin/env python3
"""Check progress of data scraping"""

from data_acquisition import supabase
import pandas as pd

# Get actual count
response = supabase.table('raw_shots').select('id', count='exact').execute()
print(f"Total shots in database: {response.count:,}")

# Get first and last game IDs
first = supabase.table('raw_shots').select('game_id').order('created_at', desc=False).limit(1).execute()
last = supabase.table('raw_shots').select('game_id').order('created_at', desc=True).limit(1).execute()

print(f"First game ID: {first.data[0]['game_id'] if first.data else 'None'}")
print(f"Last game ID: {last.data[0]['game_id'] if last.data else 'None'}")

# Get unique games (fetch all with pagination)
print("Counting unique games (this may take a moment)...")
all_game_ids = []
offset = 0
batch_size = 1000
while True:
    response = supabase.table('raw_shots').select('game_id').range(offset, offset + batch_size - 1).execute()
    if not response.data or len(response.data) == 0:
        break
    all_game_ids.extend([g['game_id'] for g in response.data])
    if len(response.data) < batch_size:
        break
    offset += batch_size
unique_games = set(all_game_ids)
print(f"Unique games processed: {len(unique_games):,}")

# Get date range
dates = supabase.table('raw_shots').select('created_at').order('created_at', desc=False).limit(1).execute()
if dates.data:
    first_date = dates.data[0]['created_at'][:10]  # Extract date part
    print(f"First shot date: {first_date}")

dates = supabase.table('raw_shots').select('created_at').order('created_at', desc=True).limit(1).execute()
if dates.data:
    last_date = dates.data[0]['created_at'][:10]
    print(f"Last shot date: {last_date}")

