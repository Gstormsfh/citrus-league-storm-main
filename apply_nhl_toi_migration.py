#!/usr/bin/env python3
"""
Apply the nhl_toi_seconds migration to player_season_stats.
This adds the column for storing NHL.com official TOI data.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

# Read migration SQL
migration_path = "supabase/migrations/20251219010000_add_nhl_toi_field.sql"
try:
    with open(migration_path, "r", encoding="utf-8") as f:
        migration_sql = f.read()
except FileNotFoundError:
    print(f"[ERROR] Migration file not found: {migration_path}")
    sys.exit(1)

print("=" * 80)
print("[apply_nhl_toi_migration] APPLYING MIGRATION")
print("=" * 80)
print()
print("Migration file:", migration_path)
print()
print("SQL to execute:")
print("-" * 80)
print(migration_sql)
print("-" * 80)
print()

# Note: Supabase REST API doesn't support DDL operations directly
# We need to use the Supabase Dashboard SQL Editor
print("[INFO] Supabase REST API doesn't support DDL operations (ALTER TABLE).")
print("[INFO] Please apply this migration manually via Supabase Dashboard:")
print()
print("1. Go to: https://supabase.com/dashboard")
print("2. Select your project")
print("3. Navigate to: SQL Editor → New query")
print(f"4. Copy and paste the contents of: {migration_path}")
print("5. Click 'Run' or press Ctrl+Enter")
print()
print("After running the migration, you can:")
print("  - Run: python fetch_nhl_toi_totals.py (to populate the data)")
print("  - Run: python check_mcdavid_toi.py (to verify)")
print()
