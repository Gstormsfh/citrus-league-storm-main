#!/usr/bin/env python3
"""Verify hits/blocks update is complete."""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Get all skaters
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

# Count players with any hits/blocks data (even if 0, means script processed them)
# Actually, we can't tell if 0 means "processed" or "not processed" since default is 0
# So let's check players with hits > 0 or blocks > 0 as a proxy

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

print("=" * 80)
print("HITS/BLOCKS UPDATE STATUS")
print("=" * 80)
print(f"Total skaters: {total_count:,}")
print(f"Players with hits > 0: {hits_count:,}")
print(f"Players with blocks > 0: {blocks_count:,}")
print()

# Check a few more players
test_players = [
    (8480801, "Brady Tkachuk"),
    (8471214, "Nathan MacKinnon"),
    (8471675, "Sidney Crosby"),
    (8478402, "Connor McDavid"),
    (8482078, "Lucas Raymond"),
]

print("Sample players:")
all_good = True
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
        status = "OK" if (hits > 0 or blocks > 0) else "ZERO"
        print(f"  {name}: Hits={hits}, Blocks={blocks} [{status}]")
        if hits == 0 and blocks == 0 and name in ["Brady Tkachuk", "Nathan MacKinnon"]:
            all_good = False  # These should have hits
    else:
        print(f"  {name}: Not found")
        all_good = False

print()
if hits_count >= 800:
    print("*** UPDATE APPEARS COMPLETE! ***")
    print(f"   {hits_count:,} players have hits data")
    print(f"   {blocks_count:,} players have blocks data")
    print()
    print("Note: Some players legitimately have 0 hits/blocks")
    print("      If specific players are missing data, StatsAPI may not have it.")
else:
    print(f"Still processing... ({hits_count}/{total_count} with hits)")

print("=" * 80)

