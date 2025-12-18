#!/usr/bin/env python3
"""
apply_moneypuck_migration.py
Apply the MoneyPuck features migration to Supabase.
"""

import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Critical MoneyPuck columns we need
CRITICAL_COLUMNS = [
    ("east_west_location_of_last_event", "NUMERIC"),
    ("defending_team_skaters_on_ice", "INTEGER"),
    ("east_west_location_of_shot", "NUMERIC"),
    ("time_since_powerplay_started", "NUMERIC"),
    ("north_south_location_of_shot", "NUMERIC"),
    ("flurry_adjusted_xg", "NUMERIC"),
]

def apply_critical_columns():
    """Apply critical MoneyPuck columns."""
    print("=" * 80)
    print("APPLYING CRITICAL MONEYPUCK COLUMNS")
    print("=" * 80)
    
    print("\n📝 Adding critical columns to raw_shots table...")
    print("   (This will skip columns that already exist)\n")
    
    for col_name, col_type in CRITICAL_COLUMNS:
        try:
            # Try to add column using ALTER TABLE
            sql = f"ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS {col_name} {col_type};"
            
            # Use Supabase RPC if available, otherwise provide manual instructions
            try:
                # Note: This requires service role key for DDL operations
                result = supabase.rpc('exec_sql', {'sql': sql}).execute()
                print(f"   ✅ Added {col_name}")
            except Exception as e:
                # If RPC doesn't work, we need manual application
                print(f"   ⚠️  Could not add {col_name} automatically")
                print(f"      SQL: {sql}")
                
        except Exception as e:
            print(f"   ❌ Error adding {col_name}: {e}")
    
    print("\n" + "=" * 80)
    print("MIGRATION STATUS")
    print("=" * 80)
    print("\n⚠️  Automatic migration may not work without service role key.")
    print("\n💡 To apply manually:")
    print("   1. Go to Supabase Dashboard → SQL Editor")
    print("   2. Run this SQL:")
    print()
    for col_name, col_type in CRITICAL_COLUMNS:
        print(f"   ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS {col_name} {col_type};")
    print()
    print("   Or run the full migration:")
    print("   supabase/migrations/20250122000000_add_moneypuck_features.sql")
    
    return True

if __name__ == "__main__":
    apply_critical_columns()

