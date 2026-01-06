#!/usr/bin/env python3
"""
Final summary of NHL.com alignment status.
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
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("=" * 80)
print("FINAL NHL.COM ALIGNMENT SUMMARY")
print("=" * 80)
print()

# Check key players we know are correct
key_players = [
    (8478402, "Connor McDavid", 31, 2),
    (8482078, "Lucas Raymond", 18, 0),
    (8471675, "Sidney Crosby", 16, 0),
    (8476453, "Mika Zibanejad", 18, 0),
]

print("Key Players Verification:")
print()
all_correct = True

for player_id, name, expected_ppp, expected_shp in key_players:
    result = db.select(
        "player_season_stats",
        select="nhl_ppp,nhl_shp,nhl_goals,nhl_assists,nhl_points",
        filters=[
            ("player_id", "eq", player_id),
            ("season", "eq", DEFAULT_SEASON)
        ],
        limit=1
    )
    
    if result and len(result) > 0:
        r = result[0]
        ppp = r.get("nhl_ppp", 0)
        shp = r.get("nhl_shp", 0)
        
        ppp_ok = ppp == expected_ppp
        shp_ok = shp == expected_shp
        
        status = "✓" if (ppp_ok and shp_ok) else "✗"
        if not (ppp_ok and shp_ok):
            all_correct = False
        
        print(f"{status} {name}:")
        print(f"    PPP: {ppp} (expected: {expected_ppp}) {'✓' if ppp_ok else '✗'}")
        print(f"    SHP: {shp} (expected: {expected_shp}) {'✓' if shp_ok else '✗'}")
        print(f"    Goals: {r.get('nhl_goals', 0)}, Assists: {r.get('nhl_assists', 0)}, Points: {r.get('nhl_points', 0)}")
    else:
        print(f"✗ {name}: Not found")
        all_correct = False

print()
print("=" * 80)
print("FIXES APPLIED")
print("=" * 80)
print()
print("1. ✓ build_player_season_stats.py - Removed nhl_ppp/nhl_shp aggregation")
print("2. ✓ fetch_nhl_stats_from_landing.py - Improved StatsAPI retry logic")
print("3. ✓ fetch_nhl_stats_from_landing.py - Always attempts StatsAPI for hits/blocks")
print("4. ✓ src/pages/Matchup.tsx - Removed PBP fallbacks from player card")
print("5. ✓ Migration files created for RPC fixes:")
print("   - 20250105000001_fix_get_matchup_stats_use_nhl_only.sql")
print("   - 20250105000002_fix_get_daily_game_stats_use_nhl_only.sql")
print()
print("=" * 80)
print("REMAINING TASKS")
print("=" * 80)
print()
print("⚠ MIGRATIONS NEED TO BE APPLIED:")
print("   The RPC migration files have been created but need to be applied")
print("   via Supabase dashboard or CLI:")
print()
print("   1. Go to Supabase Dashboard → SQL Editor")
print("   2. Run: supabase/migrations/20250105000001_fix_get_matchup_stats_use_nhl_only.sql")
print("   3. Run: supabase/migrations/20250105000002_fix_get_daily_game_stats_use_nhl_only.sql")
print()
print("   These migrations ensure:")
print("   - get_matchup_stats() uses nhl_* columns exclusively")
print("   - get_daily_game_stats() uses nhl_* columns exclusively")
print("   - No PBP fallbacks in RPC functions")
print()
print("=" * 80)
if all_correct:
    print("✓✓✓ DATABASE VALUES ARE CORRECT! ✓✓✓")
    print()
    print("All key players have correct PPP/SHP values matching NHL.com")
    print("After applying RPC migrations, matchup and player cards will be 1:1 aligned")
else:
    print("⚠ Some players need verification")
print("=" * 80)

