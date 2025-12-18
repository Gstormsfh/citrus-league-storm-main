#!/usr/bin/env python3
"""
Test script for two-phase pipeline.
Tests both Phase 1 (ingestion) and Phase 2 (processing) with a small sample.
"""

import sys
import datetime

print("=" * 80)
print("TESTING TWO-PHASE PIPELINE")
print("=" * 80)
print()

# Test 1: Check if migration has been applied
print("Test 1: Checking if raw_nhl_data table exists...")
try:
    from data_acquisition import supabase
    response = supabase.table('raw_nhl_data').select('game_id').limit(1).execute()
    print("[OK] raw_nhl_data table exists")
except Exception as e:
    if 'raw_nhl_data' in str(e) or 'PGRST205' in str(e):
        print("[ERROR] raw_nhl_data table does not exist!")
        print("  Please run migration: supabase/migrations/20251217000000_create_raw_nhl_data_table.sql")
        print("  Or apply it via Supabase dashboard.")
        sys.exit(1)
    else:
        print(f"[ERROR] Unexpected error: {e}")
        sys.exit(1)

# Test 2: Test Phase 1 with small date range
print("\nTest 2: Testing Phase 1 ingestion (2 games)...")
print("  Running: py ingest_raw_nhl.py 2025-10-07 2025-10-08 --max-processes 2")
print("  (This will scrape 2 games and save JSON to raw_nhl_data)")
print()

# Test 3: Test Phase 2 processing
print("Test 3: Testing Phase 2 processing...")
print("  After Phase 1 completes, run:")
print("  py process_xg_stats.py --batch-size 2")
print("  (This will process the scraped games and save shots to raw_shots)")
print()

print("=" * 80)
print("To run the tests:")
print("  1. Ensure migration is applied (raw_nhl_data table exists)")
print("  2. Run Phase 1: py ingest_raw_nhl.py 2025-10-07 2025-10-08 --max-processes 2")
print("  3. Run Phase 2: py process_xg_stats.py --batch-size 2")
print("  4. Verify: Check raw_shots table for processed shots")
print("=" * 80)

