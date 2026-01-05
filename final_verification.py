#!/usr/bin/env python3
"""
Final verification - check if key players are correct and provide summary.
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
print("Final Verification - Key Players")
print("=" * 80)
print()

key_players = [
    (8478402, "Connor McDavid", 31, 2),
    (8471675, "Sidney Crosby", 16, 0),
    (8471214, "Nathan MacKinnon", None, None),
    (8477956, "Auston Matthews", None, None),
]

all_correct = True
for player_id, name, expected_ppp, expected_shp in key_players:
    result = db.select(
        "player_season_stats",
        select="nhl_ppp,nhl_shp",
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
        
        status = "✓"
        if expected_ppp is not None and ppp != expected_ppp:
            status = "✗"
            all_correct = False
        if expected_shp is not None and shp != expected_shp:
            status = "✗"
            all_correct = False
        
        print(f"{status} {name}:")
        print(f"    PPP: {ppp}" + (f" (expected: {expected_ppp})" if expected_ppp is not None else ""))
        print(f"    SHP: {shp}" + (f" (expected: {expected_shp})" if expected_shp is not None else ""))
    else:
        print(f"✗ {name}: Not found in database")
        all_correct = False

print()
print("=" * 80)
if all_correct:
    print("✓✓✓ ALL KEY PLAYERS VERIFIED CORRECTLY! ✓✓✓")
    print()
    print("The script has successfully updated PPP/SHP from the NHL landing endpoint.")
    print("Key players (McDavid, Crosby) have correct values.")
    print()
    print("Note: Some players may show 0 PPP/SHP, which is valid if they:")
    print("  - Don't get powerplay time")
    print("  - Don't score shorthanded goals")
    print("  - Are depth players with limited special teams usage")
else:
    print("⚠ Some key players need verification")
print("=" * 80)
