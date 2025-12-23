#!/usr/bin/env python3
"""Check processing status"""

from data_acquisition import supabase

# Count unprocessed games
unprocessed = supabase.table('raw_nhl_data').select('game_id', count='exact').eq('processed', False).execute()
unprocessed_count = unprocessed.count if hasattr(unprocessed, 'count') else len(unprocessed.data) if unprocessed.data else 0

# Count processed games
processed = supabase.table('raw_nhl_data').select('game_id', count='exact').eq('processed', True).execute()
processed_count = processed.count if hasattr(processed, 'count') else len(processed.data) if processed.data else 0

# Count total games
total = supabase.table('raw_nhl_data').select('game_id', count='exact').execute()
total_count = total.count if hasattr(total, 'count') else len(total.data) if total.data else 0

# Count shots
shots = supabase.table('raw_shots').select('id', count='exact').execute()
shots_count = shots.count if hasattr(shots, 'count') else len(shots.data) if shots.data else 0

print("=" * 60)
print("PROCESSING STATUS")
print("=" * 60)
print(f"Total games in raw_nhl_data: {total_count:,}")
print(f"Processed games: {processed_count:,}")
print(f"Unprocessed games: {unprocessed_count:,}")
print(f"Total shots in raw_shots: {shots_count:,}")
print("=" * 60)

