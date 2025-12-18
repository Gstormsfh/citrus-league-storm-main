#!/usr/bin/env python3
"""Monitor Phase 1 ingestion progress"""

from data_acquisition import supabase
import time

print("Monitoring Phase 1 ingestion progress...")
print("Press Ctrl+C to stop\n")

last_count = 0
start_time = time.time()

try:
    while True:
        response = supabase.table('raw_nhl_data').select('game_id', count='exact').execute()
        current_count = response.count if hasattr(response, 'count') else len(response.data) if response.data else 0
        
        if current_count > last_count:
            elapsed = time.time() - start_time
            rate = (current_count - last_count) / elapsed if elapsed > 0 else 0
            print(f"[{time.strftime('%H:%M:%S')}] Games scraped: {current_count:,} (+{current_count - last_count} since last check, {rate:.1f} games/sec)")
            last_count = current_count
            start_time = time.time()
        
        time.sleep(5)  # Check every 5 seconds
        
except KeyboardInterrupt:
    print(f"\nFinal count: {current_count:,} games scraped")

