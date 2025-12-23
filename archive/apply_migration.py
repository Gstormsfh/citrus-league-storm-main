#!/usr/bin/env python3
"""
apply_migration.py
Apply the enhanced features migration to Supabase raw_shots table.
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

def apply_migration():
    """Apply the migration SQL to add enhanced features."""
    print("=" * 80)
    print("APPLYING ENHANCED FEATURES MIGRATION")
    print("=" * 80)
    
    # Read migration file
    migration_path = 'supabase/migrations/20250121000000_add_enhanced_features_to_raw_shots.sql'
    
    try:
        with open(migration_path, 'r') as f:
            migration_sql = f.read()
        print(f"✅ Read migration file: {migration_path}")
    except FileNotFoundError:
        print(f"❌ Error: Migration file not found: {migration_path}")
        return False
    
    # Split into individual statements (by semicolon, but keep multi-line statements together)
    statements = []
    current_statement = []
    
    for line in migration_sql.split('\n'):
        line = line.strip()
        if not line or line.startswith('--'):
            continue
        
        current_statement.append(line)
        
        if line.endswith(';'):
            statement = ' '.join(current_statement)
            if statement.strip():
                statements.append(statement)
            current_statement = []
    
    # Execute each statement
    print(f"\n📝 Executing {len(statements)} SQL statements...")
    
    for i, statement in enumerate(statements, 1):
        try:
            # Use Supabase's RPC to execute SQL (if available)
            # Otherwise, we'll need to use direct query
            print(f"  [{i}/{len(statements)}] Executing statement...")
            
            # Try using Supabase's query method
            # Note: This might require service role key for DDL operations
            result = supabase.rpc('exec_sql', {'sql': statement}).execute()
            
            if hasattr(result, 'data'):
                print(f"     ✅ Success")
            else:
                print(f"     ⚠️  No data returned (may still be successful)")
                
        except Exception as e:
            # If RPC doesn't work, provide manual instructions
            print(f"     ⚠️  Could not execute automatically: {e}")
            print("\n" + "=" * 80)
            print("MANUAL MIGRATION REQUIRED")
            print("=" * 80)
            print("\nThe migration needs to be applied manually via Supabase Dashboard:")
            print("\n1. Go to: https://supabase.com/dashboard")
            print("2. Select your project")
            print("3. Navigate to SQL Editor → New query")
            print(f"4. Copy and paste the contents of: {migration_path}")
            print("5. Click 'Run' or press Ctrl+Enter")
            print("\nThe migration file contains:")
            print(f"   - {len(statements)} SQL statements")
            print("   - Adds ~60 new columns to raw_shots table")
            print("   - Creates indexes for performance")
            return False
    
    print("\n✅ Migration applied successfully!")
    print("\n📊 Summary:")
    print("   - Enhanced features columns added")
    print("   - Raw data fields added")
    print("   - Calculated features columns added")
    print("   - Indexes created")
    return True

if __name__ == "__main__":
    success = apply_migration()
    if not success:
        print("\n⚠️  Please apply the migration manually using the instructions above.")
        exit(1)

