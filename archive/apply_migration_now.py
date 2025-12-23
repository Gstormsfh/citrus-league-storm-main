#!/usr/bin/env python3
"""
apply_migration_now.py
Apply the critical MoneyPuck columns migration.
This will add the missing columns so we can save new data.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# Critical SQL statements to add MoneyPuck columns
CRITICAL_MIGRATION_SQL = """
-- MoneyPuck Core Variables
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS east_west_location_of_last_event NUMERIC;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS defending_team_skaters_on_ice INTEGER;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS east_west_location_of_shot NUMERIC;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS time_since_powerplay_started NUMERIC;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS north_south_location_of_shot NUMERIC;
ALTER TABLE raw_shots ADD COLUMN IF NOT EXISTS flurry_adjusted_xg NUMERIC;
"""

def print_migration_instructions():
    """Print instructions for applying migration."""
    print("=" * 80)
    print("APPLY DATABASE MIGRATION")
    print("=" * 80)
    print("\n📋 To apply the migration:")
    print("\nOption 1: Via Supabase Dashboard (Recommended)")
    print("   1. Go to: https://supabase.com/dashboard")
    print("   2. Select your project")
    print("   3. Navigate to: SQL Editor → New query")
    print("   4. Copy and paste the SQL below:")
    print("\n" + "-" * 80)
    print(CRITICAL_MIGRATION_SQL)
    print("-" * 80)
    print("\n   5. Click 'Run' or press Ctrl+Enter")
    print("\nOption 2: Via Supabase CLI")
    print("   supabase migration up")
    print("\n" + "=" * 80)
    print("MIGRATION SQL (Copy this):")
    print("=" * 80)
    print(CRITICAL_MIGRATION_SQL)
    
    return CRITICAL_MIGRATION_SQL

if __name__ == "__main__":
    sql = print_migration_instructions()
    
    print("\n💡 After applying migration:")
    print("   1. Reprocess games: python data_acquisition.py 2025-01-15")
    print("   2. Retrain model: python retrain_xg_with_moneypuck.py")
    print("   3. Test performance: python test_moneypuck_model.py")
    print("\n🚀 Ready to push forward!")

