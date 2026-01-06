#!/usr/bin/env python3
"""Final status check for all stats."""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Check key players
test_players = [
    (8478402, "Connor McDavid", 31, 2, 18, 18),
    (8482078, "Lucas Raymond", 18, 0, 20, 17),
    (8471675, "Sidney Crosby", 16, 0, 35, 17),
    (8480801, "Brady Tkachuk", 7, 0, 58, 5),
]

print("=" * 80)
print("FINAL STATUS CHECK")
print("=" * 80)
print()

all_good = True
for player_id, name, exp_ppp, exp_shp, exp_hits, exp_blocks in test_players:
    result = db.select(
        "player_season_stats",
        select="nhl_ppp,nhl_shp,nhl_hits,nhl_blocks",
        filters=[("player_id", "eq", player_id), ("season", "eq", 2025)],
        limit=1
    )
    
    if result:
        ppp = result[0].get("nhl_ppp", 0)
        shp = result[0].get("nhl_shp", 0)
        hits = result[0].get("nhl_hits", 0)
        blocks = result[0].get("nhl_blocks", 0)
        
        ppp_ok = ppp == exp_ppp
        shp_ok = shp == exp_shp
        hits_ok = hits == exp_hits
        blocks_ok = blocks == exp_blocks
        
        status = "OK" if (ppp_ok and shp_ok and hits_ok and blocks_ok) else "FAIL"
        if not (ppp_ok and shp_ok and hits_ok and blocks_ok):
            all_good = False
        
        print(f"{status} {name}:")
        print(f"    PPP: {ppp} (exp: {exp_ppp}) {'OK' if ppp_ok else 'FAIL'}")
        print(f"    SHP: {shp} (exp: {exp_shp}) {'OK' if shp_ok else 'FAIL'}")
        print(f"    Hits: {hits} (exp: {exp_hits}) {'OK' if hits_ok else 'FAIL'}")
        print(f"    Blocks: {blocks} (exp: {exp_blocks}) {'OK' if blocks_ok else 'FAIL'}")
    else:
        print(f"FAIL {name}: Not found")
        all_good = False

print()
print("=" * 80)
if all_good:
    print("*** ALL KEY PLAYERS HAVE CORRECT VALUES! ***")
    print()
    print("The fixes are working correctly:")
    print("  - build_player_season_stats.py no longer overwrites PPP/SHP/hits/blocks")
    print("  - Stats are preserved from fetch_nhl_stats_from_landing.py")
else:
    print("Some players need attention")
print("=" * 80)

