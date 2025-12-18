#!/usr/bin/env python3
"""Monitor progress to verify the 268-game stall fix"""

from data_acquisition import supabase
import time

print("Monitoring Phase 2 progress to verify 268-game stall fix...")
print("=" * 60)

last_processed = 0
stall_count = 0
max_stall_count = 3

while True:
    try:
        # Get processed count
        response = supabase.table('raw_nhl_data').select('game_id', count='exact').eq('processed', True).execute()
        processed = response.count if hasattr(response, 'count') else len(response.data) if response.data else 0
        
        # Get total games
        response = supabase.table('raw_nhl_data').select('game_id', count='exact').execute()
        total = response.count if hasattr(response, 'count') else len(response.data) if response.data else 0
        
        # Get shots count
        response = supabase.table('raw_shots').select('id', count='exact').execute()
        shots = response.count if hasattr(response, 'count') else len(response.data) if response.data else 0
        
        unprocessed = total - processed
        
        print(f"[{time.strftime('%H:%M:%S')}] Processed: {processed:,}/{total:,} | Unprocessed: {unprocessed:,} | Shots: {shots:,}")
        
        # Check if we're past 268
        if processed > 268:
            print("\n" + "=" * 60)
            print("✅ SUCCESS: Processed more than 268 games!")
            print(f"   Current: {processed} games processed")
            print("   The fix is working - no stall detected!")
            print("=" * 60)
            break
        
        # Check for stall
        if processed == last_processed:
            stall_count += 1
            if stall_count >= max_stall_count:
                print(f"\n⚠️  WARNING: No progress for {max_stall_count} checks")
                print(f"   Stuck at {processed} games")
        else:
            stall_count = 0
        
        last_processed = processed
        
        # Check if complete
        if unprocessed == 0:
            print("\n" + "=" * 60)
            print("✅ COMPLETE: All games processed!")
            print(f"   Total: {processed} games, {shots:,} shots")
            print("=" * 60)
            break
        
        time.sleep(30)  # Check every 30 seconds
        
    except KeyboardInterrupt:
        print("\n\nMonitoring stopped by user")
        break
    except Exception as e:
        print(f"\nError: {e}")
        time.sleep(30)

