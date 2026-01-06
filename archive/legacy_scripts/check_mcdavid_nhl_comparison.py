#!/usr/bin/env python3
"""Compare our McDavid stats with what should be on NHL.com"""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("MCDAVID STATS COMPARISON")
print("=" * 80)

MCDAVID_ID = 8478402

# Get all game stats
game_stats = db.select(
    "player_game_stats",
    select="game_id,game_date,nhl_ppp,nhl_ppg,nhl_ppa,nhl_shp,nhl_shg,nhl_sha,nhl_hits,nhl_blocks,ppp,shp",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID)],
    limit=100
)

print(f"\nTotal games: {len(game_stats)}")

# Calculate totals
nhl_ppp_total = sum(g.get('nhl_ppp', 0) for g in game_stats)
nhl_ppg_total = sum(g.get('nhl_ppg', 0) for g in game_stats)
nhl_ppa_total = sum(g.get('nhl_ppa', 0) for g in game_stats)
nhl_shp_total = sum(g.get('nhl_shp', 0) for g in game_stats)
nhl_hits_total = sum(g.get('nhl_hits', 0) for g in game_stats)
nhl_blocks_total = sum(g.get('nhl_blocks', 0) for g in game_stats)

pbp_ppp_total = sum(g.get('ppp', 0) for g in game_stats)
pbp_shp_total = sum(g.get('shp', 0) for g in game_stats)

print(f"\nNHL Stats (from boxscore):")
print(f"  PPP: {nhl_ppp_total} (PPG: {nhl_ppg_total}, PPA: {nhl_ppa_total})")
print(f"  SHP: {nhl_shp_total}")
print(f"  Hits: {nhl_hits_total}")
print(f"  Blocks: {nhl_blocks_total}")

print(f"\nPBP Stats (calculated):")
print(f"  PPP: {pbp_ppp_total}")
print(f"  SHP: {pbp_shp_total}")

# Check season stats
season_stats = db.select(
    "player_season_stats",
    select="nhl_ppp,nhl_shp,nhl_hits,nhl_blocks,ppp,shp",
    filters=[("season", "eq", 2025), ("player_id", "eq", MCDAVID_ID)],
    limit=1
)

if season_stats:
    s = season_stats[0]
    print(f"\nSeason Stats (player_season_stats):")
    print(f"  nhl_ppp: {s.get('nhl_ppp', 0)}")
    print(f"  nhl_shp: {s.get('nhl_shp', 0)}")
    print(f"  nhl_hits: {s.get('nhl_hits', 0)}")
    print(f"  nhl_blocks: {s.get('nhl_blocks', 0)}")
    print(f"  pbp_ppp: {s.get('ppp', 0)}")
    print(f"  pbp_shp: {s.get('shp', 0)}")

# Check games with zero NHL stats but non-zero PBP stats
zero_nhl_ppp = [g for g in game_stats if g.get('nhl_ppp', 0) == 0 and g.get('ppp', 0) > 0]
print(f"\nGames with PBP PPP but zero NHL PPP: {len(zero_nhl_ppp)}")

# Check games with zero NHL hits/blocks
zero_nhl_hits = [g for g in game_stats if g.get('nhl_hits', 0) == 0]
zero_nhl_blocks = [g for g in game_stats if g.get('nhl_blocks', 0) == 0]
print(f"Games with zero NHL hits: {len(zero_nhl_hits)}")
print(f"Games with zero NHL blocks: {len(zero_nhl_blocks)}")

print("\n" + "=" * 80)

