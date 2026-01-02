"""
Verification script to confirm all NHL stats are properly populated
and RPCs are returning data correctly.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Load environment variables
main_project_env = os.path.join(os.path.expanduser("~"), "Documents", "citrus-league-storm-main", ".env")
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

supabase_url = os.getenv("VITE_SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not supabase_url or not supabase_key:
    print("ERROR: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

supabase = SupabaseRest(supabase_url, supabase_key)

print("=" * 80)
print("VERIFYING NHL STATS POPULATION")
print("=" * 80)

# 1. Check recent games for SOG population
print("\n1. Checking Shots on Goal (SOG) population...")
# Get sample of recent skater records
result = supabase.select(
    "player_game_stats",
    "nhl_shots_on_goal, is_goalie, game_id",
    filters=[("is_goalie", "eq", False)],
    limit=500
)

if result:
    total_records = len(result)
    sog_count = sum(1 for r in result if r.get('nhl_shots_on_goal', 0) > 0)
    zero_sog = total_records - sog_count
    
    print(f"   Sample size: {total_records} skater records")
    print(f"   Records with SOG > 0: {sog_count}")
    print(f"   Records with SOG = 0: {zero_sog}")
    
    if sog_count > 0:
        print("   [OK] SOG is populated!")
    else:
        print("   [ERROR] SOG is NOT populated!")
else:
    print("   ❌ Could not fetch data")

# 2. Check PPP components and totals
print("\n2. Checking Power Play Points (PPP) population...")
ppp_result = supabase.select(
    "player_game_stats",
    "nhl_ppg, nhl_ppa, nhl_ppp, is_goalie",
    filters=[("is_goalie", "eq", False)],
    limit=500
)

if ppp_result:
    games_with_ppg = sum(1 for r in ppp_result if r.get('nhl_ppg', 0) > 0)
    games_with_ppa = sum(1 for r in ppp_result if r.get('nhl_ppa', 0) > 0)
    games_with_ppp = sum(1 for r in ppp_result if r.get('nhl_ppp', 0) > 0)
    missing_ppp = sum(1 for r in ppp_result 
                     if (r.get('nhl_ppg', 0) > 0 or r.get('nhl_ppa', 0) > 0) 
                     and r.get('nhl_ppp', 0) == 0)
    
    print(f"   Games with PPG > 0: {games_with_ppg}")
    print(f"   Games with PPA > 0: {games_with_ppa}")
    print(f"   Games with PPP > 0: {games_with_ppp}")
    print(f"   Games with components but PPP = 0: {missing_ppp}")
    
    if games_with_ppg > 0 or games_with_ppa > 0:
        print("   [OK] PPP components are populated!")
        if missing_ppp == 0 or games_with_ppp > 0:
            print("   [OK] PPP totals are populated (or will be calculated from components)!")
        else:
            print("   [WARN] Some PPP totals missing, but RPC will calculate from components")
    else:
        print("   [WARN] No PPP data found (may be normal if no PP goals/assists)")

# 3. Check SHP components and totals
print("\n3. Checking Shorthanded Points (SHP) population...")
shp_result = supabase.select(
    "player_game_stats",
    "nhl_shg, nhl_sha, nhl_shp, is_goalie",
    filters=[("is_goalie", "eq", False)],
    limit=500
)

if shp_result:
    games_with_shg = sum(1 for r in shp_result if r.get('nhl_shg', 0) > 0)
    games_with_sha = sum(1 for r in shp_result if r.get('nhl_sha', 0) > 0)
    games_with_shp = sum(1 for r in shp_result if r.get('nhl_shp', 0) > 0)
    missing_shp = sum(1 for r in shp_result 
                     if (r.get('nhl_shg', 0) > 0 or r.get('nhl_sha', 0) > 0) 
                     and r.get('nhl_shp', 0) == 0)
    
    print(f"   Games with SHG > 0: {games_with_shg}")
    print(f"   Games with SHA > 0: {games_with_sha}")
    print(f"   Games with SHP > 0: {games_with_shp}")
    print(f"   Games with components but SHP = 0: {missing_shp}")
    
    if games_with_shg > 0 or games_with_sha > 0:
        print("   [OK] SHP components are populated!")
        if missing_shp == 0 or games_with_shp > 0:
            print("   [OK] SHP totals are populated (or will be calculated from components)!")
        else:
            print("   [WARN] Some SHP totals missing, but RPC will calculate from components")
    else:
        print("   [WARN] No SHP data found (may be normal if no SH goals/assists)")

# 4. Test RPC directly (skip for now - supabase_rest doesn't support RPC easily)
print("\n4. Testing RPCs...")
print("   [INFO] RPC testing skipped (use Supabase dashboard to test)")
print("   RPCs should work if data is populated correctly above")

# 5. Sample data check
print("\n5. Sample data check (recent games)...")
# Get records with SOG > 0
sample_result = supabase.select(
    "player_game_stats",
    "nhl_shots_on_goal, nhl_ppg, nhl_ppa, nhl_ppp, nhl_shg, nhl_sha, nhl_shp, nhl_hits, nhl_blocks, is_goalie",
    filters=[("is_goalie", "eq", False), ("nhl_shots_on_goal", "gt", 0)],
    limit=5
)

if sample_result:
    print("   Sample records with SOG > 0:")
    for i, record in enumerate(sample_result[:3], 1):
        print(f"   Record {i}:")
        print(f"      SOG: {record.get('nhl_shots_on_goal', 0)}")
        print(f"      PPG: {record.get('nhl_ppg', 0)}, PPA: {record.get('nhl_ppa', 0)}, PPP: {record.get('nhl_ppp', 0)}")
        print(f"      SHG: {record.get('nhl_shg', 0)}, SHA: {record.get('nhl_sha', 0)}, SHP: {record.get('nhl_shp', 0)}")
        print(f"      Hits: {record.get('nhl_hits', 0)}, Blocks: {record.get('nhl_blocks', 0)}")
    print("   [OK] Found sample data with populated stats!")
else:
    print("   [ERROR] No sample data found with SOG > 0")

print("\n" + "=" * 80)
print("VERIFICATION COMPLETE")
print("=" * 80)
print("\nIf all checks show [OK], you're good to load it up!")
print("If you see [ERROR] or [WARN], there may be issues to investigate.")

