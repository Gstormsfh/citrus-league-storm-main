#!/usr/bin/env python3
"""
Cleanup all data from raw_nhl_data and raw_shots tables.
"""

import sys
from data_acquisition import supabase
from pull_season_data import cleanup_raw_shots_table

# Set UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

print("=" * 80)
print("CLEANUP ALL DATA")
print("=" * 80)
print()
print("This will delete ALL data from:")
print("  - raw_nhl_data table (raw JSON)")
print("  - raw_shots table (processed shots)")
print()

# Cleanup raw_shots using existing function
print("Cleaning raw_shots table...")
cleanup_raw_shots_table(confirm=False)

print()
print("Cleaning raw_nhl_data table...")

# Delete all from raw_nhl_data
try:
    # Get count first
    response = supabase.table('raw_nhl_data').select('id', count='exact').execute()
    count = response.count if hasattr(response, 'count') else len(response.data) if response.data else 0
    print(f"  Found {count:,} records in raw_nhl_data table")
    
    if count == 0:
        print("  [OK] raw_nhl_data table is already empty")
    else:
        # Delete in batches
        offset = 0
        batch_size = 1000
        total_deleted = 0
        
        while True:
            response = supabase.table('raw_nhl_data').select('id').range(offset, offset + batch_size - 1).execute()
            if not response.data or len(response.data) == 0:
                break
            
            ids = [r['id'] for r in response.data]
            for id_val in ids:
                try:
                    supabase.table('raw_nhl_data').delete().eq('id', id_val).execute()
                    total_deleted += 1
                except:
                    pass
            
            if len(response.data) < batch_size:
                break
            offset += batch_size
            print(f"    Deleted {total_deleted:,}/{count:,} records...")
        
        print(f"  [OK] Deleted {total_deleted:,} records from raw_nhl_data")
except Exception as e:
    print(f"  [ERROR] Error cleaning raw_nhl_data: {e}")
    import traceback
    traceback.print_exc()

print()
print("=" * 80)
print("CLEANUP COMPLETE")
print("=" * 80)
print()
print("Ready for fresh pipeline test!")

