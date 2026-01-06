#!/usr/bin/env python3
"""Verify that PPP/SHP updates worked correctly."""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Key players we know should have specific values
test_players = [
    (8478402, "Connor McDavid", 31, 2),
    (8482078, "Lucas Raymond", 18, 0),
    (8471675, "Sidney Crosby", 16, 0),
    (8476453, "Mika Zibanejad", 18, 0),
]

print("=" * 80)
print("VERIFYING PPP/SHP UPDATES")
print("=" * 80)
print()

all_correct = True
for player_id, name, expected_ppp, expected_shp in test_players:
    result = db.select(
        "player_season_stats",
        select="nhl_ppp,nhl_shp",
        filters=[("player_id", "eq", player_id), ("season", "eq", 2025)],
        limit=1
    )
    
    if result:
        ppp = result[0].get("nhl_ppp", 0)
        shp = result[0].get("nhl_shp", 0)
        ppp_ok = ppp == expected_ppp
        shp_ok = shp == expected_shp
        
        status = "OK" if (ppp_ok and shp_ok) else "FAIL"
        if not (ppp_ok and shp_ok):
            all_correct = False
        
        print(f"{status} {name}:")
        print(f"    PPP: {ppp} (expected: {expected_ppp}) {'OK' if ppp_ok else 'FAIL'}")
        print(f"    SHP: {shp} (expected: {expected_shp}) {'OK' if shp_ok else 'FAIL'}")
    else:
        print(f"FAIL {name}: Not found")
        all_correct = False

print()
print("=" * 80)

# Count total players with PPP > 0
players_with_ppp = db.select(
    "player_season_stats",
    select="player_id",
    filters=[("season", "eq", 2025), ("nhl_ppp", "gt", 0)],
    limit=10000
)
ppp_count = len(players_with_ppp) if players_with_ppp else 0

print(f"Total players with PPP > 0: {ppp_count:,}")
print()

if all_correct:
    print("*** ALL KEY PLAYERS HAVE CORRECT VALUES! ***")
    print()
    print("The update was successful! Player cards should now show correct PPP/SHP.")
else:
    print("⚠ Some players need verification")

print("=" * 80)

