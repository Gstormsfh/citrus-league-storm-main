#!/usr/bin/env python3
"""Quick script to check which tables exist."""

from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(
    os.getenv('VITE_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

tables_to_check = [
    'goalie_gsax',
    'player_gar_components',
    'player_toi_by_situation',
    'player_shifts'
]

print("=" * 80)
print("CHECKING TABLE EXISTENCE")
print("=" * 80)

for table in tables_to_check:
    try:
        result = supabase.table(table).select('*').limit(1).execute()
        print(f"✅ {table}: EXISTS")
    except Exception as e:
        error_msg = str(e)
        if 'PGRST205' in error_msg or 'not found' in error_msg.lower():
            print(f"❌ {table}: MISSING (migration needed)")
        else:
            print(f"⚠️  {table}: ERROR - {error_msg[:100]}")

print("\n" + "=" * 80)
print("MIGRATIONS NEEDED")
print("=" * 80)

missing = []
if 'goalie_gsax' in [t for t in tables_to_check]:
    try:
        supabase.table('goalie_gsax').select('*').limit(1).execute()
    except:
        missing.append('20250115000000_create_goalie_gsax_table.sql')

if 'player_gar_components' in [t for t in tables_to_check]:
    try:
        supabase.table('player_gar_components').select('*').limit(1).execute()
    except:
        missing.append('20250125000000_create_toi_and_gar_tables.sql')

if missing:
    print("\nApply these migrations:")
    for m in missing:
        print(f"  - {m}")
else:
    print("\n✅ All required tables exist!")

