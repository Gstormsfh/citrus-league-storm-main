#!/usr/bin/env python3
"""Check if PPP and SHP are in player_season_stats"""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("CHECKING PPP AND SHP IN player_season_stats")
print("=" * 80)

# Check players with non-zero PPP or SHP
stats = db.select(
    "player_season_stats",
    select="player_id,nhl_ppp,nhl_shp,ppp,shp",
    filters=[("season", "eq", 2025)],
    limit=100
)

with_ppp = [s for s in stats if s.get('nhl_ppp', 0) > 0]
with_shp = [s for s in stats if s.get('nhl_shp', 0) > 0]

print(f"\nPlayers with nhl_ppp > 0: {len(with_ppp)}")
if with_ppp:
    print("  Sample:")
    for s in with_ppp[:5]:
        print(f"    Player {s['player_id']}: nhl_ppp={s.get('nhl_ppp', 0)}, pbp_ppp={s.get('ppp', 0)}")

print(f"\nPlayers with nhl_shp > 0: {len(with_shp)}")
if with_shp:
    print("  Sample:")
    for s in with_shp[:5]:
        print(f"    Player {s['player_id']}: nhl_shp={s.get('nhl_shp', 0)}, pbp_shp={s.get('shp', 0)}")

print("\n" + "=" * 80)
if len(with_ppp) > 0 and len(with_shp) > 0:
    print("✅ PPP and SHP are in player_season_stats")
else:
    print("⚠️  No PPP/SHP found - may need to rebuild player_season_stats")
print("=" * 80)

