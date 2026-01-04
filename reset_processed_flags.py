#!/usr/bin/env python3
"""Reset processed flags for games in date range."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def _paginate_select(db, table, select, filters, max_records=50000):
    """Paginate through all records to bypass the 1000 record API limit."""
    all_records = []
    offset = 0
    batch_size = 1000
    
    while len(all_records) < max_records:
        try:
            batch = db.select(table, select=select, filters=filters, limit=batch_size, offset=offset)
            if not batch:
                break
            all_records.extend(batch)
            if len(batch) < batch_size:
                break
            offset += batch_size
            print(f"  Fetched {len(all_records)} records so far...")
        except Exception as e:
            print(f"  [WARN] Pagination error at offset {offset}: {e}")
            break
    
    return all_records

# Get all processed games in date range with pagination
print("Fetching all processed games in date range...")
all_games = _paginate_select(
    db,
    'raw_nhl_data',
    select='game_id',
    filters=[
        ('game_date', 'gte', '2025-10-07'),
        ('game_date', 'lte', '2026-01-03'),
        ('processed', 'eq', True)
    ]
)

print(f"Found {len(all_games)} processed games to reset")

# Reset processed flag for all games
total_reset = 0
batch_size = 50  # Update in smaller batches to avoid timeouts

for i in range(0, len(all_games), batch_size):
    batch = all_games[i:i+batch_size]
    for game in batch:
        try:
            db.update(
                'raw_nhl_data',
                {'processed': False},
                filters=[('game_id', 'eq', game['game_id'])]
            )
            total_reset += 1
        except Exception as e:
            print(f"  Error resetting game {game['game_id']}: {e}")
    
    if (i + batch_size) % 100 == 0 or i + batch_size >= len(all_games):
        print(f"Reset {total_reset}/{len(all_games)} games...")

print(f"\nTotal reset: {total_reset} games")

