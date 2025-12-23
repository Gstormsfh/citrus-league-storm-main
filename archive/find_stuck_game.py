#!/usr/bin/env python3
"""Find which game might be causing the stall"""

from data_acquisition import supabase

# Get processed games
processed = supabase.table('raw_nhl_data').select('game_id').eq('processed', True).order('game_id').execute()
processed_ids = [g['game_id'] for g in processed.data] if processed.data else []

# Get unprocessed games
unprocessed = supabase.table('raw_nhl_data').select('game_id').eq('processed', False).order('game_id').limit(20).execute()
unprocessed_ids = [g['game_id'] for g in unprocessed.data] if unprocessed.data else []

print(f"Processed games: {len(processed_ids)}")
print(f"Last processed game: {processed_ids[-1] if processed_ids else 'None'}")
print()
print("Next 20 unprocessed games:")
for gid in unprocessed_ids:
    print(f"  {gid}")

# Check if there's a pattern
if len(processed_ids) >= 268:
    print()
    print(f"Games around the 268 mark:")
    print(f"  Game 265: {processed_ids[264] if len(processed_ids) > 264 else 'N/A'}")
    print(f"  Game 266: {processed_ids[265] if len(processed_ids) > 265 else 'N/A'}")
    print(f"  Game 267: {processed_ids[266] if len(processed_ids) > 266 else 'N/A'}")
    print(f"  Game 268: {processed_ids[267] if len(processed_ids) > 267 else 'N/A'}")
    print(f"  Next unprocessed: {unprocessed_ids[0] if unprocessed_ids else 'N/A'}")

