#!/usr/bin/env python3
"""Force cleanup of all shots"""

from data_acquisition import supabase

print("Force cleaning all shots from raw_shots table...")

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
    print(f"  Deleted {total_deleted:,} records...")

print(f"[OK] Deleted {total_deleted:,} total records")

# Verify
response = supabase.table('raw_shots').select('id', count='exact').execute()
remaining = response.count if hasattr(response, 'count') else len(response.data) if response.data else 0
print(f"Remaining shots: {remaining}")

