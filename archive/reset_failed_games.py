#!/usr/bin/env python3
"""
Reset games that were marked as processed but have no shots.
These games need to be re-processed.
"""

from data_acquisition import supabase

print("Finding games marked as processed but with no shots...")

# Get all processed games
processed = supabase.table('raw_nhl_data').select('game_id').eq('processed', True).execute()
processed_ids = set([g['game_id'] for g in processed.data]) if processed.data else set()

# Get all games with shots
shots = supabase.table('raw_shots').select('game_id').execute()
shots_ids = set([s['game_id'] for s in shots.data]) if shots.data else set()

# Find games that are marked processed but have no shots
missing = processed_ids - shots_ids

print(f"Found {len(missing)} games that need to be reset")
print()

if len(missing) > 0:
    print("Resetting these games to unprocessed...")
    
    # Reset in batches
    missing_list = list(missing)
    batch_size = 100
    
    for i in range(0, len(missing_list), batch_size):
        batch = missing_list[i:i + batch_size]
        try:
            supabase.table('raw_nhl_data')\
                .update({'processed': False})\
                .in_('game_id', batch)\
                .execute()
            print(f"  Reset {min(i + batch_size, len(missing_list))}/{len(missing_list)} games...")
        except Exception as e:
            print(f"  Error resetting batch: {e}")
    
    print()
    print(f"[OK] Reset {len(missing)} games to unprocessed")
    print()
    print("You can now re-run Phase 2:")
    print("  py process_xg_stats.py --batch-size 20")
else:
    print("[OK] All processed games have shots - no reset needed")

