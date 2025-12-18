#!/usr/bin/env python3
"""
Verify the two-phase pipeline is working correctly.
Checks all components before running.
"""

import sys
from data_acquisition import supabase

# Set UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

print("=" * 80)
print("PIPELINE VERIFICATION")
print("=" * 80)
print()

# Check 1: raw_nhl_data table exists
print("1. Checking raw_nhl_data table...")
try:
    response = supabase.table('raw_nhl_data').select('game_id').limit(1).execute()
    print("   [OK] raw_nhl_data table exists")
except Exception as e:
    if 'raw_nhl_data' in str(e) or 'PGRST205' in str(e):
        print("   [ERROR] raw_nhl_data table does not exist!")
        print("   Run migration: supabase/migrations/20251217000000_create_raw_nhl_data_table.sql")
        sys.exit(1)
    else:
        print(f"   [ERROR] {e}")
        sys.exit(1)

# Check 2: raw_shots table exists
print("2. Checking raw_shots table...")
try:
    response = supabase.table('raw_shots').select('id').limit(1).execute()
    print("   [OK] raw_shots table exists")
except Exception as e:
    print(f"   [ERROR] raw_shots table issue: {e}")
    sys.exit(1)

# Check 3: Models loaded
print("3. Checking ML models...")
try:
    from data_acquisition import XG_MODEL, MODEL_FEATURES, USE_MONEYPUCK_MODEL
    print(f"   [OK] xG model loaded (MoneyPuck: {USE_MONEYPUCK_MODEL})")
    print(f"   [OK] Model features: {len(MODEL_FEATURES)} features")
except Exception as e:
    print(f"   [ERROR] Model loading issue: {e}")
    sys.exit(1)

# Check 4: Processing functions available
print("4. Checking processing functions...")
try:
    from data_acquisition import _extract_shots_from_game, _save_shots_to_database
    print("   [OK] _extract_shots_from_game available")
    print("   [OK] _save_shots_to_database available")
except Exception as e:
    print(f"   [ERROR] Processing functions issue: {e}")
    sys.exit(1)

# Check 5: Scripts importable
print("5. Checking scripts...")
try:
    import ingest_raw_nhl
    import process_xg_stats
    print("   [OK] ingest_raw_nhl.py imports successfully")
    print("   [OK] process_xg_stats.py imports successfully")
except Exception as e:
    print(f"   [ERROR] Script import issue: {e}")
    sys.exit(1)

print()
print("=" * 80)
print("ALL CHECKS PASSED - PIPELINE READY")
print("=" * 80)

