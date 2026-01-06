#!/usr/bin/env python3
"""
Apply RPC fixes to ensure all stats use NHL.com exclusively.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("=" * 80)
print("Applying RPC Fixes")
print("=" * 80)
print()

# Read SQL files
with open("fix_get_matchup_stats_rpc.sql", "r", encoding="utf-8") as f:
    matchup_sql = f.read()

with open("fix_get_daily_game_stats_rpc.sql", "r", encoding="utf-8") as f:
    daily_sql = f.read()

# Execute SQL
print("1. Fixing get_matchup_stats RPC...")
try:
    # Split by semicolons and execute each statement
    statements = [s.strip() for s in matchup_sql.split(";") if s.strip() and not s.strip().startswith("--")]
    for stmt in statements:
        if stmt:
            db.rpc("exec_sql", {"sql": stmt})
    print("   ✓ get_matchup_stats RPC updated")
except Exception as e:
    print(f"   ✗ Error: {e}")
    # Try direct execution
    try:
        db.execute_raw(matchup_sql)
        print("   ✓ get_matchup_stats RPC updated (via execute_raw)")
    except Exception as e2:
        print(f"   ✗ Failed: {e2}")

print()
print("2. Fixing get_daily_game_stats RPC...")
try:
    statements = [s.strip() for s in daily_sql.split(";") if s.strip() and not s.strip().startswith("--")]
    for stmt in statements:
        if stmt:
            db.rpc("exec_sql", {"sql": stmt})
    print("   ✓ get_daily_game_stats RPC updated")
except Exception as e:
    print(f"   ✗ Error: {e}")
    try:
        db.execute_raw(daily_sql)
        print("   ✓ get_daily_game_stats RPC updated (via execute_raw)")
    except Exception as e2:
        print(f"   ✗ Failed: {e2}")

print()
print("=" * 80)
print("RPC Fixes Applied")
print("=" * 80)
print()
print("Note: If errors occurred, you may need to apply these migrations manually")
print("via Supabase dashboard or psql.")

