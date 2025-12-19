#!/usr/bin/env python3
"""Quick check for McDavid's TOI and plus/minus data - verify migration and data population."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# McDavid's player_id
MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025

print("=" * 80)
print("CHECKING MCDAVID TOI AND PLUS/MINUS DATA")
print("=" * 80)
print()

# Check if columns exist by trying to select them
print("1. Checking if nhl_toi_seconds and nhl_plus_minus columns exist...")
try:
    result = db.select(
        "player_season_stats",
        select="player_id, games_played, icetime_seconds, nhl_toi_seconds, plus_minus, nhl_plus_minus",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=1
    )
    
    if result:
        row = result[0]
        print(f"   [OK] Columns exist!")
        print()
        
        # TOI check
        print("   TOI:")
        print(f"   Our calculated TOI: {row.get('icetime_seconds', 0)} seconds ({row.get('icetime_seconds', 0) / 60:.1f} minutes)")
        nhl_toi = row.get('nhl_toi_seconds')
        if nhl_toi is not None:
            print(f"   NHL.com TOI: {nhl_toi} seconds ({nhl_toi / 60:.1f} minutes)")
            if nhl_toi > 0:
                games = row.get('games_played', 0) or 35  # Default to 35 if not available
                toi_per_game = nhl_toi / games / 60 if games > 0 else 0
                print(f"   [OK] NHL.com TOI data is populated! ({toi_per_game:.2f} min/game, expected: 22:41 = 22.68 min)")
            else:
                print(f"   [WARNING] NHL.com TOI is 0 - need to run fetch_nhl_stats_from_landing.py")
        else:
            print(f"   [WARNING] nhl_toi_seconds is NULL - column may not exist or migration not run")
        
        print()
        # Plus/minus check
        print("   Plus/Minus:")
        print(f"   Our calculated +/-: {row.get('plus_minus', 0)}")
        nhl_pm = row.get('nhl_plus_minus')
        if nhl_pm is not None:
            print(f"   NHL.com +/-: {nhl_pm}")
            if nhl_pm != 0 or nhl_toi is not None:  # 0 might be valid, so check if TOI exists
                print(f"   [OK] NHL.com plus/minus data is populated!")
            else:
                print(f"   [WARNING] NHL.com plus/minus is 0 - need to run fetch_nhl_stats_from_landing.py")
        else:
            print(f"   [WARNING] nhl_plus_minus is NULL - column may not exist or migration not run")
    else:
        print(f"   [ERROR] No stats found for McDavid (player_id={MCDAVID_ID})")
        
except Exception as e:
    error_msg = str(e)
    if "column" in error_msg.lower() and "does not exist" in error_msg.lower():
        if "nhl_toi_seconds" in error_msg:
            print(f"   [ERROR] Column 'nhl_toi_seconds' does not exist!")
            print(f"   [INFO] Run migration: supabase/migrations/20251219010000_add_nhl_toi_field.sql")
        elif "nhl_plus_minus" in error_msg:
            print(f"   [ERROR] Column 'nhl_plus_minus' does not exist!")
            print(f"   [INFO] Run migration: supabase/migrations/20251219020000_add_nhl_plus_minus_field.sql")
        else:
            print(f"   [ERROR] Column does not exist!")
    else:
        print(f"   [ERROR] Error: {e}")

print()
print("=" * 80)
print("NEXT STEPS")
print("=" * 80)
print("1. If columns don't exist: Run the migrations")
print("   - supabase/migrations/20251219010000_add_nhl_toi_field.sql")
print("   - supabase/migrations/20251219020000_add_nhl_plus_minus_field.sql")
print("2. If columns exist but data is 0: Run fetch_nhl_stats_from_landing.py")
print("3. Refresh your frontend to see updated TOI and plus/minus")
print()
