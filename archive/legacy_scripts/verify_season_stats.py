#!/usr/bin/env python3
"""Verify that player_season_stats has NHL stats"""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("VERIFYING player_season_stats HAS NHL STATS")
print("=" * 80)

# Check a few players with stats
stats = db.select(
    "player_season_stats",
    select="player_id,nhl_shots_on_goal,nhl_hits,nhl_blocks,nhl_toi_seconds,shots_on_goal,hits,blocks,icetime_seconds",
    filters=[("season", "eq", 2025)],
    limit=10
)

print(f"\nSample player_season_stats (showing first 5 with non-zero NHL stats):")
print("-" * 80)

players_with_nhl_stats = [s for s in stats if s.get('nhl_shots_on_goal', 0) > 0 or s.get('nhl_hits', 0) > 0 or s.get('nhl_blocks', 0) > 0]

if players_with_nhl_stats:
    for s in players_with_nhl_stats[:5]:
        print(f"  Player {s['player_id']}:")
        print(f"    NHL: SOG={s.get('nhl_shots_on_goal', 0)}, Hits={s.get('nhl_hits', 0)}, Blocks={s.get('nhl_blocks', 0)}, TOI={s.get('nhl_toi_seconds', 0)}s")
        print(f"    PBP: SOG={s.get('shots_on_goal', 0)}, Hits={s.get('hits', 0)}, Blocks={s.get('blocks', 0)}, TOI={s.get('icetime_seconds', 0)}s")
    print(f"\n  ✅ Found {len(players_with_nhl_stats)} players with NHL stats")
else:
    print("  ⚠️  No players with NHL stats found")

# Count total players with NHL stats
all_stats = db.select(
    "player_season_stats",
    select="player_id,nhl_shots_on_goal,nhl_hits,nhl_blocks",
    filters=[("season", "eq", 2025)],
    limit=1000
)

with_nhl = sum(1 for s in all_stats if s.get('nhl_shots_on_goal', 0) > 0 or s.get('nhl_hits', 0) > 0 or s.get('nhl_blocks', 0) > 0)
print(f"\n  Total players checked: {len(all_stats)}")
print(f"  Players with NHL stats: {with_nhl}")

print("\n" + "=" * 80)
if with_nhl > 0:
    print("✅ SUCCESS: player_season_stats has NHL stats aggregated!")
    print("   Frontend should now display hits, blocks, and SOG correctly.")
else:
    print("⚠️  WARNING: No NHL stats found in player_season_stats")
print("=" * 80)

