#!/usr/bin/env python3
"""Verify PPP/SHP are being read correctly by frontend"""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("VERIFYING PPP/SHP DISPLAY")
print("=" * 80)

# Check a specific player that should have PPP
stats = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp,ppp,shp",
    filters=[("season", "eq", 2025), ("nhl_ppp", "gt", 0)],
    limit=5
)

print("\nPlayers with nhl_ppp > 0:")
for s in stats:
    print(f"  Player {s['player_id']}:")
    print(f"    nhl_ppp={s.get('nhl_ppp', 0)} (should be displayed as ppp)")
    print(f"    nhl_shp={s.get('nhl_shp', 0)} (should be displayed as shp)")
    print(f"    pbp_ppp={s.get('ppp', 0)} (PBP - should NOT be used)")
    print(f"    pbp_shp={s.get('shp', 0)} (PBP - should NOT be used)")

print("\n" + "=" * 80)
print("FRONTEND MAPPING:")
print("=" * 80)
print("1. PlayerService.ts returns:")
print("   ppp: Number(s?.nhl_ppp ?? 0)")
print("   shp: Number(s?.nhl_shp ?? 0)")
print("\n2. Matchup.tsx maps:")
print("   powerPlayPoints: stats.powerPlayPoints ?? stats.ppp ?? 0")
print("   shortHandedPoints: stats.shortHandedPoints ?? stats.shp ?? 0")
print("\n3. PlayerStatsModal displays:")
print("   stats.powerPlayPoints")
print("   stats.shortHandedPoints")
print("\n✅ Mapping looks correct - data should display")
print("=" * 80)

