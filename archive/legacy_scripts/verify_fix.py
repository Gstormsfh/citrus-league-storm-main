#!/usr/bin/env python3
"""
Verify that the fixes are working correctly.
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
print("Verifying Fixes")
print("=" * 80)
print()

# Test players
test_players = [
    (8481524, "Lucas Raymond", 3, 0),  # PPP should be 3, not 1 (PPG)
    (8476453, "Mika Zibanejad", 18, 0),  # PPP should be 18, not 5 (PPG)
    (8478402, "Connor McDavid", 31, 2),  # PPP=31, SHP=2
    (8471675, "Sidney Crosby", 16, 0),  # PPP=16
]

print("Checking PPP/SHP values:")
print()

all_correct = True
for player_id, name, expected_ppp, expected_shp in test_players:
    result = db.select(
        "player_season_stats",
        select="nhl_ppp,nhl_shp,nhl_hits",
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
        hits = r.get("nhl_hits", 0)
        
        ppp_ok = ppp == expected_ppp
        shp_ok = shp == expected_shp
        
        status = "✓" if (ppp_ok and shp_ok) else "✗"
        if not (ppp_ok and shp_ok):
            all_correct = False
        
        print(f"{status} {name}:")
        print(f"    PPP: {ppp} (expected: {expected_ppp}) {'✓' if ppp_ok else '✗'}")
        print(f"    SHP: {shp} (expected: {expected_shp}) {'✓' if shp_ok else '✗'}")
        print(f"    Hits: {hits}")
    else:
        print(f"✗ {name}: Not found in database")
        all_correct = False

print()
print("=" * 80)
if all_correct:
    print("✓✓✓ ALL VERIFICATIONS PASSED! ✓✓✓")
else:
    print("⚠ Some verifications failed - may need to wait for script to complete")
print("=" * 80)

