#!/usr/bin/env python3
"""Check progress of hits/blocks update."""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Count total skaters
total_skaters = db.select(
    "player_directory",
    select="player_id",
    filters=[
        ("season", "eq", 2025),
        ("is_goalie", "eq", False)
    ],
    limit=10000
)
total_count = len(total_skaters) if total_skaters else 0

# Count players with hits > 0 or blocks > 0 (indicates StatsAPI data exists)
players_with_hits = db.select(
    "player_season_stats",
    select="player_id",
    filters=[
        ("season", "eq", 2025),
        ("nhl_hits", "gt", 0)
    ],
    limit=10000
)
hits_count = len(players_with_hits) if players_with_hits else 0

players_with_blocks = db.select(
    "player_season_stats",
    select="player_id",
    filters=[
        ("season", "eq", 2025),
        ("nhl_blocks", "gt", 0)
    ],
    limit=10000
)
blocks_count = len(players_with_blocks) if players_with_blocks else 0

# Check a few known players who should have hits
test_players = [
    (8480801, "Brady Tkachuk"),  # Known for hits
    (8471214, "Nathan MacKinnon"),
    (8471675, "Sidney Crosby"),
]

print("=" * 80)
print("HITS/BLOCKS UPDATE PROGRESS")
print("=" * 80)
print(f"Total skaters to process: {total_count:,}")
print(f"Players with hits > 0: {hits_count:,}")
print(f"Players with blocks > 0: {blocks_count:,}")
print()

print("Sample players:")
for player_id, name in test_players:
    result = db.select(
        "player_season_stats",
        select="nhl_hits,nhl_blocks",
        filters=[("player_id", "eq", player_id), ("season", "eq", 2025)],
        limit=1
    )
    if result:
        hits = result[0].get("nhl_hits", 0)
        blocks = result[0].get("nhl_blocks", 0)
        print(f"  {name}: Hits={hits}, Blocks={blocks}")
    else:
        print(f"  {name}: Not found")

print()
print("Note: Progress is approximate - many players legitimately have 0 hits/blocks")
print("      The script processes all skaters regardless of their stat values.")
print("=" * 80)

