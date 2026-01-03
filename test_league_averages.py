#!/usr/bin/env python3
"""Quick test to verify get_league_averages works without errors."""

from dotenv import load_dotenv
import os
from supabase_rest import SupabaseRest
from calculate_daily_projections import get_league_averages

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("Testing get_league_averages for all positions...")
for position in ["C", "LW", "RW", "D"]:
    try:
        result = get_league_averages(db, position, 2025)
        if result:
            print(f"✓ {position}: OK (replacement={result.get('replacement_fpts_per_60')})")
        else:
            print(f"✗ {position}: No data returned")
    except Exception as e:
        print(f"✗ {position}: ERROR - {e}")

print("\nTest complete!")



