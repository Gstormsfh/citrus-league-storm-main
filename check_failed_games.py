#!/usr/bin/env python3
"""Check for games that might be causing processing to fail"""

from data_acquisition import supabase

# Get processed vs unprocessed
processed = supabase.table('raw_nhl_data').select('game_id').eq('processed', True).execute()
unprocessed = supabase.table('raw_nhl_data').select('game_id').eq('processed', False).limit(10).execute()

processed_ids = [g['game_id'] for g in processed.data] if processed.data else []
unprocessed_ids = [g['game_id'] for g in unprocessed.data] if unprocessed.data else []

print(f"Processed games: {len(processed_ids)}")
print(f"Unprocessed games: {len(unprocessed_ids)}")
print()
print("Sample unprocessed game IDs:")
for gid in unprocessed_ids[:10]:
    print(f"  {gid}")

# Check if any processed games have no shots
print()
print("Checking processed games for missing shots...")
shots = supabase.table('raw_shots').select('game_id').execute()
shots_ids = set([s['game_id'] for s in shots.data]) if shots.data else set()

processed_without_shots = [gid for gid in processed_ids if gid not in shots_ids]
if processed_without_shots:
    print(f"WARNING: {len(processed_without_shots)} processed games have NO shots!")
    print(f"Sample: {processed_without_shots[:5]}")

