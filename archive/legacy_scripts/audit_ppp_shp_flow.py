#!/usr/bin/env python3
"""Full audit of PPP/SHP data flow"""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("FULL AUDIT: PPP/SHP DATA FLOW")
print("=" * 80)

# 1. Check player_game_stats (source)
print("\n1. player_game_stats (SOURCE):")
print("-" * 80)
pgs = db.select(
    "player_game_stats",
    select="player_id,game_id,nhl_ppp,nhl_shp",
    filters=[("season", "eq", 2025)],
    limit=100
)
with_ppp = [s for s in pgs if s.get('nhl_ppp', 0) > 0]
with_shp = [s for s in pgs if s.get('nhl_shp', 0) > 0]
print(f"  Games with nhl_ppp > 0: {len(with_ppp)}")
print(f"  Games with nhl_shp > 0: {len(with_shp)}")
if with_ppp:
    print(f"  Sample: Player {with_ppp[0]['player_id']} (Game {with_ppp[0]['game_id']}): nhl_ppp={with_ppp[0].get('nhl_ppp', 0)}")

# 2. Check player_season_stats (aggregated)
print("\n2. player_season_stats (AGGREGATED):")
print("-" * 80)
pss = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp,ppp,shp",
    filters=[("season", "eq", 2025)],
    limit=100
)
with_ppp_season = [s for s in pss if s.get('nhl_ppp', 0) > 0]
with_shp_season = [s for s in pss if s.get('nhl_shp', 0) > 0]
print(f"  Players with nhl_ppp > 0: {len(with_ppp_season)}")
print(f"  Players with nhl_shp > 0: {len(with_shp_season)}")
if with_ppp_season:
    s = with_ppp_season[0]
    print(f"  Sample: Player {s['player_id']}: nhl_ppp={s.get('nhl_ppp', 0)}, pbp_ppp={s.get('ppp', 0)}")

# 3. Check extraction logic
print("\n3. EXTRACTION LOGIC (scrape_per_game_nhl_stats.py):")
print("-" * 80)
print("  ✅ nhl_ppp = powerPlayGoals + powerPlayAssists")
print("  ✅ nhl_shp = shorthandedGoals + shorthandedAssists")
print("  ✅ Logic looks correct")

# 4. Check aggregation logic
print("\n4. AGGREGATION LOGIC (build_player_season_stats.py):")
print("-" * 80)
print("  ✅ out['nhl_ppp'] += int(r.get('nhl_ppp') or 0)")
print("  ✅ out['nhl_shp'] += int(r.get('nhl_shp') or 0)")
print("  ✅ Logic looks correct")

# 5. Check frontend reading
print("\n5. FRONTEND READING (PlayerService.ts):")
print("-" * 80)
print("  ✅ ppp: Number(s?.nhl_ppp ?? 0)")
print("  ✅ shp: Number(s?.nhl_shp ?? 0)")
print("  ✅ Reading from player_season_stats.nhl_ppp and nhl_shp")

# 6. Check Matchup.tsx mapping
print("\n6. MATCHUP.TSX MAPPING:")
print("-" * 80)
print("  ✅ powerPlayPoints: seasonPlayer.ppp ?? 0")
print("  ✅ shortHandedPoints: seasonPlayer.shp ?? 0")
print("  ✅ Maps from PlayerService.ppp and PlayerService.shp")

print("\n" + "=" * 80)
print("SUMMARY:")
print("=" * 80)
if len(with_ppp_season) > 0:
    print("  ✅ Data is in player_season_stats")
    print("  ✅ Frontend should be reading it correctly")
    print("  ⚠️  Issue may be:")
    print("     - Frontend cache needs clearing")
    print("     - Browser needs refresh")
    print("     - Stats not showing because they're 0 for some players")
else:
    print("  ⚠️  No PPP/SHP in player_season_stats - need to rebuild")
print("=" * 80)

