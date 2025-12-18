#!/usr/bin/env python3
"""
Cleanup and reset script for two-phase pipeline.
Deletes all data from raw_nhl_data and raw_shots tables for a fresh start.
"""

import sys
from data_acquisition import supabase
from dotenv import load_dotenv
import os

# Set UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

print("=" * 80)
print("CLEANUP AND RESET")
print("=" * 80)
print()
print("This will delete ALL data from:")
print("  - raw_nhl_data table (raw JSON)")
print("  - raw_shots table (processed shots)")
print()
response = input("Are you sure you want to continue? (yes/no): ")

if response.lower() != 'yes':
    print("Cancelled.")
    sys.exit(0)

print()
print("Cleaning up raw_nhl_data table...")

# Delete all from raw_nhl_data
try:
    # Get all IDs
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
        print(f"  Deleted {total_deleted:,} records from raw_nhl_data...")
    
    print(f"[OK] Deleted {total_deleted:,} records from raw_nhl_data")
except Exception as e:
    print(f"[ERROR] Error cleaning raw_nhl_data: {e}")

print()
print("Cleaning up raw_shots table...")

# Delete all from raw_shots
try:
    # Get all IDs
    offset = 0
    batch_size = 1000
    total_deleted = 0
    
    while True:
        response = supabase.table('raw_shots').select('id').range(offset, offset + batch_size - 1).execute()
        if not response.data or len(response.data) == 0:
            break
        
        ids = [r['id'] for r in response.data]
        for id_val in ids:
            try:
                supabase.table('raw_shots').delete().eq('id', id_val).execute()
                total_deleted += 1
            except:
                pass
        
        if len(response.data) < batch_size:
            break
        offset += batch_size
        print(f"  Deleted {total_deleted:,} records from raw_shots...")
    
    print(f"[OK] Deleted {total_deleted:,} records from raw_shots")
except Exception as e:
    print(f"[ERROR] Error cleaning raw_shots: {e}")

print()
print("=" * 80)
print("CLEANUP COMPLETE")
print("=" * 80)
print()
print("Next steps:")
print("  1. Run Phase 1: py ingest_raw_nhl.py 2025-10-07 2025-10-08 --max-processes 4")
print("  2. Run Phase 2: py process_xg_stats.py --batch-size 10")
print("  3. Verify: py check_processing_status.py")

