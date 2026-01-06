#!/usr/bin/env python3
"""
Estimate runtime for fetch_nhl_stats_from_landing.py
"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Count players
players = db.select("player_directory", select="player_id", limit=10000)
player_count = len(players) if players else 0

# Count goalies vs skaters
goalies = db.select("player_directory", select="player_id", filters=[("is_goalie", "eq", True)], limit=10000)
goalie_count = len(goalies) if goalies else 0
skater_count = player_count - goalie_count

print("=" * 80)
print("RUNTIME ESTIMATE for fetch_nhl_stats_from_landing.py")
print("=" * 80)
print()
print(f"Total players: {player_count:,}")
print(f"  - Skaters: {skater_count:,}")
print(f"  - Goalies: {goalie_count:,}")
print()

# Timing estimates
landing_delay = 0.1  # 100ms between landing endpoint requests
statsapi_delay = 0.5  # Average StatsAPI request time (if successful)
statsapi_retry_delay = 2 + 4 + 8 + 16 + 32  # Worst case retry delays = 62 seconds

# Best case (all requests succeed quickly)
best_case_landing = player_count * landing_delay
best_case_statsapi = skater_count * statsapi_delay
best_case_total = best_case_landing + best_case_statsapi

# Average case (some StatsAPI retries)
avg_case_landing = player_count * landing_delay
avg_case_statsapi = skater_count * (statsapi_delay * 1.5)  # 50% need 1 retry
avg_case_total = avg_case_landing + avg_case_statsapi

# Worst case (many StatsAPI failures)
worst_case_landing = player_count * landing_delay
worst_case_statsapi = skater_count * statsapi_retry_delay
worst_case_total = worst_case_landing + worst_case_statsapi

print("Time estimates:")
print(f"  Best case:  {best_case_total/60:.1f} minutes ({best_case_total:.0f} seconds)")
print(f"  Average:   {avg_case_total/60:.1f} minutes ({avg_case_total:.0f} seconds)")
print(f"  Worst case: {worst_case_total/60:.1f} minutes ({worst_case_total:.0f} seconds)")
print()
print("Note: Progress updates appear every 15 seconds")
print("      StatsAPI has 5 retries with exponential backoff (2s, 4s, 8s, 16s, 32s)")
print("=" * 80)

