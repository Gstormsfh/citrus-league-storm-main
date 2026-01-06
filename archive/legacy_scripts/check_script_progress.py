#!/usr/bin/env python3
"""
Check progress of fetch_nhl_stats_from_landing.py by checking which players have been processed.
We check if players have nhl_goals set (even if 0), which indicates the script has processed them.
"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Get total players
total_players = db.select(
    "player_season_stats",
    select="player_id",
    filters=[("season", "eq", 2025)],
    limit=10000
)
total_count = len(total_players) if total_players else 0

# Check players that have been processed by the script
# The script always sets nhl_goals (even if 0), so we can check if it exists
# Actually, since nhl_goals defaults to 0, we need a different approach
# Let's check players where nhl_points has been explicitly set (the script always sets this)

# Get all players and check if they have nhl_points >= 0 (meaning script processed them)
# But wait, nhl_points might also default to 0...

# Better: Check players where the script has run by looking at players that have
# been updated recently OR have any non-zero NHL stat (indicating processing)
# Actually, the script updates ALL players, so we can't use that...

# Best approach: Count players that have nhl_ppp explicitly set (the script always sets this, even if 0)
# But we need to distinguish between "not set" and "set to 0"
# Since the column defaults to 0, we can't tell...

# Alternative: Check the player_directory to see how many players exist,
# then check how many have been processed by the script
# The script processes all players in player_directory

player_dir_count = db.select(
    "player_directory",
    select="player_id",
    filters=[("season", "eq", 2025)],
    limit=10000
)
total_players_to_process = len(player_dir_count) if player_dir_count else 0

# Now check how many have been processed by looking at players that have
# nhl_goals set AND were updated recently (within last 2 hours)
# Or simpler: just count all players in player_season_stats that match player_directory
# Actually, the script processes players from player_directory and updates player_season_stats

# Simplest: The script processes all players from player_directory
# So total_players_to_process is the target
# We can check progress by seeing how many player_season_stats records exist
# But that doesn't tell us if they've been updated by THIS run...

# Let's use a simpler metric: Check how many players have nhl_ppp that matches
# what we'd expect from the API (non-zero for players who should have it)
# But that's not accurate either...

# Actually, the best way: Track by checking if players have been updated in the
# last X minutes. But we need updated_at to work.

# For now, let's just show:
# 1. Total players to process (from player_directory)
# 2. Total players in player_season_stats
# 3. Players with PPP > 0 (as a sanity check, but acknowledge many will be 0)

players_with_ppp = db.select(
    "player_season_stats",
    select="player_id",
    filters=[
        ("season", "eq", 2025),
        ("nhl_ppp", "gt", 0)
    ],
    limit=10000
)

ppp_count = len(players_with_ppp) if players_with_ppp else 0

print("=" * 80)
print("SCRIPT PROGRESS CHECK")
print("=" * 80)
print(f"Players in player_directory (to process): {total_players_to_process:,}")
print(f"Players in player_season_stats: {total_count:,}")
print(f"Players with PPP > 0: {ppp_count:,}")
print()
print("Note: Many players legitimately have PPP = 0, so this is not")
print("      an accurate progress metric. The script processes ALL players")
print("      from player_directory regardless of their PPP value.")
print()
print("To get accurate progress, check the script's terminal output")
print("which shows '[PROGRESS] Processed X/Y players' every 15 seconds.")
print("=" * 80)
